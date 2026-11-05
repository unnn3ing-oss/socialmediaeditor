// 外掛橋接：網頁用 postMessage 向外掛的內容腳本發請求，依 nonce 配對回覆。

export function makeRequest(op, payload, nonce) {
  return { source: 'tbx-web', nonce, op, payload };
}

const defaultTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };
const defaultNonce = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// win、timers、nonce 可注入，方便 Node 測試。
export function createExt({ win = globalThis.window, timers = defaultTimers, nonce = defaultNonce } = {}) {
  return {
    call(op, payload, { timeout = 3000 } = {}) {
      return new Promise((resolve, reject) => {
        const n = nonce();
        let timer;
        const onMsg = (e) => {
          const d = e && e.data;
          if (!d || d.source !== 'tbx-ext' || d.nonce !== n) return;
          cleanup();
          if (d.ok) resolve(d.data);
          else reject(Object.assign(new Error(d.error || '外掛回報失敗'), { code: d.code }));
        };
        const cleanup = () => { timers.clear(timer); win.removeEventListener('message', onMsg); };
        win.addEventListener('message', onMsg);
        timer = timers.set(() => {
          cleanup();
          reject(Object.assign(new Error('未偵測到外掛'), { code: 'no_extension' }));
        }, timeout);
        win.postMessage(makeRequest(op, payload, n), '*');
      });
    },
  };
}
