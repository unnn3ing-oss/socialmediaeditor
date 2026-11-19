// YT 批量下載：外掛背景模組（由工具箱核心載入，匯出的函式就是 op，網頁用 `ytdl.<名稱>` 呼叫）。
// 負責 Native Messaging 連線與下載清單，網頁關著下載也照跑；網頁只是清單的畫面。
// 協定見 tools/ytdl/PROTOCOL.md。模組最上層不碰 chrome.*，需要的都在 init() 裡。
import { HOST_NAME } from "./lib/constants.js";
import { classifyConnectError } from "./lib/platform.js";
import { applyUpdate, collectUpdateInfo } from "./lib/update-pipeline.js";
import { createCheckRunner, recordCheck, recordFailure } from "./lib/update-state.js";
import { createController } from "./lib/queue-controller.js";
import { OUTPUT_DIR_LOCKED_TEXT } from "./lib/queue.js";
import { NOT_CONNECTED_TEXT, diagnosticsReply } from "./lib/diagnostics.js";
import { injectBridge } from "./lib/inject.js";
import { describeTab } from "./lib/page.js";

const NOT_READY = { ok: false, code: "not_ready", error: "下載功能還沒啟動，請重新整理頁面或重新載入外掛" };
const NOT_CONNECTED = "尚未連線下載助手";
const STORAGE_QUEUE = "ytdl-queue";
const UPDATE_ALARM = "ytdl-check-update";

let ctx = null;            // init 之後才有
let port = null;           // Native Messaging 連線
let status = { state: "stopped", ready: null, detail: null };
let controllerReady = null; // Promise<controller>
let updating = false;
let listenersAdded = false;
let checks = null;
let checkedOnConnect = false;
let requestSeq = 0;
const waiting = new Map();

const snapshot = () => ({ type: "status", ...status });
const emit = (data) => { try { ctx?.push(data); } catch { /* 沒人訂閱 */ } };

function setStatus(next) {
  status = next;
  emit(snapshot());
}

// ---- 對下載助手發的請求（reqId 前綴 "bg:"，和助手主動送的事件分開）----
const host = {
  connected: () => Boolean(port) && status.state === "running",
  version: () => status.ready?.hostVersion ?? null,
  outputDir: () => status.ready?.outputDir ?? null,
  send(message) {
    if (!port) throw new Error(NOT_CONNECTED);
    port.postMessage(message);
  },
  request(message, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!port) { reject(new Error(NOT_CONNECTED)); return; }
      const reqId = `bg:${++requestSeq}`;
      const timer = setTimeout(() => {
        waiting.delete(reqId);
        reject(new Error("逾時，沒有收到回應"));
      }, timeoutMs);
      waiting.set(reqId, { resolve, reject, timer });
      port.postMessage({ ...message, reqId });
    });
  },
};

function failWaiting(error) {
  for (const { reject, timer } of waiting.values()) {
    clearTimeout(timer);
    reject(error);
  }
  waiting.clear();
}

// ---- 下載清單：開機時從 storage 還原、最多每 500ms 存一次、最多每 200ms 推給網頁一次 ----
let saveTimer = null;
let latestQueue = null;
function saveQueue(state) {
  latestQueue = state;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { Promise.resolve(chrome.storage.local.set({ [STORAGE_QUEUE]: latestQueue })).catch(() => {}); } catch { /* 存不了就算了 */ }
  }, 500);
}

let pushTimer = null;
let lastPush = 0;
function pushQueue() {
  const wait = 200 - (Date.now() - lastPush);
  if (wait > 0) {
    pushTimer ??= setTimeout(() => { pushTimer = null; pushQueue(); }, wait);
    return;
  }
  lastPush = Date.now();
  controllerReady?.then((controller) => emit({ type: "queue_state", state: controller.getState() }));
}

function onHostMessage(msg) {
  if (msg.type === "ready") {
    setStatus({ state: "running", ready: msg, detail: null });
    controllerReady?.then((controller) => controller.onHostConnected(msg));
    if (!checkedOnConnect) {
      checkedOnConnect = true;
      checks?.trigger();
    }
    return;
  }
  const waiter = typeof msg.reqId === "string" && msg.reqId.startsWith("bg:") ? waiting.get(msg.reqId) : null;
  controllerReady?.then((controller) => controller.onHostEvent(msg));
  if (waiter) {
    clearTimeout(waiter.timer);
    waiting.delete(msg.reqId);
    waiter.resolve(msg);
  }
}

function connect() {
  if (port) return;
  const p = chrome.runtime.connectNative(HOST_NAME);
  port = p;
  p.onMessage.addListener(onHostMessage);
  p.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message;
    const kind = classifyConnectError(message);
    if (port === p) port = null;
    failWaiting(new Error("與下載助手的連線中斷"));
    controllerReady?.then((controller) => controller.onHostDisconnected());
    const state = kind === "not_installed" ? "not_installed" : kind === "forbidden" ? "forbidden" : "stopped";
    setStatus({ state, ready: null, detail: message ?? null });
  });
}

// 主動斷開（更新後要重新啟動下載助手用新檔案），不當成錯誤。
function disconnect() {
  const p = port;
  if (!p) return;
  port = null;
  try { p.disconnect(); } catch { /* 已經斷了 */ }
  failWaiting(new Error("與下載助手的連線中斷"));
  controllerReady?.then((controller) => controller.onHostDisconnected());
  setStatus({ state: "stopped", ready: null, detail: null });
}

// ---- op 外殼：統一回 {ok,data} / {ok:false,error,code?}，init 前呼叫回錯誤不拋例外 ----
function fromReply(reply) {
  if (reply && reply.ok === false) return { ok: false, error: reply.error ?? "失敗", ...(reply.code ? { code: reply.code } : {}) };
  const { ok, ...data } = reply ?? {};
  return { ok: true, data };
}

async function withController(fn) {
  if (!ctx || !controllerReady) return NOT_READY;
  try {
    return await fn(await controllerReady);
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), code: error?.code ?? "op_failed" };
  }
}

const queueOp = (fn) => async (payload = {}) => withController(async (controller) => fromReply(await fn(controller, payload)));

// ---- 狀態與連線 ----
export async function get_status() {
  if (!ctx) return NOT_READY;
  const { type, ...data } = snapshot();
  return { ok: true, data };
}

export async function start() {
  if (!ctx) return NOT_READY;
  try {
    connect();
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  return { ok: true, data: {} };
}

export async function set_output_dir({ path } = {}) {
  if (!ctx) return NOT_READY;
  if (!host.connected()) return { ok: false, error: "請先連線下載助手" };
  // 一個工作會把影片和封面都寫進開始時的資料夾：換資料夾要等下一個工作
  if ((await controllerReady).outputDirLocked()) return { ok: false, error: OUTPUT_DIR_LOCKED_TEXT };
  try {
    const event = await host.request({ type: "set_config", outputDir: path });
    if (event.type !== "config") return { ok: false, error: event.message ?? "無法使用這個資料夾" };
    status = { ...status, ready: { ...status.ready, outputDir: event.outputDir } };
    emit(snapshot());
    return { ok: true, data: { outputDir: event.outputDir } };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// 「檢查環境」：下載助手看看裝了什麼、什麼能跑；帶 fix 就先修復安全可修的部分。
export async function doctor({ fix } = {}) {
  if (!ctx) return NOT_READY;
  if (!host.connected()) return { ok: false, error: "尚未連線下載助手。連不上的時候，重新執行安裝檔就會自動檢查並修復。" };
  try {
    const event = await host.request({ type: "doctor", extensionId: chrome.runtime.id, fix: fix === true }, 120000);
    if (event.type !== "doctor") return { ok: false, error: event.message ?? "檢查失敗" };
    return { ok: true, data: { checks: event.checks, fixed: event.fixed } };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// 「複製診斷資訊」：下載助手產生純文字報告（版本、環境檢查、近期紀錄），交給網頁複製。
export async function diagnostics() {
  if (!ctx) return NOT_READY;
  if (!host.connected()) return { ok: false, error: NOT_CONNECTED_TEXT };
  try {
    const reply = diagnosticsReply(await host.request({ type: "diagnostics" }, 60000));
    return reply.ok ? { ok: true, data: { text: reply.text } } : { ok: false, error: reply.error };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// 「更新下載引擎（yt-dlp）」：等下載助手回 engine_updated 再回覆。
export async function update_engine() {
  if (!ctx) return NOT_READY;
  if (!host.connected()) return { ok: false, error: NOT_CONNECTED };
  try {
    const event = await host.request({ type: "update_engine" }, 290000);
    if (event.type === "error") return { ok: false, error: event.message ?? "更新失敗" };
    return { ok: true, data: { ytdlpVersion: event.ytdlpVersion ?? null } };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ---- 下載助手自動更新（只比對 tools/ytdl/host/ 這層的 *.py）----
const hostRequestIfConnected = () => (host.connected() ? (message, timeout) => host.request(message, timeout) : null);

const currentUpdateInfo = () => collectUpdateInfo({ hostRequest: hostRequestIfConnected(), hostVersion: host.version() });

export async function update_info() {
  if (!ctx) return NOT_READY;
  try {
    const info = await currentUpdateInfo();
    await recordCheck(info);
    return {
      ok: true,
      data: {
        current: info.current, hostVersion: info.hostVersion, latestSha: info.sha, date: info.date, message: info.message,
        hostCount: info.hostChanged.length, hostChecked: info.hostChecked, hasUpdate: info.hasUpdate,
      },
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function update_apply({ sha } = {}) {
  if (!ctx) return NOT_READY;
  if (updating) return { ok: false, error: "正在更新中" };
  if (!host.connected()) return { ok: false, error: "請先讓下載助手連線（按「啟動」），再更新" };
  updating = true;
  try {
    const info = await currentUpdateInfo();
    if (typeof sha === "string" && sha !== info.sha) return { ok: false, error: "GitHub 上又有更新的版本了，請再按一次「檢查更新」" };
    if (!info.hasUpdate) return { ok: true, data: { count: 0, nothing: true } };
    const result = await applyUpdate({
      info,
      hostRequest: (message, timeout) => host.request(message, timeout),
      onProgress: (p) => emit({ type: "update_progress", ...p }),
    });
    // 下載助手用新檔案重新啟動：斷開後重新連線（不重新載入外掛）。
    disconnect();
    setTimeout(() => { try { connect(); } catch { /* 網頁會顯示未連線，可按啟動 */ } }, 800);
    return { ok: true, data: { count: result.count } };
  } catch (error) {
    return { ok: false, error: error.message, code: error.code ?? undefined };
  } finally {
    updating = false;
  }
}

// ---- 下載清單 ----
export const queue_get = queueOp((c) => ({ ok: true, state: c.getState() }));
export const queue_add = queueOp((c, { url }) => c.add(url));
export const queue_remove = queueOp((c, { uid }) => { c.remove(uid); return { ok: true }; });
export const queue_clear = queueOp((c) => c.clearAll());
export const queue_retry = queueOp((c, { uid }) => { c.retry(uid); return { ok: true }; });
export const queue_start = queueOp((c) => c.start());
export const queue_stop = queueOp((c) => { c.stop(); return { ok: true }; });
export const queue_copy_text = queueOp((c, { uid }) => c.copyText(uid));
export const queue_download_cover = queueOp((c, { uid }) => c.downloadCover(uid));
export const settings_set = queueOp((c, { settings }) => { c.setSettings(settings); return { ok: true }; });

// ---- 目前分頁（側邊欄的「目前分頁」卡）：只回 YouTube／Instagram 網址的分頁；其他分頁回 null ----
// 不需要 tabs 權限：這些網站已在 host 權限內，Chrome 才會給網址與標題。
async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return describeTab(tab?.url, tab?.title);
  } catch { return null; }
}
let tabTimer = null;
function pushTab() {
  clearTimeout(tabTimer);
  tabTimer = setTimeout(async () => emit({ type: "current_tab", tab: await activeTab() }), 150);
}
export async function current_tab() {
  if (!ctx) return NOT_READY;
  return { ok: true, data: { tab: await activeTab() } };
}

// ---- 啟動 ----
async function backgroundCheck() {
  if (updating) return; // 更新正在寫同一批檔案
  try {
    await recordCheck(await currentUpdateInfo());
  } catch (error) {
    await recordFailure(error.message);
  }
}

async function ensureUpdateAlarm() {
  if (!(await chrome.alarms.get(UPDATE_ALARM))) {
    await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
  }
}

export function init(context) {
  ctx = context;
  port = null;
  status = { state: "stopped", ready: null, detail: null };
  checkedOnConnect = false;
  checks = createCheckRunner(backgroundCheck);

  controllerReady = Promise.resolve()
    .then(() => chrome.storage.local.get(STORAGE_QUEUE))
    .catch(() => ({}))
    .then((stored) => createController({
      host,
      save: saveQueue,
      notify: pushQueue,
      fetchFn: (url, options) => fetch(url, options),
      downloads: chrome.downloads,
      initial: stored?.[STORAGE_QUEUE] ?? null,
      prefetchTags: true, // 每支影片的說明文字都先讀好，網頁才能顯示
    }));

  ctx.onSubscribe((send) => {
    send(snapshot());
    controllerReady.then((controller) => send({ type: "queue_state", state: controller.getState() })).catch(() => {});
  });

  if (!listenersAdded) {
    listenersAdded = true;
    // 外掛重新載入後，已開著的工具箱分頁要補上 bridge（核心 bridge 能防重複注入）。
    chrome.runtime.onStartup?.addListener(() => { injectBridge(chrome); checks?.trigger(); });
    chrome.alarms?.onAlarm?.addListener((alarm) => { if (alarm.name === UPDATE_ALARM) checks?.trigger(); });
    chrome.tabs?.onActivated?.addListener(pushTab);
    chrome.windows?.onFocusChanged?.addListener(pushTab);
    chrome.tabs?.onUpdated?.addListener((_id, change, tab) => { if (tab?.active && (change.url || change.title || change.status === "complete")) pushTab(); });
  }
  injectBridge(chrome);
  ensureUpdateAlarm().catch(() => {});
}
