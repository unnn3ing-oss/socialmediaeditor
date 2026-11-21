// 排程發布：各模組共用的小工具（時間格式、錯誤文字、確認對話、留言狀態文字）
export const $ = (id) => document.getElementById(id);
export const MIN_S = 10 * 60, MAX_S = 30 * 24 * 3600;   // 排程：10 分鐘～30 天

const pad = (n) => String(n).padStart(2, '0');
export const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmt = (ms) => { if (!Number.isFinite(ms)) return '時間不明'; const d = new Date(ms); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const errText = (e) => (e && e.message) || '失敗';
export const bounds = () => { const n = Date.now(); return { min: toLocalInput(n + MIN_S * 1000), max: toLocalInput(n + MAX_S * 1000) }; };
export const inRange = (at) => { const n = Math.floor(Date.now() / 1000); return Number.isFinite(at) && at >= n + MIN_S && at <= n + MAX_S; };

export const COMMENT = { done: '已留言', armed: '排程後補留言', retry: '第 1 則稍後重試', pending: '等待補留言', posting: '等待補留言', none: '不留言', failed: '留言失敗', canceled: '已取消' };
export const commentState = (c) => {
  if (!c) return '';
  if (typeof c === 'string') return '留言：' + (COMMENT[c] || c);
  return '留言：' + (COMMENT[c.status] || c.status || '') + (c.error ? '（' + c.error + '）' : '');
};

export function say(id, text, bad) { $(id).textContent = text; $(id).classList.toggle('bad', !!bad); }

export function confirmBox(title, body) {
  return new Promise((res) => {
    const d = $('cfDlg');
    $('cfTitle').textContent = title; $('cfBody').textContent = body;
    const done = (v) => { d.close(); res(v); };
    $('cfYes').onclick = () => done(true);
    $('cfNo').onclick = () => done(false);
    d.addEventListener('cancel', () => res(false), { once: true });
    d.showModal();
  });
}

// 分段切換鈕（隱藏切換用）：buttons 有 data-<key>；回傳 set(value)
export function segmented(root, key, onPick) {
  const set = (v) => {
    for (const b of root.querySelectorAll(`[data-${key}]`)) {
      const on = b.dataset[key] === v;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
    }
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest(`[data-${key}]`); if (!b || b.disabled) return;
    set(b.dataset[key]); onPick(b.dataset[key]);
  });
  return set;
}

// 複製文字：先用 clipboard API，不行（iframe、權限）退回舊方式；回傳是否成功
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 退回舊方式 */ }
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0;left:-9999px';
  (document.querySelector('dialog[open]') || document.body).append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

// 貼文開頭的空白行（帶入時留給小編文，沒填就不送）
export const stripLead = (t) => String(t).replace(/^(?:[ \t\u3000]*\n)+/, '');

// 一列左右滑（選色列、粉專列）：滾輪上下 → 左右捲；左右還有東西時邊緣淡出（.fade-l／.fade-r）；鍵盤焦點移到看不到的項目會自動捲過去
export function hscroll(el) {
  const sync = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('fade-l', max > 2 && el.scrollLeft > 2);
    el.classList.toggle('fade-r', max > 2 && el.scrollLeft < max - 2);
  };
  const reveal = (child) => {
    if (!child || !el.clientWidth) return;
    const l = child.offsetLeft - el.offsetLeft, r = l + child.offsetWidth;
    if (l < el.scrollLeft) el.scrollLeft = Math.max(0, l - 24);
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 24;
    sync();
  };
  el.addEventListener('scroll', sync, { passive: true });
  el.addEventListener('wheel', (e) => {
    if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault(); el.scrollLeft += e.deltaY;
  }, { passive: false });
  el.addEventListener('focusin', (e) => { const c = [...el.children].find((x) => x.contains(e.target)); reveal(c); });
  new ResizeObserver(sync).observe(el);
  new MutationObserver(sync).observe(el, { childList: true });
  sync();
  return { sync, reveal };
}
