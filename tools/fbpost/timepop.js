// 粉專膠囊右半：先跳小選單（立即發布／排程發布…），選「排程發布…」再開「排程時間」小視窗（貼在膠囊上方）。
// 小視窗：日期、時間（打 4 碼、↑↓ 10 分）、+30 分／+1 小時／明天。
// open(anchor, state, onChange)：state = { sched, at(ms) }，改動時直接改 state 並呼叫 onChange()
import { $ } from './util.js';
import { typing, toMs, dateStr, timeStr, step, plus, tomorrow, check } from './time.js';

// 預設排程時間：現在＋30 分，進位到下一個 10 分
const defaultAt = () => Math.ceil(plus(Date.now(), 30) / 600000) * 600000;

export function createTimePop() {
  const pop = $('timePop'), menu = $('tpMenu');
  const date = $('tpDate'), time = $('tpTime'), hint = $('tpHint');
  const items = [...menu.querySelectorAll('[data-tp]')];
  let cur = null, onChange = () => {}, anchor = null;

  function render() {
    date.value = dateStr(cur.at);
    if (document.activeElement !== time) time.value = timeStr(cur.at);
    const c = check(cur.at);
    hint.textContent = c.ok ? `排程 ${timeStr(cur.at)}．直接打 4 碼（2130＝21:30），↑↓ 每次 10 分` : c.msg;
    hint.className = 'tp-hint ' + (c.ok ? 'ok' : 'bad');
  }
  const set = (ms) => { if (!Number.isFinite(ms)) return; cur.at = ms; cur.sched = true; render(); onChange(); };

  // 貼在 anchor 上方（放不下就放下方），左右不超出畫面
  function placeAt(el) {
    if (!anchor || el.hidden) return;
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const top = r.top - h - 8 >= 8 ? r.top - h - 8 : Math.min(r.bottom + 8, window.innerHeight - h - 8);
    el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px';
  }
  const place = () => { placeAt(menu); placeAt(pop); };

  function close() { pop.hidden = true; menu.hidden = true; anchor = null; }
  function closeMenu(refocus) { menu.hidden = true; if (refocus && anchor) anchor.focus(); if (pop.hidden) anchor = null; }

  function openMenu() {
    pop.hidden = true;
    for (const b of items) {
      const on = (b.dataset.tp === 'sched') === !!cur.sched;
      b.classList.toggle('cur', on); b.setAttribute('aria-checked', String(on));
    }
    menu.hidden = false; placeAt(menu);
    (items.find((b) => b.classList.contains('cur')) || items[0]).focus();
  }
  function openPop() {
    menu.hidden = true;
    pop.hidden = false; render(); placeAt(pop); time.focus(); time.select();
  }

  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tp]'); if (!b) return;
    if (b.dataset.tp === 'now') { cur.sched = false; onChange(); closeMenu(true); return; }
    cur.sched = true;
    if (!check(cur.at).ok) cur.at = defaultAt();
    onChange(); openPop();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[n].focus();
  });

  pop.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) set(q.dataset.q === 'tomorrow' ? tomorrow(cur.at) : plus(cur.at, +q.dataset.q));
  });
  date.addEventListener('change', () => set(toMs(date.value, timeStr(cur.at))));
  time.addEventListener('input', () => {
    const v = typing(time.value);
    if (v !== time.value) time.value = v;
    const ms = toMs(dateStr(cur.at), time.value);
    if (ms !== null) set(ms);
  });
  time.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    set(step(cur.at, e.key === 'ArrowUp' ? 1 : -1));
    time.value = timeStr(cur.at);
  });
  time.addEventListener('blur', () => { time.value = timeStr(cur.at); });

  const isOpen = () => !pop.hidden || !menu.hidden;
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !pop.contains(e.target) && !menu.contains(e.target) && !(anchor && anchor.contains(e.target))) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.stopPropagation();
    if (!menu.hidden) closeMenu(true); else close();
  }, true);
  window.addEventListener('resize', place);

  return {
    open(el, state, cb) {
      if (isOpen() && anchor === el) { close(); return; }
      anchor = el; cur = state; onChange = cb;
      openMenu();
    },
    close,
    isOpen
  };
}
