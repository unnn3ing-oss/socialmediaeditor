// 「排程時間」小視窗：貼在點到的粉專膠囊上方。立即／排程、日期、時間（打 4 碼、↑↓ 10 分）、+30 分／+1 小時／明天。
// open(anchor, state, onChange)：state = { sched, at(ms) }，改動時直接改 state 並呼叫 onChange()
import { $ } from './util.js';
import { typing, toMs, dateStr, timeStr, step, plus, tomorrow, check } from './time.js';

export function createTimePop() {
  const pop = $('timePop');
  const date = $('tpDate'), time = $('tpTime'), hint = $('tpHint');
  let cur = null, onChange = () => {}, anchor = null;

  const setMode = (sched) => {
    for (const b of pop.querySelectorAll('[data-tp]')) {
      const on = (b.dataset.tp === 'sched') === sched;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
    }
  };
  function render() {
    setMode(cur.sched);
    date.value = dateStr(cur.at);
    if (document.activeElement !== time) time.value = timeStr(cur.at);
    if (!cur.sched) { hint.textContent = '立即發布；改日期或時間會自動切成排程'; hint.className = 'tp-hint'; return; }
    const c = check(cur.at);
    hint.textContent = c.ok ? `排程 ${timeStr(cur.at)}．直接打 4 碼（2130＝21:30），↑↓ 每次 10 分` : c.msg;
    hint.className = 'tp-hint ' + (c.ok ? 'ok' : 'bad');
  }
  const set = (ms, sched = true) => { if (!Number.isFinite(ms)) return; cur.at = ms; cur.sched = sched; render(); onChange(); };
  const base = () => (cur.sched ? cur.at : Date.now());

  pop.addEventListener('click', (e) => {
    const m = e.target.closest('[data-tp]');
    if (m) { cur.sched = m.dataset.tp === 'sched'; if (cur.sched && !check(cur.at).ok) cur.at = plus(Date.now(), 30); render(); onChange(); return; }
    const q = e.target.closest('[data-q]');
    if (q) set(q.dataset.q === 'tomorrow' ? tomorrow(base()) : plus(base(), +q.dataset.q));
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

  function place() {
    if (!anchor || pop.hidden) return;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const top = r.top - h - 8 >= 8 ? r.top - h - 8 : Math.min(r.bottom + 8, window.innerHeight - h - 8);
    pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
  }
  function close() { pop.hidden = true; anchor = null; }
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !(anchor && anchor.contains(e.target))) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); } }, true);
  window.addEventListener('resize', place);

  return {
    open(el, state, cb) {
      if (!pop.hidden && anchor === el) { close(); return; }
      anchor = el; cur = state; onChange = cb;
      pop.hidden = false; render(); place(); time.focus(); time.select();
    },
    close,
    isOpen: () => !pop.hidden
  };
}
