// 值班粉專（純函式）：1～3 個，其中一個主要。記在這個瀏覽器，到下一個本機 05:00 失效（失效後全部清空重選）。
// 只影響預設：晶片排序（主要 → 其他值班 → 其餘）、只預勾主要、已排程／成效預設主要；其他粉專照樣可選。
export const MAX_DUTY = 3;
export const RESET_HOUR = 5;
const KEY = 'tbx.fbpost.duty.v1';

// 從 now 算起下一個 05:00（本機時間）的毫秒
export function nextReset(now = Date.now()) {
  const d = new Date(now);
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), RESET_HOUR, 0, 0, 0);
  if (r.getTime() <= now) r.setDate(r.getDate() + 1);
  return r.getTime();
}

// 整理選擇：ids 去重、最多 3 個；main 不在 ids 裡就用第一個
export function normalize(ids, main) {
  const list = [...new Set((ids || []).filter((x) => typeof x === 'string' && x))].slice(0, MAX_DUTY);
  if (!list.length) return null;
  return { ids: list, main: list.includes(main) ? main : list[0] };
}

// 讀：過期、格式壞掉 → null
export function loadDuty(now = Date.now(), store = globalThis.localStorage) {
  try {
    const v = JSON.parse(store.getItem(KEY) || 'null');
    if (!v || typeof v.exp !== 'number' || v.exp <= now) return null;
    const n = normalize(v.ids, v.main);
    return n ? { ...n, exp: v.exp } : null;
  } catch (e) { return null; }
}
export function saveDuty(ids, main, now = Date.now(), store = globalThis.localStorage) {
  const n = normalize(ids, main);
  if (!n) return null;
  const v = { ...n, exp: nextReset(now) };
  try { store.setItem(KEY, JSON.stringify(v)); } catch (e) { /* 被停用：這次分頁內照常 */ }
  return v;
}
export function clearDuty(store = globalThis.localStorage) {
  try { store.removeItem(KEY); } catch (e) { /* 略過 */ }
}

// 依值班排序：主要 → 其他值班（照選的順序）→ 其餘（原順序）；不在清單裡的值班 ID 忽略
export function orderPages(pages, duty) {
  if (!duty) return pages.slice();
  const rank = (id) => (id === duty.main ? 0 : duty.ids.includes(id) ? 1 + duty.ids.indexOf(id) : Infinity);
  return pages.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.id) - rank(b.p.id) || a.i - b.i).map((x) => x.p);
}
// 主要粉專還在清單裡才回它
export const mainOf = (pages, duty) => (duty && pages.some((p) => p.id === duty.main) ? duty.main : '');
