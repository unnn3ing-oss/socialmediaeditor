// 排程發布（公司專屬）：多粉專發文／排程、已排程（改時間、取消、留言狀態）、成效。
// 新增發文彈窗照網新快速排程（schedulenewnet web/app.js）重做：貼文章網址自動帶入、粉專晶片各自立即／排程、全部送出。
// 標題換行、文章解析、小編文格式、排程時間規則都用 sdk/news-*.js（和網新同一套）。
// 內容保留：切換分頁／模式一律用 hidden；彈窗只有「確認關閉」「清空」「再發一篇」會清內容。
// 後端：/fb/pages、/fb/post（multipart）、/fb/scheduled、/fb/cancel、/fb/reschedule、/fb/comments、/fb/comment/retry、/fb/comment/dismiss、
//       /fb/posts、/fb/insights、/fetch/article、/fetch/image。
import { tb } from '../../sdk/toolbox.js';
import { autoLines, buildLink, frameForUrl, charWidth, articleId } from '../../sdk/news-rules.js';
import { parseArticle, formatCopy, mainCaption, overrideOneLine, bindTitle, learnSeps, titleAsOneLine, replaceTitleLine } from '../../sdk/news-article.js';
import * as Sched from '../../sdk/news-sched.js';
import { createPhotoEditor } from './editor.js';
import * as Duty from './duty.js';
import * as RD from './rundown.js';
import { TEXT_SWATCHES, DEFAULT_SWATCH, drawTextCard, swatchCss } from './textcard.js';

tb.init('fbpost');

const $ = (id) => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(n.dataset, dataset);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const TITLE_MAX = 15, TITLE_LINES = 4, NATIVE_MAX = 130;
const DEFAULT_COMMENT = '看更多新聞內容';
const FRAME_NAMES = { news: '新聞（藍框）', ent: '娛樂（粉框）', generic: '通用框', none: '無框' };
const errText = (e) => (e && e.message) || '發生錯誤';
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (sec) => { const d = new Date(sec * 1000); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtIso = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? '' : fmtTime(Math.floor(t / 1000)); };
const now = () => new Date();

// ---------- 確認框 ----------
function confirmBox(title, body, yes = '確定') {
  const dlg = $('confirmDlg');
  $('cfTitle').textContent = title;
  $('cfBody').textContent = body;
  $('cfYes').textContent = yes;
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); $('cfYes').onclick = $('cfNo').onclick = null; dlg.oncancel = null; resolve(v); };
    $('cfYes').onclick = () => done(true);
    $('cfNo').onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

// ---------- 分頁（隱藏切換，不重建） ----------
function segment(root, attr, onPick) {
  const btns = [...root.querySelectorAll('button')];
  const set = (v) => {
    for (const b of btns) { const on = b.dataset[attr] === v; b.classList.toggle('is-on', on); if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', String(on)); else b.setAttribute('aria-pressed', String(on)); }
    onPick(v);
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && root.contains(b) && b.dataset[attr]) set(b.dataset[attr]); });
  return { set, get: () => (btns.find((b) => b.classList.contains('is-on')) || btns[0]).dataset[attr] };
}

segment($('tabs'), 'tab', (t) => {
  $('tab-sched').hidden = t !== 'sched';
  $('tab-stats').hidden = t !== 'stats';
  if (t === 'stats' && !statsLoaded) loadStats(true);
});

// ---------- 時間編輯（日期＋4 碼時間＋快捷鈕；排程發布的晶片與「改時間」共用）----------
// 規則全部來自 sdk/news-sched.js：10 分鐘～30 天、↑↓ ±10 分、直接打 4 碼（2130＝21:30）
function createTimeEditor({ onChange = () => {}, onEnter = () => {} } = {}) {
  const date = el('input', { type: 'date', className: 'tp-date', ariaLabel: '日期' });
  const time = el('input', { type: 'text', inputMode: 'numeric', maxLength: 5, autocomplete: 'off', className: 'tp-time', placeholder: '2130', ariaLabel: '時間（直接打 4 碼，2130＝21:30）' });
  const hint = el('p', { className: 'hint' });
  const chips = el('div', { className: 'chips' }, ...[['30', '+30 分'], ['60', '+1 小時'], ['1440', '明天']]
    .map(([m, t]) => el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: t, dataset: { add: m } })));
  const root = el('div', { className: 'tp-body' }, el('div', { className: 'tp-row' }, date, time), hint, chips);
  let last = null;   // 最後一次合法（可解析）的時間
  const read = () => Sched.combine(date.value, time.value);
  function refresh() {
    const n = now(), at = read(), err = Sched.validate(at, n);
    hint.textContent = err ? err.msg : `排程 ${Sched.fmtWhen(at, n)}・直接打 4 碼（2130＝21:30），↑↓ 每次 10 分`;
    hint.className = 'hint ' + (err ? 'bad' : 'ok');
    time.setAttribute('aria-invalid', String(!!err));
    return !err;
  }
  function set(at) {
    const n = now();
    date.min = Sched.fmtDateInput(n); date.max = Sched.fmtDateInput(Sched.latest(n));
    last = at;
    date.value = Sched.fmtDateInput(at); time.value = Sched.fmtTime(at);
    refresh();
  }
  const take = () => { const at = read(); if (at) { last = at; onChange(at); } refresh(); };   // 打字／選日期：能解析就寫回（超出範圍送出前會擋）
  time.addEventListener('input', () => { const v = Sched.formatTyping(time.value); if (v !== time.value) time.value = v; take(); });
  date.addEventListener('change', take);
  time.addEventListener('blur', () => { if (last && !read()) time.value = Sched.fmtTime(last); });
  time.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const at = Sched.step(read() || last || now(), e.key === 'ArrowUp' ? 1 : -1);
      set(at); onChange(at);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (refresh()) onEnter();
    }
  });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-add]');
    if (!b) return;
    const at = new Date((read() || last || now()).getTime() + Number(b.dataset.add) * 60000);
    set(at); onChange(at);
  });
  return { root, set, get: () => read(), valid: refresh, focus: () => { time.focus(); time.select(); } };
}

// ---------- 粉專 ----------
let pages = [];
const pageLabel = (p) => p.label || p.name;
async function loadPages(refresh = false) {
  const st = $('pagesState');
  st.className = 'pill';
  st.textContent = '讀取粉專中…';
  try {
    pages = await tb.api.call('/fb/pages' + (refresh ? '?refresh=1' : ''));
    st.className = 'pill ' + (pages.length ? 'pill-ok' : 'pill-warn');
    st.textContent = pages.length ? `已連線 ${pages.length} 個粉專` : '沒有可用的粉專';
  } catch (e) {
    pages = [];
    st.className = 'pill pill-warn';
    st.textContent = e.code === 'unauthorized' ? '請先輸入公司密碼' : e.code === 'fb_not_configured' ? '後端還沒設定臉書 token' : '粉專讀取失敗：' + errText(e);
  }
  renderPageChips();
  fillSelects(!selInit);
  selInit = true;
  loadSched();
  statsLoaded = false;
  if (!$('tab-stats').hidden) loadStats(true);
  renderDutyBtn();
  if (pages.length && !duty && !dutyAsked) openDuty();
}
$('pagesRefresh').addEventListener('click', () => loadPages(true));

// ---------- 值班粉專（1～3 個，★主要）：只影響預設，其他粉專照樣可選；到下一個 05:00 失效 ----------
let duty = Duty.loadDuty();
let dutyAsked = false;   // 這次開頁面已經問過（按了「先不選」）就不再自動跳
let selInit = false;
const ordered = () => Duty.orderPages(pages, duty);
const mainId = () => Duty.mainOf(pages, duty);
// 下拉：值班粉專排前面；useDuty＝改成主要粉專（第一次載入、值班換了）
function fillSelects(useDuty) {
  const list = ordered(), main = mainId();
  for (const sel of [$('schedPage'), $('statsPage')]) {
    const keep = sel.value;
    sel.replaceChildren(...(sel.id === 'schedPage' ? [el('option', { value: '', textContent: '全部粉專' })] : []),
      ...list.map((p) => el('option', { value: p.id, textContent: p.name })));
    if (useDuty && main) sel.value = main;
    else if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
}
function renderDutyBtn() {
  const b = $('dutyBtn');
  b.hidden = !pages.length;
  const list = duty ? ordered().filter((p) => duty.ids.includes(p.id)) : [];
  b.classList.toggle('unset', !list.length);
  b.textContent = list.length ? '值班：' + list.map((p) => (p.id === duty.main ? '★' : '') + pageLabel(p)).join('、') + ' ▾' : '值班：未選 ▾';
  b.title = list.length ? '每天 05:00 後要重選；點這裡修改' : '選擇今天負責的粉專';
}
// 值班換了：重排晶片、下拉改成主要粉專、沒在發文中的晶片改成只預勾主要
function onDutyChanged() {
  renderDutyBtn();
  if (!modal.open) for (const c of chips.values()) if (!c.status) { c.on = c.id === mainId(); c.sched = false; c.at = null; }
  renderPageChips();
  fillSelects(true);
  loadSched();
  statsLoaded = false;
  if (!$('tab-stats').hidden) loadStats(true);
}
// 過期就清掉（全部空白重選）；回傳是否過期
function dutyExpired() {
  if (!duty || duty.exp > Date.now()) return false;   // 用記憶體裡的 exp 判斷（localStorage 被停用也不誤判）
  duty = null; dutyAsked = false;
  onDutyChanged();
  return true;
}
let dutyResolve = null;
function openDuty() {
  const dlg = $('dutyDlg');
  if (dlg.open) return new Promise((r) => { const prev = dutyResolve; dutyResolve = (v) => { prev && prev(v); r(v); }; });
  const pick = duty ? { ids: duty.ids.filter((id) => pages.some((p) => p.id === id)), main: duty.main } : { ids: [], main: '' };   // 過期或沒選＝空白
  const list = $('dutyList');
  function render() {
    if (!pick.ids.includes(pick.main)) pick.main = pick.ids[0] || '';
    list.replaceChildren(...pages.map((p) => {
      const on = pick.ids.includes(p.id), isMain = on && pick.main === p.id, full = !on && pick.ids.length >= Duty.MAX_DUTY;
      const item = el('div', { className: 'duty-item' + (on ? ' on' : '') + (isMain ? ' main' : ''), dataset: { page: p.id } });
      const name = el('button', { type: 'button', className: 'duty-pick', disabled: full, title: full ? `最多 ${Duty.MAX_DUTY} 個` : p.name },
        el('span', { className: 'box', textContent: on ? '✓' : '' }), el('span', { className: 'duty-name', textContent: pageLabel(p) }));
      name.setAttribute('aria-pressed', String(on));
      name.addEventListener('click', () => { if (on) pick.ids = pick.ids.filter((x) => x !== p.id); else pick.ids.push(p.id); render(); list.querySelector(`[data-page="${p.id}"] .duty-pick`).focus(); });
      item.append(name);
      if (on) {
        const star = el('button', { type: 'button', className: 'duty-star', textContent: isMain ? '★' : '☆' });
        star.setAttribute('aria-label', isMain ? `${pageLabel(p)}是主要粉專` : `把${pageLabel(p)}設成主要`);
        star.setAttribute('aria-pressed', String(isMain));
        star.addEventListener('click', () => { pick.main = p.id; render(); list.querySelector(`[data-page="${p.id}"] .duty-star`).focus(); });
        item.append(star);
      }
      return item;
    }));
    $('dutyOk').disabled = !pick.ids.length;
    $('dutyHint').textContent = pick.ids.length ? `已選 ${pick.ids.length}／${Duty.MAX_DUTY} 個，主要：${pageLabel(pages.find((p) => p.id === pick.main))}` : `請選 1～${Duty.MAX_DUTY} 個`;
  }
  render();
  return new Promise((resolve) => {
    dutyResolve = resolve;
    const done = (save) => {
      if (save) { duty = Duty.saveDuty(pick.ids, pick.main); onDutyChanged(); }
      dutyAsked = true;
      dlg.close();
      const r = dutyResolve; dutyResolve = null; r && r(save);
    };
    $('dutyOk').onclick = () => done(true);
    $('dutySkip').onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}
$('dutyBtn').addEventListener('click', () => { dutyExpired(); openDuty(); });
// 頁面一直開著跨過 05:00：回到這個分頁時檢查（發文中不打斷，等下次按「新增發文」）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && dutyExpired() && pages.length && !modal.open && !$('dutyDlg').open) openDuty();
});
const pageName = (id) => (pages.find((p) => p.id === id) || {}).name || id;

// ---------- 已排程 ----------
const COMMENT_TEXT = { pending: '等待留言', done: '已留言', canceled: '已取消留言' };
function commentLine(c) {
  if (!c) return null;
  if (c.status === 'failed') return el('p', { className: 'cm bad', textContent: '留言失敗' + (c.error ? '：' + c.error : '') });
  return el('p', { className: 'cm' + (c.status === 'done' ? ' ok' : ''), textContent: COMMENT_TEXT[c.status] || c.status });
}
// 讀取中的骨架列：形狀同真的一列（縮圖＋時間＋內文＋按鈕），讀完整批換掉，畫面不跳
function skelRow() {
  const li = el('li', { className: 'sk-row' },
    el('div', { className: 'thumb sk' }),
    el('div', { className: 'body' }, el('span', { className: 'sk-line w40' }), el('span', { className: 'sk-line' }), el('span', { className: 'sk-line w70' })),
    el('div', { className: 'act' }, el('span', { className: 'sk-btn' })));
  li.setAttribute('aria-hidden', 'true');
  return li;
}
function setBusy(list, on) {
  list.querySelectorAll(':scope > .sk-row').forEach((n) => n.remove());
  if (on) list.append(skelRow(), skelRow(), skelRow());
  if (on) list.setAttribute('aria-busy', 'true'); else list.removeAttribute('aria-busy');
}
// 排序：時間最近（先發的在上）／時間最遠；只重排現有的列，不重新讀臉書。選擇記在這台瀏覽器
const SORT_KEY = 'fbpost.schedSort';
try { const v = localStorage.getItem(SORT_KEY); if (v === 'near' || v === 'far') $('schedSort').value = v; } catch { /* 無痕或封鎖儲存：用預設 */ }
function applySort() {
  const list = $('schedList'), far = $('schedSort').value === 'far';
  const rows = [...list.querySelectorAll(':scope > li.item')];
  rows.sort((a, b) => (Number(a.dataset.at) - Number(b.dataset.at)) * (far ? -1 : 1));
  list.append(...rows);
}
$('schedSort').addEventListener('change', () => {
  try { localStorage.setItem(SORT_KEY, $('schedSort').value); } catch { /* 略過 */ }
  applySort();
});
async function loadSched() {
  const list = $('schedList'), hint = $('schedHint');
  const ids = $('schedPage').value ? [$('schedPage').value] : pages.map((p) => p.id);
  list.replaceChildren();
  if (!ids.length) { hint.textContent = '沒有粉專'; return; }
  hint.textContent = '讀取中…';
  setBusy(list, true);
  const items = [], errs = [];
  await Promise.all(ids.map(async (id) => {
    try { for (const it of (await tb.api.call('/fb/scheduled?page=' + id)).items) items.push({ ...it, page: id }); }
    catch (e) { errs.push(`${pageName(id)}：${errText(e)}`); }
  }));
  items.sort((a, b) => (a.at || 0) - (b.at || 0));
  setBusy(list, false);
  hint.textContent = (items.length ? `共 ${items.length} 篇` : '目前沒有排程') + (errs.length ? `；${errs.join('；')}` : '');
  list.replaceChildren(...items.map((it) => {
    const cancel = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: '取消排程' });
    cancel.addEventListener('click', async () => {
      if (!(await confirmBox('取消這篇排程？', `${pageName(it.page)}｜${it.at ? fmtTime(it.at) : ''}\n取消後臉書上這篇排程會被刪除，無法復原。`, '取消排程'))) return;
      cancel.disabled = true;
      try { await tb.api.call('/fb/cancel', { method: 'POST', body: { post: it.id } }); li.remove(); hint.textContent = '已取消一篇排程'; }
      catch (e) { cancel.disabled = false; hint.textContent = '取消失敗：' + errText(e); }
    });
    const move = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: '改時間', dataset: { act: 'resched' } });
    move.addEventListener('click', () => openResched(it));
    const li = el('li', { className: 'item', dataset: { post: it.id, at: String(it.at || 0) } },
      it.picture ? el('img', { className: 'thumb', src: it.picture, alt: '', loading: 'lazy' }) : el('div', { className: 'thumb ph txt', textContent: '文字' }),
      el('div', { className: 'body' },
        el('div', { className: 'meta' }, el('b', { textContent: it.at ? fmtTime(it.at) : '—' }), el('span', { className: 'muted', textContent: pageName(it.page) })),
        el('p', { className: 'msg', textContent: it.message || '（沒有文字）' }),
        commentLine(it.comment)),
      el('div', { className: 'act' }, move, cancel));
    return li;
  }));
  applySort();
}
$('schedPage').addEventListener('change', loadSched);
$('schedReload').addEventListener('click', () => { loadSched(); pollFailed(); });

// 改時間：同網新的時間視窗；確定後 POST /fb/reschedule
let rsTarget = null;
const rsEd = createTimeEditor({ onEnter: () => $('rsYes').click() });
$('rsEditor').append(rsEd.root);
function openResched(it) {
  rsTarget = it;
  $('rsWhat').textContent = `${pageName(it.page)}｜目前排在 ${it.at ? fmtTime(it.at) : '—'}`;
  $('rsErr').textContent = '';
  rsEd.set(it.at ? new Date(it.at * 1000) : Sched.defaultAt(now()));
  $('rsDlg').showModal();
  rsEd.focus();
}
$('rsNo').addEventListener('click', () => $('rsDlg').close());
$('rsYes').addEventListener('click', async () => {
  if (!rsTarget || !rsEd.valid()) return;
  const at = rsEd.get(), btn = $('rsYes');
  btn.disabled = true;
  try {
    await tb.api.call('/fb/reschedule', { method: 'POST', body: { post: rsTarget.id, time: Math.floor(at.getTime() / 1000) } });
    $('rsDlg').close();
    $('schedHint').textContent = `已改成 ${Sched.fmtWhen(at, now())}`;
    await loadSched();
    $('schedHint').textContent = `已改成 ${Sched.fmtWhen(at, now())}`;
  } catch (e) {
    $('rsErr').textContent = e.code === 'already_published' ? '這篇已經發布了，不能再改時間。' : errText(e);
  } finally { btn.disabled = false; }
});

// ---------- 留言失敗通知（工具內）----------
// 工具開著時每 60 秒（頁面看得到才打）查失敗的留言：已排程分頁籤顯示紅點＋數字、上方列出項目（補留言／知道了）、新失敗跳瀏覽器通知。
// 第一次載入就已存在的失敗只顯示紅點、不跳通知。
const fails = { items: [], seen: new Set(), first: true };
function renderFails() {
  const n = fails.items.length;
  $('schedBadge').hidden = !n;
  $('schedBadge').textContent = n ? String(n) : '';
  $('schedBadge').setAttribute('aria-label', n ? `留言失敗 ${n} 則` : '');
  $('failBox').hidden = !n;
  $('failCount').textContent = String(n);
  $('failList').replaceChildren(...fails.items.map((c) => {
    const retry = el('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '補留言', dataset: { act: 'retry' } });
    const dismiss = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: '知道了', dataset: { act: 'dismiss' } });
    const note = el('p', { className: 'cm bad', textContent: '原因：' + (c.error || '未知') });
    const li = el('li', { className: 'item fail', dataset: { comment: c.id } },
      el('div', { className: 'body' },
        el('div', { className: 'meta' }, el('b', { textContent: pageName(c.page) }), el('span', { className: 'muted', textContent: c.due ? '預計 ' + fmtTime(c.due) : '' })),
        el('p', { className: 'msg', textContent: String(c.message || '').replace(/\s+/g, ' ').slice(0, 80) }), note),
      el('div', { className: 'act' }, retry, dismiss));
    const run = (path, okText) => async () => {
      retry.disabled = dismiss.disabled = true;
      try {
        await tb.api.call(path, { method: 'POST', body: { id: c.id } });
        fails.items = fails.items.filter((x) => x.id !== c.id);
        renderFails();
        $('schedHint').textContent = okText;
        loadSched();
      } catch (e) { retry.disabled = dismiss.disabled = false; note.textContent = '失敗：' + errText(e); }
    };
    retry.addEventListener('click', run('/fb/comment/retry', '已重新排入留言'));
    dismiss.addEventListener('click', run('/fb/comment/dismiss', '已標示知道了'));
    return li;
  }));
}
async function notifyFails(fresh) {
  if (typeof Notification === 'undefined') return;
  try {
    if (Notification.permission === 'default') await Notification.requestPermission();   // 第一次需要時才問；拒絕就只剩紅點
    if (Notification.permission !== 'granted') return;
    new Notification('臉書留言失敗', { body: `${fresh.length} 則留言沒送出，請到「已排程」分頁處理`, tag: 'fbpost-comment-fail' });
  } catch { /* 通知失敗不影響主流程 */ }
}
let polling = false;
async function pollFailed() {
  if (polling) return;
  polling = true;
  try {
    const r = await tb.api.call('/fb/comments?status=failed');
    const items = (r.items || []).filter((i) => !i.dismissed);
    const fresh = items.filter((i) => !fails.seen.has(i.id));
    items.forEach((i) => fails.seen.add(i.id));
    fails.items = items;
    renderFails();
    if (fresh.length && !fails.first) notifyFails(fresh);
    fails.first = false;
  } catch { /* 沒登入或後端還沒部署：不打擾 */ } finally { polling = false; }
}
setInterval(() => { if (document.visibilityState === 'visible') pollFailed(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollFailed(); });

// ---------- 成效 ----------
let statsLoaded = false, statsNext = null, statsBusy = false, statsSeq = 0;
const METRIC_NAMES = { post_media_view: '瀏覽', post_total_media_view_unique: '觸及人數', post_clicks: '點擊' };
async function loadStats(reset) {
  const page = $('statsPage').value;
  const list = $('statsList'), hint = $('statsHint'), more = $('statsMore'), moreHint = $('statsMoreHint');
  if (statsBusy && !reset) return;
  const seq = ++statsSeq; // 切換粉專（reset）時，舊請求回來要丟掉
  if (reset) { list.replaceChildren(); statsNext = null; more.hidden = true; }
  moreHint.textContent = '';
  if (!page) { statsBusy = false; more.disabled = false; more.textContent = '載入更多'; hint.textContent = '沒有粉專'; return; }
  statsLoaded = true;
  statsBusy = true;
  if (reset) hint.textContent = '讀取中…';
  else { more.disabled = true; more.textContent = '載入中…'; }
  setBusy(list, true);
  try {
    const r = await tb.api.call(`/fb/posts?page=${page}&limit=10` + (statsNext ? '&after=' + encodeURIComponent(statsNext) : ''));
    if (seq !== statsSeq) return;
    setBusy(list, false);
    statsNext = r.next;
    more.hidden = !statsNext;
    hint.textContent = '';
    list.append(...r.items.map(statRow));
    if (!list.children.length) hint.textContent = '沒有貼文';
  } catch (e) {
    if (seq !== statsSeq) return;
    setBusy(list, false);
    // 第一頁失敗寫在上方；「載入更多」失敗寫在按鈕旁，按鈕留著可以再按
    if (reset || !list.children.length) hint.textContent = '讀取失敗：' + errText(e);
    else moreHint.textContent = '讀取失敗：' + errText(e);
  } finally {
    if (seq === statsSeq) { statsBusy = false; more.disabled = false; more.textContent = '載入更多'; }
  }
}
function statRow(p) {
  const out = el('div', { className: 'ins', hidden: true });
  const btn = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: '看成效' });
  btn.addEventListener('click', async () => {
    if (!out.hidden) { out.hidden = true; return; }
    out.hidden = false;
    if (out.dataset.done) return;
    out.replaceChildren(el('span', { className: 'sk-line w70' }), el('span', { className: 'sr-only', textContent: '讀取中…' }));
    out.setAttribute('aria-busy', 'true');
    try {
      const r = await tb.api.call('/fb/insights?post=' + encodeURIComponent(p.id));
      const m = r.metrics || {};
      const parts = Object.entries(METRIC_NAMES).filter(([k]) => m[k] != null).map(([k, n]) => `${n} ${Number(m[k]).toLocaleString()}`);
      const rx = m.post_reactions_by_type_total;
      if (rx && typeof rx === 'object') parts.push('心情 ' + Object.values(rx).reduce((a, b) => a + Number(b || 0), 0).toLocaleString());
      out.removeAttribute('aria-busy');
      out.textContent = parts.length ? parts.join('｜') : '臉書沒有回傳成效（可能太新或權限不足）';
      out.dataset.done = '1';
    } catch (e) { out.removeAttribute('aria-busy'); out.textContent = '讀取失敗：' + errText(e); }
  });
  return el('li', { className: 'item' },
    p.picture ? el('img', { className: 'thumb', src: p.picture, alt: '', loading: 'lazy' }) : el('div', { className: 'thumb ph' }),
    el('div', { className: 'body' },
      el('div', { className: 'meta' }, el('b', { textContent: fmtIso(p.created) }),
        el('span', { className: 'muted', textContent: `讚 ${p.reactions}｜留言 ${p.comments}｜分享 ${p.shares}` })),
      el('p', { className: 'msg', textContent: p.message || '（沒有文字）' }), out),
    el('div', { className: 'act' }, btn,
      p.url && /^https:\/\//.test(p.url) ? el('a', { className: 'btn btn-secondary btn-sm', href: p.url, target: '_blank', rel: 'noopener', textContent: '開啟' }) : null));
}
$('statsPage').addEventListener('change', () => loadStats(true));
$('statsReload').addEventListener('click', () => loadStats(true));
$('statsMore').addEventListener('click', () => loadStats(false));

// ---------- 素材（同圖片套版）----------
const STICKER_IDS = ['smile', 'shock', 'cry', 'angry', 'kiss', 'laugh', 'meh'];
async function urlOf(key) { try { return (await tb.assets.get(key))?.url || null; } catch { return null; } }
async function loadAssets() {
  const [ribbonEnt, ribbonNews, logo, fontUrl, ...st] = await Promise.all([
    urlOf('frame.ent.ribbon'), urlOf('frame.news.ribbon'), urlOf('frame.logo'), urlOf('font.title'),
    ...STICKER_IDS.map((id) => urlOf('sticker.' + id))]);
  let fontLoaded = false;
  if (fontUrl) { try { const f = new FontFace('WHZ-Heavy', `url(${fontUrl})`); await f.load(); document.fonts.add(f); fontLoaded = true; } catch { /* 用系統字 */ } }
  const stickers = {};
  STICKER_IDS.forEach((id, i) => { if (st[i]) stickers[id] = st[i]; });
  return { company: Boolean(ribbonEnt || ribbonNews), ribbonEnt, ribbonNews, logo, fontLoaded, stickers };
}

// =====================================================================
// 新增發文彈窗
// =====================================================================
const modal = $('modal');
const state = { articleUrl: '', fontLoaded: false };
const cap = { auto: '', title: null };   // 小編文：上次自動填進去的全文、上次同步進【】的標題
let sending = false;

// ---------- 作圖框編輯器 ----------
let editor = null, frameCtl = null;
const editorReady = loadAssets().then((assets) => {
  state.fontLoaded = assets.fontLoaded;
  editor = createPhotoEditor({
    canvas: $('editorCanvas'), wrap: $('canvasWrap'), fxBar: $('fxBar'), assets,
    titleOverlay: $('titleOverlay'), onEmptyClick: () => $('fileInput').click(),
  });
  const frameSeg = $('frameSeg');
  frameSeg.replaceChildren(...editor.frames().map((k) => el('button', { type: 'button', textContent: FRAME_NAMES[k] || k, dataset: { frame: k } })));
  frameCtl = segment(frameSeg, 'frame', (k) => editor.setFrame(k));
  frameCtl.set(editor.getFrame());
  editor.onChange(() => { const has = editor.hasImage(); $('canvasWrap').classList.toggle('has-image', has); $('clearImg').hidden = !has; $('fxBtn').hidden = !has; if (!has) closeFx(); });
  // 預覽上點兩下改的標題寫回標題框，走標題框自己的 input（計數、【標題】同步都同一條路）
  editor.onTitleInput((v) => { $('title').value = v; $('title').dispatchEvent(new Event('input')); });
  editor.setTitle($('title').value);
  renderCard();
}).catch(() => { tb.log.error('fbpost-editor-failed'); });

// 😊 T寶／馬賽克工具列：預設收起，點按鈕展開，加完或點外面收起（照網新）
function closeFx() { $('fxBar').hidden = true; $('fxBtn').setAttribute('aria-expanded', 'false'); }
$('fxBtn').addEventListener('click', () => { const open = $('fxBar').hidden; $('fxBar').hidden = !open; $('fxBtn').setAttribute('aria-expanded', String(open)); });
$('fxBar').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !/刪除/.test(b.getAttribute('aria-label') || '')) closeFx(); });
document.addEventListener('pointerdown', (e) => { if (!$('fxBar').hidden && !$('fxBar').contains(e.target) && !$('fxBtn').contains(e.target)) closeFx(); });

let mode = 'frame', textStyle = 'card';
function syncPanes() {
  $('framePane').hidden = mode !== 'frame';
  $('textPane').hidden = mode !== 'text';
  $('cardPane').hidden = textStyle !== 'card';
  $('nativePane').hidden = textStyle !== 'native';
  $('plainPane').hidden = textStyle !== 'plain';
  $('titleBlock').hidden = mode === 'text' && textStyle !== 'card';   // 原生背景／無底色不用標題
  updateCount();
  if (mode === 'text') renderCard();
}
const modeSeg = segment($('modeSeg'), 'mode', (m) => { mode = m; syncPanes(); });
const textSeg = segment($('textSeg'), 'text', (t) => { textStyle = t; syncPanes(); });

// 照片：點畫布（沒照片時）、拖曳、貼上
async function takeImage(file) {
  await editorReady;
  if (!editor) return;
  try { await editor.loadFile(file); } catch (e) { $('urlHint').textContent = errText(e); }
}
$('fileInput').addEventListener('change', () => { const f = $('fileInput').files[0]; $('fileInput').value = ''; if (f) takeImage(f); });
$('canvasWrap').addEventListener('dragover', (e) => e.preventDefault());
$('canvasWrap').addEventListener('drop', (e) => { e.preventDefault(); const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (f) takeImage(f); });
document.addEventListener('paste', (e) => {
  if (!modal.open || mode !== 'frame') return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); takeImage(f); }
});
$('clearImg').addEventListener('click', () => editor && editor.clearImage());

// ---------- 標題（作圖框與純文字底圖共用）----------
const titleEl = $('title');
bindTitle(titleEl);   // sdk 的 titleAsOneLine 讀這個標題框
const titleRows = () => titleEl.value.replace(/\r/g, '').split('\n');
const getLines = () => titleRows().map((l) => l.trim()).filter(Boolean);   // 送出／畫圖用：去掉空行
function updateCounters() {
  updateSlugHint();
  const rs = titleRows();
  let n = 0;
  $('titleCnts').replaceChildren(...rs.map((r) => {
    const s = el('span');
    if (!r.trim()) return s;
    const len = charWidth(r.trim());   // 同網新：全形 1、半形 0.5
    s.textContent = `${len}/${TITLE_MAX}`;
    s.className = len > TITLE_MAX || n >= TITLE_LINES ? 'bad' : '';
    n++;
    return s;
  }));
  titleEl.rows = Math.max(3, rs.length);
  if (editor) editor.setTitle(titleEl.value);
  renderCard();
}
function setLines(lines) { titleEl.value = lines.join('\n'); updateCounters(); }
// 小編文的【標題】那一行跟著標題框走：沒改過的相鄰兩行照文章原本的接法，新的用空格接（網新 syncCaptionTitle）
function syncCaptionTitle() {
  const c = $('caption'), t = titleAsOneLine();
  const r = replaceTitleLine(c.value, t, cap.title);
  if (r.index < 0) return;   // 小編把【…】那一行刪掉了：不再補回來
  cap.title = t;
  if (r.text === c.value) return;
  if (c.value === cap.auto) cap.auto = r.text;
  c.value = r.text;
  updateCount();
}
titleEl.addEventListener('input', () => { updateCounters(); syncCaptionTitle(); });

// ---------- 純文字底圖 ----------
let swatch = TEXT_SWATCHES.find((s) => s.key === DEFAULT_SWATCH) || TEXT_SWATCHES[0];
function renderCard() { drawTextCard($('textCanvas'), { text: getLines().join('\n'), swatch, fontLoaded: state.fontLoaded }); }
function pickSwatch(s) {
  swatch = s;
  for (const x of $('swatches').children) { const on = x.dataset.key === s.key; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', String(on)); }
  renderCard();
}
$('swatches').replaceChildren(...TEXT_SWATCHES.map((s) => {
  const b = el('button', { type: 'button', className: 'sw' + (s === swatch ? ' is-on' : ''), title: s.label, ariaLabel: s.label, dataset: { key: s.key } });
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(s === swatch));
  b.style.background = swatchCss(s);
  b.addEventListener('click', () => pickSwatch(s));
  return b;
}));
document.fonts.load('900 76px "Noto Sans TC"', '字').catch(() => {}).then(renderCard);

// ---------- 小編文、留言小編文 ----------
function updateCount() {
  const n = [...$('caption').value].length;
  const native = mode === 'text' && textStyle === 'native';
  $('capCount').textContent = native ? `${n}/${NATIVE_MAX}` : (n ? `${n} 字` : '');
  $('capCount').classList.toggle('bad', native && n > NATIVE_MAX);
}
$('caption').addEventListener('input', updateCount);

// 留言用的文章網址：優先用最後一次帶入記住的原始網址，沒有才看網址欄
const articleUrl = () => {
  if (state.articleUrl) return state.articleUrl;
  const u = $('url').value.trim();
  return /^https?:\/\/\S+$/i.test(u) ? u : '';
};
// 每個粉專的留言 = （填的 || 看更多新聞內容）＋換行＋文章網址（帶該粉專 utm）；沒有網址時有填才送、沒填不留言
function commentFor(p) {
  const custom = $('comment').value.trim();
  const url = articleUrl();
  if (!url) return custom;
  return `${custom || DEFAULT_COMMENT}\n${buildLink(url, p.utm)}`;
}
function updateCommentPreview() {
  const first = checkedChips()[0];
  const p = first && pages.find((x) => x.id === first.id);
  const box = $('commentPrev');
  if (!p) { box.textContent = '勾選粉專後，這裡顯示留言預覽'; return; }
  const text = commentFor(p);
  box.textContent = text ? `留言預覽（${pageLabel(p)}）：\n${text}` : `留言預覽（${pageLabel(p)}）：不會留言（沒有文章網址也沒填留言）`;
}
$('comment').addEventListener('input', updateCommentPreview);

// ---------- 文章網址自動帶入（同網新 quickFill）----------
const hint = (msg, cls) => { const h = $('urlHint'); h.textContent = msg || ''; h.className = 'hint' + (cls ? ' ' + cls : ''); };
// 帶入時標題、小編文、畫布先放骨架（灰底 shimmer），各自拿到結果就拿掉
function skel(node, on) { node.classList.toggle('is-skel', on); if (node.tagName === 'TEXTAREA') node.readOnly = on; node.setAttribute('aria-busy', String(on)); }
const skelNodes = () => [$('title'), $('caption'), $('canvasWrap')];
let filling = false;
async function loadMainImage(images) {
  for (const im of images.slice(0, 3)) {   // 失敗再試下一張，最多 3 張
    try {
      const res = await tb.api.call('/fetch/image?url=' + encodeURIComponent(im.url), { raw: true });
      let blob = await res.blob();
      if (!/^image\//.test(blob.type)) blob = new Blob([blob], { type: 'image/jpeg' });
      await editor.loadFile(blob);
      return true;
    } catch { /* 試下一張 */ }
  }
  return false;
}
async function quickFill() {
  if (filling) return;
  const url = $('url').value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) { hint('請先貼文章網址（https 開頭）', 'bad'); return; }
  filling = true; $('fillBtn').disabled = true; hint('帶入中…');
  const capCur = $('caption').value;
  skel($('title'), true); skel($('canvasWrap'), true);
  if (!capCur.trim() || capCur === cap.auto) skel($('caption'), true);
  try {
    await editorReady;
    let art;
    try {
      const r = await tb.api.call('/fetch/article?url=' + encodeURIComponent(url));
      art = parseArticle(r.html, r.url || url);
    } catch (e) { hint('帶入失敗：' + (e.code === 'host_not_allowed' ? '這個網址不在允許的網域（tvbs.com.tw）' : errText(e)), 'bad'); return; }
    state.articleUrl = url;
    const done = [];
    // 網址是 /entertainment/ 就自動切娛樂粉框，其他回新聞藍框（沒有公司素材時只有通用框，維持原樣）
    const f = frameForUrl(url);
    if (editor && frameCtl && editor.frames().includes(f)) frameCtl.set(f);
    if (art.title) {
      const lines = autoLines(art.title);
      learnSeps(overrideOneLine(art.title), lines);   // 小編文的【標題】接回原標題的樣子
      setLines(lines);
      done.push('標題');
    }
    skel($('title'), false);
    let imgFail = false;
    if (art.images.length && editor) { if (await loadMainImage(art.images)) done.push('主圖'); else imgFail = true; }
    skel($('canvasWrap'), false);
    // 小編文：空的或還是自動帶的就整段重帶；小編改過就不覆蓋，只更新【標題】那一行
    const caption = mainCaption(art);
    const fill = !$('caption').value.trim() || $('caption').value === cap.auto;
    if (fill) {
      const t = titleAsOneLine();
      $('caption').value = cap.auto = formatCopy({ title: t, caption, tags: art.tags });
      cap.title = t;
      updateCount();
      done.push('小編文');
    } else syncCaptionTitle();
    const notes = [];
    if (!art.title) notes.push('沒讀到標題');
    if (imgFail) notes.push('主圖讀不出來，請手動放照片');
    if (fill && !caption) notes.push('沒抓到圖說');
    if (!fill) notes.push('小編文已改過，沒有覆蓋（只更新【標題】那一行）');
    hint(`已帶入：${done.join('、') || '（沒有可帶入的內容）'}` + (notes.length ? `；${notes.join('；')}` : ''), imgFail || !art.title ? 'bad' : 'ok');
    updateCommentPreview();
  } finally { filling = false; $('fillBtn').disabled = false; skelNodes().forEach((n) => skel(n, false)); }
}
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); quickFill(); } });
$('url').addEventListener('input', updateCommentPreview);
$('fillBtn').addEventListener('click', quickFill);
// 貼上網址就直接帶入（等貼上的值寫進欄位後再讀）
$('url').addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\/\S+$/i.test($('url').value.trim())) quickFill(); }, 0));

// ---------- 粉專晶片：點名稱勾選；▾ 選立即／排程（排程才開時間視窗）----------
const chips = new Map();   // 粉專ID → { id, on, sched, at, status('' | sending | ok | fail), result, els }
const menu = $('modeMenu'), pop = $('timePop');
let popFor = null;
function place(node, anchor) {
  const mr = modal.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
  node.hidden = false;
  node.style.left = Math.max(8, Math.min(ar.left - mr.left, mr.width - node.offsetWidth - 8)) + 'px';
  const above = ar.top - mr.top - node.offsetHeight - 8;
  node.style.top = (above >= 8 ? above : ar.bottom - mr.top + 8) + 'px';
}
function closePops() { menu.hidden = true; pop.hidden = true; popFor = null; }
const checkedChips = () => ordered().map((p) => chips.get(p.id)).filter((c) => c && c.on);
const pendingChips = () => checkedChips().filter((c) => c.status !== 'ok');

function renderChip(id) {
  const c = chips.get(id), p = pages.find((x) => x.id === id);
  if (!c || !p) return;
  const e = c.els, done = c.status === 'ok', fail = c.status === 'fail', busy = c.status === 'sending';
  e.root.classList.toggle('on', c.on && !done && !fail);
  e.root.classList.toggle('done', done); e.root.classList.toggle('fail', fail); e.root.classList.toggle('busy', busy);
  e.main.setAttribute('aria-pressed', String(c.on));
  e.main.disabled = done || busy;
  e.box.textContent = c.on ? '✓' : '';
  e.mode.hidden = !c.on;
  e.mode.disabled = busy || done;
  e.retry.hidden = !fail;
  e.mode.title = fail && c.result ? c.result.error : '';
  if (done) e.mode.textContent = c.result && c.result.schedule ? `✓ 排程 ${Sched.fmtWhen(c.at, now())}` : '✓ 已發布';
  else if (fail) e.mode.textContent = '✗ 失敗 ▾';
  else if (busy) e.mode.textContent = '送出中…';
  else e.mode.textContent = (c.sched && c.at ? `排程 ${Sched.fmtWhen(c.at, now())}` : '立即') + ' ▾';
}
function updateSendBtn() {
  const n = pendingChips().length;
  $('sendBtn').textContent = n ? `全部送出（${n} 台）` : '全部送出';
  $('sendBtn').disabled = !n || sending;
  $('sendTip').hidden = n > 0 || checkedChips().length > 0;
  updateCommentPreview();
}
function makeChip(p) {
  const c = { id: p.id, on: p.id === mainId(), sched: false, at: null, status: '', result: null };   // 只預勾主要值班粉專
  const root = el('div', { className: 'pg', dataset: { page: p.id } });
  const main = el('button', { type: 'button', className: 'pg-main' });
  const box = el('span', { className: 'box' });
  main.append(box, pageLabel(p));
  main.title = p.name;
  const mode = el('button', { type: 'button', className: 'pg-mode', hidden: true });
  mode.setAttribute('aria-haspopup', 'menu');
  const retry = el('button', { type: 'button', className: 'retry', hidden: true, textContent: '↻ 重送' });
  retry.setAttribute('aria-label', `重送${pageLabel(p)}`);
  root.append(main, mode, retry);
  c.els = { root, main, box, mode, retry };
  main.addEventListener('click', () => {
    c.on = !c.on; c.status = ''; c.result = null;
    closePops(); renderChip(p.id); updateSendBtn();
  });
  mode.addEventListener('click', (e) => { e.stopPropagation(); if (c.status === 'ok') return; openMenu(p.id); });
  retry.addEventListener('click', () => send([p.id]));
  return c;
}
function renderPageChips() {
  const ids = new Set(pages.map((p) => p.id));
  for (const id of [...chips.keys()]) if (!ids.has(id)) chips.delete(id);
  for (const p of pages) if (!chips.has(p.id)) chips.set(p.id, makeChip(p));
  $('pages').replaceChildren(...(pages.length ? ordered().map((p) => { renderChip(p.id); return chips.get(p.id).els.root; }) : [el('span', { className: 'hint', textContent: '沒有可發的粉專' })]));
  updateSendBtn();
}

function openMenu(id) {
  popFor = id; pop.hidden = true;
  const c = chips.get(id);
  menu.querySelectorAll('button').forEach((b) => b.classList.toggle('cur', (b.dataset.m === 'sched') === c.sched));
  place(menu, c.els.mode);
  menu.querySelector('button').focus();
}
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-m]');
  if (!b || !popFor) return;
  const id = popFor, c = chips.get(id);
  if (b.dataset.m === 'now') { c.sched = false; closePops(); renderChip(id); c.els.mode.focus(); return; }
  c.sched = true;
  if (!c.at || Sched.validate(c.at, now())) c.at = Sched.defaultAt(now());   // 預填 現在＋30 分
  renderChip(id); menu.hidden = true; openPop(id);
});
// 時間視窗：日期預設今天；時間直接打 4 碼（2130→21:30），↑↓ ±10 分；快捷鈕 +30 分／+1 小時／明天
const popEd = createTimeEditor({
  onChange: (at) => { const c = chips.get(popFor); if (c) { c.at = at; renderChip(popFor); } },
  onEnter: () => { const id = popFor; closePops(); if (chips.get(id)) chips.get(id).els.mode.focus(); },
});
pop.append(el('h3', { textContent: '排程時間' }), popEd.root);
function openPop(id) {
  const c = chips.get(id);
  popEd.set(c.at);
  place(pop, c.els.mode);
  popEd.focus();
}
modal.addEventListener('mousedown', (e) => { if ((!menu.hidden || !pop.hidden) && !e.target.closest('.menu,.timepop,.pg-mode')) closePops(); });

// ---------- 送出 ----------
// 先組好「要送的內容」（同一張圖給每個粉專），再逐台送；每台各自的時間與留言
async function buildPayload() {
  const caption = $('caption').value;
  const p = { message: caption, image: null, textPreset: '' };
  const lines = getLines();
  if (mode === 'frame') {
    await editorReady;
    if (!editor || !editor.hasImage()) throw new Error('請先放照片');
    if (lines.length > TITLE_LINES || lines.some((l) => charWidth(l) > TITLE_MAX)) throw new Error(`標題每行最多 ${TITLE_MAX} 字、最多 ${TITLE_LINES} 行`);
    p.image = await editor.exportBlob('image/jpeg', 0.92);
  } else if (textStyle === 'card') {
    if (!lines.length) throw new Error('請輸入標題（底圖文字）');
    drawTextCard($('textCanvas'), { text: lines.join('\n'), swatch, fontLoaded: state.fontLoaded });
    p.image = await new Promise((r) => $('textCanvas').toBlob(r, 'image/jpeg', 0.92));
    renderCard();
  } else {
    if (!caption.trim()) throw new Error('請輸入小編文');
    if (textStyle === 'native') {
      p.textPreset = $('presetId').value.trim();
      if (!/^\d{5,20}$/.test(p.textPreset)) throw new Error('請輸入背景代碼（數字）');
    }
  }
  return p;
}
async function sendOne(page, p, at) {
  const fd = new FormData();
  fd.append('page', page.id);
  fd.append('message', p.message);
  if (p.image) fd.append('image', p.image, 'post.jpg');
  if (p.textPreset) fd.append('textPreset', p.textPreset);
  if (at) fd.append('scheduledAt', String(at));
  fd.append('comment', commentFor(page));
  return tb.api.call('/fb/post', { method: 'POST', body: fd });
}
const sendMsg = (text, cls) => { const m = $('sendMsg'); m.textContent = text || ''; m.className = 'hint' + (cls ? ' ' + cls : ''); };

async function send(ids) {
  if (sending) return;
  if (!ids.length) { sendMsg('請先勾選要發的粉專', 'bad'); return; }
  sending = true;   // 在任何 await 之前就鎖上，避免連點兩下重複發文
  $('sendBtn').disabled = true;
  try {
    let payload;
    try { payload = await buildPayload(); } catch (e) { sendMsg(errText(e), 'bad'); return; }
    // 排程時間先全部檢查：有一台不合法就整批不送（同網新）
    for (const id of ids) {
      const c = chips.get(id);
      const err = c.sched ? Sched.validate(c.at, now()) : null;
      if (err) { sendMsg(`${pageLabel(pages.find((p) => p.id === id))}：${err.msg}`, 'bad'); return; }
    }
    ids.forEach((id) => { chips.get(id).status = 'sending'; renderChip(id); });
    let schedN = 0, nowN = 0, commentBad = 0;
    const failed = [], sent = [];
    const rdInfo = { articleId: articleId($('url').value.trim()), slug: $('slug').value, lines: getLines(), type: RD.typeOf(mode, textStyle) };
    for (const [i, id] of ids.entries()) {
      const c = chips.get(id), page = pages.find((p) => p.id === id);
      sendMsg(`送出 ${pageLabel(page)}…（${i + 1}/${ids.length}）`);
      try {
        const r = await sendOne(page, payload, c.sched ? Math.floor(c.at.getTime() / 1000) : null);
        c.status = 'ok'; c.result = { schedule: c.sched };
        sent.push({ code: page.code, at: c.sched ? Math.floor(c.at.getTime() / 1000) : new Date() });
        if (c.sched) schedN++; else nowN++;
        if (r && r.comment && r.comment.status === 'failed') commentBad++;
      } catch (e) {
        c.status = 'fail'; c.result = { error: errText(e) };
        failed.push(`${pageLabel(page)} ${errText(e)}`);
      }
      renderChip(id);
    }
    const sum = [nowN ? `已發布 ${nowN} 台` : '', schedN ? `已排程 ${schedN} 台` : ''].filter(Boolean).join('、');
    const rd = await toRundown(rdInfo, sent);
    const extra = (commentBad ? `；${commentBad} 台留言沒排成功，請到「已排程」分頁處理` : '') + (rd.msg ? '；' + rd.msg : '');
    if (failed.length) sendMsg(`${sum ? sum + '；' : ''}失敗 ${failed.length} 台：${failed.join('；')}（可按晶片上的「↻ 重送」）${extra}`, 'bad');
    else sendMsg(sum + extra, commentBad || rd.bad ? 'bad' : 'ok');
    if (schedN) loadSched();
    pollFailed();
    if (!pendingChips().length && checkedChips().length) showDone((sum || '全部完成') + extra);
  } finally {
    sending = false;
    updateSendBtn();
  }
}
$('sendBtn').addEventListener('click', () => send(pendingChips().map((c) => c.id)));

// ---------- 排入 Rundown（開關打開才做；這次送成功的台各寫一筆，排程用排程時間、立即用送出當下）----------
const rdLabel = (code) => { const p = pages.find((x) => x.code === code); return p ? pageLabel(p) : RD.PAGES[code]; };
async function toRundown(info, sent) {
  if (!$('rdOn').checked || !sent.length) return { msg: '' };
  const { entries } = RD.entries(info, sent);
  if (!entries.length) return { msg: '' };
  sendMsg('寫入 Rundown…');
  let res;
  try { res = await tb.api.call('/rundown', { method: 'POST', body: { action: 'add', entries } }); } catch (e) {
    return { msg: 'Rundown 沒寫入：' + errText(e), bad: true };
  }
  const list = Array.isArray(res && res.results) ? res.results : [];
  return { msg: 'Rundown：' + entries.map((en, i) => RD.describe(list[i], rdLabel(en.page))).join('；'), bad: entries.some((en, i) => !(list[i] && list[i].ok)) };
}
function syncRd() {
  const on = $('rdOn').checked;
  $('slug').disabled = !on;
  $('rdBox').classList.toggle('off', !on);
}
function updateSlugHint() {
  const ds = RD.defaultSlug(getLines());
  $('slug').placeholder = ds ? `空白＝${ds}（標題前 4 字）` : '空白＝標題前 4 字';
}
$('rdOn').checked = RD.rundownOn();
syncRd();
$('rdOn').addEventListener('change', () => { RD.setRundownOn($('rdOn').checked); syncRd(); });
$('rdSetBtn').addEventListener('click', () => { $('rdHint').textContent = ''; $('rdHint').className = 'hint'; $('rdDlg').showModal(); });
$('rdClose').addEventListener('click', () => $('rdDlg').close());
$('rdTest').addEventListener('click', async () => {
  const h = $('rdHint');
  $('rdTest').disabled = true; h.className = 'hint'; h.textContent = '測試中…';
  try {
    const j = await tb.api.call('/rundown', { method: 'POST', body: { action: 'ping' } });
    h.className = 'hint ok'; h.textContent = `連線成功：${j.title || '試算表'}（分頁 ${(j.sheets || []).slice(0, 3).join('、')}…）`;
  } catch (e) { h.className = 'hint bad'; h.textContent = e.code === 'unauthorized' ? '請先輸入公司密碼' : errText(e); }
  finally { $('rdTest').disabled = false; }
});

// ---------- 完成、關閉、清空 ----------
function showDone(body) {
  closePops();
  $('dnBody').textContent = body;
  $('doneDlg').showModal();
  $('dnAgain').focus();
}
const isDirty = () => !!($('url').value.trim() || $('title').value.trim() || $('caption').value.trim() || $('comment').value.trim() || $('presetId').value.trim() || (editor && editor.hasImage()));
const allSent = () => [...chips.values()].some((c) => c.on && c.status === 'ok') && !pendingChips().length;

// 清空全部（同網新 resetAll）：唯一會刪內容的地方只有「確認關閉」「清空」「再發一篇」
function resetAll() {
  for (const id of ['url', 'title', 'caption', 'comment', 'presetId']) $(id).value = '';
  hint(''); sendMsg('');
  state.articleUrl = ''; cap.auto = ''; cap.title = null;
  learnSeps('', []);
  if (editor) { editor.clearAll(); frameCtl.set(editor.getFrame()); }
  closeFx();
  mode = 'frame'; textStyle = 'card';
  modeSeg.set('frame'); textSeg.set('card');
  pickSwatch(TEXT_SWATCHES.find((s) => s.key === DEFAULT_SWATCH) || TEXT_SWATCHES[0]);
  $('slug').value = ''; updateSlugHint();
  for (const c of chips.values()) { c.on = c.id === mainId(); c.sched = false; c.at = null; c.status = ''; c.result = null; renderChip(c.id); }
  closePops(); updateCounters(); updateCount(); updateSendBtn();
}
let ourClose = false;
function closeModal() {
  ourClose = true;
  $('doneDlg').open && $('doneDlg').close();
  modal.close();
  resetAll();
}
async function requestClose() {
  if (sending) { sendMsg('送出中，請等全部送完', 'bad'); return; }
  if (!isDirty() || allSent()) { closeModal(); return; }
  const some = [...chips.values()].some((c) => c.status);
  if (await confirmBox('關閉新增發文？', some ? '還有沒送出或失敗的粉專，關閉後內容會全部清掉。' : '目前填的內容還沒送出，關閉後會清掉。', '放棄並關閉')) closeModal();
}
$('newPost').addEventListener('click', async () => {
  if (dutyExpired() || (!duty && !dutyAsked && pages.length)) { await openDuty(); resetAll(); }
  modal.showModal(); $('url').focus();
});
$('mClose').addEventListener('click', requestClose);
modal.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });   // Esc 走同一條路
// 瀏覽器偶爾會略過 cancel 直接關（連按兩次 Esc）：內容還沒送就原地重開，再問一次
modal.addEventListener('close', () => {
  if (ourClose) { ourClose = false; return; }
  if (isDirty() && !allSent()) { modal.showModal(); requestClose(); } else resetAll();
});
$('clearBtn').addEventListener('click', async () => {
  if (sending) return;
  if (isDirty() || checkedChips().length) {
    if (!(await confirmBox('清空新增發文？', '照片、標題、小編文、留言、粉專勾選與時間、送出結果都會清掉。', '清空'))) return;
  }
  resetAll();
  $('url').focus();
});
$('dnList').addEventListener('click', () => closeModal());
$('dnAgain').addEventListener('click', () => { $('doneDlg').close(); resetAll(); $('url').focus(); });

pickSwatch(swatch);
updateCounters();
updateCount();
loadPages();
pollFailed();
