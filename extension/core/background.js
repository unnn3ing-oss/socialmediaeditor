// 背景（service worker）：路由網站送來的 op、點圖示開側邊欄。
import { toolOps } from '../routes.gen.js';

const ops = { ping: () => ({ ok: true, data: { version: chrome.runtime.getManifest().version } }) };
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

function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
setup();
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
