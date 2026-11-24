// 全站共用：按鈕回饋（處理中轉圈、成功打勾、失敗抖動、列收合）
//   樣式在 ui/fx.css（頁面要同時載入）；系統「減少動態」時動畫全部關掉，只留文字
//   處理中用 disabled 擋重複按，另加 aria-busy；.fx-busy 讓按鈕不要看起來像「不能按」
//   用法：busy(btn,'儲存中') → ok(btn,'已儲存','儲存') 或 fail(btn,'儲存')（原因由呼叫端寫在旁邊）
//   一般腳本（非模組）可用 window.tbxFx
const OK_MS = 1500;
const SPIN = () => { const s = document.createElement('span'); s.className = 'fx-spin'; s.setAttribute('aria-hidden', 'true'); return s; };
const CHECK = () => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'fx-chk'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M3 8.5l3.2 3L13 4.5'); svg.append(p);
  return svg;
};
const timers = new WeakMap();
function stopTimer(btn) { clearTimeout(timers.get(btn)); timers.delete(btn); }

// 換按鈕內容（文字淡入）；lead＝前面的圖示；dots＝文字後面呼吸的「…」
export function setLabel(btn, text, { lead = null, dots = false } = {}) {
  btn.textContent = '';
  if (lead) btn.append(lead);
  const s = document.createElement('span'); s.className = 'fx-lbl' + (dots ? ' fx-dots' : ''); s.textContent = text;
  btn.append(s);
}
// 處理中：轉圈＋文字、不能再按（同一顆按鈕可以一直呼叫來更新文字）
export function busy(btn, text, opts = {}) {
  stopTimer(btn);
  btn.classList.remove('fx-ok', 'fx-bad');
  btn.classList.add('fx-busy');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  const cur = btn.querySelector('.fx-lbl');
  if (cur && cur.textContent === text && btn.querySelector('.fx-spin') && cur.classList.contains('fx-dots') === !!opts.dots) return;   // 文字沒變不重畫（不重播淡入）
  setLabel(btn, text, { lead: SPIN(), dots: opts.dots });
}
// 回到一般狀態
export function idle(btn, text, { disabled = false } = {}) {
  stopTimer(btn);
  btn.classList.remove('fx-busy', 'fx-ok', 'fx-bad');
  btn.removeAttribute('aria-busy');
  btn.disabled = disabled;
  if (text == null) return;
  const cur = btn.querySelector('.fx-lbl');
  if (cur && cur.textContent === text && btn.childNodes.length === 1 && !cur.classList.contains('fx-dots')) return;   // 文字沒變不重畫（常被重複呼叫時不閃）
  setLabel(btn, text);
}
// 成功：綠色打勾 1.5 秒後回到 back（after 在恢復後呼叫）
//   opts.disabled：打勾期間與恢復後按鈕是否停用（例如已經沒有東西可以送）
export function ok(btn, text, back, after, opts = {}) {
  idle(btn, null, opts);
  btn.classList.add('fx-ok');
  setLabel(btn, text, { lead: CHECK() });
  timers.set(btn, setTimeout(() => { idle(btn, back, opts); if (after) after(); }, OK_MS));
}
// 失敗：紅色＋抖一下，1.5 秒後恢復顏色（文字直接回到 back，原因由呼叫端寫在旁邊或提示）
export function fail(btn, back, opts = {}) {
  idle(btn, back, opts);
  btn.classList.add('fx-bad');
  shake(btn);
  timers.set(btn, setTimeout(() => btn.classList.remove('fx-bad'), OK_MS));
}
// 抖一下（被擋下來的操作也用）
export function shake(el) {
  el.classList.remove('fx-shake'); void el.offsetWidth; el.classList.add('fx-shake');
  el.addEventListener('animationend', () => el.classList.remove('fx-shake'), { once: true });
}
// 閃一下綠框（封面換好了）
export function flash(el) {
  el.classList.remove('fx-flash'); void el.offsetWidth; el.classList.add('fx-flash');
  el.addEventListener('animationend', () => el.classList.remove('fx-flash'), { once: true });
}
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// 收合後移除（列表的一列）；減少動態時直接移除
export function collapse(el) {
  return new Promise((res) => {
    if (!el || !el.isConnected || reduced()) { res(); return; }
    el.style.height = el.offsetHeight + 'px';
    void el.offsetWidth;
    el.classList.add('fx-gone');
    let done = false;
    const end = () => { if (done) return; done = true; res(); };
    el.addEventListener('transitionend', end, { once: true });
    setTimeout(end, 350);
  });
}

if (typeof window !== 'undefined') window.tbxFx = { setLabel, busy, idle, ok, fail, shake, flash, collapse };
