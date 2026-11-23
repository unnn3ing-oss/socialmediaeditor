// 管理頁表格欄寬可調（2026-11-23）：表頭右緣拖曳、雙擊恢復；方向鍵 ←→ 每次 16px（鍵盤可用）
//   欄寬存在這台瀏覽器（localStorage tbx.admin.colw.<卡片 id>.<第幾張表>），每張表分開；讀不到就用預設。
//   只在寬螢幕（≥821px）啟用；手機維持原本的橫向捲動。
//   第一次拖曳時先把每欄目前寬度固定下來（table-layout: fixed），之後只改被拖的那一欄，表格總寬跟著變（外框可橫向捲動）。
const KEY = 'tbx.admin.colw.';
const MIN = 48;
const STEP = 16;
const wide = window.matchMedia('(min-width: 821px)');

const load = (k) => { try { const v = JSON.parse(localStorage.getItem(KEY + k)); return Array.isArray(v) ? v : null; } catch { return null; } };
const save = (k, v) => { try { if (v) localStorage.setItem(KEY + k, JSON.stringify(v)); else localStorage.removeItem(KEY + k); } catch { /* 存不了：本次有效 */ } };

function keyOf(table) {
  const card = table.closest('section[id]') || table.closest('[id]');
  const id = card ? card.id : 'page';
  const all = card ? Array.from(card.querySelectorAll('table')) : Array.from(document.querySelectorAll('table'));
  return id + '.' + all.indexOf(table);
}
const heads = (table) => Array.from(table.tHead.rows[0].cells);

function apply(table, widths) {
  const ths = heads(table);
  if (!widths || widths.length !== ths.length) return false;
  ths.forEach((th, i) => { th.style.width = widths[i] + 'px'; });
  table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
  table.style.minWidth = '0';
  table.classList.add('col-fixed');
  return true;
}
function reset(table) {
  heads(table).forEach((th) => { th.style.width = ''; });
  table.style.width = ''; table.style.minWidth = '';
  table.classList.remove('col-fixed');
}
// 目前每欄寬度（還沒固定過就先量）
function freeze(table) {
  if (!table.classList.contains('col-fixed')) apply(table, heads(table).map((th) => Math.max(MIN, Math.ceil(th.getBoundingClientRect().width) + 1)));
  return heads(table).map((th) => parseFloat(th.style.width) || MIN);
}
function setCol(table, i, w) {
  const ws = freeze(table);
  ws[i] = Math.max(MIN, Math.round(w));
  apply(table, ws);
  return ws;
}

function setup(table) {
  if (!table.tHead || !table.tHead.rows.length || table.dataset.colResize) return;
  table.dataset.colResize = '1';
  const key = keyOf(table);
  const ths = heads(table);
  ths.forEach((th, i) => {
    if (i === ths.length - 1) return;   // 最後一欄不放把手（拖前一欄就好）
    const g = document.createElement('span');
    g.className = 'col-grip';
    g.setAttribute('role', 'separator');
    g.setAttribute('aria-orientation', 'vertical');
    g.setAttribute('aria-label', '調整「' + (th.textContent.trim() || '第 ' + (i + 1) + ' 欄') + '」欄寬');
    g.tabIndex = 0;
    g.title = '拖曳調整欄寬，點兩下恢復';
    g.addEventListener('pointerdown', (e) => {
      if (!wide.matches || e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX;
      const w0 = freeze(table)[i];
      let last = null;
      g.setPointerCapture(e.pointerId);
      document.body.classList.add('col-dragging');
      const move = (ev) => { last = setCol(table, i, w0 + ev.clientX - x0); };
      const up = () => {
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
        document.body.classList.remove('col-dragging');
        if (last) save(key, last);
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });
    g.addEventListener('dblclick', () => { reset(table); save(key, null); });
    g.addEventListener('keydown', (e) => {
      if (!wide.matches || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      save(key, setCol(table, i, freeze(table)[i] + (e.key === 'ArrowRight' ? STEP : -STEP)));
    });
    th.append(g);
  });
  if (wide.matches) apply(table, load(key));
}

export function initColResize(root = document) {
  const tables = Array.from(root.querySelectorAll('main table'));
  tables.forEach(setup);
  // 寬窄切換：窄螢幕拿掉固定欄寬，回到寬螢幕再套用存好的
  wide.addEventListener('change', () => tables.forEach((t) => { if (wide.matches) apply(t, load(keyOf(t))); else reset(t); }));
}
initColResize();
