// 內容腳本：只注入小編工具箱網站。把網頁的 postMessage 轉給外掛背景，再把結果貼回網頁。
(function () {
  const ORIGIN = location.origin;
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const d = event.data;
    if (!d || d.source !== 'tbx-web' || typeof d.nonce !== 'string') return;
    const reply = (res) => window.postMessage({ source: 'tbx-ext', nonce: d.nonce, ...res }, ORIGIN);
    try {
      chrome.runtime.sendMessage({ op: d.op, payload: d.payload || {} }, (res) => {
        if (chrome.runtime.lastError) reply({ ok: false, error: chrome.runtime.lastError.message });
        else reply(res || { ok: false, error: 'empty_response' });
      });
    } catch (e) { reply({ ok: false, error: String((e && e.message) || e) }); }
  });
  window.postMessage({ source: 'tbx-ext', type: 'ready', version: chrome.runtime.getManifest().version }, ORIGIN);
})();
