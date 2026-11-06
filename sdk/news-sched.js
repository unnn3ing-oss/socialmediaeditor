// 排程時間（純函式，不碰 DOM）。時間一律用本機時區。
// 來源：unnn3ing-oss/schedulenewnet web/sched.js；範圍改成臉書的 10 分鐘～30 天。
const MIN_LEAD = 10;                         // 臉書：排程至少比現在晚 10 分鐘
const DEF_LEAD = 30;                         // 預填 現在＋30 分
const MAX_DAYS = 30;                         // 臉書：最多排到 30 天內
const STEP = 10;                             // ↑／↓ 每次 ±10 分
const pad = n => String(n).padStart(2, '0');
const addMin = (d, n) => new Date(d.getTime() + n * 60000);

// 打字中的時間欄：只有數字且剛好 4 碼就補冒號（2130 → 21:30）；其他保持原樣讓小編繼續打
function formatTyping(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^\d{4}$/.test(s)) return s.slice(0, 2) + ':' + s.slice(2);
  return s;
}

// '2130'、'21:30'、'930'、'9:30' → { h, m }；不合法回 null
function parseTime(v) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return null;
  return { h, m: mm };
}
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // <input type=date> 的值

// 日期（'YYYY-MM-DD' 或 Date）＋時間字串 → Date；不合法回 null
function combine(date, time) {
  const t = parseTime(time);
  if (!t) return null;
  let d;
  if (date instanceof Date) d = new Date(date.getTime());
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!m) return null;
    d = new Date(+m[1], +m[2] - 1, +m[3]);
  }
  if (isNaN(d)) return null;
  d.setHours(t.h, t.m, 0, 0);
  return d;
}

// 預填：現在＋30 分，再往上取到 10 分鐘整（一定 ≥ 30 分）
function defaultAt(now) {
  const d = addMin(now, DEF_LEAD);
  if (d.getSeconds() || d.getMilliseconds() || d.getMinutes() % STEP) d.setMinutes(Math.floor(d.getMinutes() / STEP) * STEP + STEP, 0, 0);
  return d;
}

const earliest = now => addMin(now, MIN_LEAD);
const latest = now => addMin(now, MAX_DAYS * 1440);

// 檢查時間：回 null（可以）或 { code, msg }
function validate(at, now) {
  if (!(at instanceof Date) || isNaN(at)) return { code: 'bad_time', msg: '時間格式不對，直接打 4 碼（例如 2130）' };
  if (at < earliest(now)) return { code: 'too_soon', msg: `至少要比現在晚 ${MIN_LEAD} 分鐘（最早 ${fmtWhen(earliest(now), now)}）` };
  if (at > latest(now)) return { code: 'too_late', msg: `最晚只能排到 ${MAX_DAYS} 天內（${fmtWhen(latest(now), now)}）` };
  return null;
}

// ↑／↓：±10 分（跨日會跟著換日期）
const step = (at, dir) => addMin(at, dir * STEP);

// 送給後端：'YYYY-MM-DDTHH:mm'
const toScheduleString = at => `${fmtDateInput(at)}T${fmtTime(at)}`;

// 給人看：今天只顯示時間，其他天加上 M/D
function fmtWhen(at, now) {
  const same = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return same ? fmtTime(at) : `${at.getMonth() + 1}/${at.getDate()} ${fmtTime(at)}`;
}


export { MIN_LEAD, DEF_LEAD, MAX_DAYS, STEP, formatTyping, parseTime, fmtTime, fmtDateInput, combine, defaultAt, earliest, latest, validate, step, toScheduleString, fmtWhen };
