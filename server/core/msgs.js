// 系統管理者手動發給員工的通知（2026-11-23）
//   D1：staff_msgs（訊息本體，recall＝撤回）、staff_msg_to（收件人與已讀時間，read_at 0＝未讀）
//   管理端（只有系統管理者，不用解鎖進階設定）：POST／GET /admin/msgs、POST /admin/msgs/:id/recall
//   員工端：GET /staff/me/msgs（未讀全部＋已讀 1 天內，不含撤回）、POST /staff/me/msgs/read { id }
//   保存 30 天（cleanupMsgs，每日 cron）
import { ok, fail, readBody } from './http.js';
import { all, first, run } from './db.js';
import { ensureOnce } from './once.js';
import { ensureStaff, audit, normId } from './staff.js';

export const MAX_BODY = 200;
export const MAX_RECIPIENTS = 500;
export const KEEP_DAYS = 30;
export const READ_SHOW_MS = 86400000;   // 已讀後還顯示 1 天
const DAY = 86400000;

const SQLS = [
  'CREATE TABLE IF NOT EXISTS staff_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, from_uid TEXT NOT NULL, from_name TEXT NOT NULL, body TEXT NOT NULL, recall INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS staff_msg_to (msg_id INTEGER NOT NULL, uid TEXT NOT NULL, read_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (msg_id, uid))',
  'CREATE INDEX IF NOT EXISTS staff_msg_to_uid ON staff_msg_to(uid)'
];
async function ensureMsgs(env) {
  await ensureStaff(env);
  for (const s of SQLS) await ensureOnce(env.DB, s);
}

async function readJson(request) {
  const buf = await readBody(request, 16384);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}
const bad = (request, env, msg) => fail(request, env, 'bad_request', msg);
const auditWho = (who) => (who && who.uid ? { uid: who.uid, name: who.name } : { uid: 'ADMIN', name: '管理員' });
const cleanBody = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');

// 依 mode 展開收件人（只限啟用中的員工、去重）；回 { uids } 或 { error }
export async function expandRecipients(env, b) {
  const mode = b && b.mode;
  if (mode === 'all') return { uids: (await all(env, 'SELECT id FROM staff WHERE enabled = 1 ORDER BY id')).map((r) => r.id) };
  if (mode === 'group') {
    const g = Number(b.group);
    if (!Number.isInteger(g) || !(await first(env, 'SELECT id FROM staff_groups WHERE id = ?', g))) return { error: '請選擇權限組。' };
    return { uids: (await all(env, 'SELECT id FROM staff WHERE grp = ? AND enabled = 1 ORDER BY id', g)).map((r) => r.id) };
  }
  if (mode === 'one' || mode === 'many') {
    const want = [...new Set((Array.isArray(b.uids) ? b.uids : []).map(normId).filter(Boolean))];
    if (!want.length) return { error: '請選擇收件人。' };
    if (mode === 'one' && want.length !== 1) return { error: '單人只能選一位。' };
    if (want.length > MAX_RECIPIENTS) return { error: '一次最多 ' + MAX_RECIPIENTS + ' 人。' };
    const rows = await all(env, 'SELECT id FROM staff WHERE enabled = 1 AND id IN (' + want.map(() => '?').join(',') + ')', ...want);
    const ok2 = new Set(rows.map((r) => r.id));
    return { uids: want.filter((u) => ok2.has(u)) };
  }
  return { error: '收件方式不正確。' };
}

async function send(request, env, who) {
  const b = await readJson(request);
  if (!b || typeof b !== 'object') return bad(request, env);
  const body = cleanBody(b.body);
  if (!body) return bad(request, env, '請輸入通知內容。');
  if ([...body].length > MAX_BODY) return bad(request, env, '通知內容最多 ' + MAX_BODY + ' 字。');
  const r = await expandRecipients(env, b);
  if (r.error) return bad(request, env, r.error);
  if (!r.uids.length) return bad(request, env, '沒有可收件的啟用員工。');
  if (r.uids.length > MAX_RECIPIENTS) return bad(request, env, '一次最多 ' + MAX_RECIPIENTS + ' 人。');
  const at = Date.now();
  const w = auditWho(who);
  const ins = await run(env, 'INSERT INTO staff_msgs (at, from_uid, from_name, body) VALUES (?, ?, ?, ?)', at, w.uid, w.name, body);
  const id = Number(ins.meta && ins.meta.last_row_id);
  await env.DB.batch(r.uids.map((u) => env.DB.prepare('INSERT OR IGNORE INTO staff_msg_to (msg_id, uid, read_at) VALUES (?, ?, 0)').bind(id, u)));
  await audit(env, w, 'msg_send', '', String(id), r.uids.length + ' 人：' + [...body].slice(0, 40).join(''));
  return ok(request, env, { id, count: r.uids.length });
}

// 最近 30 天已發送清單：每則含收件人（姓名、已讀時間）
async function list(request, env) {
  const since = Date.now() - KEEP_DAYS * DAY;
  const msgs = await all(env, 'SELECT id, at, from_uid, from_name, body, recall FROM staff_msgs WHERE at >= ? ORDER BY at DESC, id DESC LIMIT 200', since);
  if (!msgs.length) return ok(request, env, { items: [] });
  const rows = await all(env, 'SELECT t.msg_id, t.uid, t.read_at, s.name FROM staff_msg_to t LEFT JOIN staff s ON s.id = t.uid WHERE t.msg_id >= ? ORDER BY t.uid', msgs[msgs.length - 1].id);
  const by = new Map();
  for (const r of rows) { if (!by.has(r.msg_id)) by.set(r.msg_id, []); by.get(r.msg_id).push({ uid: r.uid, name: r.name || r.uid, readAt: Number(r.read_at) || 0 }); }
  return ok(request, env, { items: msgs.map((m) => {
    const to = by.get(m.id) || [];
    return { id: m.id, at: m.at, fromName: m.from_name, body: m.body, recalled: !!m.recall, count: to.length, read: to.filter((x) => x.readAt).length, to };
  }) });
}

async function recall(request, env, who, id) {
  const m = await first(env, 'SELECT id, recall FROM staff_msgs WHERE id = ?', id);
  if (!m) return fail(request, env, 'not_found', '找不到這則通知。');
  if (!m.recall) {
    await run(env, 'UPDATE staff_msgs SET recall = 1 WHERE id = ?', id);
    await audit(env, auditWho(who), 'msg_recall', '', String(id), '');
  }
  return ok(request, env, { id, recalled: true });
}

// 管理路由（adminExtras）；只有系統管理者（不用解鎖）
export async function adminMsgs(request, env, path, who) {
  const m = /^\/admin\/msgs(?:\/(\d{1,12})\/recall)?$/.exec(path);
  if (!m) return null;
  if (!who || who.role !== 'sys') return fail(request, env, 'forbidden');
  await ensureMsgs(env);
  if (!m[1] && request.method === 'POST') return send(request, env, who);
  if (!m[1] && request.method === 'GET') return list(request, env);
  if (m[1] && request.method === 'POST') return recall(request, env, who, Number(m[1]));
  return null;
}

// 員工自己的通知：未讀全部＋已讀 1 天內；不含撤回
export async function myMsgs(request, env, staff) {
  await ensureMsgs(env);
  const rows = await all(env, 'SELECT m.id, m.at, m.from_name, m.body, t.read_at FROM staff_msg_to t JOIN staff_msgs m ON m.id = t.msg_id WHERE t.uid = ? AND m.recall = 0 AND (t.read_at = 0 OR t.read_at >= ?) ORDER BY m.at DESC, m.id DESC LIMIT 100',
    staff.id, Date.now() - READ_SHOW_MS);
  return ok(request, env, { items: rows.map((r) => ({ id: r.id, at: r.at, fromName: r.from_name, body: r.body, readAt: Number(r.read_at) || 0 })) });
}

export async function readMyMsg(request, env, staff) {
  await ensureMsgs(env);
  const b = await readJson(request);
  const id = Number(b && b.id);
  if (!Number.isInteger(id) || id < 1) return bad(request, env);
  const r = await run(env, 'UPDATE staff_msg_to SET read_at = ? WHERE msg_id = ? AND uid = ? AND read_at = 0', Date.now(), id, staff.id);
  if (!(r.meta && r.meta.changes)) {
    const ex = await first(env, 'SELECT msg_id FROM staff_msg_to WHERE msg_id = ? AND uid = ?', id, staff.id);
    if (!ex) return fail(request, env, 'not_found');
  }
  return ok(request, env, { id });
}

export async function cleanupMsgs(env, nowMs) {
  try {
    await ensureMsgs(env);
    const cut = nowMs - KEEP_DAYS * DAY;
    await run(env, 'DELETE FROM staff_msg_to WHERE msg_id IN (SELECT id FROM staff_msgs WHERE at < ?)', cut);
    await run(env, 'DELETE FROM staff_msgs WHERE at < ?', cut);
  } catch { /* 靜默 */ }
}
