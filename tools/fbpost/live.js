// 即時狀態（外掛側邊欄的新增發文標題列）：綠燈＝留言都正常；紅燈＋紅色光暈閃爍＝有留言失敗
//   資料：/staff/me/notices（只查 D1，不打臉書；權限組沒開「接收留言失敗通知」就隱藏）
//   畫面開著時每 2 分鐘讀一次（分頁在背景不讀），新增發文打開／關閉時也讀一次
import { $ } from './util.js';

const POLL_MS = 2 * 60 * 1000;

export function createLive({ tb, onClick } = {}) {
  const el = $('liveState');
  let items = [], last = 0, req = 0, pending = null;
  function paint(enabled) {
    el.hidden = !enabled;
    const bad = items.length > 0;
    el.classList.toggle('is-bad', bad);
    const pages = [...new Set(items.map((x) => x.pageName))].join('、');
    const tip = bad ? `留言失敗 ${items.length} 則（${pages}），點一下到「已發佈」查看` : '留言都正常';
    el.title = tip;
    el.setAttribute('aria-label', '即時狀態：' + tip);
  }
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
  el.addEventListener('click', () => { if (items.length && onClick) onClick(items); });
  // 定時讀只在外掛側邊欄（燈只在側邊欄顯示，CSS）；網頁版只在新增發文打開／關閉時讀（回列表切到已發佈）
  const side = () => document.documentElement.classList.contains('is-side');
  const tick = () => { if (side() && document.visibilityState === 'visible' && Date.now() - last >= POLL_MS) refresh(); };
  if (side()) refresh();
  setInterval(tick, 30 * 1000);
  document.addEventListener('visibilitychange', tick);
  return { refresh, items: () => items };
}
