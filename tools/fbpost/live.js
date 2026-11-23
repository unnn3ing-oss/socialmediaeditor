// 即時狀態（外掛側邊欄的新增發文標題列）：綠燈＝留言都正常；紅燈＋紅色光暈閃爍＝有留言失敗
//   游標移上（或鍵盤聚焦）跳小視窗列出問題（粉專、第幾則、簡短概述、貼文摘要）；點按鈕才到「已發佈」列表
//   資料：/staff/me/notices（只查 D1，不打臉書；權限組沒開「接收留言失敗通知」就隱藏）
//   畫面開著時每 2 分鐘讀一次（分頁在背景不讀），新增發文打開／關閉時也讀一次
import { $ } from './util.js';

const POLL_MS = 2 * 60 * 1000;

export function createLive({ tb, onClick } = {}) {
  const el = $('liveState'), tip = $('liveTip'), wrap = el.parentElement;
  const MAX_ROWS = 5;
  let hover = false;
  let items = [], last = 0, req = 0, pending = null;
  function paint(enabled) {
    el.hidden = !enabled;
    const bad = items.length > 0;
    el.classList.toggle('is-bad', bad);
    const pages = [...new Set(items.map((x) => x.pageName))].join('、');
    const text = bad ? `留言有問題 ${items.length} 則（${pages}）` : '留言都正常';
    el.removeAttribute('title');   // 改用小視窗，不用瀏覽器的提示
    el.setAttribute('aria-label', '即時狀態：' + text + (bad ? '，按一下到「已發佈」查看' : ''));
    fillTip(text, bad);
    tip.hidden = !(hover && enabled);
  }
  function fillTip(text, bad) {
    tip.textContent = '';
    if (!bad) { tip.append(text); return; }
    const ul = document.createElement('ul');
    for (const x of items.slice(0, MAX_ROWS)) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${x.pageName}｜第 ${x.seq} 則留言${x.failed ? '失敗' : '重試中'}${x.error ? '：' + x.error : ''}`;
      li.append(b);
      if (x.title) { const s = document.createElement('span'); s.textContent = x.title; li.append(s); }
      ul.append(li);
    }
    tip.append(ul);
    const p = document.createElement('p');
    p.textContent = (items.length > MAX_ROWS ? `還有 ${items.length - MAX_ROWS} 則・` : '') + '按「即時狀態」到已發佈列表';
    tip.append(p);
  }
  const showTip = (on) => { hover = on; tip.hidden = !(on && !el.hidden); };
  wrap.addEventListener('mouseenter', () => showTip(true));
  wrap.addEventListener('mouseleave', () => showTip(el.matches(':focus-visible')));
  el.addEventListener('focus', () => showTip(true));
  el.addEventListener('blur', () => showTip(wrap.matches(':hover')));
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tip.hidden) { e.stopPropagation(); showTip(false); } });
  // 回傳排程發布（kind post）的失敗通知
  function refresh() {
    if (pending) return pending;
    const my = ++req;
    pending = (async () => {
      try {
        const d = await tb.api.call('/staff/me/notices');
        if (my !== req) return items;
        items = d && d.enabled && Array.isArray(d.items) ? d.items.filter((x) => x.kind === 'post') : [];
        last = Date.now();
        paint(!!(d && d.enabled));
      } catch { /* 讀不到維持原狀 */ }
      return items;
    })().finally(() => { pending = null; });
    return pending;
  }
  el.addEventListener('click', () => { showTip(false); if (items.length && onClick) onClick(items); });
  // 定時讀只在外掛側邊欄（燈只在側邊欄顯示，CSS）；網頁版只在新增發文打開／關閉時讀（回列表切到已發佈）
  const side = () => document.documentElement.classList.contains('is-side');
  const tick = () => { if (side() && document.visibilityState === 'visible' && Date.now() - last >= POLL_MS) refresh(); };
  if (side()) refresh();
  setInterval(tick, 30 * 1000);
  document.addEventListener('visibilitychange', tick);
  return { refresh, items: () => items };
}
