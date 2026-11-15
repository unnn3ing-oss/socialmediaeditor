// 模組：暫停排程發布（管理頁開關）。
// 全部集中在這個檔案；掛點只有：fb.js 的 handleFb、rundown.js 的 handleRundown 各呼叫 pausedFail，index.js 註冊 adminFbPause。
// 要整個拿掉：刪這個檔案＋上面三個掛點即可，不影響發文核心（createPost／graph.js）。
// 狀態存在 D1 fb_settings 一列 key='pause'，value＝JSON {reason, at}；沒有這列＝使用中。
// 讀不到或資料壞掉一律當作「使用中」，不讓 D1 問題把工具擋死。只擋工具發出的請求（/fb/*、/rundown），已排定貼文與留言佇列照常。
import { ok, fail, readBody } from './http.js';
import { first, run } from './db.js';

export const PAUSE_REASON_MAX = 100;
const NOT_PAUSED = Object.freeze({ paused: false, reason: '', at: null });
const DDL = 'CREATE TABLE IF NOT EXISTS fb_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)';
const ensured = new WeakSet();
async function ensureTable(env) {
  if (ensured.has(env.DB)) return;
  await env.DB.prepare(DDL).run();
  ensured.add(env.DB);
}

export function cleanReason(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const timeOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function getPause(env) {
  if (!env.DB) return { ...NOT_PAUSED };
  try {
    await ensureTable(env);
    const r = await first(env, `SELECT value FROM fb_settings WHERE key='pause'`);
    if (!r) return { ...NOT_PAUSED };
    const v = JSON.parse(r.value);
    if (!v || typeof v !== 'object') return { ...NOT_PAUSED };
    return { paused: true, reason: cleanReason(v.reason).slice(0, PAUSE_REASON_MAX), at: timeOf(v.at) };
  } catch (e) { return { ...NOT_PAUSED }; }
}

// paused=true：寫入（已停用時保留原本的停用時間，只更新原因）；false：刪除這列
export async function setPause(env, paused, reason = '', nowMs = Date.now()) {
  await ensureTable(env);
  if (!paused) { await run(env, `DELETE FROM fb_settings WHERE key='pause'`); return { ...NOT_PAUSED }; }
  const cur = await getPause(env);
  const v = { reason: cleanReason(reason).slice(0, PAUSE_REASON_MAX), at: cur.paused && cur.at ? cur.at : nowMs };
  await run(env, `INSERT INTO fb_settings (key, value, updated) VALUES ('pause', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated`, JSON.stringify(v), nowMs);
  return { paused: true, reason: v.reason, at: v.at };
}

// 停用中回 fb_paused（附原因與停用時間）；使用中或管理員憑證（前端用管理密碼登入，cred.adm）回 null
export async function pausedFail(request, env, cred) {
  if (cred && cred.adm) return null;
  const p = await getPause(env);
  return p.paused ? fail(request, env, 'fb_paused', null, { reason: p.reason, at: p.at }) : null;
}

async function audit(env, code) {
  try { await run(env, 'INSERT INTO logs (at, tool, code, ver, ua) VALUES (?, ?, ?, ?, ?)', Date.now(), 'fb', code, null, null); }
  catch (e) { /* 記錄失敗不影響操作 */ }
}

// 管理頁：GET／POST /admin/fb/pause（已通過 admin 驗證）；body { paused: boolean, reason?: string }
export async function adminFbPause(request, env, path) {
  if (path !== '/admin/fb/pause') return null;
  if (!env.DB) return fail(request, env, 'misconfigured');
  const view = (p) => ({ ...p, reasonMax: PAUSE_REASON_MAX });
  if (request.method === 'GET') return ok(request, env, view(await getPause(env)));
  if (request.method !== 'POST') return null;
  const buf = await readBody(request, 4 * 1024);
  if (!buf) return fail(request, env, 'too_large');
  let b;
  try { b = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return fail(request, env, 'bad_request'); }
  if (!b || typeof b.paused !== 'boolean') return fail(request, env, 'bad_request', '缺少 paused（true／false）。');
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== 'string') return fail(request, env, 'bad_request', '停用原因要是文字。');
  const reason = cleanReason(b.reason);
  if (reason.length > PAUSE_REASON_MAX) return fail(request, env, 'bad_request', `停用原因最多 ${PAUSE_REASON_MAX} 字。`);
  await setPause(env, b.paused, reason);
  await audit(env, b.paused ? 'fbpost-paused' : 'fbpost-resumed');
  return ok(request, env, view(await getPause(env)));
}
