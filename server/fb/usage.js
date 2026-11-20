// 臉書速率限制用量（管理頁「速率限制」卡片）
//   臉書沒有查用量的 API，只會附在每次回應的標頭：
//     X-App-Usage：使用者／App 權杖的呼叫，{ call_count, total_time, total_cputime }（%）
//     X-Business-Use-Case-Usage：粉專權杖的呼叫，{ <粉專ID>: [{ type, call_count, total_cputime, total_time, estimated_time_to_regain_access(分鐘) }] }
//   graph() 每次回應都交給 noteUsage；被限流（4／17／32／613／80001）交給 noteThrottle
//   存 D1 fb_settings k='rate_usage'：{ app, pages:{ id: {...} }, throttle }；每個執行個體最多每 60 秒寫一次，被限流或 ≥75% 立即寫
import { ensureSettings } from '../core/once.js';
const KEY = 'rate_usage';
const WRITE_GAP = 60 * 1000;
const URGENT_GAP = 10 * 1000;   // 高用量時也至少隔 10 秒才寫（限流紀錄與立即查詢除外）
const URGENT_PCT = 75;
const KEEP_MS = 7 * 86400000;
const MAX_PAGES = 100;

const pct = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 1000) : 0; };
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// 標頭 → 用量更新（純函式，方便測試）：{ app?, pages: { id: {...} } }
export function parseUsage(headers, now = Date.now()) {
  const out = { app: null, pages: {} };
  const a = parse(headers.get('x-app-usage'));
  if (a && typeof a === 'object') out.app = { callCount: pct(a.call_count), totalTime: pct(a.total_time), totalCputime: pct(a.total_cputime), at: now };
  const b = parse(headers.get('x-business-use-case-usage'));
  if (b && typeof b === 'object') {
    for (const [id, list] of Object.entries(b)) {
      if (!/^\d{1,30}$/.test(id) || !Array.isArray(list)) continue;
      const x = list.find((y) => y && y.type === 'pages') || list[0];
      if (!x || typeof x !== 'object') continue;
      out.pages[id] = {
        type: String(x.type || '').slice(0, 30), callCount: pct(x.call_count), totalCputime: pct(x.total_cputime), totalTime: pct(x.total_time),
        regainMin: pct(x.estimated_time_to_regain_access), at: now
      };
    }
  }
  return out;
}
const peak = (u) => Math.max(u.callCount, u.totalTime, u.totalCputime);

// 每個 D1 綁定一份待寫入的更新
const state = new WeakMap();
function st(env) {
  let s = state.get(env.DB);
  if (!s) state.set(env.DB, (s = { app: null, pages: {}, throttle: null, last: 0, dirty: false }));
  return s;
}

async function readRow(env) {
  try {
    const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first();
    const o = r ? parse(r.v) : null;
    return o && typeof o === 'object' ? { app: o.app || null, pages: o.pages && typeof o.pages === 'object' ? o.pages : {}, throttle: o.throttle || null } : { app: null, pages: {}, throttle: null };
  } catch { return { app: null, pages: {}, throttle: null }; }
}

async function flush(env, now) {
  const s = st(env);
  if (!s.dirty) return;
  s.last = now; s.dirty = false;
  const pend = { app: s.app, pages: s.pages, throttle: s.throttle };
  s.app = null; s.pages = {}; s.throttle = null;
  try {
    await ensureSettings(env);
    const cur = await readRow(env);
    if (pend.app) cur.app = pend.app;
    Object.assign(cur.pages, pend.pages);
    if (pend.throttle) cur.throttle = pend.throttle;
    const ids = Object.keys(cur.pages).filter((id) => now - (Number(cur.pages[id].at) || 0) < KEEP_MS)
      .sort((x, y) => (cur.pages[y].at || 0) - (cur.pages[x].at || 0)).slice(0, MAX_PAGES);
    cur.pages = Object.fromEntries(ids.map((id) => [id, cur.pages[id]]));
    await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
      .bind(KEY, JSON.stringify(cur), now).run();
  } catch { /* 記不了就算了，不影響發文 */ }
}

// graph() 每次回應呼叫；force＝管理頁「立即查詢」
export async function noteUsage(env, headers, { force = false, now = Date.now() } = {}) {
  if (!env || !env.DB || !headers) return;
  const u = parseUsage(headers, now);
  const s = st(env);
  let urgent = false;
  if (u.app) { s.app = u.app; s.dirty = true; if (peak(u.app) >= URGENT_PCT) urgent = true; }
  for (const [id, p] of Object.entries(u.pages)) { s.pages[id] = p; s.dirty = true; if (peak(p) >= URGENT_PCT || p.regainMin > 0) urgent = true; }
  const gap = now - s.last;
  if (s.dirty && (force || gap >= WRITE_GAP || (urgent && gap >= URGENT_GAP))) await flush(env, now);
}

// 被限流：記最後一次（立即寫）
export async function noteThrottle(env, code, message, now = Date.now()) {
  if (!env || !env.DB) return;
  const s = st(env);
  s.throttle = { code: Number(code) || 0, message: String(message || '').slice(0, 200), at: now };
  s.dirty = true;
  await flush(env, now);
}

// 管理頁讀取：存好的＋這個執行個體還沒寫進去的
export async function readUsage(env) {
  if (!env || !env.DB) return { app: null, pages: {}, throttle: null };
  const cur = await readRow(env);
  const s = state.get(env.DB);
  if (s && s.dirty) { if (s.app) cur.app = s.app; Object.assign(cur.pages, s.pages); if (s.throttle) cur.throttle = s.throttle; }
  return cur;
}
