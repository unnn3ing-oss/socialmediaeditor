import { ok, fail, readBody } from './http.js';
import { all, run } from './db.js';

const TOOL_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
const CODE_RE = /^[a-z0-9_.-]{1,60}$/;
const DAY = 86400000;
export const LOG_KEEP_DAYS = 30;
export const MAX_LOGS = 500;

// 只收 tool／code／ver／ua，其他欄位（標題、網址、內容）一律丟掉
export async function handleLogs(request, env, path) {
  if (path !== '/logs' || request.method !== 'POST') return null;
  const buf = await readBody(request, 2048);
  if (!buf) return fail(request, env, 'too_large');
  let b;
  try { b = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return fail(request, env, 'bad_request'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(request, env, 'bad_request');
  if (typeof b.tool !== 'string' || !TOOL_ID_RE.test(b.tool)) return fail(request, env, 'bad_request');
  if (typeof b.code !== 'string' || !CODE_RE.test(b.code)) return fail(request, env, 'bad_request');
  const ver = typeof b.ver === 'string' ? b.ver.slice(0, 20) : null;
  const ua = typeof b.ua === 'string' ? b.ua.slice(0, 200) : null;
  await run(env, 'INSERT INTO logs (at, tool, code, ver, ua) VALUES (?, ?, ?, ?, ?)', Date.now(), b.tool, b.code, ver, ua);
  return ok(request, env, {});
}

// GET /admin/logs?days=7（已通過 admin 驗證）
export async function adminLogs(request, env, path) {
  if (path !== '/admin/logs' || request.method !== 'GET') return null;
  const n = Number(new URL(request.url).searchParams.get('days'));
  const days = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), LOG_KEEP_DAYS) : 7;
  const rows = await all(env,
    'SELECT id, at, tool, code, ver, ua FROM logs WHERE at >= ? ORDER BY at DESC, id DESC LIMIT ?',
    Date.now() - days * DAY, MAX_LOGS);
  return ok(request, env, rows);
}

export async function cleanup(env, nowMs) {
  await run(env, 'DELETE FROM logs WHERE at < ?', nowMs - LOG_KEEP_DAYS * DAY);
}
