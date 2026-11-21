// 管理頁權限分層：系統管理者（admin 憑證＝已解鎖、系統管理者員工登入＝未解鎖）／管理者／普通；路由對應卡片；名單部分權限；層級權限表
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, permMod, levelsMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const perm = async () => (permMod = permMod || (await import('../../server/core/adminperm.js')));
const lvm = async () => (levelsMod = levelsMod || (await import('../../server/core/levels.js')));

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

// 名單：M1 管理者（發文組）、M2 管理者、U1 普通（發文組）、U2 普通（檢視組）
async function setup(t) {
  const f = installFetch({ 'GET /me/accounts': () => ({ data: [] }) }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'U', SYS_STAFF_ID: 'SYS1' });
  const sys = await sign(env, 'admin');
  const d = (await call(env, '/admin/staff', { headers: sys })).body.data;
  const g = { 管理: gid(d, '管理'), 發文: gid(d, '發文'), 檢視: gid(d, '檢視') };
  for (const [id, level, grp] of [['M1', 'mgr', '發文'], ['M2', 'mgr', '發文'], ['U1', 'user', '發文'], ['U2', 'user', '檢視']]) {
    assert.equal((await post(env, sys, '/admin/staff', { id, name: id, group: g[grp], level })).status, 200);
  }
  return { env, sys, g, adm: await sign(env, 'company', false, 'SYS1'), old: await sign(env, 'company', true), co: await sign(env, 'company'), m1: await sign(env, 'company', false, 'M1'), u1: await sign(env, 'company', false, 'U1') };
}

test('每條已知 /admin/* 路由都有對應卡片；staff-groups 不會被當成 staff', async () => {
  const { cardFor } = await perm();
  const paths = { '/admin/levels': 'levels', '/admin/fb/access': 'access', '/admin/fb/profiles': 'profiles', '/admin/fb/profiles/p1': 'profiles', '/admin/fb/profiles/p1/activate': 'profiles',
    '/admin/fb/status': 'fbconn', '/admin/fb/token': 'fbconn', '/admin/fb/app': 'fbconn', '/admin/fb/refresh': 'fbconn', '/admin/fb/webhook': 'webhook', '/admin/fb/usage': 'usage', '/admin/fb/usage/refresh': 'usage',
    '/admin/fb/pages': 'pages', '/admin/fb/presets': 'presets', '/admin/fb/video-settings': 'video', '/admin/staff-groups': 'groups', '/admin/staff-groups/3': 'groups', '/admin/staff': 'staff', '/admin/staff/T1': 'staff',
    '/admin/audit': 'audit', '/admin/rundown': 'rundown', '/admin/rundown/ping': 'rundown', '/admin/assets': 'assets', '/admin/assets/logo': 'assets', '/admin/logs': 'logs' };
  for (const [p, k] of Object.entries(paths)) assert.equal(cardFor(p), k, p);
  assert.equal(cardFor('/admin/fb/somethingnew'), null);
  assert.equal(cardFor('/admin/staffx'), null);
});

test('身分：admin 憑證全開；adm:1 擋敏感卡片；公司密碼憑證 401；普通沒有卡片 /admin/me 403', async (t) => {
  const { env, sys, adm, old, co, m1, u1 } = await setup(t);
  assert.equal((await call(env, '/admin/me', { headers: old })).status, 401, '舊版 adm:1 憑證已失效');
  const me = (await call(env, '/admin/me', { headers: sys })).body.data;
  assert.equal(me.role, 'sys'); assert.equal(me.unlocked, true); assert.ok(me.cards.includes('levels'));
  const am = (await call(env, '/admin/me', { headers: adm })).body.data;
  assert.equal(am.role, 'sys'); assert.equal(am.unlocked, false);
  for (const k of ['access', 'profiles', 'fbconn', 'webhook', 'groups', 'levels']) assert.ok(!am.cards.includes(k), k);
  for (const p of ['/admin/fb/token', '/admin/fb/status', '/admin/fb/profiles', '/admin/fb/webhook', '/admin/staff-groups', '/admin/levels']) assert.equal((await call(env, p, { headers: adm })).status, 403, p);
  assert.equal((await call(env, '/admin/fb/somethingnew', { headers: adm })).status, 403, '未對應路徑只給已解鎖');
  assert.equal((await call(env, '/admin/fb/somethingnew', { headers: sys })).status, 404);
  assert.equal((await call(env, '/admin/logs', { headers: adm })).status, 200);
  assert.equal((await call(env, '/admin/me', { headers: co })).status, 401);
  assert.equal((await call(env, '/admin/logs', { headers: co })).status, 401);
  const mm = (await call(env, '/admin/me', { headers: m1 })).body.data;
  assert.equal(mm.role, 'mgr'); assert.equal(mm.id, 'M1');
  assert.deepEqual(mm.cards, ['guard', 'fbstate', 'usage', 'pages', 'presets', 'video', 'bg', 'staff', 'audit', 'rundown', 'assets', 'logs']);
  assert.equal((await call(env, '/admin/fb/token', { headers: m1 })).status, 403);
  assert.equal((await call(env, '/admin/fb/access', { headers: m1 })).status, 403, '排程發布開關只有系統管理者');
  assert.equal((await call(env, '/admin/fb/access', { headers: adm })).status, 403, '系統管理者也要解鎖');
  assert.equal((await call(env, '/admin/fb/conn', { headers: m1 })).status, 200, '管理者看得到粉專連線狀態');
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 200);
  assert.equal((await call(env, '/admin/me', { headers: u1 })).status, 403);
  assert.equal((await call(env, '/admin/logs', { headers: u1 })).status, 403);
  // /auth/status manage
  assert.equal((await call(env, '/auth/status', { headers: m1 })).body.data.manage, true);
  assert.equal((await call(env, '/auth/status', { headers: m1 })).body.data.staff.level, 'mgr');
  assert.equal((await call(env, '/auth/status', { headers: u1 })).body.data.manage, false);
  assert.equal((await call(env, '/auth/status', { headers: co })).status, 401, '沒有員工編號的舊公司憑證無效');
});

test('停用、移除、降層級立即生效', async (t) => {
  const { env, sys, m1 } = await setup(t);
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 200);
  await post(env, sys, '/admin/staff/M1', { level: 'user' });
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 403);
  await post(env, sys, '/admin/staff/M1', { level: 'mgr' });
  await post(env, sys, '/admin/staff/M1', { enabled: false });
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 401);
});

test('名單：管理者只能動普通、不能動自己與其他管理者、不能設層級、不能指派超出自己權限組的組', async (t) => {
  const { env, sys, adm, g, m1 } = await setup(t);
  const st = (await call(env, '/admin/staff', { headers: m1 })).body.data;
  assert.deepEqual(st.staff.map((s) => [s.id, s.canEdit]), [['M1', false], ['M2', false], ['SYS1', false], ['U1', true], ['U2', true]]);
  assert.deepEqual(st.groups.map((x) => [x.name, x.assignable]), [['管理', false], ['發文', true], ['檢視', true]]);
  assert.equal(st.me.canLevel, false); assert.equal(st.me.canAdd, true);
  assert.equal((await post(env, m1, '/admin/staff/M1', { name: '自己' })).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/M2', { name: '同層' })).status, 403);
  assert.equal((await del(env, m1, '/admin/staff/M2')).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/U1', { level: 'mgr' })).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/U1', { group: g.管理 })).status, 403, '不能升到含 bypass 的組');
  assert.equal((await post(env, m1, '/admin/staff/U2', { group: g.發文 })).status, 200);
  assert.equal((await post(env, m1, '/admin/staff/U1', { name: '改名', contact: '1234' })).status, 200);
  assert.equal((await post(env, m1, '/admin/staff', { id: 'N1', name: 'N1', group: g.發文, level: 'mgr' })).status, 403);
  assert.equal((await post(env, m1, '/admin/staff', { id: 'N1', name: 'N1', group: g.管理 })).status, 403);
  const add = await post(env, m1, '/admin/staff', { id: 'N1', name: 'N1', group: g.檢視 });
  assert.equal(add.status, 200); assert.equal(add.body.data.staff.find((s) => s.id === 'N1').level, 'user');
  assert.equal((await post(env, m1, '/admin/staff', { id: 'M2', name: 'x', group: g.檢視 })).status, 400, '編號已存在');
  assert.equal((await del(env, m1, '/admin/staff/N1')).status, 200);
  // 系統管理者未解鎖：可以改人，但不能改層級
  assert.equal((await post(env, adm, '/admin/staff/M2', { name: '改' })).status, 200);
  assert.equal((await post(env, adm, '/admin/staff/U1', { level: 'mgr' })).status, 403);
  assert.equal((await post(env, sys, '/admin/staff/U1', { level: 'mgr' })).status, 200);
  assert.equal((await post(env, sys, '/admin/staff/U1', { level: 'boss' })).status, 400);
});

test('普通拿到授權名單卡片也只能看；管理者被勾了敏感卡片可用，但 levels 永遠不行', async (t) => {
  const { env, sys, g, m1, u1 } = await setup(t);
  const r = await post(env, sys, '/admin/levels', { mgr: ['staff', 'fbconn', 'levels'], user: ['staff'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.levels, { mgr: ['fbconn', 'staff'], user: ['staff'] });
  const st = (await call(env, '/admin/staff', { headers: u1 })).body.data;
  assert.ok(st.staff.every((s) => !s.canEdit)); assert.equal(st.me.canAdd, false);
  assert.equal((await post(env, u1, '/admin/staff/U2', { name: 'x' })).status, 403);
  assert.equal((await post(env, u1, '/admin/staff', { id: 'N2', name: 'N2', group: g.檢視 })).status, 403);
  assert.equal((await call(env, '/admin/fb/status', { headers: m1 })).status, 200);
  assert.equal((await call(env, '/admin/levels', { headers: m1 })).status, 403);
  assert.equal((await call(env, '/admin/logs', { headers: m1 })).status, 403, '沒勾的卡片擋下');
});

test('層級權限表：存檔普通併入管理者、剔除 levels 與未知卡片；讀取時壞值修正', async (t) => {
  const { env, sys } = await setup(t);
  const { normLevels, DEFAULT_LEVELS } = await lvm();
  assert.deepEqual(normLevels(null), DEFAULT_LEVELS);
  assert.deepEqual(normLevels({ mgr: ['logs'], user: ['logs', 'assets', 'levels'] }), { mgr: ['logs'], user: ['logs'] });
  assert.deepEqual(normLevels({ mgr: 'bad', user: ['logs', 'x'] }), { mgr: DEFAULT_LEVELS.mgr, user: ['logs'] });
  assert.deepEqual(normLevels({ mgr: ['levels', 'zzz'], user: [] }), { mgr: [], user: [] });
  const bad = await post(env, sys, '/admin/levels', { mgr: 'x', user: [] });
  assert.equal(bad.status, 400);
  // D1 被手動改壞
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
  await env.DB.prepare("INSERT INTO fb_settings (k, v, updated) VALUES ('admin_levels', ?, 0) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind('{"mgr":["logs"],"user":["logs","levels","assets"]}').run();
  const g = (await call(env, '/admin/levels', { headers: sys })).body.data;
  assert.deepEqual(g.levels, { mgr: ['logs'], user: ['logs'] });
  assert.ok(g.cards.find((c) => c.key === 'levels').locked);
});

test('?p=<組別> 只有系統管理者能指定', async (t) => {
  const { env, sys, m1 } = await setup(t);
  await post(env, sys, '/admin/levels', { mgr: ['fbconn'], user: [] });
  assert.equal((await call(env, '/admin/fb/status?p=pzz', { headers: sys })).status, 400, '系統管理者指定不存在的組別會被檢查');
  assert.equal((await call(env, '/admin/fb/status?p=pzz', { headers: m1 })).status, 200, '其他人的 ?p 被忽略');
});

test('重置／停用／刪除：對方權限組比自己多（含 bypass）就 403；系統管理者不受限', async (t) => {
  const { env, sys, g, m1 } = await setup(t);
  assert.equal((await post(env, sys, '/admin/staff', { id: 'U3', name: 'U3', group: g.管理 })).status, 200);
  assert.equal((await post(env, m1, '/admin/staff/U3/reset', null)).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/U3', { enabled: false })).status, 403);
  assert.equal((await del(env, m1, '/admin/staff/U3')).status, 403);
  assert.equal((await post(env, m1, '/admin/staff/U1/reset', null)).status, 200);
  assert.equal((await post(env, sys, '/admin/staff/U3/reset', null)).status, 200);
  assert.equal((await post(env, m1, '/admin/staff', { id: 'sys1', name: 'x', group: g.檢視 })).status, 400, '系統管理者編號不能被新增');
});
