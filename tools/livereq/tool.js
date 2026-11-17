// 直播需求單：畫面。規則都在 parse.js。
import { tb } from '../../sdk/toolbox.js';
import { PAGES, parse, check, build, weatherNote, dutyExpiry, fmtTime } from './parse.js';

tb.init('livereq');

const $ = (id) => document.getElementById(id);
const src = $('src'), list = $('list'), empty = $('empty'), count = $('count');
const dutyName = $('dutyName'), dutyContact = $('dutyContact'), dutyHint = $('dutyHint');
const tpl = $('cardTpl'), pagesTpl = $('pagesTpl');
const pagesBar = $('pagesBar'), nav = $('nav'), pos = $('pos'), dots = $('dots');
const KEY = 'tbx.livereq.duty';
const cards = []; // { a, el, pagesEl, refresh, copied }
let cur = 0;

// ---- 值班小編（依班別到期） ----
let dutyExp = 0;
const fmt = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function showDutyHint() {
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
function saveDuty() {
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
dutyContact.addEventListener('input', saveDuty);
setInterval(expireDuty, 30000);
loadDuty();

const duty = () => ({ name: dutyName.value, contact: dutyContact.value });

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

// ---- 卡片 ----
function makeCard(a, idx) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  const q = (s) => el.querySelector(s);
  const title = q('.lr-title'), evWrap = q('.lr-event'), evIn = q('[data-event]'), tmIn = q('[data-time]');
  const out = q('[data-out]'), msg = q('[data-msg]'), copyBtn = q('[data-copy]'), regen = q('[data-regen]');
  el.dataset.idx = String(idx);
  q('[data-repeat]').hidden = !a.repeat;
  evWrap.hidden = !!a.event;
  q('[data-timewrap]').hidden = !!a.time;

  // 粉專：放在輸入區與卡片之間（每張一排，只顯示目前這張）；需求單已經有的打勾並鎖住
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
  pq('[data-have]').textContent = a.fbExisting.length ? `需求單已有：${a.fbExisting.join('、')}` : '';

  const w = weatherNote(a);
  if (w) {
    q('[data-weather]').hidden = false;
    q('[data-wbox]').hidden = false;
    q('[data-wtext]').textContent = w.text;
  }

  let dirty = false;
  let lastMissing = [];
  out.addEventListener('input', () => { dirty = true; regen.hidden = false; });
  regen.addEventListener('click', () => { dirty = false; regen.hidden = true; refresh(); });

  function refresh() {
    const checked = boxes.filter((b) => b.checked && !b.disabled).map((b) => b.value);
    const opt = { checked, duty: duty(), eventOverride: evIn.value, timeOverride: tmIn.value };
    const { missing, warnings } = check(a, opt);
    lastMissing = missing;
    const name = (a.event || evIn.value.trim() || '（未填新聞事件）') + (a.repeat && !(a.event || '').includes(a.repeat) ? ' ' + a.repeat : '');
    title.textContent = name;
    title.classList.toggle('is-bad', !a.event && !evIn.value.trim());
    evIn.classList.toggle('is-bad', !evIn.value.trim());
    tmIn.classList.toggle('is-bad', !tmIn.value.trim());
    q('.lr-time').textContent = fmtTime(a.time || tmIn.value.trim());
    const items = [
      ['新聞事件', '新聞事件'], ['直播時間', '直播時間'], ['FB 粉專', 'FB 粉專'], ['值班小編', '值班小編'], ['標題', '標題'], ['內文', a.body.trim() ? '內文' : '內文（由標題補上）'],
    ];
    const ul = q('[data-checks]');
    const timeWarn = warnings.some((w) => w.startsWith('直播時間'));
    const okItems = items.filter(([k]) => !(k === '直播時間' && timeWarn)).map(([k, label]) => {
      const li = document.createElement('li');
      const bad = missing.includes(k);
      li.className = bad ? 'bad' : 'ok';
      li.textContent = (bad ? '缺 ' : '✓ ') + (bad ? k : label);
      return li;
    });
    const warnItems = warnings.map((t) => { const li = document.createElement('li'); li.className = 'warn'; li.textContent = t; return li; });
    ul.replaceChildren(...okItems, ...warnItems);
    if (!dirty) { out.value = build(a, opt); out.rows = Math.min(Math.max(out.value.split('\n').length + 1, 6), 40); }
    copyBtn.disabled = missing.length > 0;
    msg.className = 'lr-msg' + (missing.length ? ' is-bad' : '');
    msg.textContent = missing.length ? `缺：${missing.join('、')}` : '';
  }
  boxes.forEach((b) => b.addEventListener('change', refresh));
  evIn.addEventListener('input', refresh);
  tmIn.addEventListener('input', refresh);

  copyBtn.addEventListener('click', async () => {
    expireDuty(); // 值班到期後馬上失效，不等 30 秒的計時
    if (lastMissing.length) return;
    const ok = await copyText(out.value);
    msg.className = 'lr-msg ' + (ok ? 'is-ok' : 'is-bad');
    msg.textContent = ok ? '已複製完整需求單' : '複製失敗，請手動選取';
    if (ok) afterCopy(idx);
  });
  q('[data-weather]').addEventListener('click', async () => {
    const ok = await copyText(w.text);
    msg.className = 'lr-msg ' + (ok ? 'is-ok' : 'is-bad');
    msg.textContent = ok ? (w.ok ? '已複製封面提醒' : '已複製封面提醒（主播或標題沒抓到，請檢查）') : '複製失敗，請手動選取';
  });

  refresh();
  return { a, el, pagesEl, refresh, copied: false };
}

// ---- 一次一張 ----
function show(i) {
  if (!cards.length) return;
  cur = Math.max(0, Math.min(cards.length - 1, i));
  cards.forEach((c, k) => { c.el.hidden = k !== cur; c.pagesEl.hidden = k !== cur; });
  pos.textContent = `第 ${cur + 1}／${cards.length} 場`;
  [...dots.children].forEach((d, k) => {
    d.classList.toggle('is-cur', k === cur);
    d.classList.toggle('is-done', cards[k].copied);
    d.textContent = cards[k].copied ? '✓' : String(k + 1);
    d.setAttribute('aria-current', k === cur ? 'true' : 'false');
  });
  $('prev').disabled = cur === 0;
  $('next').disabled = cur === cards.length - 1;
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
$('next').addEventListener('click', () => show(cur + 1));

function run() {
  cards.length = 0;
  const all = parse(src.value);
  list.replaceChildren(...all.map((a, i) => { const c = makeCard(a, i); cards.push(c); return c.el; }));
  pagesBar.replaceChildren(...cards.map((c) => c.pagesEl));
  dots.replaceChildren(...cards.map((c, k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lr-dot'; b.setAttribute('aria-label', `第 ${k + 1} 場`);
    b.addEventListener('click', () => show(k));
    return b;
  }));
  pagesBar.hidden = nav.hidden = !all.length;
  show(0);
  empty.hidden = !!all.length || !src.value.trim();
  count.textContent = all.length ? `共 ${all.length} 場` : '';
}

$('run').addEventListener('click', run);
// 一次一份：貼上就取代框內舊的需求單並馬上解析，不累加
src.addEventListener('paste', (e) => {
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!text) { setTimeout(run, 0); return; }
  e.preventDefault();
  src.value = text;
  run();
});
$('clear').addEventListener('click', () => {
  src.value = ''; cards.length = 0; list.replaceChildren(); pagesBar.replaceChildren(); dots.replaceChildren();
  pagesBar.hidden = nav.hidden = true; empty.hidden = true; count.textContent = '';
  src.focus();
});
