import { ok, fail, readBody } from './http.js';
import { all, run } from './db.js';
import { withPageNames } from './pagenames.js';

// page 欄位（2026-11-22，留言失敗記粉專 ID）、detail 欄位（2026-11-23，臉書英文原文）：舊表自動補欄位；同一執行個體只試一次，並發 ALTER 失敗吞掉
const pageCol = new WeakMap();   // D1 綁定 → Promise
// 2026-11-23 第二批：留言失敗的貼文資訊（post 貼文 ID、title 摘要、ptype 類型、pub_at 發布時間（秒）、page_name 粉專完整名稱）
//   與處理狀態（st：open／read／retry／closed，st_by／st_name／st_at 誰、何時），與留言失敗通知（fb/notices.js）同一套
const COLS = ['page TEXT', 'detail TEXT', 'post TEXT', 'title TEXT', 'ptype TEXT', 'pub_at INTEGER', 'page_name TEXT', 'st TEXT', 'st_by TEXT', 'st_name TEXT', 'st_at INTEGER']
  .map((c) => 'ALTER TABLE logs ADD COLUMN ' + c);
export const PTYPES = ['template', 'textimg', 'text', 'video', 'reels'];
export const LOG_STATES = ['open', 'read', 'retry', 'closed'];
export function ensurePageCol(env) {
  let p = pageCol.get(env.DB);
  if (!p) {
    // 欄位已存在＝成功；其他錯誤（暫時性）不記住，下次再試
    p = Promise.all(COLS.map((sql) => env.DB.prepare(sql).run()
      .catch((e) => { if (!/duplicate column/i.test(String(e && e.message))) pageCol.delete(env.DB); }))).then(() => true);
    pageCol.set(env.DB, p);
  }
  return p;
}
// 後端自己記的事件（例：留言失敗），不經過 /logs
// detail：臉書英文原文（管理頁游標移到錯誤碼看），≤200 字；info：{ post, title, ptype, pubAt, pageName, st }（留言失敗才有）
export async function logEvent(env, tool, code, page = '', detail = '', info = {}) {
  await ensurePageCol(env);
  const t = (v, n) => (v ? String(v).slice(0, n) : null);
  await run(env, 'INSERT INTO logs (at, tool, code, ver, ua, page, detail, post, title, ptype, pub_at, page_name, st) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    Date.now(), tool, String(code).slice(0, 60), null, 'server', t(page, 30), t(detail, 500),
    t(info.post, 40), t(info.title, 60), PTYPES.includes(info.ptype) ? info.ptype : null,
    Number.isInteger(info.pubAt) && info.pubAt > 0 ? info.pubAt : null, t(info.pageName, 80), LOG_STATES.includes(info.st) ? info.st : null);
}

// 改處理狀態：post＝貼文 ID（同一則的列一起改），from＝只改目前是這些狀態的列；回是否有改到
export async function setLogState(env, post, st, who, from) {
  if (!env.DB || !post) return false;
  await ensurePageCol(env);
  const r = await env.DB.prepare(`UPDATE logs SET st = ?, st_by = ?, st_name = ?, st_at = ? WHERE post = ? AND st IN (${from.map(() => '?').join(', ')})`)
    .bind(st, String((who && who.uid) || ''), String((who && who.name) || '').slice(0, 30), Date.now(), String(post), ...from).run();
  return !!(r && r.meta && r.meta.changes);
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

// GET /admin/logs?days=7&st=&limit=21&offset=0（已通過 admin 驗證）：limit 由前端多要 1 筆判斷有沒有下一頁
//   st：open 未處理／handled 發文者已處理（read＋retry）／closed 已結案；空白＝全部
export const MAX_PAGE = 101;
export async function adminLogs(request, env, path, who) {
  if (path === '/admin/logs/read' && request.method === 'POST') return adminLogRead(request, env, who);
  if (path !== '/admin/logs' || request.method !== 'GET') return null;
  const q = new URL(request.url).searchParams;
  const n = Number(q.get('days'));
  const days = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), LOG_KEEP_DAYS) : 7;
  const lim = Number(q.get('limit')), off = Number(q.get('offset'));
  const limit = Number.isInteger(lim) && lim >= 1 ? Math.min(lim, MAX_PAGE) : MAX_LOGS;
  const offset = Number.isInteger(off) && off >= 0 ? Math.min(off, 100000) : 0;
  const st = String(q.get('st') || '');
  const where = { open: " AND st = 'open'", handled: " AND st IN ('read', 'retry')", closed: " AND st = 'closed'" }[st] || '';
  await ensurePageCol(env);
  const rows = await all(env,
    'SELECT id, at, tool, code, ver, ua, page, detail, post, title, ptype, pub_at, page_name, st, st_by, st_name, st_at FROM logs WHERE at >= ?' + where + ' ORDER BY at DESC, id DESC LIMIT ? OFFSET ?',
    Date.now() - days * DAY, limit, offset);
  return ok(request, env, await withPageNames(env, rows));   // 粉專 ID 換成簡稱（pagenames.js）
}

// POST /admin/logs/read { id }：管理頁按「已讀」＝結案。留言失敗的列連同首頁通知一起結案（fb/notices.js readNotice）
async function adminLogRead(request, env, who) {
  const buf = await readBody(request, 256);
  let b = null;
  try { b = buf ? JSON.parse(new TextDecoder().decode(buf)) : null; } catch { b = null; }
  const id = b && Number(b.id);
  if (!Number.isInteger(id) || id < 1) return fail(request, env, 'bad_request');
  await ensurePageCol(env);
  const row = (await all(env, 'SELECT id, post FROM logs WHERE id = ?', id))[0];
  if (!row) return fail(request, env, 'not_found');
  const me = { uid: (who && who.uid) || 'admin', name: (who && who.name) || '' };
  if (row.post) {
    const { readNotice } = await import('../fb/notices.js');   // 動態載入：notices.js 也 import 這支
    await readNotice(env, row.post, me, true);
  }
  await run(env, "UPDATE logs SET st = 'closed', st_by = ?, st_name = ?, st_at = ? WHERE id = ?", String(me.uid), String(me.name).slice(0, 30), Date.now(), id);
  return ok(request, env, { ok: true });
}

export async function cleanup(env, nowMs) {
  await run(env, 'DELETE FROM logs WHERE at < ?', nowMs - LOG_KEEP_DAYS * DAY);
}
