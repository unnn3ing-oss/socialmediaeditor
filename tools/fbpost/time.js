// 排程時間（純函式，不碰畫面）：一律本機時間。
export const MIN_LEAD_MS = 10 * 60000;          // 臉書：至少晚 10 分鐘
export const MAX_LEAD_MS = 30 * 86400000;       // 最多 30 天
export const STEP_MIN = 10;                     // ↑↓ 每次 10 分

const pad = (n) => String(n).padStart(2, '0');

// 打字中：剛好 4 碼數字就補冒號（2130 → 21:30），其他保持原樣讓人繼續打
export const typing = (v) => (/^\d{4}$/.test(String(v || '').trim()) ? String(v).trim().slice(0, 2) + ':' + String(v).trim().slice(2) : String(v || ''));

// '2130'、'21:30'、'9:05' → { h, m }；不合法回 null
export function parseHM(v) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? { h, m: mi } : null;
}

// 'YYYY-MM-DD' ＋ 時間 → 毫秒（本機）；不合法回 null
export function toMs(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const t = parseHM(time);
  if (!d || !t) return null;
  return new Date(+d[1], +d[2] - 1, +d[3], t.h, t.m).getTime();
}
export const dateStr = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const timeStr = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const plus = (ms, minutes) => ms + minutes * 60000;
export const step = (ms, dir) => plus(ms, dir * STEP_MIN);
export const tomorrow = (ms) => { const d = new Date(ms); d.setDate(d.getDate() + 1); return d.getTime(); };

// 範圍檢查：回 { ok, msg }
export function check(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return { ok: false, msg: '時間格式不對（例：2130 或 21:30）' };
  if (ms < now + MIN_LEAD_MS) return { ok: false, msg: '排程至少要晚 10 分鐘' };
  if (ms > now + MAX_LEAD_MS) return { ok: false, msg: '排程要在 30 天內' };
  return { ok: true, msg: '' };
}
