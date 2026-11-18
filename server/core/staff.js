// 授權名單（員工編號＋姓名＋權限組）與排程發布操作紀錄。
//   staff：名單；staff_groups：權限組（預設 管理／發文／檢視，可自訂）；fb_audit：發文、改時間、刪除的紀錄（90 天）
//   登入只用員工編號（auth.js）；憑證帶 uid，每次請求由 bearer() 用 findStaff() 確認還在名單、還啟用，移除／停用立即生效。
import { ok, fail, readBody } from './http.js';
import { all, first, run } from './db.js';

export const PERMS = ['view', 'post', 'edit', 'delete', 'bypass'];
export const PERM_LABELS = { view: '檢視已排程／已發佈', post: '新增發文（含排入 Rundown）', edit: '改排程時間', delete: '刪除貼文', bypass: '關閉時仍可使用' };
export const DEFAULT_GROUPS = [
  { name: '管理', perms: ['view', 'post', 'edit', 'delete', 'bypass'] },
  { name: '發文', perms: ['view', 'post', 'edit', 'delete'] },
  { name: '檢視', perms: ['view'] }
];
export const STAFF_ID_RE = /^[A-Za-z0-9_-]{1,20}$/;
export const MAX_NAME = 20;
export const MAX_STAFF = 500;
export const MAX_GROUPS = 20;
export const AUDIT_KEEP_DAYS = 90;
export const MAX_AUDIT = 500;
const DAY = 86400000;

// 員工編號一律大寫、去空白；不合格回 ''
export const normId = (v) => { const s = typeof v === 'string' ? v.trim().toUpperCase() : ''; return STAFF_ID_RE.test(s) ? s : ''; };
const cleanName = (v) => (typeof v === 'string' ? [...v.trim()].slice(0, MAX_NAME + 1).join('') : '');
const cleanPerms = (v) => (Array.isArray(v) ? PERMS.filter((p) => v.includes(p)) : null);
const parsePerms = (s) => { try { return cleanPerms(JSON.parse(s)) || []; } catch { return []; } };

// 每個 D1 綁定只建一次表；staff_groups 空的就放預設 3 組
const ready = new WeakSet();
export async function ensureStaff(env) {
  if (!env.DB || ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS staff_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, perms TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, grp INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, updated INTEGER NOT NULL, last_login INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, uid TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL, page TEXT NOT NULL DEFAULT \'\', post TEXT NOT NULL DEFAULT \'\', detail TEXT NOT NULL DEFAULT \'\')'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fb_audit_at ON fb_audit(at)')
  ]);
  const n = await first(env, 'SELECT COUNT(*) AS n FROM staff_groups');
  if (!n || !n.n) {
    const now = Date.now();
    await env.DB.batch(DEFAULT_GROUPS.map((g, i) => env.DB.prepare('INSERT OR IGNORE INTO staff_groups (name, perms, ord, updated) VALUES (?, ?, ?, ?)').bind(g.name, JSON.stringify(g.perms), i, now)));
  }
  ready.add(env.DB);
}

// 名單內且啟用 → { id, name, group, groupName, perms }；否則 null（讀不到資料庫也是 null＝擋下）
export async function findStaff(env, id) {
  const uid = normId(id);
  if (!uid || !env.DB) return null;
  try {
    await ensureStaff(env);
    const r = await first(env, 'SELECT s.id, s.name, s.grp, s.enabled, g.name AS gname, g.perms FROM staff s LEFT JOIN staff_groups g ON g.id = s.grp WHERE s.id = ?', uid);
    if (!r || !r.enabled) return null;
    return { id: r.id, name: r.name, group: r.grp, groupName: r.gname || '', perms: r.gname ? parsePerms(r.perms) : [] };
  } catch { return null; }
}

export async function touchLogin(env, id) {
  try { await run(env, 'UPDATE staff SET last_login = ? WHERE id = ?', Date.now(), id); } catch { /* 記不了不影響登入 */ }
}

// 操作紀錄：who＝{ uid, name }（管理員密碼登入＝{ uid:'ADMIN', name:'管理員' }）；寫不進去不影響主要動作
export async function audit(env, who, action, page = '', post = '', detail = '') {
  try {
    await ensureStaff(env);
    await run(env, 'INSERT INTO fb_audit (at, uid, name, action, page, post, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      Date.now(), String(who && who.uid || ''), String(who && who.name || ''), action, String(page || ''), String(post || ''), String(detail || '').slice(0, 200));
  } catch { /* 靜默 */ }
}

export async function cleanupAudit(env, nowMs) {
  try { await ensureStaff(env); await run(env, 'DELETE FROM fb_audit WHERE at < ?', nowMs - AUDIT_KEEP_DAYS * DAY); } catch { /* 靜默 */ }
}

// ---- 管理 API（已通過 admin 驗證，掛在 core/admin.js 的 adminExtras）----
async function readJson(request, max = 16384) {
  const buf = await readBody(request, max);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}
async function listGroups(env) {
  const rows = await all(env, 'SELECT g.id, g.name, g.perms, g.ord, (SELECT COUNT(*) FROM staff s WHERE s.grp = g.id) AS used FROM staff_groups g ORDER BY g.ord, g.id');
  return rows.map((g) => ({ id: g.id, name: g.name, perms: parsePerms(g.perms), used: g.used }));
}
async function listStaff(env) {
  const rows = await all(env, 'SELECT id, name, grp, enabled, created, last_login FROM staff ORDER BY id');
  return rows.map((s) => ({ id: s.id, name: s.name, group: s.grp, enabled: !!s.enabled, created: s.created, lastLogin: s.last_login || null }));
}
const state = async (env) => ({ staff: await listStaff(env), groups: await listGroups(env), perms: PERMS.map((k) => ({ key: k, label: PERM_LABELS[k] })) });
const groupExists = async (env, id) => Number.isInteger(id) && !!(await first(env, 'SELECT id FROM staff_groups WHERE id = ?', id));
const bad = (request, env, msg) => fail(request, env, 'bad_request', msg);

export async function adminStaff(request, env, path) {
  if (path !== '/admin/staff' && !path.startsWith('/admin/staff/') && path !== '/admin/staff-groups' && !path.startsWith('/admin/staff-groups/') && path !== '/admin/audit') return null;
  await ensureStaff(env);
  const method = request.method;

  if (path === '/admin/staff' && method === 'GET') return ok(request, env, await state(env));

  // 新增：{ id, name, group }
  if (path === '/admin/staff' && method === 'POST') {
    const b = await readJson(request);
    const id = normId(b && b.id), name = cleanName(b && b.name), group = Number(b && b.group);
    if (!id) return bad(request, env, '員工編號只能是英數字、- 或 _，最多 20 字。');
    if (!name || [...name].length > MAX_NAME) return bad(request, env, '姓名必填，最多 ' + MAX_NAME + ' 字。');
    if (!(await groupExists(env, group))) return bad(request, env, '請選擇權限組。');
    if (await first(env, 'SELECT id FROM staff WHERE id = ?', id)) return bad(request, env, '員工編號 ' + id + ' 已在名單內。');
    const n = await first(env, 'SELECT COUNT(*) AS n FROM staff');
    if (n && n.n >= MAX_STAFF) return bad(request, env, '名單最多 ' + MAX_STAFF + ' 人。');
    const now = Date.now();
    await run(env, 'INSERT INTO staff (id, name, grp, enabled, created, updated) VALUES (?, ?, ?, 1, ?, ?)', id, name, group, now, now);
    return ok(request, env, await state(env));
  }

  const sm = /^\/admin\/staff\/([^/]+)$/.exec(path);
  if (sm) {
    const id = normId(decodeURIComponent(sm[1]));
    if (!id || !(await first(env, 'SELECT id FROM staff WHERE id = ?', id))) return fail(request, env, 'not_found', '名單裡沒有這個員工編號。');
    if (method === 'DELETE') {
      await run(env, 'DELETE FROM staff WHERE id = ?', id);
      return ok(request, env, await state(env));
    }
    // 修改：{ name?, group?, enabled? }
    if (method === 'POST') {
      const b = await readJson(request);
      if (!b || typeof b !== 'object') return bad(request, env);
      const sets = [], args = [];
      if (b.name !== undefined) { const name = cleanName(b.name); if (!name || [...name].length > MAX_NAME) return bad(request, env, '姓名必填，最多 ' + MAX_NAME + ' 字。'); sets.push('name = ?'); args.push(name); }
      if (b.group !== undefined) { const g = Number(b.group); if (!(await groupExists(env, g))) return bad(request, env, '請選擇權限組。'); sets.push('grp = ?'); args.push(g); }
      if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') return bad(request, env); sets.push('enabled = ?'); args.push(b.enabled ? 1 : 0); }
      if (!sets.length) return bad(request, env);
      sets.push('updated = ?'); args.push(Date.now());
      await run(env, 'UPDATE staff SET ' + sets.join(', ') + ' WHERE id = ?', ...args, id);
      return ok(request, env, await state(env));
    }
  }

  // 權限組新增／修改：{ id?, name, perms }
  if (path === '/admin/staff-groups' && method === 'POST') {
    const b = await readJson(request);
    const name = cleanName(b && b.name), perms = cleanPerms(b && b.perms);
    if (!name || [...name].length > MAX_NAME) return bad(request, env, '權限組名稱必填，最多 ' + MAX_NAME + ' 字。');
    if (!perms) return bad(request, env);
    const dup = await first(env, 'SELECT id FROM staff_groups WHERE name = ?', name);
    const now = Date.now();
    if (b.id !== undefined && b.id !== null) {
      const id = Number(b.id);
      if (!(await groupExists(env, id))) return fail(request, env, 'not_found', '找不到這個權限組。');
      if (dup && dup.id !== id) return bad(request, env, '已經有叫「' + name + '」的權限組。');
      await run(env, 'UPDATE staff_groups SET name = ?, perms = ?, updated = ? WHERE id = ?', name, JSON.stringify(perms), now, id);
    } else {
      if (dup) return bad(request, env, '已經有叫「' + name + '」的權限組。');
      const n = await first(env, 'SELECT COUNT(*) AS n, MAX(ord) AS m FROM staff_groups');
      if (n && n.n >= MAX_GROUPS) return bad(request, env, '權限組最多 ' + MAX_GROUPS + ' 個。');
      await run(env, 'INSERT INTO staff_groups (name, perms, ord, updated) VALUES (?, ?, ?, ?)', name, JSON.stringify(perms), ((n && n.m) || 0) + 1, now);
    }
    return ok(request, env, await state(env));
  }
  const gm = /^\/admin\/staff-groups\/(\d{1,9})$/.exec(path);
  if (gm && method === 'DELETE') {
    const id = Number(gm[1]);
    if (!(await groupExists(env, id))) return fail(request, env, 'not_found', '找不到這個權限組。');
    const used = await first(env, 'SELECT COUNT(*) AS n FROM staff WHERE grp = ?', id);
    if (used && used.n) return bad(request, env, '還有 ' + used.n + ' 人在這個權限組，先把他們改到別組才能刪除。');
    await run(env, 'DELETE FROM staff_groups WHERE id = ?', id);
    return ok(request, env, await state(env));
  }

  // 操作紀錄：?days=1～90（預設 7）、?uid=編號（選填），最多 500 筆
  if (path === '/admin/audit' && method === 'GET') {
    const q = new URL(request.url).searchParams;
    const d = Number(q.get('days'));
    const days = Number.isFinite(d) && d >= 1 ? Math.min(Math.floor(d), AUDIT_KEEP_DAYS) : 7;
    const uid = q.get('uid') ? normId(q.get('uid')) : '';
    const since = Date.now() - days * DAY;
    const rows = uid
      ? await all(env, 'SELECT id, at, uid, name, action, page, post, detail FROM fb_audit WHERE at >= ? AND uid = ? ORDER BY at DESC, id DESC LIMIT ?', since, uid, MAX_AUDIT)
      : await all(env, 'SELECT id, at, uid, name, action, page, post, detail FROM fb_audit WHERE at >= ? ORDER BY at DESC, id DESC LIMIT ?', since, MAX_AUDIT);
    return ok(request, env, rows);
  }
  return fail(request, env, 'not_found');
}
