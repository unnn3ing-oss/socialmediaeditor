// 值班粉專：只有早班、晚班（以本機時間計）。依「選好的當下」歸班：14:30 前＝早班，選擇有效到當天 16:30；
// 14:30 起＝晚班，有效到隔天 00:00（晚班最晚 00:00 下班）。每個班段第一次開啟要先選（至少 1 個，不能略過），
// 選好的粉專在「新增發文」一開始、清空、送出完成後自動勾選。選擇記在這個瀏覽器（localStorage），過期就重選。
import { $ } from './util.js';

export const DUTY_KEY = 'tbx.fbpost.duty';
export const SHIFTS = { am: '早班（到 16:30）', pm: '晚班（到 24:00）' };
const PM_FROM = 14 * 60 + 30;   // 14:30 起選的算晚班

// 選好的時間 → { key: 'YYYY-MM-DD-am|pm', name }
export function shiftOf(ms) {
  const d = new Date(ms), m = d.getHours() * 60 + d.getMinutes();
  const s = m < PM_FROM ? 'am' : 'pm';
  const p = (n) => String(n).padStart(2, '0');
  return { key: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${s}`, name: SHIFTS[s] };
}

// 班段 key → 選擇失效的時間（毫秒）：早班當天 16:30、晚班隔天 00:00；舊版大夜（night）當天 07:30；格式不對回 0
export function untilOf(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(am|pm|night)$/.exec(String(key || ''));
  if (!m) return 0;
  const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  if (m[4] === 'am') return new Date(y, mo, d, 16, 30).getTime();
  if (m[4] === 'pm') return new Date(y, mo, d + 1, 0, 0).getTime();
  return new Date(y, mo, d, 7, 30).getTime();
}
const alive = (key, ms) => ms < untilOf(key) && ms >= untilOf(key) - 2 * 86400 * 1000;   // 還沒過期（也擋未來日期的怪資料）

// 目前還有效的值班粉專 id；沒選過（或過期、資料壞掉）回 null
export function readDuty(storage, ms) {
  try {
    const v = JSON.parse(storage.getItem(DUTY_KEY));
    if (v && alive(v.shift, ms) && Array.isArray(v.pages) && v.pages.every((x) => typeof x === 'string')) return v.pages;
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
  const current = () => readDuty(storage, now()) || (mem && alive(mem.shift, now()) ? mem.pages : null);
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

  // 選擇過期（早班 16:30、晚班 00:00）：頁面開著每分鐘檢查一次，回到頁面也檢查
  function check() {
    paintBtn();
    if (!pages().length || !canAsk() || current()) return;
    if (document.hidden) return;
    open(true);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  let had = !!current();
  setInterval(() => { const has = !!current(); if (had && !has) check(); had = has; }, 60000);

  return { check, ids: valid, paint: paintBtn };
}
