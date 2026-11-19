// 授權名單（員工編號＋姓名＋權限組）與排程發布操作紀錄。
//   staff：名單；staff_groups：權限組（預設 管理／發文／檢視，可自訂）；fb_audit：發文、改時間、刪除的紀錄（90 天）
//   登入＝員工編號＋自己的密碼（auth.js）；第一次或被重置後用管理頁給的 6 碼設定碼自己設密碼（password.js）。
//   憑證帶 uid 與 pv（密碼版本），每次請求由 bearer() 用 findStaff() 確認還在名單、還啟用、pv 相符；移除／停用／改密碼／重置立即生效。
//   系統管理者＝後端設定 SYS_STAFF_ID 的那一位：名單沒有就自動建立，不能停用、刪除、改層級。
import { ok, fail, readBody } from './http.js';
import { all, first, run } from './db.js';
import { newSetupCode, codeHash, SETUP_MS } from './password.js';

export const PERMS = ['view', 'post', 'edit', 'delete', 'bypass'];
export const PERM_LABELS = { view: '檢視已排程／已發佈', post: '新增發文（含排入 Rundown）', edit: '改排程時間', delete: '刪除貼文', bypass: '關閉時仍可使用' };
export const DEFAULT_GROUPS = [
  { name: '管理', perms: ['view', 'post', 'edit', 'delete', 'bypass'] },
  { name: '發文', perms: ['view', 'post', 'edit', 'delete'] },
  { name: '檢視', perms: ['view'] }
];
export const STAFF_ID_RE = /^[A-Za-z0-9_-]{1,20}$/;
export const MAX_NAME = 20;
export const MAX_CONTACT = 30;
// 分機／手機：數字、# - + 空白（含全形）括號，最多 30 字；空字串＝清除
const CONTACT_RE = /^[0-9#+\-() \u3000（）]*$/;
export const cleanContact = (v) => { if (typeof v !== 'string') return null; const s = v.trim(); return [...s].length <= MAX_CONTACT && CONTACT_RE.test(s) ? s : null; };
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
    env.DB.prepare('CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, grp INTEGER NOT NULL, contact TEXT NOT NULL DEFAULT \'\', level TEXT NOT NULL DEFAULT \'user\', enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, updated INTEGER NOT NULL, last_login INTEGER, ' + PW_COLS.map((c) => c.join(' ')).join(', ') + ')'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, uid TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL, page TEXT NOT NULL DEFAULT \'\', post TEXT NOT NULL DEFAULT \'\', detail TEXT NOT NULL DEFAULT \'\')'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fb_audit_at ON fb_audit(at)')
  ]);
  // 舊表沒有 contact（分機／手機）就補欄位
  try { await first(env, 'SELECT contact FROM staff LIMIT 1'); } catch { try { await run(env, "ALTER TABLE staff ADD COLUMN contact TEXT NOT NULL DEFAULT ''"); } catch { /* 另一個 isolate 剛補過（duplicate column） */ } }
  // 舊表沒有 level（管理頁層級：user 普通／mgr 管理者）就補欄位，舊員工一律普通
  try { await first(env, 'SELECT level FROM staff LIMIT 1'); } catch { try { await run(env, "ALTER TABLE staff ADD COLUMN level TEXT NOT NULL DEFAULT 'user'"); } catch { /* 同上 */ } }
  // 舊表沒有密碼欄位就補；pw_ver 預設 1，舊憑證（沒有 pv）一律失效，要用設定碼設好密碼才能登入
  for (const [col, type] of PW_COLS) {
    try { await first(env, 'SELECT ' + col + ' FROM staff LIMIT 1'); } catch { try { await run(env, 'ALTER TABLE staff ADD COLUMN ' + col + ' ' + type); } catch { /* 同上 */ } }
  }
  const n = await first(env, 'SELECT COUNT(*) AS n FROM staff_groups');
  if (!n || !n.n) {
    const now = Date.now();
    await env.DB.batch(DEFAULT_GROUPS.map((g, i) => env.DB.prepare('INSERT OR IGNORE INTO staff_groups (name, perms, ord, updated) VALUES (?, ?, ?, ?)').bind(g.name, JSON.stringify(g.perms), i, now)));
  }
  ready.add(env.DB);
}

// 密碼相關欄位：雜湊、鹽、密碼版本、設定碼（HMAC）與到期、連錯次數、鎖到何時
const PW_COLS = [['pw_hash', 'TEXT'], ['pw_salt', 'TEXT'], ['pw_ver', 'INTEGER NOT NULL DEFAULT 1'], ['setup_hash', 'TEXT'], ['setup_exp', 'INTEGER'], ['fails', 'INTEGER NOT NULL DEFAULT 0'], ['lock_until', 'INTEGER']];

// 系統管理者的員工編號（後端設定 SYS_STAFF_ID；沒設＝沒有）
export const sysId = (env) => normId(env && env.SYS_STAFF_ID);
const levelOf = (env, r) => (r.id === sysId(env) ? 'sys' : r.level === 'mgr' ? 'mgr' : 'user');

// 系統管理者不在名單就建一筆（姓名「系統管理者」、權限組＝有 bypass 的第一組）；已在名單就確保啟用
async function ensureSys(env) {
  const id = sysId(env);
  if (!id) return;
  const row = await first(env, 'SELECT id, enabled FROM staff WHERE id = ?', id);
  if (row) { if (!row.enabled) await run(env, 'UPDATE staff SET enabled = 1 WHERE id = ?', id); return; }
  const groups = await all(env, 'SELECT id, perms FROM staff_groups ORDER BY ord, id');
  const g = groups.find((x) => parsePerms(x.perms).includes('bypass')) || groups[0];
  if (!g) return;
  const now = Date.now();
  await run(env, 'INSERT OR IGNORE INTO staff (id, name, grp, contact, level, enabled, created, updated) VALUES (?, ?, ?, \'\', \'user\', 1, ?, ?)', id, '系統管理者', g.id, now, now);
}

// 名單內且啟用 → { id, name, group, groupName, perms, level（sys／mgr／user）, pwVer }；系統管理者的 perms 一律全部；否則 null（讀不到資料庫也是 null＝擋下）
export async function findStaff(env, id) {
  const uid = normId(id);
  if (!uid || !env.DB) return null;
  try {
    await ensureStaff(env);
    if (uid === sysId(env)) await ensureSys(env);
    const r = await first(env, 'SELECT s.id, s.name, s.grp, s.enabled, s.level, s.pw_ver, g.name AS gname, g.perms FROM staff s LEFT JOIN staff_groups g ON g.id = s.grp WHERE s.id = ?', uid);
    if (!r || !r.enabled) return null;
    const level = levelOf(env, r);
    const perms = level === 'sys' ? PERMS.slice() : r.gname ? parsePerms(r.perms) : [];
    return { id: r.id, name: r.name, group: r.grp, groupName: r.gname || '', perms, level, pwVer: Number(r.pw_ver) || 1 };
  } catch { return null; }
}

// 自己的資料（直播需求單用）：{ id, name, group, contact }
export async function getProfile(env, id) {
  await ensureStaff(env);
  const r = await first(env, 'SELECT s.id, s.name, s.contact, s.level, g.name AS gname FROM staff s LEFT JOIN staff_groups g ON g.id = s.grp WHERE s.id = ?', normId(id));
  return r ? { id: r.id, name: r.name, group: r.gname || '', contact: r.contact || '', level: levelOf(env, r) } : null;
}
export async function setContact(env, id, contact) {
  await ensureStaff(env);
  await run(env, 'UPDATE staff SET contact = ?, updated = ? WHERE id = ?', contact, Date.now(), normId(id));
}

// ---- 登入用（auth.js）----
// 登入資料：{ id, enabled, sys, hasPw, hash, salt, ver, setupHash, setupExp, fails, lockUntil }；沒有或停用回 null
export async function authRow(env, id) {
  const uid = normId(id);
  if (!uid || !env.DB) return null;
  await ensureStaff(env);
  if (uid === sysId(env)) await ensureSys(env);
  const r = await first(env, 'SELECT id, enabled, pw_hash, pw_salt, pw_ver, setup_hash, setup_exp, fails, lock_until FROM staff WHERE id = ?', uid);
  if (!r || !r.enabled) return null;
  return { id: r.id, sys: r.id === sysId(env), hasPw: !!r.pw_hash, hash: r.pw_hash || '', salt: r.pw_salt || '', ver: Number(r.pw_ver) || 1,
    setupHash: r.setup_hash || '', setupExp: Number(r.setup_exp) || 0, fails: Number(r.fails) || 0, lockUntil: Number(r.lock_until) || 0 };
}
// 連錯一次：到上限就鎖並歸零；回 { locked, left, until }
export async function recordFail(env, row, max, lockMs) {
  const n = row.fails + 1;
  if (n >= max) {
    const until = Date.now() + lockMs;
    await run(env, 'UPDATE staff SET fails = 0, lock_until = ? WHERE id = ?', until, row.id);
    return { locked: true, left: 0, until };
  }
  await run(env, 'UPDATE staff SET fails = ? WHERE id = ?', n, row.id);
  return { locked: false, left: max - n, until: 0 };
}
export async function clearFails(env, id) { await run(env, 'UPDATE staff SET fails = 0, lock_until = NULL WHERE id = ?', id); }
// 設定新密碼：清掉設定碼與連錯，密碼版本 +1（其他裝置的舊憑證失效）；回新版本
export async function storePassword(env, row, { hash, salt }) {
  const ver = row.ver + 1;
  await run(env, 'UPDATE staff SET pw_hash = ?, pw_salt = ?, pw_ver = ?, setup_hash = NULL, setup_exp = NULL, fails = 0, lock_until = NULL, updated = ? WHERE id = ?', hash, salt, ver, Date.now(), row.id);
  return ver;
}
// 重置：清密碼、發新設定碼（24 小時）、密碼版本 +1、解鎖；回 { code, exp }
//   bump=false：剛新增的人（還沒有任何憑證）不用加版本
async function resetPassword(env, id, bump = true) {
  const code = newSetupCode(), exp = Date.now() + SETUP_MS;
  await run(env, 'UPDATE staff SET pw_hash = NULL, pw_salt = NULL, pw_ver = COALESCE(pw_ver, 1) + ' + (bump ? 1 : 0) + ', setup_hash = ?, setup_exp = ?, fails = 0, lock_until = NULL, updated = ? WHERE id = ?',
    await codeHash(env.SESSION_SECRET, id, code), exp, Date.now(), id);
  return { id, code, exp };
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
// 系統管理者那一列不能停用、改層級（看本文，不消耗原本的 request）
async function isProtectedEdit(request) {
  try { const b = await request.clone().json(); return !!b && (b.enabled !== undefined || b.level !== undefined); } catch { return false; }
}
async function readJson(request, max = 16384) {
  const buf = await readBody(request, max);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}
async function listGroups(env) {
  const rows = await all(env, 'SELECT g.id, g.name, g.perms, g.ord, (SELECT COUNT(*) FROM staff s WHERE s.grp = g.id) AS used FROM staff_groups g ORDER BY g.ord, g.id');
  return rows.map((g) => ({ id: g.id, name: g.name, perms: parsePerms(g.perms), used: g.used }));
}
// pw：set 已設定／setup 設定碼有效中（setupExp）／none 沒有密碼也沒有有效設定碼；locked：連錯被鎖中
async function listStaff(env) {
  await ensureSys(env);
  const now = Date.now();
  const rows = await all(env, 'SELECT id, name, grp, contact, level, enabled, created, last_login, pw_hash, setup_exp, lock_until FROM staff ORDER BY id');
  return rows.map((s) => ({ id: s.id, name: s.name, group: s.grp, contact: s.contact || '', level: levelOf(env, s), enabled: !!s.enabled, created: s.created, lastLogin: s.last_login || null,
    pw: s.pw_hash ? 'set' : (s.setup_exp && s.setup_exp > now ? 'setup' : 'none'), setupExp: !s.pw_hash && s.setup_exp > now ? s.setup_exp : null, locked: !!(s.lock_until && s.lock_until > now) }));
}

// ---- 名單的部分權限（管理頁層級，見 adminperm.js）----
//   系統管理者：全部；改層級要已解鎖（管理頁輸入管理員密碼）。
//   其他人（有授權名單卡片）：只能動層級比自己低、且不是自己的人；新增一律普通；
//   權限組只能指派「權限都在自己權限組裡」的組，換組時原本的組也要在範圍內。
const RANK = { user: 0, mgr: 1, sys: 2 };
export const LEVEL_VALUES = ['user', 'mgr'];
const isSys = (who) => !!who && who.role === 'sys';
const canLevel = (who) => isSys(who) && !!who.unlocked;
const subsetOf = (perms, own) => perms.every((p) => own.includes(p));
//   系統管理者那一列（SYS_STAFF_ID）：只有系統管理者能動，而且不能停用、刪除、改層級（見 adminStaff）。
function canTouch(who, row, env) {
  if (isSys(who)) return true;
  if (!who) return false;
  return row.id !== who.uid && RANK[levelOf(env, row)] < RANK[who.role];
}
function canAssign(who, g) {
  if (isSys(who)) return true;
  if (!who) return false;
  return !!g && subsetOf(g.perms, (who.staff && who.staff.perms) || []);
}
const state = async (env, who) => {
  const staff = await listStaff(env), groups = await listGroups(env);
  return {
    staff: staff.map((s) => ({ ...s, canEdit: canTouch(who, s, env) })),
    groups: groups.map((g) => ({ ...g, assignable: canAssign(who, g) })),
    perms: PERMS.map((k) => ({ key: k, label: PERM_LABELS[k] })),
    me: { role: who ? who.role : '', canLevel: canLevel(who), canAdd: isSys(who) || (!!who && who.role === 'mgr'), id: who && who.uid ? who.uid : '' }
  };
};
const groupExists = async (env, id) => Number.isInteger(id) && !!(await first(env, 'SELECT id FROM staff_groups WHERE id = ?', id));
const bad = (request, env, msg) => fail(request, env, 'bad_request', msg);
export const CONTACT_MSG = '分機／手機最多 ' + MAX_CONTACT + ' 字，只能有數字、#、-、+、空白和括號。';

const forbid = (request, env, msg) => fail(request, env, 'forbidden', msg);
const groupById = async (env, id) => (await listGroups(env)).find((g) => g.id === id) || null;

export async function adminStaff(request, env, path, who) {
  if (path !== '/admin/staff' && !path.startsWith('/admin/staff/') && path !== '/admin/staff-groups' && !path.startsWith('/admin/staff-groups/') && path !== '/admin/audit') return null;
  await ensureStaff(env);
  const method = request.method;

  if (path === '/admin/staff' && method === 'GET') return ok(request, env, await state(env, who));

  // 新增：{ id, name, group, contact? }
  if (path === '/admin/staff' && method === 'POST') {
    const b = await readJson(request);
    const id = normId(b && b.id), name = cleanName(b && b.name), group = Number(b && b.group);
    const contact = b && b.contact !== undefined ? cleanContact(b.contact) : '';
    if (contact === null) return bad(request, env, CONTACT_MSG);
    if (!id) return bad(request, env, '員工編號只能是英數字、- 或 _，最多 20 字。');
    if (!name || [...name].length > MAX_NAME) return bad(request, env, '姓名必填，最多 ' + MAX_NAME + ' 字。');
    if (!(await groupExists(env, group))) return bad(request, env, '請選擇權限組。');
    if (!isSys(who) && who.role !== 'mgr') return forbid(request, env, '你的層級不能新增人員。');
    let level = 'user';
    if (b.level !== undefined) {
      if (!canLevel(who)) return forbid(request, env, '只有系統管理者（輸入管理員密碼解鎖）能設定層級。');
      if (!LEVEL_VALUES.includes(b.level)) return bad(request, env);
      level = b.level;
    }
    if (!canAssign(who, await groupById(env, group))) return forbid(request, env, '不能指派權限比你多的權限組。');
    if (await first(env, 'SELECT id FROM staff WHERE id = ?', id)) return bad(request, env, '員工編號 ' + id + ' 已在名單內。');
    const n = await first(env, 'SELECT COUNT(*) AS n FROM staff');
    if (n && n.n >= MAX_STAFF) return bad(request, env, '名單最多 ' + MAX_STAFF + ' 人。');
    const now = Date.now();
    await run(env, 'INSERT INTO staff (id, name, grp, contact, level, enabled, created, updated) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', id, name, group, contact, level, now, now);
    // 新增就發設定碼（只回這一次），本人第一次登入時用它設密碼
    const setup = await resetPassword(env, id, false);
    return ok(request, env, { ...(await state(env, who)), setup });
  }

  const sm = /^\/admin\/staff\/([^/]+)(\/reset)?$/.exec(path);
  if (sm) {
    let raw = sm[1]; try { raw = decodeURIComponent(raw); } catch { raw = ''; }   // 壞掉的 %編碼當查無此人，不讓 Worker 500
    const id = normId(raw);
    const row = id ? await first(env, 'SELECT id, grp, level FROM staff WHERE id = ?', id) : null;
    if (!row) return fail(request, env, 'not_found', '名單裡沒有這個員工編號。');
    if (!canTouch(who, row, env)) return forbid(request, env, '只能修改層級比你低的人，也不能修改自己。');
    const sysRow = row.id === sysId(env);
    // 重置密碼：回新的設定碼（只回這一次）
    if (sm[2]) {
      if (method !== 'POST') return fail(request, env, 'not_found');
      const setup = await resetPassword(env, id);
      return ok(request, env, { ...(await state(env, who)), setup });
    }
    if (sysRow && (method === 'DELETE' || (method === 'POST' && await isProtectedEdit(request)))) return forbid(request, env, '系統管理者不能刪除、停用或改層級。');
    if (method === 'DELETE') {
      await run(env, 'DELETE FROM staff WHERE id = ?', id);
      return ok(request, env, await state(env, who));
    }
    // 修改：{ name?, group?, enabled?, contact? }
    if (method === 'POST') {
      const b = await readJson(request);
      if (!b || typeof b !== 'object') return bad(request, env);
      const sets = [], args = [];
      if (b.name !== undefined) { const name = cleanName(b.name); if (!name || [...name].length > MAX_NAME) return bad(request, env, '姓名必填，最多 ' + MAX_NAME + ' 字。'); sets.push('name = ?'); args.push(name); }
      if (b.group !== undefined) {
        const g = Number(b.group);
        if (!(await groupExists(env, g))) return bad(request, env, '請選擇權限組。');
        if (!canAssign(who, await groupById(env, g)) || !canAssign(who, await groupById(env, row.grp))) return forbid(request, env, '不能指派或變更權限比你多的權限組。');
        sets.push('grp = ?'); args.push(g);
      }
      if (b.level !== undefined) {
        if (!canLevel(who)) return forbid(request, env, '只有系統管理者（輸入管理員密碼解鎖）能設定層級。');
        if (!LEVEL_VALUES.includes(b.level)) return bad(request, env);
        sets.push('level = ?'); args.push(b.level);
      }
      if (b.contact !== undefined) { const c = cleanContact(b.contact); if (c === null) return bad(request, env, CONTACT_MSG); sets.push('contact = ?'); args.push(c); }
      if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') return bad(request, env); sets.push('enabled = ?'); args.push(b.enabled ? 1 : 0); }
      if (!sets.length) return bad(request, env);
      sets.push('updated = ?'); args.push(Date.now());
      await run(env, 'UPDATE staff SET ' + sets.join(', ') + ' WHERE id = ?', ...args, id);
      return ok(request, env, await state(env, who));
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
    return ok(request, env, await state(env, who));
  }
  const gm = /^\/admin\/staff-groups\/(\d{1,9})$/.exec(path);
  if (gm && method === 'DELETE') {
    const id = Number(gm[1]);
    if (!(await groupExists(env, id))) return fail(request, env, 'not_found', '找不到這個權限組。');
    const used = await first(env, 'SELECT COUNT(*) AS n FROM staff WHERE grp = ?', id);
    if (used && used.n) return bad(request, env, '還有 ' + used.n + ' 人在這個權限組，先把他們改到別組才能刪除。');
    await run(env, 'DELETE FROM staff_groups WHERE id = ?', id);
    return ok(request, env, await state(env, who));
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
