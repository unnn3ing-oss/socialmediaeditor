// 已排程／已發佈：選粉專＋刷新才查；編輯（尚未推出）、改時間、刪除
import { $, errText, bounds, inRange, toLocalInput, commentState, say, confirmBox } from './util.js';
import { postKey } from './history.js';
import * as fx from '../../ui/fx.js';

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
  sp.classList.toggle('cm-bad', bad);
  return sp;
}
function rowBase(it, whenMs, pageName, preview) {
  const li = document.createElement('li'); li.dataset.id = it.id;
  const body = document.createElement('div'); body.className = 'body';
  const m = document.createElement('div'); m.className = 'msg'; m.textContent = (it.message || '').replace(/\s+/g, ' ').trim() || '（沒有文字）'; m.title = it.message || '';
  const meta = document.createElement('div'); meta.className = 'meta';
  const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = metaText(it, pageName);
  const t2 = document.createElement('span'); t2.className = 'when-m'; t2.textContent = fmtDay(whenMs);   // 手機：時間併到這一行
  meta.append(kind, t2, commentSpan(it.comment));   // 時間（手機）接在粉專後面，留言狀態最後（紅字自己一行）
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
function btn(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = text; if (fn) b.onclick = fn; return b; }

// 查詢中骨架：3 列灰色占位（樣式 .sk 來自 ui/tokens.css）。重新查詢時先收起舊列，失敗再放回
function skelStart(ul, more) {
  if (!more && !ul._kept) { ul._kept = [...ul.children].filter((li) => !li.classList.contains('sk-row')); ul.textContent = ''; }
  ul.querySelectorAll('.sk-row').forEach((li) => li.remove());
  for (let i = 0; i < 3; i++) {
    const li = document.createElement('li'); li.className = 'sk-row'; li.setAttribute('aria-hidden', 'true');
    li.innerHTML = '<span class="sk sk-thumb"></span><span class="sk-lines"><span class="sk sk-l1"></span><span class="sk sk-l2"></span></span><span class="sk sk-when"></span>';
    ul.append(li);
  }
  ul.setAttribute('aria-busy', 'true');
}
function skelEnd(ul, restore) {
  ul.querySelectorAll('.sk-row').forEach((li) => li.remove());
  if (restore && ul._kept) ul.append(...ul._kept);
  ul._kept = null; ul.setAttribute('aria-busy', 'false');
}
function skelDrop(ul) { ul._kept = null; ul.textContent = ''; ul.setAttribute('aria-busy', 'false'); }

// history：送出記錄（只在這個瀏覽器，7 天）；onResend(記錄)：再發一次
const NO_REC = '沒有記錄：只有這台電腦、這個瀏覽器 7 天內送出的貼文才能再發一次';
export function createManage({ tb, history = null, onResend = null }) {
  const recIndex = () => (history ? history.index() : Promise.resolve(new Map()));
  function resendBtn(it, idx) {
    const rec = idx.get(postKey(it.id));
    const b = btn('再發一次', 'btn-secondary act-resend', rec ? () => onResend && onResend(rec) : null);
    if (!rec) { b.disabled = true; b.title = NO_REC; b.setAttribute('aria-description', NO_REC); }
    return b;
  }
  // 重新留言：只在留言失敗累計 ≥2 次或已失敗時出現；成功後改成「重新留言中」，不重查臉書
  function retryBtn(it, li, page, hint) {
    const c = it.comment;
    if (!c || !c.alert) return null;
    const b = btn('重新留言', 'btn-secondary act-retry', async () => {
      fx.busy(b, '重新留言中');
      try {
        await tb.api.call('/fb/comment/retry', { method: 'POST', body: { postId: it.id, page } });
        const sp = li.querySelector('.cm'); sp.textContent = '留言：重新留言中'; sp.classList.remove('cm-bad'); sp.classList.add('cm-line');
        b.remove(); say(hint, '已要求重新留言，稍後按「刷新」看結果');
      } catch (e) { fx.fail(b, '重新留言'); say(hint, errText(e), true); }
    });
    b.title = '馬上再試一次留言（已留過的不會重複）';
    return b;
  }
  // 排序只重排畫面上的列，不重查臉書
  function sortSched() {
    const ul = $('schedList');
    [...ul.children].sort((a, b) => byAt(a.dataset.at, b.dataset.at, $('schedSort').value)).forEach((li) => ul.append(li));
  }
  let schedSeq = 0, pubSeq = 0;   // 換粉專或再查一次時，晚到的舊回應丟掉
  let lastSched = Date.now();      // 上次查已排程（自動刷新用）
  async function loadSched() {
    const page = $('schedPage').value; if (!page) return;
    const my = ++schedSeq;
    lastSched = Date.now();
    say('schedHint', '查詢中…');
    skelStart($('schedList'), false);
    try {
      const [raw, idx] = await Promise.all([tb.api.call('/fb/scheduled?page=' + encodeURIComponent(page)), recIndex()]);
      // 只顯示晚於現在的排程；已過時間的不列（沒有時間的照列，免得漏看）
      const items = raw.filter((it) => !(Number(it.at) > 0) || it.at * 1000 > Date.now());
      if (my !== schedSeq) return;
      items.sort((a, b) => byAt(a.at, b.at, $('schedSort').value));
      const ul = $('schedList'); skelEnd(ul, false); ul.textContent = '';
      const pageName = $('schedPage').selectedOptions[0]?.textContent || '';
      for (const it of items) {
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
            // 成功：直接更新這一列的時間並重排，不整份重查臉書
            it.at = at; li.dataset.at = String(at); edit.hidden = true;
            li._setWhen(at * 1000);
            sortSched(); say('schedHint', `共 ${$('schedList').children.length} 則，已改時間`);
            fx.ok(ok, '已更新', '確認改時間');
          }
          catch (e) { fx.fail(ok, '確認改時間'); say('schedHint', errText(e), true); }
        });
        edit.append(dt, ok);
        const bEdit = btn('改時間', 'btn-secondary act-time', () => {
          const { min, max } = bounds(); dt.min = min; dt.max = max; dt.value = toLocalInput(it.at * 1000); edit.hidden = !edit.hidden;
        });
        const bCancel = btn('刪除', 'btn-secondary btn-del', async () => {
          if (!await confirmBox('刪除排程貼文', '確定要刪除這則排程貼文嗎？刪除後不會發布，無法復原。')) return;
          fx.busy(bCancel, '刪除中');
          try {
            await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/cancel`, { method: 'POST', body: { page } });
            await fx.collapse(li); li.remove(); const n = $('schedList').children.length; say('schedHint', n ? `共 ${n} 則` : '沒有排程貼文');   // 直接移除這一列，不重查
          }
          catch (e) { fx.fail(bCancel, '刪除'); say('schedHint', errText(e), true); }
        });
        const bRetry = retryBtn(it, li, page, 'schedHint');
        if (bRetry) acts.append(bRetry);
        acts.append(editSoon(), resendBtn(it, idx), bEdit, bCancel);
        li.insertBefore(acts, li.querySelector('.when')); li.append(edit); ul.append(li);
      }
      say('schedHint', items.length ? `共 ${items.length} 則` : '沒有排程貼文');
      return true;
    } catch (e) { if (my === schedSeq) { skelEnd($('schedList'), true); say('schedHint', errText(e), true); return false; } }
  }

  let pubNext = null;
  async function loadPub(more) {
    const page = $('pubPage').value; if (!page) return;
    const my = ++pubSeq;
    say('pubHint', '查詢中…');
    skelStart($('pubList'), more);
    $('pubMore').hidden = true;   // 查詢中不能再按「載入更多」，免得兩個請求互相蓋掉
    try {
      const [d, idx] = await Promise.all([tb.api.call('/fb/published?page=' + encodeURIComponent(page) + (more && pubNext ? '&after=' + encodeURIComponent(pubNext) : '')), recIndex()]);
      if (my !== pubSeq) return;
      const ul = $('pubList'); skelEnd(ul, false); if (!more) ul.textContent = '';
      const pageName = $('pubPage').selectedOptions[0]?.textContent || '';
      for (const it of d.items || []) {
        const li = rowBase(it, new Date(it.time).getTime(), pageName, it.url ? openablePreview(it) : null);
        const acts = document.createElement('div'); acts.className = 'acts';
        const bRetry = retryBtn(it, li, page, 'pubHint');
        if (bRetry) acts.append(bRetry);
        acts.append(editSoon(), resendBtn(it, idx));
        const bDel = btn('刪除', 'btn-secondary btn-del', async () => {
          if (!await confirmBox('刪除貼文', '確定要刪除這則已發佈的貼文嗎？無法復原。')) return;
          fx.busy(bDel, '刪除中');
          try { await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/delete`, { method: 'POST', body: { page } }); await fx.collapse(li); li.remove(); const n = ul.children.length; say('pubHint', n ? `共 ${n} 則` : '沒有已發佈貼文'); }
          catch (e) { fx.fail(bDel, '刪除'); say('pubHint', errText(e), true); }
        });
        acts.append(bDel);
        li.insertBefore(acts, li.querySelector('.when')); ul.append(li);
      }
      pubNext = d.next || null; $('pubMore').hidden = !pubNext;
      say('pubHint', ul.children.length ? `共 ${ul.children.length} 則` : '沒有已發佈貼文');
      return true;
    } catch (e) { if (my === pubSeq) { skelEnd($('pubList'), true); $('pubMore').hidden = !pubNext; say('pubHint', errText(e), true); return false; } }
  }

  // 畫面開著時，時間到了的排程每分鐘拿掉（不重查臉書）
  function pruneSched() {
    const ul = $('schedList'); let gone = 0;
    for (const li of [...ul.children]) { const at = Number(li.dataset.at); if (at > 0 && at * 1000 <= Date.now()) { li.remove(); gone++; } }
    if (gone) { const n = ul.children.length; say('schedHint', n ? `共 ${n} 則` : '沒有排程貼文'); }
  }
  setInterval(pruneSched, 60 * 1000);
  // 已排程每 30 分鐘自動刷新（2026-11-22）：分頁在背景時先不查，切回來超過 30 分鐘就補查；正在改時間時延後
  const AUTO_MS = 30 * 60 * 1000;
  function autoSched() {
    if (document.visibilityState !== 'visible' || !$('schedPage').value) return;
    if (Date.now() - lastSched < AUTO_MS) return;
    if ([...$('schedList').querySelectorAll('.edit')].some((x) => !x.hidden)) return;
    loadSched();
  }
  setInterval(autoSched, 60 * 1000);
  document.addEventListener('visibilitychange', autoSched);
  const reloader = (id, load) => async () => {
    const b = $(id); fx.busy(b, '刷新中');
    const r = await load();
    if (r === true) fx.ok(b, '已更新', '刷新'); else if (r === false) fx.fail(b, '刷新'); else fx.idle(b, '刷新');
  };
  $('schedReload').onclick = reloader('schedReload', loadSched);
  // 排序只重排畫面上的列，不重查臉書
  $('schedSort').onchange = sortSched;
  // 換粉專：清掉舊粉專的列表，等按「刷新」才查（不自動查詢）
  $('schedPage').onchange = () => { schedSeq++; skelDrop($('schedList')); say('schedHint', '按「刷新」讀取 Facebook 排程'); };
  $('pubPage').onchange = () => { pubSeq++; skelDrop($('pubList')); pubNext = null; $('pubMore').hidden = true; say('pubHint', '按「刷新」讀取 Facebook 已發佈貼文'); };
  $('pubReload').onclick = reloader('pubReload', () => loadPub(false));
  $('pubMore').onclick = () => loadPub(true);

  return {
    // 切到已發佈並讀某粉專（留言失敗回列表用）；粉專不在清單就讀目前選的
    showPub(page) {
      const el = $('pubPage');
      if (page && [...el.options].some((o) => o.value === String(page))) el.value = String(page);
      pubSeq++; pubNext = null;
      loadPub(false);
    },
    setPages(pages) {
      for (const id of ['schedPage', 'pubPage']) {
        const el = $(id), keep = el.value; el.textContent = '';
        for (const p of pages) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.short; el.append(o); }
        if (keep && pages.some((p) => p.id === keep)) el.value = keep;   // 重新整理粉專不動目前選的粉專與列表
      }
    }
  };
}
