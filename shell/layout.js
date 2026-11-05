// 版面狀態機：全部是純函式，回傳新物件，不改輸入。
// State = { view: 'showcase' | 'work', mode: 'single' | 'split', left, right, last }

export function initial() {
  return { view: 'showcase', mode: 'single', left: null, right: null, last: 'left' };
}

const other = (side) => (side === 'left' ? 'right' : 'left');

function single(id) {
  return { view: 'work', mode: 'single', left: id, right: null, last: 'left' };
}

export function openSingle(s, id) {
  if (s.view === 'showcase' || s.mode === 'single') return single(id);
  if (s.left === id) return { ...s, last: 'left' };
  if (s.right === id) return { ...s, last: 'right' };
  return { ...s, [s.last]: id };
}

export function dropOnSide(s, id, side) {
  if (s.view === 'showcase') return openSingle(s, id);
  if (s.mode === 'single') {
    if (s.left === id) return s;
    return { view: 'work', mode: 'split', [side]: id, [other(side)]: s.left, last: side };
  }
  if (s[other(side)] === id) return { ...s, left: s.right, right: s.left, last: side };
  if (s[side] === id) return { ...s, last: side };
  return { ...s, [side]: id, last: side };
}

export function focus(s, side) {
  return { ...s, last: side };
}

export function closePane(s, side) {
  if (s.mode === 'split') return single(s[other(side)]);
  return { ...s, view: 'showcase' };
}

export function home(s) {
  return { ...s, view: 'showcase' };
}

export function visible(s) {
  if (s.view !== 'work') return [];
  const ids = s.mode === 'split' ? [s.left, s.right] : [s.left];
  return ids.filter(Boolean);
}
