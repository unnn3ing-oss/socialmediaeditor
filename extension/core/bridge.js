// 內容腳本：只注入小編工具箱網站。把網頁的 postMessage 轉給外掛背景，再把結果貼回網頁。
// 推播：網頁送 { source:'tbx-web', type:'subscribe' } 後才開一條 port（tbx-push），背景推來的 { tool, data }
// 轉成 { source:'tbx-ext', type:'push', tool, data }。外掛重新載入後，背景可能再注入一次本檔：舊的失效就換新的。
(function () {
  const prev = window.__tbxBridge;
  if (prev) {
    if (prev.alive()) return;
    prev.dispose();
  }
  const ORIGIN = location.origin;
  const alive = () => { try { return Boolean(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  const post = (msg) => window.postMessage({ source: 'tbx-ext', ...msg }, ORIGIN);
  let port = null;
  let subscribed = false;
  let retry = null;

  function connect() {
    if (port || !subscribed || !alive()) return;
    try {
      port = chrome.runtime.connect({ name: 'tbx-push' });
      port.onMessage.addListener((m) => { if (m && typeof m.tool === 'string') post({ type: 'push', tool: m.tool, data: m.data }); });
      // 背景（service worker）休眠或重啟時 port 會斷：網頁還在訂閱就重連
      port.onDisconnect.addListener(() => { port = null; clearTimeout(retry); retry = setTimeout(connect, 1000); });
    } catch (e) { port = null; }
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const d = event.data;
    if (!d || d.source !== 'tbx-web') return;
    if (d.type === 'subscribe') { subscribed = true; connect(); return; }
    if (typeof d.nonce !== 'string') return;
    const reply = (res) => post({ nonce: d.nonce, ...res });
    if (!alive()) { reply({ ok: false, error: '外掛已重新載入，請重新整理頁面' }); return; }
    try {
      chrome.runtime.sendMessage({ op: d.op, payload: d.payload || {} }, (res) => {
        if (chrome.runtime.lastError) reply({ ok: false, error: chrome.runtime.lastError.message });
        else reply(res || { ok: false, error: 'empty_response' });
      });
    } catch (e) { reply({ ok: false, error: String((e && e.message) || e) }); }
  }

  window.addEventListener('message', onMessage);
  window.__tbxBridge = {
    alive,
    dispose() {
      window.removeEventListener('message', onMessage);
      clearTimeout(retry);
      subscribed = false;
      try { if (port) port.disconnect(); } catch (e) { /* 已失效 */ }
      port = null;
    },
  };
  if (alive()) post({ type: 'ready', version: chrome.runtime.getManifest().version });
})();
