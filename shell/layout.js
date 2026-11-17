// 版面狀態機：全部是純函式，回傳新物件，不改輸入。一次只開一個工具（並排已停用）。
// State = { view: 'showcase' | 'work', tool }

export function initial() {
  return { view: 'showcase', tool: null };
}

export function open(s, id) {
  return { view: 'work', tool: id };
}

export function home(s) {
  return { ...s, view: 'showcase' };
}

export function visible(s) {
  return s.view === 'work' && s.tool ? [s.tool] : [];
}
