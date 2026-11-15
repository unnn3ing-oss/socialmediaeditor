// 背景（service worker）：路由網站送來的 op、點圖示開側邊欄。
import { toolOps } from '../routes.gen.js';
import './updater.js';   // 掛上全域 Updater

const ops = { ping: () => ({ ok: true, data: { version: self.Updater.verOf(chrome.runtime.getManifest()) } }) };
// 工具模組匯出的函式都是 op（網頁用 `<id>.<名稱>` 呼叫）；`init` 與 _ 開頭的不是 op。
const isOpName = (name) => name !== 'init' && !name.startsWith('_');
for (const [id, mod] of Object.entries(toolOps)) {
  for (const [name, fn] of Object.entries(mod)) if (typeof fn === 'function' && isOpName(name)) ops[`${id}.${name}`] = fn;
}

// ---- 推播：工具模組可匯出 init(ctx)，用 ctx.push(data) 把狀態推給有訂閱的網頁，
//      ctx.onSubscribe(fn) 在網頁新連上時呼叫 fn(send)，讓工具先送一份目前狀態 ----
const pushPorts = new Set();
const subscribeHandlers = [];
function sendTo(port, tool, data) {
  try { port.postMessage({ tool, data }); } catch (e) { pushPorts.delete(port); }
}
export function push(tool, data) {
  for (const port of pushPorts) sendTo(port, tool, data);
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'tbx-push' || !port.sender || port.sender.id !== chrome.runtime.id) { port.disconnect(); return; }
  pushPorts.add(port);
  port.onDisconnect.addListener(() => pushPorts.delete(port));
  for (const { id, fn } of subscribeHandlers) {
    try { fn((data) => sendTo(port, id, data)); } catch (e) { /* 單一工具出錯不影響其他工具 */ }
  }
});
for (const [id, mod] of Object.entries(toolOps)) {
  if (typeof mod.init !== 'function') continue;
  try {
    mod.init({
      id,
      push: (data) => push(id, data),
      onSubscribe: (fn) => { if (typeof fn === 'function') subscribeHandlers.push({ id, fn }); },
    });
  } catch (e) { console.error(`工具 ${id} 初始化失敗`, e); }
}

export async function handle(msg, sender = null) {
  const op = msg && msg.op;
  const fn = typeof op === 'string' && Object.hasOwn(ops, op) ? ops[op] : null;
  if (!fn) return { ok: false, code: 'unknown_op', error: '外掛不支援這個動作' };
  try { return await fn((msg && msg.payload) || {}, sender); }
  catch (e) { return { ok: false, code: 'op_failed', error: String((e && e.message) || e) }; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 只接受自己的內容腳本與側邊欄
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg, sender).then(sendResponse);
  return true;
});

// ---- 側邊欄與自動檢查更新 ----
const CHECK_EVERY_MINUTES = 60;
function ensureCheckAlarm() {
  chrome.alarms.get('check-update', (alarm) => {
    if (!alarm || alarm.periodInMinutes !== CHECK_EVERY_MINUTES) {
      chrome.alarms.create('check-update', { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MINUTES });
    }
  });
}
function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  ensureCheckAlarm();
}
// 檢查一次並更新圖示上的「新」。啟動、安裝／重新載入外掛時也會馬上查，
// 但距離上次檢查不到 5 分鐘就跳過，免得常開關 Chrome 時一直問 GitHub（force 時不跳過）。
const MIN_GAP_MS = 5 * 60 * 1000;
const CHECKED_KEY = 'tbx-update-checked-at';
export async function checkNow({ force = false } = {}) {
  if (!force) {
    try {
      const last = (await chrome.storage.local.get(CHECKED_KEY))[CHECKED_KEY] || 0;
      if (Date.now() - last < MIN_GAP_MS) return;
      await chrome.storage.local.set({ [CHECKED_KEY]: Date.now() });
    } catch (e) { /* 存不了就照樣查 */ }
  }
  try {
    const info = await self.Updater.checkLatest();
    await chrome.action.setBadgeText({ text: info.hasUpdate ? '新' : '' });
    if (info.hasUpdate) await chrome.action.setBadgeBackgroundColor({ color: '#d92d20' });
  } catch (e) { /* 離線或被限流：下次鬧鐘再試 */ }
}
setup();
chrome.runtime.onInstalled.addListener(() => { setup(); checkNow(); });
chrome.runtime.onStartup.addListener(() => { setup(); checkNow(); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'check-update') return checkNow();
});
