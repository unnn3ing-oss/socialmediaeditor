// 狀態：轉接外殼（window.parent.tbxShell）；工具頁單獨開啟時一律回「請從小編工具箱開啟」。

const STANDALONE = { state: 'warn', text: '請從小編工具箱開啟' };

export function createStatus({ getShell = defaultShell } = {}) {
  return {
    get(id) {
      const s = getShell();
      return s ? s.getStatus(id) : STANDALONE;
    },
    on(fn) {
      const s = getShell();
      return s ? s.onStatus(fn) : () => {};
    },
  };
}

function defaultShell() {
  try {
    const w = globalThis.window;
    if (w && w.parent && w.parent !== w && w.parent.tbxShell) return w.parent.tbxShell;
  } catch { /* 跨網域就當作沒有外殼 */ }
  return null;
}
