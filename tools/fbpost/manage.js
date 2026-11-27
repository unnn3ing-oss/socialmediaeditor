// 已排程／已發佈：進入自動讀目前粉專（每批 50 則、自動最多 2 批）、換粉專自動讀（同次開頁讀過的用記憶體，按刷新才重查）、分頁、列表／卡片；改時間、刪除
import { $, errText, bounds, inRange, toLocalInput, commentState, say, confirmBox } from './util.js';
import { postKey } from './history.js';
import * as fx from '../../ui/fx.js';
import { fbPostUrl } from '../../shell/notices.js';

// 列表（2026-11-18 使用者定版）：縮圖｜內容（一行）＋「相片／文字．粉專．留言」｜按鈕｜時間欄
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDay = (ms) => { if (!Number.isFinite(ms)) return '時間不明'; const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

function thumb(url) {
  if (url) { const i = document.createElement('img'); i.className = 'thumb'; i.src = url; i.alt = ''; return i; }
  const d = document.createElement('div'); d.className = 'noimg'; d.textContent = '無圖'; return d;
}
// 已發佈的預覽：點一下變半透明並出現「開新分頁」圖示，按圖示才打開貼文
function openablePreview(it) {
  const box = document.createElement('div'); box.className = 'pv';
  const arm = document.createElement('button'); arm.type = 'button'; arm.className = 'pv-arm';
  arm.setAttribute('aria-label', '顯示開啟貼文的按鈕'); arm.setAttribute('aria-expanded', 'false');
  arm.append(thumb(it.picture));
  const open = document.createElement('a'); open.className = 'pv-open'; open.href = it.url; open.target = '_blank'; open.rel = 'noopener';
  open.setAttribute('aria-label', '在新分頁開啟這則貼文'); open.title = '在新分頁開啟'; open.innerHTML = OPEN_ICON;
  open.tabIndex = -1;
  arm.onclick = () => {
    const on = !box.classList.contains('armed');
    for (const x of document.querySelectorAll('.pv.armed')) disarm(x);
    if (on) { box.classList.add('armed'); arm.setAttribute('aria-expanded', 'true'); open.tabIndex = 0; open.focus(); }
  };
  open.onclick = () => disarm(box);
  box.append(arm, open);
  return box;
}
function disarm(box) {
  box.classList.remove('armed');
  box.querySelector('.pv-arm').setAttribute('aria-expanded', 'false');
  box.querySelector('.pv-open').tabIndex = -1;
}
document.addEventListener('pointerdown', (e) => { for (const x of document.querySelectorAll('.pv.armed')) if (!x.contains(e.target)) disarm(x); });
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; for (const x of document.querySelectorAll('.pv.armed')) { disarm(x); x.querySelector('.pv-arm').focus(); } });

function metaText(it, pageName) {
  return [it.picture ? '相片' : '文字', pageName].filter(Boolean).join('．');
}
// 留言狀態：失敗累計 ≥2 次或已失敗（後端回 alert）＝紅字
function commentSpan(c) {
  const sp = document.createElement('span'); sp.className = 'cm';
  const t = commentState(c);
  const bad = !!(c && c.alert);
  if (t) sp.textContent = bad ? t : '．' + t;   // 紅字自己一行，不接「．」
  sp.classList.toggle('cm-bad', bad); sp.classList.toggle('cm-line', !!(c && c.status === 'retrying'));
  return sp;
}
function rowBase(it, whenMs, pageName, preview) {
  const li = document.createElement('li'); li.dataset.id = it.id;
  const body = document.createElement('div'); body.className = 'body';
  const m = document.createElement('div'); m.className = 'msg'; m.textContent = (it.message || '').replace(/\s+/g, ' ').trim() || '（沒有文字）'; m.title = it.message || '';
  const meta = document.createElement('div'); meta.className = 'meta';
  const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = metaText(it, pageName);
  const t2 = document.createElement('span'); t2.className = 'when-m'; t2.textContent = fmtDay(whenMs);   // 手機：時間併到這一行
  meta.append(kind, t2, commentSpan(it.retrying ? { status: 'retrying' } : it.comment));   // 時間（手機）接在粉專後面，留言狀態最後（紅字自己一行）
  body.append(m, meta);
  const when = document.createElement('div'); when.className = 'when'; when.textContent = fmtDay(whenMs);
  li.append(preview || thumb(it.picture), body, when);
  li._setWhen = (ms) => { when.textContent = t2.textContent = fmtDay(ms); };
  return li;
}
// 「編輯」尚未推出：先放按鈕、不能按（2026-11-18 使用者選 A）
function editSoon() { const b = btn('編輯', 'btn-secondary', null); b.disabled = true; b.title = '即將推出'; b.setAttribute('aria-description', '即將推出'); return b; }

// 排序：near＝時間由近到遠、far＝由遠到近；缺時間一律放最後
function byAt(x, y, order) {
  const a = Number(x) || 0, b = Number(y) || 0;
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return order === 'far' ? b - a : a - b;
}
// 開啟貼文 ↗：已發佈優先用臉書回的 permalink，否則 /粉專/posts/貼文；網址不合法就不放
function openBtn(it) {
  const href = (it.url && /^https:\/\/(www\.|m\.)?facebook\.com\//.test(it.url)) ? it.url : fbPostUrl(it.id);
  if (!href) return null;
  const a = document.createElement('a'); a.className = 'btn btn-sm btn-secondary act-open'; a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.innerHTML = '開啟<span class="open-long">貼文</span> ↗'; a.setAttribute('aria-label', '開啟貼文');   // 側邊欄與手機只顯示「開啟 ↗」（CSS）
  a.title = '在新分頁開啟這則貼文';
  return a;
}
// 刪除：側邊欄與手機（≤820px）只顯示垃圾桶圖示（CSS），按鈕名稱仍是「刪除」
function delBtn(fn) { const b = btn('刪除', 'btn-secondary btn-del', fn); b.title = '刪除'; return b; }
function btn(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = text; if (fn) b.onclick = fn; return b; }

// 查詢中骨架：3 列灰色占位（樣式 .sk 來自 ui/tokens.css）
function skel(ul) {
  ul.textContent = '';
  for (let i = 0; i < 3; i++) {
    const li = document.createElement('li'); li.className = 'sk-row'; li.setAttribute('aria-hidden', 'true');
    li.innerHTML = '<span class="sk sk-thumb"></span><span class="sk-lines"><span class="sk sk-l1"></span><span class="sk sk-l2"></span></span><span class="sk sk-when"></span>';
    ul.append(li);
  }
}

const PAGE = 50;        // 每頁（也是後端每批）則數
const AUTO_BATCHES = 2; // 進入／換粉專自動讀幾批（最多 100 則）；之後按「讀取更多」每次再讀一批
const SIDE_STEP = 20;   // 外掛側邊欄：不分頁，先顯示 20 則、每按「載入更多」再 +20
const isSide = () => document.documentElement.classList.contains('is-side');
const VIEW_KEY = 'tbx.fbpost.view';
const store = { get() { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } }, set(v) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* 無痕：只在這次有效 */ } } };
const dedupe = (arr) => { const seen = new Set(); return (arr || []).filter((x) => !seen.has(x.id) && seen.add(x.id)); };

// 通用列表控制器：每個粉專一份記憶體快取 {items,next,batches,at,pageNo}；畫面只畫目前這一頁
// fetchBatch(page, after) → {items,next}；build(it, ctx) → li；sort(items) → 排序後陣列（作用在全部資料）
function makeList({ ids, fetchBatch, build, sort, empty, recIndex }) {
  const cache = new Map(), gen = new Map(), loading = new Map();   // gen：晚到的舊回應丟掉；loading：粉專 → 'first'｜'more'
  const cur = () => $(ids.page).value;
  const hint = (t, bad) => say(ids.hint, t, bad);
  let idx = new Map();
  const L = {
    cache,
    entry: () => cache.get(cur()),
    isCur: (page) => cur() === page,
    render() {
      const page = cur(), e = cache.get(page), ul = $(ids.list), ph = loading.get(page);
      ul.setAttribute('aria-busy', ph === 'first' ? 'true' : 'false');
      $(ids.pager).hidden = true; $(ids.more).hidden = true; $(ids.end).hidden = true;
      if (ph === 'first') { skel(ul); hint('查詢中…'); return; }
      ul.textContent = '';
      if (!e) { hint(''); return; }
      const all = sort(e.items);
      if (isSide()) { renderSide(page, e, all, ul, ph); return; }
      const pages = Math.max(1, Math.ceil(all.length / PAGE));
      e.pageNo = Math.min(Math.max(e.pageNo || 0, 0), pages - 1);
      const pageName = $(ids.page).selectedOptions[0]?.textContent || '';
      const ctx = { page, pageName, idx, L };
      for (const it of all.slice(e.pageNo * PAGE, (e.pageNo + 1) * PAGE)) ul.append(build(it, ctx));
      $(ids.pager).hidden = pages <= 1;
      $(ids.no).textContent = `第 ${e.pageNo + 1}／${pages} 頁`;
      $(ids.prev).disabled = e.pageNo === 0; $(ids.next).disabled = e.pageNo >= pages - 1;
      $(ids.more).hidden = !(e.next && e.pageNo === pages - 1 && !ph);
      hint(ph === 'more' ? `共 ${all.length} 則，讀取更多中…` : all.length ? `共 ${all.length} 則${e.next ? '（還有更多）' : ''}` : empty);
    },
    // 讀目前粉專。force＝按刷新／自動刷新（成功才換掉快取）；沒 force 且記憶體有就直接顯示
    // auto＝每 10 分鐘自動刷新：只讀第一批、不顯示骨架；之前讀過更多的，後面那些保留（不重查）、頁碼不跳回
    async load(force, auto = false) {
      const page = cur(); if (!page) return;
      if (cache.has(page) && !force) { L.render(); return true; }
      const old = cache.get(page);
      const g = (gen.get(page) || 0) + 1; gen.set(page, g);
      if (!auto) { loading.set(page, 'first'); L.render(); }
      let e;
      try {
        const [d, i] = await Promise.all([fetchBatch(page, null), recIndex()]);
        if (gen.get(page) !== g) return;
        idx = i;
        e = { items: dedupe(d.items), next: d.next || null, batches: 1, at: Date.now(), pageNo: 0, shown: SIDE_STEP };
        if (auto && old && old.batches > 1) { e.items = dedupe([...e.items, ...old.items]); e.next = old.next; e.batches = old.batches; }
        if (auto && old) { e.pageNo = old.pageNo || 0; e.shown = old.shown || SIDE_STEP; }
        cache.set(page, e);
      } catch (err) {
        if (gen.get(page) !== g) return;
        loading.delete(page);
        if (auto && old) old.at = Date.now();   // 自動刷新失敗：10 分鐘後再試，不每分鐘重打
        if (cur() === page) { L.render(); if (!auto) hint(errText(err), true); }
        return false;
      }
      if (auto) { loading.delete(page); if (cur() === page) L.render(); return true; }
      // 第 1 批先顯示；第 2 批背景接著讀
      if (e.next && e.batches < AUTO_BATCHES) { loading.set(page, 'more'); if (cur() === page) L.render(); return await L.more(page, g); }
      loading.delete(page); if (cur() === page) L.render();
      prefetch(page);
      return true;
    },
    // 再讀一批接在後面；g＝自動第 2 批沿用同一代，不帶＝「讀取更多」按鈕（開新的一代）
    // quiet＝側邊欄背景先讀：不改提示文字、失敗不顯示錯誤（按「載入更多」時再試並顯示）
    async more(page, g, quiet = false) {
      const e = cache.get(page); if (!e || !e.next) return true;
      if (g == null) { g = (gen.get(page) || 0) + 1; gen.set(page, g); loading.set(page, quiet ? 'bg' : 'more'); if (cur() === page) L.render(); }
      try {
        const d = await fetchBatch(page, e.next);
        if (gen.get(page) !== g) return;
        e.items = dedupe([...e.items, ...d.items]); e.next = d.next || null; e.batches++;
        loading.delete(page); if (cur() === page) L.render();
        return true;
      } catch (err) {
        if (gen.get(page) !== g) return;
        loading.delete(page);
        if (cur() === page) { L.render(); if (!quiet) hint(errText(err), true); }
        return false;
      }
    },
    show() { return L.load(false); },
    // 只動記憶體裡的資料（刪除），不重查臉書
    remove(page, id) { const e = cache.get(page); if (e) e.items = e.items.filter((x) => x.id !== id); }
  };
  $(ids.prev).onclick = () => { const e = L.entry(); if (e) { e.pageNo--; L.render(); } };
  $(ids.next).onclick = () => { const e = L.entry(); if (e) { e.pageNo++; L.render(); } };
  // ===== 外掛側邊欄：載入更多＋背景先讀 =====
  const pending = new Map();   // 粉專 → 背景先讀中的 Promise
  function renderSide(page, e, all, ul, ph) {
    const pageName = $(ids.page).selectedOptions[0]?.textContent || '';
    const ctx = { page, pageName, idx, L };
    e.shown = Math.max(SIDE_STEP, e.shown || SIDE_STEP);
    for (const it of all.slice(0, e.shown)) ul.append(build(it, ctx));
    const rest = all.length > e.shown || !!e.next, b = $(ids.more);
    if (b.getAttribute('aria-busy') !== 'true') b.textContent = '載入更多';
    $(ids.more).hidden = !rest || ph === 'more';
    $(ids.end).hidden = rest || !all.length || ph === 'more';
    hint(ph === 'more' ? `共 ${all.length} 則，讀取更多中…` : all.length ? `共 ${all.length} 則${e.next ? '（還有更多）' : ''}` : empty);
  }
  // 還沒顯示的少於 20 則、臉書還有下一批：背景讀一批（一次只讀一批；側邊欄看不到時不讀）
  function prefetch(page) {
    if (!isSide() || document.hidden || pending.has(page) || loading.get(page)) return;
    const e = cache.get(page);
    if (!e || !e.next || e.items.length - (e.shown || SIDE_STEP) >= SIDE_STEP) return;
    // 成功才接著判斷要不要再讀（失敗不連續重打，等使用者按「載入更多」）
    const p = L.more(page, undefined, true).then((ok) => { pending.delete(page); if (ok === true) prefetch(page); return ok; }, () => { pending.delete(page); return false; });
    pending.set(page, p);
  }
  async function sideMore() {
    const page = cur(), b = $(ids.more);
    let e = cache.get(page); if (!e) return;
    if (e.items.length <= e.shown) {
      if (!e.next) return;
      const want = e.shown;
      fx.busy(b, '載入中');
      if (pending.has(page)) await pending.get(page);   // 背景已在讀：等它
      e = cache.get(page);
      if (e && e.items.length <= want && e.next) await L.more(page);   // 沒先讀到（或背景失敗）：這次照一般方式讀，失敗會顯示原因
      fx.idle(b, '載入更多');
      e = cache.get(page);
      if (!e || e.items.length <= want) return;
    }
    e.shown = (e.shown || SIDE_STEP) + SIDE_STEP;
    if (cur() === page) L.render();
    prefetch(page);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) prefetch(cur()); });
  L.prefetch = () => prefetch(cur());
  $(ids.more).onclick = () => (isSide() ? sideMore() : L.more(cur()));
  return L;
}

// history：送出記錄（只在這個瀏覽器，7 天）；onResend(記錄)：再發一次；getDuty()：值班粉專 id 陣列（第一個＝預設）
const NO_REC = '沒有記錄：只有這台電腦、這個瀏覽器 7 天內送出的貼文才能再發一次';
// onDirect(貼文, 粉專, 按鈕)：幫直出（已發佈）
export function createManage({ tb, history = null, onResend = null, onDirect = null, getDuty = () => [] }) {
  const recIndex = () => (history ? history.index() : Promise.resolve(new Map()));
  function resendBtn(it, idx) {
    const rec = idx.get(postKey(it.id));
    const b = btn('再發一次', 'btn-secondary act-resend', rec ? () => onResend && onResend(rec) : null);
    if (!rec) { b.disabled = true; b.title = NO_REC; b.setAttribute('aria-description', NO_REC); }
    return b;
  }
  // 重新留言：只在留言失敗累計 ≥2 次或已失敗時出現；成功後改成「重新留言中」，不重查臉書
  function retryBtn(it, li, page, hintId) {
    const c = it.comment;
    if (!c || !c.alert || it.retrying) return null;
    const b = btn('重新留言', 'btn-secondary act-retry', async () => {
      fx.busy(b, '重新留言中');
      try {
        await tb.api.call('/fb/comment/retry', { method: 'POST', body: { postId: it.id, page } });
        it.retrying = true;
        const sp = li.querySelector('.cm'); sp.textContent = '留言：重新留言中'; sp.classList.remove('cm-bad'); sp.classList.add('cm-line');
        b.remove(); say(hintId, '已要求重新留言，稍後按「刷新」看結果');
      } catch (e) { fx.fail(b, '重新留言'); say(hintId, errText(e), true); }
    });
    b.title = '馬上再試一次留言（已留過的不會重複）';
    return b;
  }
  const norm = (d) => (Array.isArray(d) ? { items: d, next: null } : { items: (d && d.items) || [], next: (d && d.next) || null });
  const q = (page, after) => 'page=' + encodeURIComponent(page) + (after ? '&after=' + encodeURIComponent(after) : '');
  const total = (L) => (L.entry() ? L.entry().items.length : 0);

  // ===== 已排程 =====
  const sched = makeList({
    ids: { page: 'schedPage', list: 'schedList', hint: 'schedHint', pager: 'schedPager', prev: 'schedPrev', no: 'schedNo', next: 'schedNext', more: 'schedMore', end: 'schedEnd' },
    empty: '沒有排程貼文', recIndex,
    // 只顯示晚於現在的排程；已過時間的不列（沒有時間的照列，免得漏看）
    fetchBatch: async (page, after) => {
      const d = norm(await tb.api.call('/fb/scheduled?v=2&' + q(page, after)));
      return { items: d.items.filter((it) => !(Number(it.at) > 0) || it.at * 1000 > Date.now()), next: d.next };
    },
    sort: (items) => [...items].sort((a, b) => byAt(a.at, b.at, $('schedSort').value)),
    build(it, { page, pageName, idx, L }) {
      const li = rowBase(it, it.at * 1000, pageName); li.dataset.at = String(it.at || '');
      const acts = document.createElement('div'); acts.className = 'acts';
      const edit = document.createElement('div'); edit.className = 'edit'; edit.hidden = true;
      const dt = document.createElement('input'); dt.type = 'datetime-local';
      const ok = btn('確認改時間', 'btn-primary', async () => {
        const at = Math.floor(new Date(dt.value).getTime() / 1000);
        if (!inRange(at)) { say('schedHint', '排程時間必須在 10 分鐘到 30 天之間。', true); return; }
        fx.busy(ok, '改時間中');
        try {
          await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/reschedule`, { method: 'POST', body: { page, at } });
          // 成功：直接更新記憶體裡這一則的時間並重排，不重查臉書
          it.at = at;
          if (L.isCur(page)) { L.render(); say('schedHint', `共 ${total(L)} 則，已改時間`); }
        }
        catch (e) { fx.fail(ok, '確認改時間'); say('schedHint', errText(e), true); }
      });
      edit.append(dt, ok);
      const bEdit = btn('改時間', 'btn-secondary act-time', () => {
        const { min, max } = bounds(); dt.min = min; dt.max = max; dt.value = toLocalInput(it.at * 1000); edit.hidden = !edit.hidden;
      });
      const bCancel = delBtn(async () => {
        if (!await confirmBox('刪除排程貼文', '確定要刪除這則排程貼文嗎？刪除後不會發布，無法復原。')) return;
        fx.busy(bCancel, '刪除中');
        try {
          await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/cancel`, { method: 'POST', body: { page } });
          await fx.collapse(li); L.remove(page, it.id);
          if (L.isCur(page)) { L.render(); const n = total(L); say('schedHint', n ? `共 ${n} 則` : '沒有排程貼文'); }   // 不重查
        }
        catch (e) { fx.fail(bCancel, '刪除'); say('schedHint', errText(e), true); }
      });
      const bRetry = retryBtn(it, li, page, 'schedHint');
      if (bRetry) acts.append(bRetry);
      const bOpen = openBtn(it); if (bOpen) acts.append(bOpen);
      acts.append(editSoon(), resendBtn(it, idx), bEdit, bCancel);
      li.insertBefore(acts, li.querySelector('.when')); li.append(edit);
      return li;
    }
  });

  // ===== 已發佈 =====
  const pub = makeList({
    ids: { page: 'pubPage', list: 'pubList', hint: 'pubHint', pager: 'pubPager', prev: 'pubPrev', no: 'pubNo', next: 'pubNext', more: 'pubMore', end: 'pubEnd' },
    empty: '沒有已發佈貼文', recIndex,
    fetchBatch: async (page, after) => norm(await tb.api.call('/fb/published?' + q(page, after))),
    sort: (items) => items,
    build(it, { page, pageName, idx, L }) {
      const li = rowBase(it, new Date(it.time).getTime(), pageName, it.url ? openablePreview(it) : null);
      const acts = document.createElement('div'); acts.className = 'acts';
      const bRetry = retryBtn(it, li, page, 'pubHint');
      if (bRetry) acts.append(bRetry);
      const bOpen = openBtn(it); if (bOpen) acts.append(bOpen);
      acts.append(editSoon(), resendBtn(it, idx));
      if (onDirect) { const bDirect = btn('幫直出', 'btn-secondary act-direct', () => onDirect(it, page, bDirect)); bDirect.title = '帶入這則貼文的內容、圖片、連結，另外發到其他粉專'; acts.append(bDirect); }
      const bDel = delBtn(async () => {
        if (!await confirmBox('刪除貼文', '確定要刪除這則已發佈的貼文嗎？無法復原。')) return;
        fx.busy(bDel, '刪除中');
        try {
          await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/delete`, { method: 'POST', body: { page } });
          await fx.collapse(li); L.remove(page, it.id);
          if (L.isCur(page)) { L.render(); const n = total(L); say('pubHint', n ? `共 ${n} 則` : '沒有已發佈貼文'); }
        }
        catch (e) { fx.fail(bDel, '刪除'); say('pubHint', errText(e), true); }
      });
      acts.append(bDel);
      li.insertBefore(acts, li.querySelector('.when'));
      return li;
    }
  });

  // 畫面開著時，時間到了的排程每分鐘拿掉（不重查臉書）
  function pruneSched() {
    let changed = false;
    for (const [page, e] of sched.cache) {
      const keep = e.items.filter((it) => { const at = Number(it.at); return !(at > 0 && at * 1000 <= Date.now()); });
      if (keep.length !== e.items.length) { e.items = keep; if (sched.isCur(page)) changed = true; }
    }
    if (changed) { sched.render(); const n = total(sched); say('schedHint', n ? `共 ${n} 則` : '沒有排程貼文'); }
  }
  setInterval(pruneSched, 60 * 1000);
  // 已排程、已發佈每 10 分鐘自動刷新（只讀第一批；後端順便校正留言計時器：改時間、提早發布）
  // 分頁在背景時先不查，切回來超過 10 分鐘就補查；正在改時間時延後
  const AUTO_MS = 10 * 60 * 1000;
  function autoList(L, listId) {
    if (!$(listId === 'schedList' ? 'schedPage' : 'pubPage').value) return;
    const e = L.entry();
    if (!e || Date.now() - e.at < AUTO_MS) return;
    if ([...$(listId).querySelectorAll('.edit')].some((x) => !x.hidden)) return;
    L.load(true, true);
  }
  function autoAll() {
    if (document.visibilityState !== 'visible') return;
    autoList(sched, 'schedList'); autoList(pub, 'pubList');
  }
  setInterval(autoAll, 60 * 1000);
  document.addEventListener('visibilitychange', autoAll);

  const reloader = (id, L) => async () => {
    const b = $(id); fx.busy(b, '刷新中');
    const r = await L.load(true);
    if (r === true) fx.ok(b, '已更新', '刷新'); else if (r === false) fx.fail(b, '刷新'); else fx.idle(b, '刷新');
  };
  $('schedReload').onclick = reloader('schedReload', sched);
  $('pubReload').onclick = reloader('pubReload', pub);
  // 排序作用在全部資料（不只當頁），只重排、不重查臉書；排序後回第 1 頁
  $('schedSort').onchange = () => { const e = sched.entry(); if (e) e.pageNo = 0; sched.render(); };

  // 使用者手動換過列表粉專，就不再跟著值班粉專切；換粉專自動讀（讀過的用記憶體）
  let touched = false;
  $('schedPage').onchange = () => { touched = true; sched.show(); };
  $('pubPage').onchange = () => { touched = true; pub.show(); };

  // 列表／卡片：同一份 DOM，只切 data-view（CSS 換版面），記在瀏覽器
  const card = $('listCard');
  function setView(v) {
    card.dataset.view = v;
    for (const b of card.querySelectorAll('.view-seg [data-view]')) { const on = b.dataset.view === v; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  setView(store.get() === 'card' ? 'card' : 'list');
  card.addEventListener('click', (e) => { const b = e.target.closest('.view-seg [data-view]'); if (b) { setView(b.dataset.view); store.set(b.dataset.view); } });

  // ===== 自動讀取：粉專載入完＋有檢視權限才開始；預設粉專＝值班粉專第一個，沒有就第一個粉專 =====
  let pagesReady = false, viewOk = false, started = false, waitDuty = false;
  const defaultPage = () => {
    const ids = [...$('schedPage').options].map((o) => o.value);
    return getDuty().find((id) => ids.includes(id)) || ids[0] || '';
  };
  function applyDefault() {
    const d = defaultPage(); if (!d) return;
    $('schedPage').value = d; $('pubPage').value = d;
  }
  function start() { started = true; applyDefault(); sched.load(false); pub.load(false); }
  function maybeStart() {
    if (started || !pagesReady || !viewOk) return;
    if (waitDuty && !getDuty().length && !document.hidden) return;   // 值班視窗選完再讀，免得先讀錯粉專
    start();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) waitDuty = false; maybeStart(); });

  return {
    // 切到已發佈並讀某粉專（留言失敗回列表用）；粉專不在清單就讀目前選的。重新讀取
    showPub(page) {
      const el = $('pubPage');
      if (page && [...el.options].some((o) => o.value === String(page))) el.value = String(page);
      pub.load(true);
    },
    // 有檢視權限才自動讀；wait＝使用者還要先選值班粉專（選完 dutyChanged 才開始）
    allowView(v, wait) { viewOk = !!v; waitDuty = !!wait; maybeStart(); },
    // 值班粉專選好／改了：還沒手動換過列表粉專，就切到值班粉專並讀取
    dutyChanged() {
      if (!viewOk) return;
      waitDuty = false;
      if (!started) { maybeStart(); return; }
      if (touched) return;
      const before = $('schedPage').value;
      applyDefault();
      if ($('schedPage').value !== before) { sched.show(); pub.show(); }
    },
    setPages(pages) {
      for (const id of ['schedPage', 'pubPage']) {
        const el = $(id), keep = el.value; el.textContent = '';
        for (const p of pages) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.short; el.append(o); }
        if (keep && pages.some((p) => p.id === keep) && (touched || started)) el.value = keep;   // 重新整理粉專不動目前選的粉專與列表
      }
      pagesReady = true;
      if (!started) applyDefault();
      maybeStart();
    }
  };
}
