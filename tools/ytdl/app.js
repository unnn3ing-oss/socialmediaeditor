// YT 批量下載（網頁）：它是「遙控器」。清單與下載由小編工具箱外掛保管，並透過 Native Messaging 交給你電腦上的下載助手；
// 這個頁面只顯示同一份清單，並帶使用者做第一次設定（見 tools/ytdl/PROTOCOL.md）。
import { tb } from "../../sdk/toolbox.js";
import * as fx from "../../ui/fx.js";
import { createBridgeClient } from "./web/bridge-client.js";
import {
  addPastedUrls, bindClearAll, bindNumberSetting, copyRowText, downloadRowCover, renderAbortNote, renderClearButton, renderFormatPicker,
  renderHostNote, renderQueue, setHidden, setText, startTicker,
} from "./web/queue-view.js";
import { OUTPUT_DIR_LOCKED_TEXT, cooldownText, outputDirLocked, summarize } from "./ext/lib/queue.js";
import { UPDATING_HINT, UPDATING_TEXT, createReloadWait, describeOutcome } from "./web/update-wait.js";
import { createAutoConnect, extensionNotice, hostNotice } from "./web/connection.js";
import { runCopyDiagnostics, runDoctor } from "./web/doctor-view.js";
import { connectSummary, detectOs, installerAdvice, isDeployed, macInstallCommand, wizardSteps } from "./web/setup-flow.js";

tb.init("ytdl");

const $ = (id) => document.getElementById(id);
const client = createBridgeClient({ ext: tb.ext });
let status = { state: "stopped", ready: null, detail: null };
let queue = null;
let everDetected = false; // 外掛在這次開頁後回應過
let hostWasRunning = false; // 下載助手也連上過
let gaveUp = false; // 自動啟動下載助手停了（它一直馬上關閉）
const autoConnect = createAutoConnect();
const send = (message, timeoutMs) => client.request(message, timeoutMs);

function setNote(id, text, kind = "info") {
  const node = $(id);
  node.textContent = text ?? "";
  node.dataset.kind = kind;
  node.hidden = !text;
}

// ---------- 設定步驟 ----------
const os = detectOs();
const INSTALLER_SEEN = "ytdl-installer-seen"; // 使用者按過「我已執行安裝檔」
const readSeen = () => { try { return localStorage.getItem(INSTALLER_SEEN) === "1"; } catch { return false; } };
const writeSeen = () => { try { localStorage.setItem(INSTALLER_SEEN, "1"); } catch { /* 無痕視窗：下次再問 */ } };
let passedInstaller = readSeen();
const loadedAt = Date.now();
let unhealthySince = loadedAt;
let wasDeployed = false;
let setupOverride = null; // null＝自動（沒連好才展開）；true／false＝使用者按「設定步驟」決定

const deployed = () => isDeployed({ detected: client.detected(), status, hostOutdated: Boolean(queue?.hostOutdated) });

const isSide = document.documentElement.classList.contains("is-side"); // 嵌在外掛側邊欄（?embed=side）
const dialog = $("setup-card");
let viewStep = null; // 使用者按上一步／下一步看的那一步；null＝跟著「現在該做」那一步
let lastSuggested = 0;
let closingByCode = false;

function showDialog(show) {
  if (show && !dialog.open) { try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); } }
  else if (!show && dialog.open) { closingByCode = true; dialog.close(); } // close 事件是非同步的，旗標在事件裡才清掉
}

function renderSteps(states, suggested) {
  if (suggested !== lastSuggested) { lastSuggested = suggested; viewStep = null; } // 進度往前了：跳到新的那一步
  const current = viewStep ?? suggested;
  document.querySelectorAll("#steps .step").forEach((step) => {
    const n = Number(step.dataset.step);
    step.dataset.s = states[n - 1];
    step.hidden = n !== current;
  });
  document.querySelectorAll(".stepper li").forEach((item) => {
    const n = Number(item.dataset.step);
    item.dataset.s = states[n - 1];
    const button = item.querySelector("button");
    if (n === current) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
  });
  $("step-prev").disabled = current <= 1;
  $("step-next").disabled = current >= 3;
}

function renderSetup() {
  const detected = client.detected();
  const ok = deployed();
  const now = Date.now();
  if (ok && !wasDeployed) { wasDeployed = true; setupOverride = null; } // 連好了：自動關閉
  else if (!ok && wasDeployed) { wasDeployed = false; unhealthySince = now; setupOverride = null; }
  // 自動打開只在「還沒連上下載助手」時；已連上但缺元件，看頂部提示與「環境檢查」，不擋住清單
  const show = setupOverride ?? (detected && !ok && status.state !== "running" && now - unhealthySince >= 1500);
  showDialog(show);
  $("open-setup").setAttribute("aria-expanded", String(show));

  const { states, suggested } = wizardSteps({ detected, passedInstaller, status, deployed: ok });
  renderSteps(states, suggested);
  $("setup-dot").dataset.s = ok ? "done" : detected && status.state === "running" ? "warn" : "todo";
  setHidden($("ext-found"), !detected);
  setText($("ext-version"), detected && client.version() ? `（v${client.version()}）` : "");
  const summary = connectSummary({ detected, deployed: ok, status });
  setText($("connect-status"), summary.text);
  setHidden($("connect-status"), !detected);
  $("connect-status").dataset.ok = String(summary.ok);
  const advice = detected ? installerAdvice(status) : null;
  setText($("installer-advice"), advice ?? "");
  setHidden($("installer-advice"), !advice);
  $("start").disabled = !detected;
  $("installer-ran").disabled = !detected;

  const pill = $("conn-pill");
  pill.className = `pill ${ok ? "pill-ok" : "pill-warn"}`;
  setText(pill, ok ? "已連線" : status.state === "running" ? "需要處理" : "尚未連上下載助手");
  setHidden(pill, !detected); // 沒外掛時只留頂部那一個提示區塊，不重複講
  syncSetupTimer();
}

dialog.addEventListener("close", () => { if (closingByCode) { closingByCode = false; return; } { setupOverride = false; renderSetup(); $("open-setup").focus(); } });
$("setup-close").addEventListener("click", () => { setupOverride = false; renderSetup(); $("open-setup").focus(); });
$("step-prev").addEventListener("click", () => { viewStep = Math.max(1, (viewStep ?? lastSuggested) - 1); renderSetup(); });
$("step-next").addEventListener("click", () => { viewStep = Math.min(3, (viewStep ?? lastSuggested) + 1); renderSetup(); });
document.querySelectorAll(".stepper li").forEach((item) => item.querySelector("button").addEventListener("click", () => { viewStep = Number(item.dataset.step); renderSetup(); }));

$("open-setup").addEventListener("click", () => { setupOverride = !dialog.open; renderSetup(); });
function installOpener() {
  // 工具在外殼的 iframe 裡：請外殼開安裝教學；單獨開這個頁面時拿不到
  try {
    const shell = window.parent !== window ? window.parent.tbxShell : null;
    if (shell && typeof shell.openInstall === "function") return () => shell.openInstall();
  } catch { /* 跨來源：外殼拿不到 */ }
  return null;
}
const canOpenInstall = () => installOpener() !== null;
const PHONE_UNSUPPORTED_TEXT = "此功能需在已安裝外掛與下載助手的電腦使用。手機無法安裝下載助手，請改用電腦開啟本頁。";
const smallScreen = () => { try { return window.matchMedia("(max-width: 820px)").matches; } catch { return false; } };
try { window.matchMedia("(max-width: 820px)").addEventListener("change", () => render()); } catch { /* 舊瀏覽器沒有 change 事件 */ }
function openInstall() {
  const open = installOpener();
  if (open) { try { open(); return; } catch { /* 退回文字說明 */ } }
  setHidden($("install-hint"), false);
}
$("open-install").addEventListener("click", openInstall);
$("no-ext-install").addEventListener("click", openInstall);
$("installer-ran").addEventListener("click", () => { passedInstaller = true; writeSeen(); renderSetup(); });
$("start").addEventListener("click", () => {
  autoConnect.reset();
  gaveUp = false;
  render();
  send({ type: "start" }).catch(() => {});
});

async function copyText(text, button, failNoteId, failText) {
  const label = fx.restLabel(button);
  try {
    await navigator.clipboard.writeText(text);
    setNote(failNoteId, "");
    fx.ok(button, "已複製", label);   // 按鈕回饋（ui/fx.js）：打勾 1.5 秒
  } catch {
    setNote(failNoteId, failText, "error");
    fx.fail(button, label);
  }
}
$("copy-mac-command").addEventListener("click", (event) => copyText(macInstallCommand(), event.currentTarget, "installer-status", `無法自動複製，請自己輸入：${macInstallCommand()}`));
$("mac-command").textContent = macInstallCommand();
document.querySelectorAll("[data-os]").forEach((node) => setHidden(node, os !== "other" && node.dataset.os !== os)); // 不認得的系統兩邊都看得到

// ---------- 畫面 ----------
function renderQueueArea() {
  const detected = client.detected();
  const connected = detected && status.state === "running";
  document.body.classList.toggle("is-locked", !detected);
  $("add-card").inert = !detected;
  $("queue-card").inert = !detected;
  const updating = reloading();
  const missing = extensionNotice({ detected, everDetected, updating });
  // 手機／小螢幕且沒有外掛：這個功能要在裝了外掛與下載助手的電腦使用，不引導在手機安裝
  const phoneOnly = !detected && smallScreen();
  document.body.classList.toggle("no-desktop", phoneOnly);
  setText($("no-ext-text"), phoneOnly ? PHONE_UNSUPPORTED_TEXT : missing ? missing + (canOpenInstall() ? "" : "請到小編工具箱首頁，按頂列的「安裝外掛」。") : "");
  setHidden($("no-extension"), !missing && !phoneOnly);
  setHidden($("no-ext-install"), phoneOnly || !canOpenInstall());
  setHidden($("work"), !detected); // 沒外掛時整個收起（只隱藏，輸入的內容還在），連上自動恢復
  setHidden($("side"), !detected);
  renderTabCard();
  const hostText = hostNotice({ detected, status, wasRunning: hostWasRunning, gaveUp, updating });
  setText($("conn-note"), hostText?.text ?? "");
  $("conn-note").dataset.kind = hostText?.kind ?? "info";
  setHidden($("conn-note"), !hostText);
  for (const id of ["add-url", "add-btn", "tab-add", "cooldown", "limit", "auto-cover"]) $(id).disabled = !detected || $(id).classList.contains("fx-busy");   // 轉圈中維持停用（避免重複送出）
  renderHostNote($("host-note"), queue, { updateAvailable: updateOffered() });
  const folderLocked = outputDirLocked(queue); // 下載中的工作沿用開始時的資料夾，改了要等下一批
  $("outdir").disabled = !connected || folderLocked;
  $("save-outdir").disabled = !connected || folderLocked || $("save-outdir").classList.contains("fx-busy");
  setText($("outdir-hint"), folderLocked ? OUTPUT_DIR_LOCKED_TEXT : "");
  setHidden($("outdir-hint"), !folderLocked);
  $("doctor-check").disabled = !connected;
  if (connected && status.ready?.outputDir && document.activeElement !== $("outdir")) $("outdir").value = status.ready.outputDir;

  if (!queue) {
    $("queue-empty").hidden = false;
    $("start-all").disabled = true;
    return;
  }
  const info = summarize(queue);
  const now = Date.now();
  renderQueue($("queue-list"), queue, now, {
    askBeforeRemove: true,
    remove: (uid) => send({ type: "queue_remove", uid }),
    retry: (uid) => send({ type: "queue_retry", uid }),
    copy: (uid, button) => copyRowText(send, uid, button),
    cover: (uid, button) => downloadRowCover(send, uid, button),
  }, { showText: !isSide }); // 網頁在每支影片下面顯示【標題】與標籤；側邊欄不顯示（用「複製內文」）
  $("queue-empty").hidden = queue.items.length > 0;
  // 標題列只寫總數；即時狀態（幾秒後下一支）由右邊的倒數膠囊顯示
  $("queue-stats").textContent = queue.items.length ? `共 ${info.total} 支` : "";
  const cooling = cooldownText(queue, now);
  $("cooldown-chip").hidden = !cooling;
  if (cooling) $("cooldown-chip").textContent = cooling;

  const button = $("start-all");
  // 按下「開始／停止」後轉圈，等下載助手回報狀態真的變了才換回（最多等 10 秒）
  if (startPending && queue.running === startPending.wasRunning && Date.now() - startPending.at < 10000) return renderQueueTail(detected);
  startPending = null;
  button.removeAttribute("aria-busy");
  button.className = `btn btn-sm ${queue.running ? "btn-danger" : "btn-primary"}`;
  button.textContent = queue.running ? "停止" : info.total && info.waiting === 0 && info.done > 0 ? "全部完成" : "開始全部下載";
  button.disabled = !queue.running && (!connected || queue.hostOutdated || info.waiting === 0);
  renderQueueTail(detected);
}
// renderQueueArea 的後半（開始鈕轉圈中時也要照常更新）
function renderQueueTail(detected) {
  renderAbortNote($("abort-note"), queue);
  renderClearButton($("clear-all"), queue);

  renderFormatPicker({ mode: $("mode"), quality: $("quality"), audio: $("audio-format") }, queue.settings, { disabled: !detected });
  if (document.activeElement !== $("cooldown")) $("cooldown").value = String(queue.settings.cooldownSec);
  $("cooldown-out").textContent = `${queue.settings.cooldownSec} 秒`;
  if (document.activeElement !== $("limit")) $("limit").value = String(queue.settings.limit);
  $("auto-cover").checked = queue.settings.autoCover !== false;
}

function render() {
  renderSetup();
  renderUpdate();
  renderQueueArea();
}

// 只是時間過去，也可能該把設定步驟展開：只在「尚未連好」時才跑；連好就停，斷線（render）再啟動
let setupTimer = null;
function syncSetupTimer() {
  const need = !deployed();
  if (need && !setupTimer) setupTimer = setInterval(renderSetup, 500);
  else if (!need && setupTimer) { clearInterval(setupTimer); setupTimer = null; }
}
syncSetupTimer();

// ---------- 連線 ----------
let notRunningAt = 0; // 最後一次看到下載助手沒在跑（更新後重新啟動會留下這個時間）
function setStatus(next) {
  status = { state: next.state, ready: next.ready ?? null, detail: next.detail ?? null };
  if (next.state !== "running") notRunningAt = Date.now();
  if (next.state === "running") hostWasRunning = true;
}

async function refresh() {
  try {
    const [nextStatus, nextQueue] = await Promise.all([send({ type: "get_status" }), send({ type: "queue_get" })]);
    if (nextStatus?.ok) setStatus(nextStatus);
    if (nextQueue?.ok) queue = nextQueue.state;
  } catch { /* 外掛又不見了：下一次 change 事件會處理 */ }
  render();
}

client.onChange((detected) => {
  if (detected) {
    everDetected = true;
    autoConnect.reset();
    gaveUp = false;
    refresh();
    connectHost();
  } else {
    render();
  }
});
client.onState((state) => { queue = state; renderQueueArea(); });
client.onVersion(() => renderSetup());
client.onStatus((next) => { setStatus(next); render(); });

// 外掛在了之後，一直請它連下載助手直到有回應（使用者可能還在跑安裝檔）。一直馬上關閉的下載助手只重試幾次（見 createAutoConnect）。
function connectHost() {
  const next = autoConnect.next(client.detected(), status);
  if (next.gaveUp !== gaveUp) {
    gaveUp = next.gaveUp;
    render();
  }
  if (next.send) send({ type: "start" }).catch(() => {});
}
// 這個 3 秒計時保留：連上時 autoConnect 回傳 send:false（不送訊息，幾乎無成本），斷線後靠它自動重連
setInterval(connectHost, 3000);

// ---------- 側邊欄：目前分頁 ----------
// 網頁：左側欄的 details 固定展開（summary 由 CSS 隱藏）；側邊欄：預設收合「設定與工具」。
if (!isSide) $("side-tools").open = true;
let currentTab = null; // { url, kind, chip, title }：作用中分頁是 YouTube／IG 時才有（外掛推播）
const tabCardShown = () => isSide && Boolean(currentTab);
// 在 YouTube／IG 分頁時：卡片上的「增加」代替網址框與下方「增加」（要貼別的網址就切到其他分頁）
function renderTabCard() {
  const shown = tabCardShown() && client.detected();
  setHidden($("tab-card"), !shown);
  setHidden($("add-in"), shown);
  setHidden($("add-btn"), shown);
  if (!shown) return;
  $("tab-add").setAttribute("aria-label", `增加目前分頁：${currentTab.title}`);
  setText($("tab-kind"), currentTab.chip);
  setText($("tab-title"), currentTab.title);
  $("tab-title").title = currentTab.title;
}
function setCurrentTab(tab) {
  currentTab = tab && typeof tab.url === "string" ? tab : null;
  renderTabCard();
}
if (isSide) {
  client.onTab(setCurrentTab);
  client.onChange((detected) => { if (detected) send({ type: "current_tab" }).then((r) => { if (r?.ok) setCurrentTab(r.tab); }).catch(() => {}); });
  // 側邊欄：「開始全部下載」放清單最下面滿版（只搬一次，不重建）
  $("queue-foot").append($("start-all"));
  setHidden($("queue-foot"), false);
}
$("tab-add").addEventListener("click", async () => {
  if (!currentTab || $("tab-add").classList.contains("fx-busy")) return;
  const button = $("tab-add"), back = fx.restLabel(button);
  fx.busy(button, "增加中");
  let err = "";
  try {
    const result = await send({ type: "queue_add", url: currentTab.url });
    err = result?.ok === false ? result.error || "無法加入" : "";
  } catch (error) { err = error.message || "無法加入"; }
  setNote("add-note", err, "error");
  if (err) fx.fail(button, back, { disabled: !client.detected() }); else fx.ok(button, "已增加", back, null, { disabled: !client.detected() });
});

// ---------- 加入與執行 ----------
async function addFromBox() {
  const button = $("add-btn");
  if (button.classList.contains("fx-busy")) return;
  if (!$("add-url").value.trim()) { setNote("add-note", await addPastedUrls($("add-url"), send), "error"); return; }
  const back = fx.restLabel(button);
  fx.busy(button, "增加中");   // 按鈕回饋（ui/fx.js）：全部加入打勾，有加不進去的抖動（原因寫在下面）
  const note = await addPastedUrls($("add-url"), send);
  setNote("add-note", note, "error");
  const opts = { disabled: !client.detected() };
  if (note) fx.fail(button, back, opts); else fx.ok(button, "已增加", back, null, opts);
}
$("add-btn").addEventListener("click", addFromBox);
$("add-url").addEventListener("keydown", (event) => { if (event.key === "Enter") addFromBox(); });
$("add-url").addEventListener("input", () => setNote("add-note", ""));

let startPending = null;   // { wasRunning, at }：開始／停止已送出、狀態還沒變
$("start-all").addEventListener("click", async () => {
  const button = $("start-all"), wasRunning = Boolean(queue?.running);
  startPending = { wasRunning, at: Date.now() };
  fx.busy(button, wasRunning ? "停止中" : "開始中");
  setTimeout(() => { if (startPending && Date.now() - startPending.at >= 10000) renderQueueArea(); }, 10100);   // 狀態一直沒變也要換回來
  let bad = false;
  try {
    const result = await send({ type: wasRunning ? "queue_stop" : "queue_start" });
    bad = result?.ok === false;
    setNote("note", bad ? result.error : "", "error");
  } catch (error) {
    bad = true;
    setNote("note", error.message, "error");
  }
  if (bad) { startPending = null; renderQueueArea(); fx.shake(button); }
});

bindClearAll($("clear-all"), { send, getState: () => queue, report: (message) => setNote("note", message, "error"), before: $("queue-list") });

$("quality").addEventListener("change", (event) => send({ type: "settings_set", settings: { quality: Number(event.target.value) } }));
$("mode").addEventListener("change", (event) => send({ type: "settings_set", settings: { mode: event.target.value } }));
$("audio-format").addEventListener("change", (event) => send({ type: "settings_set", settings: { audioFormat: event.target.value } }));
$("cooldown").addEventListener("input", () => { $("cooldown-out").textContent = `${$("cooldown").value} 秒`; });
bindNumberSetting($("cooldown"), "cooldownSec", { send, current: () => queue?.settings?.cooldownSec });
bindNumberSetting($("limit"), "limit", { send, current: () => queue?.settings?.limit });
$("auto-cover").addEventListener("change", () => send({ type: "settings_set", settings: { autoCover: $("auto-cover").checked } }));
const doctorUi = () => ({ check: $("doctor-check"), fix: $("doctor-fix"), list: $("doctor-list"), summary: $("doctor-summary"), fixed: $("doctor-fixed") });
$("doctor-check").addEventListener("click", () => runDoctor(send, doctorUi(), false));
$("doctor-fix").addEventListener("click", () => runDoctor(send, doctorUi(), true));
$("diag-copy").addEventListener("click", async () => {
  const button = $("diag-copy"), back = fx.restLabel(button);
  fx.busy(button, "產生中");
  try { await runCopyDiagnostics(send, { button, status: $("diag-copy-status"), fallback: $("diag-copy-text") }); } catch { /* 原因寫在狀態列 */ }
  if ($("diag-copy-status").dataset.kind === "ok") fx.ok(button, "已複製", back); else fx.fail(button, back);
});
$("save-outdir").addEventListener("click", async () => {
  const button = $("save-outdir"), back = fx.restLabel(button);
  fx.busy(button, "儲存中");
  let good = false;
  try {
    const result = await send({ type: "set_output_dir", path: $("outdir").value });
    good = Boolean(result?.ok);
    setNote("settings-note", result?.ok ? `已改為：${result.outputDir}` : result?.error ?? "無法使用這個資料夾", result?.ok ? "ok" : "error");
  } catch (error) {
    setNote("settings-note", error.message, "error");
  }
  if (good) fx.ok(button, "已儲存", back, renderQueueArea); else { fx.fail(button, back); renderQueueArea(); }
});

// ---------- 版本與更新（只管下載助手與下載引擎；外掛本身的更新由工具箱處理）----------
let updateInfo = null; // ytdl.update_info 的回覆
let updateBusy = false;
let upNote = { text: "", kind: "info" };
let autoChecked = false;

function setUpNote(text, kind = "info") {
  upNote = { text, kind };
  renderUpdate();
}

const updateProgressText = ({ step, done, total }) => ({
  download: `下載更新檔案 ${done} / ${total}`, host: "更新下載助手…", write: `寫入檔案 ${done} / ${total}`,
})[step] ?? "更新中…";

// 更新後等下載助手重新啟動（見 web/update-wait.js）。等的時候頁面只說一句平靜的話，並暫時不顯示「連線中斷」。
const reloadWait = createReloadWait({
  probe: () => ({ detected: client.detected(), running: status.state === "running", notRunningAt }),
});
const reloading = () => reloadWait.running();
let doneBanner = null; // 完成後幾秒內顯示「下載助手已更新」
let doneTimer = null;

function renderBanner() {
  const busy = reloading();
  const shown = busy ? { text: UPDATING_TEXT, kind: "info" } : doneBanner;
  $("update-banner").hidden = !shown;
  if (!shown) return;
  $("update-banner").dataset.kind = shown.kind;
  $("update-banner").dataset.busy = String(busy);
  setText($("update-banner-text"), shown.text);
  setText($("update-banner-hint"), busy ? UPDATING_HINT : "");
}

// 「更新下載助手」現在可以按（找到更新才會出現）。
const updateOffered = () => Boolean(updateInfo?.hasUpdate && client.detected() && status.state === "running") && !updateBusy;

function renderUpdate() {
  const detected = client.detected();
  const connected = detected && status.state === "running";
  const hostVersion = connected ? status.ready?.hostVersion : null;
  setText($("up-current"), connected ? (hostVersion ? `下載助手 v${hostVersion}` : "下載助手已連線") : "尚未連線");
  setText($("up-engine"), connected && status.ready?.ytdlpVersion ? `yt-dlp ${status.ready.ytdlpVersion}` : "尚未連線");
  let latest = "尚未檢查";
  if (updateInfo) {
    if (updateInfo.hasUpdate) latest = `有新版（${updateInfo.message ?? updateInfo.latestSha?.slice(0, 7) ?? ""}）`;
    else latest = updateInfo.hostChecked ? "已是最新版" : "下載助手還沒連線，沒有比對";
  }
  setText($("up-latest"), latest);
  $("up-check").disabled = !detected || updateBusy;
  $("engine-update").disabled = !connected || updateBusy;
  setHidden($("up-apply"), !updateInfo?.hasUpdate);
  $("up-apply").disabled = !(updateInfo?.hasUpdate && connected) || updateBusy;
  let note = upNote;
  if (!upNote.text && updateInfo?.hasUpdate) note = { kind: "info", text: connected ? "下載助手有新版，按「更新下載助手」。" : "下載助手有新版。請先讓它連線（按設定步驟的「啟動」），再更新。" };
  setNote("up-note", note.text, note.kind);
  renderBanner();
  renderHostNote($("host-note"), queue, { updateAvailable: updateOffered() });
  if (connected && !autoChecked && !updateBusy) { // 每次開頁安靜檢查一次
    autoChecked = true;
    checkUpdate({ quiet: true });
  }
}

async function checkUpdate({ quiet = false } = {}) {
  if (updateBusy) return;
  updateBusy = true;
  if (!quiet) setUpNote("檢查中…");
  try {
    const result = await send({ type: "update_info" });
    if (result?.ok) {
      updateInfo = result;
      if (!quiet) upNote = { text: result.hasUpdate ? "下載助手有新版，按「更新下載助手」。" : result.hostChecked ? "已是最新版。" : "下載助手還沒連線，沒有比對它。", kind: result.hasUpdate ? "info" : "ok" };
    } else if (!quiet) {
      upNote = { text: result?.error ?? "檢查失敗", kind: "error" };
    }
  } catch (error) {
    if (!quiet) upNote = { text: error.message, kind: "error" };
  } finally {
    updateBusy = false;
    renderUpdate();
  }
}

async function applyUpdate() {
  if (updateBusy || !updateInfo?.hasUpdate) return;
  updateBusy = true;
  setUpNote("準備更新…");
  try {
    const result = await send({ type: "update_apply", sha: updateInfo.latestSha });
    if (!result?.ok) throw new Error(result?.error ?? "更新失敗");
    if (result.nothing) {
      updateInfo = null;
      upNote = { text: "已是最新版。", kind: "ok" };
      return;
    }
    setUpNote("更新完成，下載助手正在重新啟動…", "ok");
    const waiting = reloadWait.start();
    render(); // 平靜的橫幅接手，整段等待都不顯示「連線中斷」
    const outcome = await waiting;
    upNote = describeOutcome({ ...outcome, version: status.ready?.hostVersion ?? null });
    if (outcome.back) unhealthySince = Date.now();
    if (upNote.kind === "ok") {
      doneBanner = { text: upNote.text, kind: "ok" };
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => { doneBanner = null; renderBanner(); }, 8000);
    }
    updateInfo = null;
  } catch (error) {
    upNote = { text: error.message, kind: "error" };
  } finally {
    updateBusy = false;
    renderUpdate();
  }
}

async function updateEngine() {
  if (updateBusy) return;
  updateBusy = true;
  setUpNote("更新下載引擎中…（可能要一兩分鐘）");
  try {
    const result = await send({ type: "update_engine" });
    upNote = result?.ok
      ? { text: result.ytdlpVersion ? `下載引擎已更新：yt-dlp ${result.ytdlpVersion}` : "下載引擎已更新。", kind: "ok" }
      : { text: result?.error ?? "更新失敗", kind: "error" };
  } catch (error) {
    upNote = { text: error.message, kind: "error" };
  } finally {
    updateBusy = false;
    renderUpdate();
    refresh();
  }
}

client.onProgress((progress) => { if (updateBusy) setUpNote(updateProgressText(progress)); });
$("up-check").addEventListener("click", () => checkUpdate());
$("up-apply").addEventListener("click", applyUpdate);
$("engine-update").addEventListener("click", updateEngine);

startTicker(() => { if (queue?.cooldown) renderQueueArea(); });
render();
