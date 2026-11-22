import { ok, fail, readBody } from './http.js';
import { all, run } from './db.js';

// page 欄位（2026-11-22，留言失敗記粉專 ID）：舊表自動補欄位；同一執行個體只試一次，並發 ALTER 失敗吞掉
const pageCol = new WeakMap();   // D1 綁定 → Promise
export function ensurePageCol(env) {
  let p = pageCol.get(env.DB);
  if (!p) {
    // 欄位已存在＝成功；其他錯誤（暫時性）不記住，下次再試
    p = env.DB.prepare('ALTER TABLE logs ADD COLUMN page TEXT').run()
      .catch((e) => { if (!/duplicate column/i.test(String(e && e.message))) pageCol.delete(env.DB); }).then(() => true);
    pageCol.set(env.DB, p);
  }
  return p;
}
// 後端自己記的事件（例：留言失敗），不經過 /logs
export async function logEvent(env, tool, code, page = '') {
  await ensurePageCol(env);
  await run(env, 'INSERT INTO logs (at, tool, code, ver, ua, page) VALUES (?, ?, ?, ?, ?, ?)', Date.now(), tool, String(code).slice(0, 60), null, 'server', page ? String(page).slice(0, 30) : null);
}

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
  await ensurePageCol(env);
  const rows = await all(env,
    'SELECT id, at, tool, code, ver, ua, page FROM logs WHERE at >= ? ORDER BY at DESC, id DESC LIMIT ?',
    Date.now() - days * DAY, MAX_LOGS);
  // 粉專 ID 換成管理頁「粉專設定」的簡稱（讀取時對照，改簡稱舊紀錄跟著變）；對不到就沒有 pageName，前端顯示 ID
  let names = new Map();
  if (rows.some((r) => r.page)) {
    try { names = new Map((await all(env, 'SELECT id, short FROM fb_pages')).map((r) => [String(r.id), r.short])); } catch { /* 還沒有粉專表 */ }
  }
  return ok(request, env, rows.map((r) => (r.page && names.get(String(r.page)) ? { ...r, pageName: names.get(String(r.page)) } : r)));
}

export async function cleanup(env, nowMs) {
  await run(env, 'DELETE FROM logs WHERE at < ?', nowMs - LOG_KEEP_DAYS * DAY);
}
