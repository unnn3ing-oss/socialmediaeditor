// 直播需求單：畫面。規則都在 parse.js。
import { tb } from '../../sdk/toolbox.js';
import { PAGES, parse, check, build, weatherNote, dutyExpiry, fmtTime } from './parse.js';

tb.init('livereq');

const $ = (id) => document.getElementById(id);
const src = $('src'), list = $('list'), empty = $('empty'), count = $('count');
const dutyName = $('dutyName'), dutyContact = $('dutyContact'), dutyHint = $('dutyHint');
const tpl = $('cardTpl'), pagesTpl = $('pagesTpl');
const stage = $('stage'), bar = $('bar'), stBar = $('stBar'), pos = $('pos'), dots = $('dots');
const pasteBtn = $('pasteBtn'), srcWrap = $('srcWrap'), copyNext = $('copy');
const KEY = 'tbx.livereq.duty';
const cards = []; // { a, el, refresh, copied, items, lastMissing, doCopy }
let cur = 0;

// ---- 值班小編（依班別到期） ----
let dutyExp = 0;
const fmt = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 分機：剛好 5 位數字就在前面加 #（手機或已經有 # 的不動）
export const fmtContact = (v) => { const t = String(v || '').trim(); return /^\d{5}$/.test(t) ? '#' + t : t; };
// 值班姓名、分機或手機都必填：空的那一欄紅框（不列在底列狀態鈕）
function markDuty() {
  for (const el of [dutyName, dutyContact]) {
    const bad = !el.value.trim();
    el.classList.toggle('is-bad', bad); el.setAttribute('aria-invalid', String(bad));
  }
}
function showDutyHint() {
  markDuty();
  dutyHint.textContent = dutyExp && (dutyName.value.trim() || dutyContact.value.trim())
    ? `本班保留到 ${fmt(dutyExp)}，之後自動清空（早班 08:00～16:30、晚班 16:00～00:00）`
    : '依班別保留：早班 08:00～16:30、晚班 16:00～00:00，下班後自動清空';
}
function loadDuty() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && v.exp > Date.now()) { dutyName.value = v.name || ''; dutyContact.value = v.contact || ''; dutyExp = v.exp; }
    else localStorage.removeItem(KEY);
  } catch { /* 瀏覽器不給存就只放記憶體 */ }
  showDutyHint();
}
// ---- 員工編號登入：姓名帶入名單（可臨時改、不存回），分機存在自己的帳號（/staff/me），不用班別清空 ----
let staff = null, staffTimer = 0, staffSaved = '', staffSeq = 0;   // staffSeq：只採用最後一次儲存的回應
function showStaffHint(state) {
  markDuty();
  const head = `已用員工編號 ${staff.id} 登入：分機存在你的帳號，下次自動帶入`;
  dutyHint.textContent = state ? head + '。' + state : head;
}
async function saveStaffContact() {
  clearTimeout(staffTimer);
  const contact = fmtContact(dutyContact.value);
  if (contact === staffSaved) return;
  showStaffHint('儲存中…');
  const seq = ++staffSeq;
  try {
    const me = await tb.api.call('/staff/me', { method: 'POST', body: { contact } });
    if (seq !== staffSeq) return;
    staffSaved = me.contact || '';
    if (fmtContact(dutyContact.value) === staffSaved) showStaffHint('已儲存');
  } catch (e) {
    if (seq !== staffSeq) return;
    showStaffHint('儲存失敗：' + ((e && e.message) || '請稍後再試'));
  }
}
async function loadStaff() {
  const who = tb.company && tb.company.staff ? tb.company.staff() : null;
  if (!who) return false;
  let me;
  try { me = await tb.api.call('/staff/me'); } catch { return false; }   // 讀不到就照舊用瀏覽器保存
  staff = me; staffSaved = me.contact || '';
  dutyName.value = me.name || ''; dutyContact.value = fmtContact(me.contact);
  dutyExp = 0;
  showStaffHint('');
  cards.forEach((c) => c.refresh());
  return true;
}

function saveDuty() {
  if (staff) { markDuty(); cards.forEach((c) => c.refresh()); return; }
  const name = dutyName.value.trim(), contact = dutyContact.value.trim();
  if (!dutyExp || dutyExp <= Date.now()) dutyExp = dutyExpiry(new Date());
  try {
    if (name || contact) localStorage.setItem(KEY, JSON.stringify({ name, contact, exp: dutyExp }));
    else { localStorage.removeItem(KEY); dutyExp = 0; }
  } catch { /* 忽略 */ }
  showDutyHint();
  cards.forEach((c) => c.refresh());
}
function expireDuty() {
  if (dutyExp && dutyExp <= Date.now()) {
    dutyName.value = ''; dutyContact.value = ''; dutyExp = 0;
    try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
    showDutyHint();
    cards.forEach((c) => c.refresh());
  }
}
dutyName.addEventListener('input', saveDuty);
dutyContact.addEventListener('input', () => {
  saveDuty();
  if (staff) { clearTimeout(staffTimer); staffTimer = setTimeout(saveStaffContact, 600); }
});
dutyContact.addEventListener('blur', () => {
  const v = fmtContact(dutyContact.value); if (v !== dutyContact.value) { dutyContact.value = v; saveDuty(); }
  if (staff) saveStaffContact();
});
setInterval(() => { if (!staff) expireDuty(); }, 30000);
loadDuty();
loadStaff();

const duty = () => ({ name: dutyName.value, contact: fmtContact(dutyContact.value) });

// ---- 複製 ----
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 改用舊方法 */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// 複製失敗：選取文字讓使用者手動複製（textarea 用 select、一般文字用 Range）
function selectManual(node) {
  try {
    if (node.select) { node.focus({ preventScroll: true }); node.select(); return; }
    node.classList.add('lr-sel');
    const r = document.createRange(); r.selectNodeContents(node);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  } catch { /* 忽略 */ }
}

// ---- 卡片 ----
function makeCard(a, idx) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  const q = (s) => el.querySelector(s);
  const title = q('.lr-title'), evWrap = q('.lr-event'), evIn = q('[data-event]'), tmIn = q('[data-time]');
  const out = q('[data-out]'), msg = q('[data-msg]'), regen = q('[data-regen]');
  const self = { a, el, copied: false, items: [], lastMissing: [], refresh: null, doCopy: null };
  el.dataset.idx = String(idx);
  q('[data-repeat]').hidden = !a.repeat;
  evWrap.hidden = !!a.event;
  q('[data-timewrap]').hidden = !!a.time;

  // 粉專：放在標題右側；需求單已經有的打勾並鎖住
  const pagesEl = pagesTpl.content.firstElementChild.cloneNode(true);
  const pq = (s) => pagesEl.querySelector(s);
  const have = new Set(a.fbExisting.map((s) => s.replace(/\s+/g, '').replace(/(粉專|粉)$/, '')));
  const boxes = PAGES.map((p) => {
    const lab = document.createElement('label');
    lab.className = 'lr-box';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = p;
    if (have.has(p)) { cb.checked = true; cb.disabled = true; lab.title = '需求單已經有'; }
    lab.append(cb, document.createTextNode(p));
    pq('[data-boxes]').append(lab);
    return cb;
  });
  q('[data-pageslot]').append(pagesEl);
  pq('[data-have]').textContent = a.fbExisting.length ? `需求單已有：${a.fbExisting.join('、')}` : '';

  const w = weatherNote(a);
  if (w) {
    q('[data-weather]').hidden = false;
    q('[data-wbox]').hidden = false;
    q('[data-wtext]').textContent = w.text;
  }

  // 缺漏提示 → 對應欄位（只指到畫面上看得到的欄位；其餘落在完整需求單）
  function jumpTarget(k) {
    if (k === '新聞事件') return !evWrap.hidden ? () => evIn : () => out;
    if (k === '直播時間') return !q('[data-timewrap]').hidden ? () => tmIn : () => out;
    if (k === 'FB 粉專') return () => boxes.find((b) => !b.disabled) || out;
    if (k === '值班小編') return () => (dutyName.value.trim() ? dutyContact : dutyName);
    return () => out;
  }
  let dirty = false;
  out.addEventListener('input', () => { dirty = true; regen.hidden = false; });
  regen.addEventListener('click', () => { dirty = false; regen.hidden = true; refresh(); });

  function refresh() {
    const checked = boxes.filter((b) => b.checked && !b.disabled).map((b) => b.value);
    const opt = { checked, duty: duty(), eventOverride: evIn.value, timeOverride: tmIn.value };
    const { missing, warnings } = check(a, opt);
    const name = (a.event || evIn.value.trim() || '（未填新聞事件）') + (a.repeat && !(a.event || '').includes(a.repeat) ? ' ' + a.repeat : '');
    title.textContent = name;
    title.classList.toggle('is-bad', !a.event && !evIn.value.trim());
    evIn.classList.toggle('is-bad', !evIn.value.trim());
    tmIn.classList.toggle('is-bad', !tmIn.value.trim());
    evIn.setAttribute('aria-invalid', String(!evIn.value.trim()));
    tmIn.setAttribute('aria-invalid', String(!tmIn.value.trim()));
    q('.lr-time').textContent = fmtTime(a.time || tmIn.value.trim());
    const keys = ['新聞事件', '直播時間', 'FB 粉專', '畫面來源', '標題', '內文'];   // 值班小編必填，但只在上方欄位標紅框
    // 依順序排；直播時間、畫面來源有提醒時，就在原位置顯示黃色
    const warnOf = (k) => warnings.find((w) => w.startsWith(k));
    self.items = keys.map((k) => {
      const bad = missing.includes(k), warn = !bad && warnOf(k);
      const state = bad ? 'bad' : warn ? 'warn' : 'ok';
      const reason = bad ? `缺少：${k}` : warn ? `提醒：${warn}` : k === '內文' && !a.body.trim() ? '完成：內文（由標題補上）' : `完成：${k}`;
      return { k, state, reason, target: state === 'ok' ? null : jumpTarget(k) };
    });
    self.lastMissing = missing;
    if (!dirty) { out.value = build(a, opt); out.rows = Math.min(Math.max(out.value.split('\n').length + 1, 6), 40); }
    if (cards[cur] === self) renderBar();
  }
  self.refresh = refresh;
  boxes.forEach((b) => b.addEventListener('change', refresh));
  evIn.addEventListener('input', refresh);
  tmIn.addEventListener('input', refresh);

  self.doCopy = async () => {
    expireDuty(); // 值班到期後馬上失效，不等 30 秒的計時
    if (self.lastMissing.length) return;
    const ok = await copyText(out.value);
    msg.className = 'lr-msg ' + (ok ? 'is-ok' : 'is-bad');
    msg.textContent = ok ? '已複製完整需求單' : '複製失敗，已選取全文，請長按或按 Ctrl+C 手動複製';
    if (ok) afterCopy(idx); else selectManual(out);
  };
  q('[data-weather]').addEventListener('click', async () => {
    const ok = await copyText(w.text);
    msg.className = 'lr-msg ' + (ok ? 'is-ok' : 'is-bad');
    msg.textContent = ok ? (w.ok ? '已複製封面提醒' : '已複製封面提醒（主播或標題沒抓到，請檢查）') : '複製失敗，已選取封面提醒文字，請手動複製';
    if (!ok) selectManual(q('[data-wtext]'));
  });

  refresh();
  return self;
}

// ---- 底列狀態鈕 ----
const SVG = 'http://www.w3.org/2000/svg';
function icon(state) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'lr-ic');
  const mk = (n, at) => { const e = document.createElementNS(SVG, n); for (const k in at) e.setAttribute(k, at[k]); s.append(e); };
  if (state === 'warn') {
    mk('path', { d: 'M10 2.2 19 17.8H1z', fill: '#f79009', stroke: '#f79009', 'stroke-width': '1.6', 'stroke-linejoin': 'round' });
    mk('path', { d: 'M10 7.6v4.4M10 14.4v.1', stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', fill: 'none' });
  } else {
    mk('circle', { cx: 10, cy: 10, r: 10, fill: state === 'ok' ? '#17b26a' : '#f04438' });
    mk('path', { d: state === 'ok' ? 'M5.6 10.4l2.8 2.8 5.8-6' : 'M6.6 6.6l6.8 6.8M13.4 6.6l-6.8 6.8', stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });
  }
  return s;
}
const focusField = (t) => { if (!t) return; t.scrollIntoView({ block: 'center' }); t.focus({ preventScroll: true }); };
function renderBar() {
  const c = cards[cur];
  if (!c) return;
  stBar.replaceChildren(...c.items.map((it) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lr-st is-' + it.state; b.dataset.state = it.state; b.dataset.key = it.k;
    b.title = it.reason; b.setAttribute('aria-label', it.state === 'ok' ? it.reason : it.reason + '，前往填寫');
    b.append(icon(it.state), document.createTextNode(it.k));
    if (it.state === 'ok') b.setAttribute('aria-disabled', 'true');
    else b.addEventListener('click', () => focusField(it.target()));
    return b;
  }));
  copyNext.disabled = c.lastMissing.length > 0;
  const miss = c.lastMissing.length ? '缺：' + c.lastMissing.join('、') : '';
  copyNext.title = miss;
}

// ---- 一次一張 ----
function show(i) {
  if (!cards.length) return;
  cur = Math.max(0, Math.min(cards.length - 1, i));
  cards.forEach((c, k) => { c.el.hidden = k !== cur; });
  pos.textContent = `第 ${cur + 1}／${cards.length} 場`;
  [...dots.children].forEach((d, k) => {
    d.classList.toggle('is-cur', k === cur);
    d.classList.toggle('is-done', cards[k].copied);
    d.textContent = cards[k].copied ? '✓' : String(k + 1);
    d.setAttribute('aria-current', k === cur ? 'true' : 'false');
  });
  $('prev').disabled = cur === 0;
  renderBar();
}
function afterCopy(i) {
  cards[i].copied = true;
  if (i < cards.length - 1) { show(i + 1); return; }
  show(i);
  const left = cards.filter((c) => !c.copied).length;
  const msg = cards[i].el.querySelector('[data-msg]');
  msg.textContent = left ? `已複製；還有 ${left} 張沒複製` : '已複製，全部完成';
}
$('prev').addEventListener('click', () => show(cur - 1));
copyNext.addEventListener('click', () => { if (cards[cur]) cards[cur].doCopy(); });

// 電腦版（≥1024px）左右兩欄：左邊貼上框一直看得到原稿，不縮合；窄螢幕貼上後縮成一行
const wide = matchMedia('(min-width: 1024px)');
let wantCollapsed = false;
function setCollapsed(on) {
  wantCollapsed = on;
  const c = on && !wide.matches;
  srcWrap.hidden = c; pasteBtn.hidden = !c; $('run').hidden = c;
}
wide.addEventListener('change', () => setCollapsed(wantCollapsed));
function run() {
  cards.length = 0;
  const all = parse(src.value);
  list.replaceChildren(...all.map((a, i) => { const c = makeCard(a, i); cards.push(c); return c.el; }));
  dots.replaceChildren(...cards.map((c, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lr-dot'; b.setAttribute('aria-label', `第 ${k + 1} 場`);
    b.addEventListener('click', () => show(k));
    return b;
  }));
  stage.hidden = bar.hidden = !all.length;
  cur = 0;
  show(0);
  empty.hidden = !!all.length || !src.value.trim();
  count.textContent = all.length ? `共 ${all.length} 場` : '';
  pasteBtn.textContent = `已貼上 ${all.length} 場（點這裡重新貼上）`;
  setCollapsed(!!all.length);
  src.scrollTop = 0;   // 電腦版左欄從原稿開頭看起
}
pasteBtn.addEventListener('click', () => { setCollapsed(false); src.focus(); src.select(); });

$('run').addEventListener('click', run);
// 一次一份：貼上就取代框內舊的需求單並馬上解析，不累加
src.addEventListener('paste', (e) => {
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!text) { setTimeout(run, 0); return; }
  e.preventDefault();
  src.value = text;
  run();
});
// 進入工具就聚焦貼上框；外殼切回這個工具時（iframe 重新取得焦點）若游標不在輸入欄，也回到貼上框
src.focus({ preventScroll: true });
window.addEventListener('focus', () => {
  const a = document.activeElement;
  if (!a || a === document.body) src.focus({ preventScroll: true });
});
$('clear').addEventListener('click', () => {
  src.value = ''; cards.length = 0; list.replaceChildren(); dots.replaceChildren(); stBar.replaceChildren();
  stage.hidden = bar.hidden = true; empty.hidden = true; count.textContent = '';
  setCollapsed(false);
  src.focus();
});
