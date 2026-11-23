// 管理頁權限：系統管理者（admin 憑證＝已解鎖、系統管理者員工登入＝未解鎖）／其他員工（權限組裡的 card:<key>）；
//   路由對應卡片；名單部分權限（子集規則）；姓名只有系統管理者能改；舊資料搬移
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, permMod, staffMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const perm = async () => (permMod = permMod || (await import('../../server/core/adminperm.js')));
const stm = async () => (staffMod = staffMod || (await import('../../server/core/staff.js')));

async function call(env, path, init = {}) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}
// 員工憑證帶 pv 1（剛新增、還沒改過密碼的版本）
const sign = async (env, kind, adm = false, uid = '', pv = 1) => { const { signToken } = await tok(); return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, adm, uid, pv)) }; };
const post = (env, h, path, body) => call(env, path, { method: 'POST', headers: h, body: JSON.stringify(body) });
const del = (env, h, path) => call(env, path, { method: 'DELETE', headers: h });
const gid = (d, name) => d.groups.find((g) => g.name === name).id;

// 權限組：主管（含管理頁 3 張卡片）、發文（主管的真子集）、檢視、同級（和主管完全相同，順序不同）
const MGR_PERMS = ['view', 'post', 'edit', 'delete', 'vview', 'vpost', 'report', 'card:fbstate', 'card:staff', 'card:logs'];
// 名單：M1／M2 主管、U1 發文、U2 檢視、S1 同級
async function setup(t) {
  const f = installFetch({ 'GET /me/accounts': () => ({ data: [] }) }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'U', SYS_STAFF_ID: 'SYS1' });
  const sys = await sign(env, 'admin');
  assert.equal((await post(env, sys, '/admin/staff-groups', { name: '主管', perms: MGR_PERMS })).status, 200);
  assert.equal((await post(env, sys, '/admin/staff-groups', { name: '同級', perms: MGR_PERMS.slice().reverse() })).status, 200);
  const d = (await call(env, '/admin/staff', { headers: sys })).body.data;
  const g = { 管理: gid(d, '管理'), 發文: gid(d, '發文'), 檢視: gid(d, '檢視'), 主管: gid(d, '主管'), 同級: gid(d, '同級') };
  for (const [id, grp] of [['M1', '主管'], ['M2', '主管'], ['U1', '發文'], ['U2', '檢視'], ['S1', '同級']]) {
    assert.equal((await post(env, sys, '/admin/staff', { id, name: id, group: g[grp] })).status, 200);
  }
  return { env, sys, g, adm: await sign(env, 'company', false, 'SYS1'), old: await sign(env, 'company', true), co: await sign(env, 'company'), m1: await sign(env, 'company', false, 'M1'), u1: await sign(env, 'company', false, 'U1') };
}

test('每條已知 /admin/* 路由都有對應卡片；staff-groups 不會被當成 staff；層級權限已拿掉', async () => {
  const { cardFor } = await perm();
  const paths = { '/admin/fb/access': 'access', '/admin/fb/profiles': 'profiles', '/admin/fb/profiles/p1': 'profiles', '/admin/fb/profiles/p1/activate': 'profiles',
    '/admin/fb/status': 'fbconn', '/admin/fb/token': 'fbconn', '/admin/fb/app': 'fbconn', '/admin/fb/refresh': 'fbconn', '/admin/fb/webhook': 'webhook', '/admin/fb/usage': 'usage', '/admin/fb/usage/refresh': 'usage',
    '/admin/fb/pages': 'pages', '/admin/fb/presets': 'presets', '/admin/fb/video-settings': 'video', '/admin/staff-groups': 'groups', '/admin/staff-groups/3': 'groups', '/admin/staff': 'staff', '/admin/staff/T1': 'staff',
    '/admin/audit': 'audit', '/admin/rundown': 'rundown', '/admin/rundown/ping': 'rundown', '/admin/assets': 'assets', '/admin/assets/logo': 'assets', '/admin/logs': 'logs' };
  for (const [p, k] of Object.entries(paths)) assert.equal(cardFor(p), k, p);
  assert.equal(cardFor('/admin/fb/somethingnew'), null);
  assert.equal(cardFor('/admin/staffx'), null);
  assert.equal(cardFor('/admin/levels'), null, '/admin/levels 已刪除');
});

test('身分：admin 憑證全開；系統管理者員工登入擋敏感卡片；舊憑證 401；卡片由權限組決定', async (t) => {
  const { env, sys, adm, old, co, m1, u1 } = await setup(t);
  assert.equal((await call(env, '/admin/me', { headers: old })).status, 401, '舊版 adm:1 憑證已失效');
  const me = (await call(env, '/admin/me', { headers: sys })).body.data;
  assert.equal(me.role, 'sys'); assert.equal(me.unlocked, true); assert.ok(me.cards.includes('groups')); assert.ok(!me.cards.includes('levels'));
  const am = (await call(env, '/admin/me', { headers: adm })).body.data;
  assert.equal(am.role, 'sys'); assert.equal(am.unlocked, false);
  for (const k of ['access', 'profiles', 'fbconn', 'webhook', 'groups']) assert.ok(!am.cards.includes(k), k);
  for (const p of ['/admin/fb/token', '/admin/fb/status', '/admin/fb/profiles', '/admin/fb/webhook', '/admin/staff-groups']) assert.equal((await call(env, p, { headers: adm })).status, 403, p);
  assert.equal((await call(env, '/admin/levels', { headers: sys })).status, 404, '層級權限路由已刪除');
  assert.equal((await call(env, '/admin/fb/somethingnew', { headers: adm })).status, 403, '未對應路徑只給已解鎖');
  assert.equal((await call(env, '/admin/fb/somethingnew', { headers: sys })).status, 404);
  assert.equal((await call(env, '/admin/logs', { headers: adm })).status, 200);
  assert.equal((await call(env, '/admin/me', { headers: co })).status, 401);
  const mm = (await call(env, '/admin/me', { headers: m1 })).body.data;
  assert.equal(mm.role, 'staff'); assert.equal(mm.roleName, '主管'); assert.equal(mm.id, 'M1');
  assert.deepEqual(mm.cards, ['fbstate', 'staff', 'logs']);
  assert.equal((await call(env, '/admin/fb/token', { headers: m1 })).status, 403);
  assert.equal((await call(env, '/admin/fb/access', { headers: m1 })).status, 403, '排程發布開關只有系統管理者');
  assert.equal((await call(env, '/admin/fb/conn', { headers: m1 })).status, 200);
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 200);
  assert.equal((await call(env, '/admin/audit', { headers: m1 })).status, 403, '沒勾的卡片擋下');
  assert.equal((await call(env, '/admin/me', { headers: u1 })).status, 403);
  assert.equal((await call(env, '/admin/logs', { headers: u1 })).status, 403);
  assert.equal((await call(env, '/auth/status', { headers: m1 })).body.data.manage, true);
  assert.equal((await call(env, '/auth/status', { headers: u1 })).body.data.manage, false, '權限組沒有任何 card: 就沒有管理頁入口');
  assert.equal((await call(env, '/auth/status', { headers: adm })).body.data.manage, true, '系統管理者一律有入口');
  assert.equal((await call(env, '/auth/status', { headers: co })).status, 401, '沒有員工編號的舊公司憑證無效');
});

test('停用、移除、換權限組、改權限立即生效', async (t) => {
  const { env, sys, g, m1 } = await setup(t);
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 200);
  await post(env, sys, '/admin/staff/M1', { group: g.發文 });
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 403);
  await post(env, sys, '/admin/staff/M1', { group: g.主管 });
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 200);
  await post(env, sys, '/admin/staff-groups', { id: g.主管, name: '主管', perms: MGR_PERMS.filter((p) => p !== 'card:logs') });
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 403, '改權限組立即生效');
  await post(env, sys, '/admin/staff/M1', { enabled: false });
  assert.equal((await call(env, '/admin/fb/conn', { headers: m1 })).status, 401);
});

test('名單：只能動權限是自己真子集的人、不能動自己與同級、指派只能是自己的子集', async (t) => {
  const { env, sys, adm, g, m1 } = await setup(t);
  const st = (await call(env, '/admin/staff', { headers: m1 })).body.data;
  assert.deepEqual(st.staff.map((s) => [s.id, s.canEdit]), [['M1', false], ['M2', false], ['S1', false], ['SYS1', false], ['U1', true], ['U2', true]]);
  assert.deepEqual(st.groups.map((x) => [x.name, x.assignable]), [['管理', false], ['發文', true], ['檢視', true], ['主管', true], ['同級', true]]);
  assert.equal(st.me.canRename, false); assert.equal(st.me.canAdd, true);
  assert.ok(st.sections.some((x) => x.name === '影片發布' && x.keys.join() === 'vview,vpost'));
  assert.ok(!('level' in st.staff[0]), '沒有層級欄');
  assert.equal((await post(env, m1, '/admin/staff/M1', { contact: '1' })).status, 403, '不能動自己');
  assert.equal((await post(env, m1, '/admin/staff/M2', { contact: '1' })).status, 403, '同權限的人不能動');
  assert.equal((await post(env, m1, '/admin/staff/S1', { contact: '1' })).status, 403, '權限完全相同（順序不同）也不能動');
  assert.equal((await del(env, m1, '/admin/staff/M2')).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/SYS1', { contact: '1' })).status, 403, '不能動系統管理者');
  assert.equal((await post(env, m1, '/admin/staff/U1', { group: g.管理 })).status, 403, '不能升到權限比自己多的組');
  assert.equal((await post(env, m1, '/admin/staff/U2', { group: g.發文 })).status, 200);
  assert.equal((await post(env, m1, '/admin/staff/U1', { contact: '1234' })).status, 200);
  assert.equal((await post(env, m1, '/admin/staff/U1', { name: '改名' })).status, 403, '只有系統管理者能改姓名');
  assert.equal((await post(env, m1, '/admin/staff', { id: 'N1', name: 'N1', group: g.管理 })).status, 403);
  const add = await post(env, m1, '/admin/staff', { id: 'N1', name: 'N1', group: g.檢視 });
  assert.equal(add.status, 200); assert.ok(add.body.data.setup.code);
  assert.equal((await post(env, m1, '/admin/staff', { id: 'M2', name: 'x', group: g.檢視 })).status, 400, '編號已存在');
  assert.equal((await del(env, m1, '/admin/staff/N1')).status, 200);
  assert.equal((await post(env, adm, '/admin/staff/M2', { contact: '9' })).status, 200, '系統管理者未解鎖也不受限');
  assert.equal((await post(env, sys, '/admin/staff/S1', { group: g.管理 })).status, 200);
});

test('姓名：只有系統管理者能改（含自己），1～20 字，寫操作紀錄 staff_rename', async (t) => {
  const { env, sys, adm, m1 } = await setup(t);
  assert.equal((await post(env, m1, '/admin/staff/U1', { name: '改名' })).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/M1', { name: '改名' })).status, 403);
  assert.equal((await post(env, adm, '/admin/staff/U1', { name: '   ' })).status, 400);
  assert.equal((await post(env, adm, '/admin/staff/U1', { name: 'x'.repeat(21) })).status, 400);
  const r = await post(env, adm, '/admin/staff/U1', { name: '  王小明  ' });
  assert.equal(r.status, 200); assert.equal(r.body.data.staff.find((s) => s.id === 'U1').name, '王小明');
  const me = await post(env, adm, '/admin/staff/SYS1', { name: '小編主管' });
  assert.equal(me.status, 200); assert.equal(me.body.data.staff.find((s) => s.id === 'SYS1').name, '小編主管', 'SYS_STAFF_ID 本人也能改');
  assert.equal((await post(env, adm, '/admin/staff/SYS1', { enabled: false })).status, 403, '仍不能停用');
  const rows = (await call(env, '/admin/audit?days=1', { headers: sys })).body.data.filter((x) => x.action === 'staff_rename');
  assert.equal(rows.length, 2);
  const u1 = rows.find((x) => x.post === 'U1');
  assert.equal(u1.detail, 'U1→王小明'); assert.equal(u1.uid, 'SYS1');
  assert.equal((await post(env, adm, '/admin/staff/U1', { name: '王小明' })).status, 200);
  assert.equal((await call(env, '/admin/audit?days=1', { headers: sys })).body.data.filter((x) => x.action === 'staff_rename').length, 2, '沒改就不記');
});

// 舊版資料庫：3 個權限組＋舊 admin_levels；第一次讀取時搬移一次
async function oldEnv(t, levelsJson) {
  const f = installFetch({}); t.after(f.restore);
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  const now = Date.now();
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).run();
  await q("ALTER TABLE staff ADD COLUMN level TEXT NOT NULL DEFAULT 'user'");   // 舊版 schema.sql 已建表，level 是後來補的欄位
  await q('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)');
  await q("INSERT INTO staff_groups (name, perms, ord, updated) VALUES ('管理', ?, 0, ?)", JSON.stringify(['view', 'post', 'edit', 'delete', 'bypass']), now);
  await q("INSERT INTO staff_groups (name, perms, ord, updated) VALUES ('檢視', ?, 1, ?)", JSON.stringify(['view']), now);
  await q("INSERT INTO staff_groups (name, perms, ord, updated) VALUES ('空', ?, 2, ?)", JSON.stringify([]), now);
  await q("INSERT INTO staff (id, name, grp, level, created, updated) VALUES ('A1', 'A', 1, 'mgr', ?, ?)", now, now);
  await q("INSERT INTO staff (id, name, grp, level, created, updated) VALUES ('B1', 'B', 2, 'user', ?, ?)", now, now);
  await q("INSERT INTO staff (id, name, grp, level, created, updated) VALUES ('C1', 'C', 3, 'user', ?, ?)", now, now);
  if (levelsJson) await q("INSERT INTO fb_settings (k, v, updated) VALUES ('admin_levels', ?, 0)", levelsJson);
  return env;
}

test('舊資料搬移：post→vpost、view→vview＋report、有 mgr 成員的組補舊管理者卡片、其他補舊普通卡片；只做一次', async (t) => {
  const env = await oldEnv(t, JSON.stringify({ mgr: ['logs', 'staff', 'fbconn', 'levels'], user: ['assets'] }));
  const { findStaff, MIGRATE_KEY, DASH_PERMS } = await stm();
  const a1 = await findStaff(env, 'A1'), b1 = await findStaff(env, 'B1'), c1 = await findStaff(env, 'C1');
  // 首頁儀表板（perms_v3）：有 card:staff 的組補全部 dash:*，其他組不動
  assert.deepEqual(a1.perms, ['view', 'post', 'edit', 'delete', 'vview', 'vpost', 'report', 'bypass', 'card:staff', 'card:logs', ...DASH_PERMS], '敏感卡片 fbconn 與 levels 不搬');
  assert.deepEqual(b1.perms, ['view', 'vview', 'report', 'card:assets']);
  assert.deepEqual(c1.perms, ['card:assets']);
  assert.equal(a1.level, 'staff');
  const mark = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(MIGRATE_KEY).first();
  assert.equal(mark.v, '1');
  // 只做一次：事後手動改回去，不會再被補
  await env.DB.prepare('UPDATE staff_groups SET perms = ? WHERE id = 2').bind(JSON.stringify(['view'])).run();
  assert.deepEqual((await findStaff(env, 'B1')).perms, ['view']);
});

test('舊資料搬移：讀不到 admin_levels 用舊預設管理者清單；全新安裝不搬', async (t) => {
  const env = await oldEnv(t, null);
  const { findStaff, DEFAULT_GROUPS } = await stm();
  const a1 = await findStaff(env, 'A1');
  for (const k of ['guard', 'fbstate', 'usage', 'pages', 'presets', 'video', 'bg', 'staff', 'audit', 'rundown', 'assets', 'logs']) assert.ok(a1.perms.includes('card:' + k), k);
  assert.deepEqual((await findStaff(env, 'C1')).perms, [], '舊普通預設沒有卡片');
  // 全新安裝：預設組原樣
  const f = installFetch({}); t.after(f.restore);
  const env2 = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  const sys = await sign(env2, 'admin');
  const d = (await call(env2, '/admin/staff', { headers: sys })).body.data;
  assert.deepEqual(d.groups.map((x) => [x.name, x.perms]), DEFAULT_GROUPS.map((x) => [x.name, x.perms]));
  const all = d.groups.find((x) => x.name === '管理').perms;
  assert.ok(all.includes('bypass') && all.includes('vpost') && all.includes('report') && all.includes('card:bg'));
  assert.ok(!all.includes('card:groups') && !all.includes('card:access'), '敏感卡片不能勾');
  assert.deepEqual(d.groups.find((x) => x.name === '檢視').perms, ['view', 'vview', 'report']);
  assert.deepEqual(d.groups.find((x) => x.name === '發文').perms, ['view', 'post', 'edit', 'delete', 'vview', 'vpost', 'report']);
});

test('?p=<組別> 只有系統管理者能指定', async (t) => {
  const { env, sys, g } = await setup(t);
  await post(env, sys, '/admin/staff-groups', { id: g.主管, name: '主管', perms: [...MGR_PERMS, 'card:usage'] });
  await post(env, sys, '/admin/staff-groups', { id: g.發文, name: '發文', perms: ['view', 'card:staff'] });
  const m1 = await sign(env, 'company', false, 'M1');
  assert.equal((await call(env, '/admin/fb/status?p=pzz', { headers: sys })).status, 400, '系統管理者指定不存在的組別會被檢查');
  assert.equal((await call(env, '/admin/fb/usage', { headers: m1 })).status, 200);
});

test('重置／停用／刪除：對方權限不是自己的真子集就 403；系統管理者不受限', async (t) => {
  const { env, sys, g, m1 } = await setup(t);
  assert.equal((await post(env, sys, '/admin/staff', { id: 'U3', name: 'U3', group: g.管理 })).status, 200);
  assert.equal((await post(env, m1, '/admin/staff/U3/reset', null)).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/U3', { enabled: false })).status, 403);
  assert.equal((await del(env, m1, '/admin/staff/U3')).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/M2/reset', null)).status, 403, '同級不能重置');
  assert.equal((await post(env, m1, '/admin/staff/U1/reset', null)).status, 200);
  assert.equal((await post(env, sys, '/admin/staff/U3/reset', null)).status, 200);
  assert.equal((await post(env, m1, '/admin/staff', { id: 'sys1', name: 'x', group: g.檢視 })).status, 400, '系統管理者編號不能被新增');
});

test('canManage 純函式：真子集才行，自己與系統管理者不行', async () => {
  const { canManage } = await stm();
  const who = { role: 'staff', uid: 'M', staff: { perms: ['view', 'post', 'card:staff'] } };
  const env = { SYS_STAFF_ID: 'SYS1' };
  assert.equal(canManage(who, 'X', ['view'], env), true);
  assert.equal(canManage(who, 'X', [], env), true);
  assert.equal(canManage(who, 'X', ['post', 'view', 'card:staff'], env), false, '完全相同');
  assert.equal(canManage(who, 'X', ['view', 'edit'], env), false, '有自己沒有的');
  assert.equal(canManage(who, 'M', ['view'], env), false, '自己');
  assert.equal(canManage(who, 'SYS1', [], env), false, '系統管理者');
  assert.equal(canManage({ role: 'sys', unlocked: false }, 'SYS1', ['view'], env), true);
});
