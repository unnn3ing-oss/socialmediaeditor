// 背景（service worker）：路由網站送來的 op、點圖示開側邊欄。
import { toolOps } from '../routes.gen.js';
import './updater.js';   // 掛上全域 Updater

const ops = { ping: () => ({ ok: true, data: { version: self.Updater.verOf(chrome.runtime.getManifest()) } }) };
for (const [id, mod] of Object.entries(toolOps)) {
  for (const [name, fn] of Object.entries(mod)) if (typeof fn === 'function') ops[`${id}.${name}`] = fn;
}

export async function handle(msg) {
  const op = msg && msg.op;
  const fn = typeof op === 'string' && Object.hasOwn(ops, op) ? ops[op] : null;
  if (!fn) return { ok: false, code: 'unknown_op', error: '外掛不支援這個動作' };
  try { return await fn((msg && msg.payload) || {}); }
  catch (e) { return { ok: false, code: 'op_failed', error: String((e && e.message) || e) }; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 只接受自己的內容腳本與側邊欄
  if (sender.id !== chrome.runtime.id) return false;
  handle(msg).then(sendResponse);
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
