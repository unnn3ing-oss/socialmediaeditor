// 影片發布：共用小工具（確認視窗、提示、時間格式、時間選擇）
export const $ = (id) => document.getElementById(id);
export const errText = (e) => (e && e.message) || '失敗';
const pad = (n) => String(n).padStart(2, '0');
export const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmt = (ms) => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dateStr = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const timeStr = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const sizeText = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB');
export const durText = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}` : '');
export const newId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const MIN_S = 600;
export const MAX_S = { video: 180 * 86400, reel: 29 * 86400 };
export const rangeText = (kind) => (kind === 'reel' ? 'Reels 排程要在 10 分鐘到 29 天之間' : '影片排程要在 10 分鐘到 6 個月之間');

let toastTimer = 0;
export function toast(text) {
  const t = $('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

export function confirmBox(title, body, yes = '確定') {
  return new Promise((res) => {
    const d = $('cfDlg');
    $('cfTitle').textContent = title; $('cfBody').textContent = body; $('cfYes').textContent = yes;
    const done = (v) => { d.close(); res(v); };
    $('cfYes').onclick = () => done(true);
    $('cfNo').onclick = () => done(false);
    d.addEventListener('cancel', () => res(false), { once: true });
    d.showModal();
  });
}

// 分段鈕：按鈕有 data-<key>；回傳 set(value)
export function segmented(root, key, onPick) {
  const set = (v) => {
    for (const b of root.querySelectorAll(`[data-${key}]`)) {
      const on = b.dataset[key] === v;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on));
    }
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest(`[data-${key}]`); if (!b || b.disabled) return;
    if (onPick(b.dataset[key]) !== false) set(b.dataset[key]);
  });
  return set;
}

// 時間：［立即｜排程］＋日期時間；get(kind) → { at:null } | { at:秒 } | { error }
export function createWhen(box, label) {
  box.innerHTML = '';
  const seg = document.createElement('div'); seg.className = 'seg seg-sm'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', label);
  seg.innerHTML = '<button type="button" data-w="now" class="is-on" aria-pressed="true">立即</button><button type="button" data-w="sched" aria-pressed="false">排程</button>';
  const dt = document.createElement('input'); dt.type = 'datetime-local'; dt.hidden = true; dt.setAttribute('aria-label', label + '：排程日期時間');
  box.append(seg, dt);
  let mode = 'now';
  segmented(seg, 'w', (v) => {
    mode = v; dt.hidden = v !== 'sched';
    if (v === 'sched' && !dt.value) dt.value = toLocalInput(Math.ceil((Date.now() + 30 * 60000) / 600000) * 600000);
  });
  return {
    get(kind) {
      if (mode === 'now') return { at: null };
      const ms = Date.parse(dt.value);
      if (!Number.isFinite(ms)) return { error: '請選排程時間' };
      const at = Math.floor(ms / 1000), now = Math.floor(Date.now() / 1000);
      if (at < now + MIN_S || at > now + MAX_S[kind]) return { error: rangeText(kind) };
      return { at };
    },
    disable(on) { for (const el of box.querySelectorAll('button,input')) el.disabled = on; }
  };
}
