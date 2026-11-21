// 值班粉專：每個班段（早班 07:30–15:59、晚班 16:00–23:59、大夜 00:00–07:29，以本機時間計）第一次開啟要先選（至少 1 個，不能略過），
// 選好的粉專在「新增發文」一開始、清空、送出完成後自動勾選。選擇記在這個瀏覽器（localStorage），換班段就失效重選。
import { $ } from './util.js';

export const DUTY_KEY = 'tbx.fbpost.duty';
export const SHIFTS = { am: '早班（07:30–16:30）', pm: '晚班（16:00–24:00）', night: '大夜（00:00–07:30）' };

// 時間 → { key: 'YYYY-MM-DD-am|pm|night', name }
export function shiftOf(ms) {
  const d = new Date(ms), m = d.getHours() * 60 + d.getMinutes();
  const s = m < 450 ? 'night' : m < 960 ? 'am' : 'pm';
  const p = (n) => String(n).padStart(2, '0');
  return { key: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${s}`, name: SHIFTS[s] };
}

// 這個班段選過的粉專 id；沒選過（或換班段、資料壞掉）回 null
export function readDuty(storage, ms) {
  try {
    const v = JSON.parse(storage.getItem(DUTY_KEY));
    if (v && v.shift === shiftOf(ms).key && Array.isArray(v.pages) && v.pages.every((x) => typeof x === 'string')) return v.pages;
  } catch { /* 沒有 */ }
  return null;
}
export function writeDuty(storage, ms, pages) {
  try { storage.setItem(DUTY_KEY, JSON.stringify({ shift: shiftOf(ms).key, pages })); } catch { /* 無痕或停用：只在這次開著時有效 */ }
}

// pages()：目前粉專清單；onChange(ids)：選好或改了；canAsk()：現在能不能跳出（例如沒有發文權限就不問）
export function createDuty({ pages, onChange, canAsk = () => true, storage = globalThis.localStorage, now = () => Date.now() }) {
  const dlg = $('dutyDlg');
  let mem = null;   // localStorage 不能用時，記在記憶體
  const current = () => readDuty(storage, now()) || (mem && mem.shift === shiftOf(now()).key ? mem.pages : null);
  const valid = () => { const ids = new Set(pages().map((p) => p.id)); return (current() || []).filter((id) => ids.has(id)); };

  function paintBtn() {
    const ids = valid(), short = new Map(pages().map((p) => [p.id, p.short]));
    $('dutyBtn').textContent = ids.length ? `值班：${ids.map((id) => short.get(id)).join('、')}` : '值班粉專';
  }
  function updateOk() { $('dutyOk').disabled = !$('dutyList').querySelector('input:checked'); }

  // must＝班段第一次（不能取消）
  function open(must) {
    if (dlg.open) return;
    const cur = new Set(valid());
    $('dutyShift').textContent = shiftOf(now()).name;
    $('dutyCancel').hidden = must;
    dlg.dataset.must = must ? '1' : '';
    const box = $('dutyList'); box.textContent = '';
    for (const p of pages()) {
      const l = document.createElement('label'); l.className = 'duty-item';
      const c = document.createElement('input'); c.type = 'checkbox'; c.value = p.id; c.checked = cur.has(p.id);
      c.addEventListener('change', updateOk);
      l.append(c, document.createTextNode(p.short));
      box.append(l);
    }
    updateOk();
    dlg.showModal();
    (box.querySelector('input:checked') || box.querySelector('input') || $('dutyOk')).focus();
  }
  dlg.addEventListener('cancel', (e) => { if (dlg.dataset.must) e.preventDefault(); });
  $('dutyCancel').addEventListener('click', () => dlg.close());
  $('dutyOk').addEventListener('click', () => {
    const ids = [...$('dutyList').querySelectorAll('input:checked')].map((c) => c.value);
    if (!ids.length) return;
    writeDuty(storage, now(), ids);
    mem = { shift: shiftOf(now()).key, pages: ids };
    dlg.close(); paintBtn(); onChange(ids);
  });
  $('dutyBtn').addEventListener('click', () => open(false));

  // 換班段：開著頁面跨過 07:30／16:00／00:00 時，回到頁面或每分鐘檢查一次
  let lastKey = '';
  function check() {
    paintBtn();
    if (!pages().length || !canAsk() || current()) return;
    if (document.hidden) return;
    open(true);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(() => { const k = shiftOf(now()).key; if (k !== lastKey) { lastKey = k; check(); } }, 60000);
  lastKey = shiftOf(now()).key;

  return { check, ids: valid, paint: paintBtn };
}
