// 授權名單：管理 API、員工編號登入、立即撤銷、權限組、開放／關閉、操作紀錄
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, staffMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const sm = async () => (staffMod = staffMod || (await import('../../server/core/staff.js')));
const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }] };

async function call(env, path, init = {}) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
async function adminH(env) {
  const { signToken } = await tok();
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)) };
}
const post = (env, h, path, body) => call(env, path, { method: 'POST', headers: h, body: JSON.stringify(body) });
const bearer = (t) => ({ authorization: 'Bearer ' + t });
// 員工登入：已設密碼就用 PW；還沒設就由管理頁重置拿設定碼，再設 PW 並登入
const PW = 'password-123';
async function login(env, staffId) {
  const q = await call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId }) });
  if (!q.body.ok) return q;
  if (q.body.data.next === 'password') return call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId, password: PW }) });
  const r = await call(env, '/admin/staff/' + encodeURIComponent(staffId) + '/reset', { method: 'POST', headers: await adminH(env) });
  return call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId, code: r.body.data.setup.code, newPassword: PW }) });
}
async function setup(t) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'U' });
  return { f, env, adm: await adminH(env) };
}
const groupId = (d, name) => d.groups.find((g) => g.name === name).id;

test('管理 API：要管理憑證；預設 3 組權限組；新增驗證、編號轉大寫、不能重複', async (t) => {
  const { env, adm } = await setup(t);
  assert.equal((await call(env, '/admin/staff')).status, 401);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  assert.deepEqual(body.data.groups.map((g) => [g.name, g.perms]), [['管理', ['view', 'post', 'edit', 'delete', 'bypass']], ['發文', ['view', 'post', 'edit', 'delete']], ['檢視', ['view']]]);
  assert.equal(body.data.perms.length, 5);
  const g = groupId(body.data, '發文');
  assert.equal((await post(env, adm, '/admin/staff', { id: 'a 1', name: '甲', group: g })).status, 400);
  assert.equal((await post(env, adm, '/admin/staff', { id: 'A1', name: '', group: g })).status, 400);
  assert.equal((await post(env, adm, '/admin/staff', { id: 'A1', name: '字'.repeat(21), group: g })).status, 400);
  assert.equal((await post(env, adm, '/admin/staff', { id: 'A1', name: '甲', group: 999 })).status, 400);
  const ok = await post(env, adm, '/admin/staff', { id: ' t0123 ', name: ' 王小明 ', group: g });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data.staff.map((s) => [s.id, s.name, s.group, s.enabled]), [['T0123', '王小明', g, true]]);
  const dup = await post(env, adm, '/admin/staff', { id: 'T0123', name: '乙', group: g });
  assert.equal(dup.status, 400); assert.match(dup.body.error, /已在名單內/);
});

test('員工編號登入：名單內才發憑證（帶 uid、轉大寫）、記最後登入；查不到或停用回 bad_staff', async (t) => {
  const { env, adm } = await setup(t);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  await post(env, adm, '/admin/staff', { id: 'T1', name: '王小明', group: groupId(body.data, '發文') });
  const bad = await login(env, 'NOPE');
  assert.equal(bad.body.ok, false); assert.equal(bad.body.code, 'bad_staff');
  const r = await login(env, 't1');
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.data.staff, { id: 'T1', name: '王小明', group: '發文', level: 'user' });
  assert.equal(r.body.data.manage, false);
  const { readToken } = await tok();
  assert.equal((await readToken(env.SESSION_SECRET, r.body.data.token, nowSec())).uid, 'T1');
  const st = await call(env, '/auth/status', { headers: bearer(r.body.data.token) });
  assert.deepEqual(st.body.data.staff, { id: 'T1', name: '王小明', group: '發文', level: 'user' });
  assert.equal(st.body.data.manage, false, '普通預設沒有卡片');
  assert.ok((await call(env, '/admin/staff', { headers: adm })).body.data.staff[0].lastLogin > 0);
  // 停用後不能登入
  await post(env, adm, '/admin/staff/T1', { enabled: false });
  assert.equal((await login(env, 'T1')).body.code, 'bad_staff');
  // 公司密碼登入已拿掉
  assert.equal((await call(env, '/auth', { method: 'POST', body: JSON.stringify({ password: 'company-pass-123' }) })).status, 400);
});

test('立即撤銷：停用或移除後，原本的憑證連 /auth/status、公司素材、排程發布都失效；重新啟用恢復', async (t) => {
  const { env, adm } = await setup(t);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  await post(env, adm, '/admin/fb/access', { mode: 'company' });
  await post(env, adm, '/admin/staff', { id: 'T1', name: '甲', group: groupId(body.data, '發文') });
  const h = bearer((await login(env, 'T1')).body.data.token);
  assert.equal((await call(env, '/fb/pages', { headers: h })).status, 200);
  await post(env, adm, '/admin/staff/T1', { enabled: false });
  assert.equal((await call(env, '/auth/status', { headers: h })).status, 401);
  assert.equal((await call(env, '/fb/pages', { headers: h })).status, 401);
  await post(env, adm, '/admin/staff/T1', { enabled: true });
  assert.equal((await call(env, '/fb/pages', { headers: h })).status, 200);
  assert.equal((await call(env, '/admin/staff/T1', { method: 'DELETE', headers: adm })).status, 200);
  assert.equal((await call(env, '/auth/status', { headers: h })).status, 401);
  assert.equal((await call(env, '/admin/staff/T1', { method: 'DELETE', headers: adm })).status, 404);
});

test('續期保留員工編號', async (t) => {
  const { env, adm } = await setup(t);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  await post(env, adm, '/admin/staff', { id: 'T1', name: '甲', group: groupId(body.data, '檢視') });
  const { signToken, readToken } = await tok();
  const old = await signToken(env.SESSION_SECRET, 'company', nowSec() + 60, false, 'T1', 1);   // 剩不到一半效期
  const st = await call(env, '/auth/status', { headers: bearer(old) });
  assert.ok(st.body.data.renew);
  assert.equal((await readToken(env.SESSION_SECRET, st.body.data.renew.token, nowSec())).uid, 'T1');
});

test('權限組：檢視組不能發文／改時間／刪除；/fb/me 回權限；改權限組立即生效', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/fb/access', { mode: 'company' });
  await post(env, adm, '/admin/staff', { id: 'V1', name: '看', group: groupId(d, '檢視') });
  const h = bearer((await login(env, 'V1')).body.data.token);
  const me = await call(env, '/fb/me', { headers: h });
  assert.deepEqual(me.body.data, { admin: false, id: 'V1', name: '看', group: '檢視', perms: ['view'], mode: 'company', tokenWarn: null });
  const fd = new FormData(); fd.set('message', 'x');
  const w = await load();
  const rp = await w.fetch(new Request('https://api.test/fb/post', { method: 'POST', headers: { origin: ORIGIN, ...h }, body: fd }), env, { waitUntil() {} });
  assert.equal(rp.status, 403); assert.equal((await rp.json()).code, 'fb_no_perm');
  assert.equal((await post(env, h, '/rundown', { items: [] })).body.code, 'fb_no_perm');
  assert.equal((await post(env, h, '/fb/posts/111_1/reschedule', { page: '111', at: nowSec() + 3600 })).body.code, 'fb_no_perm');
  assert.equal((await post(env, h, '/fb/posts/111_1/delete', { page: '111' })).body.code, 'fb_no_perm');
  // 改成可以改時間（自訂權限組）
  const g = await post(env, adm, '/admin/staff-groups', { name: '改時間', perms: ['view', 'edit', 'nope'] });
  assert.deepEqual(g.body.data.groups.find((x) => x.name === '改時間').perms, ['view', 'edit']);
  await post(env, adm, '/admin/staff/V1', { group: groupId(g.body.data, '改時間') });
  assert.deepEqual((await call(env, '/fb/me', { headers: h })).body.data.perms, ['view', 'edit']);
  assert.notEqual((await post(env, h, '/fb/posts/111_1/reschedule', { page: '111', at: 1 })).body.code, 'fb_no_perm');
  assert.equal((await post(env, h, '/fb/posts/111_1/delete', { page: '111' })).body.code, 'fb_no_perm');
});

test('關閉時：管理組（bypass）可用、發文組被擋並看到原因；管理員密碼一直可用', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/fb/access', { mode: 'admin', reason: '維護中' });
  await post(env, adm, '/admin/staff', { id: 'M1', name: '主管', group: groupId(d, '管理') });
  await post(env, adm, '/admin/staff', { id: 'P1', name: '小編', group: groupId(d, '發文') });
  const m = bearer((await login(env, 'M1')).body.data.token);
  const p = bearer((await login(env, 'P1')).body.data.token);
  assert.equal((await call(env, '/fb/pages', { headers: m })).status, 200);
  const r = await call(env, '/fb/pages', { headers: p });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'fb_forbidden'); assert.deepEqual(r.body.detail, { reason: '維護中' });
  const { signToken } = await tok();
  const a = bearer(await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, true));
  const me = await call(env, '/fb/me', { headers: a });
  assert.equal(me.body.data.admin, true); assert.equal(me.body.data.name, '管理員');
});

test('權限組管理：名稱不能重複、使用中不能刪、沒人用可刪', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  assert.match((await post(env, adm, '/admin/staff-groups', { name: '管理', perms: [] })).body.error, /已經有/);
  const view = groupId(d, '檢視');
  assert.match((await post(env, adm, '/admin/staff-groups', { id: view, name: '發文', perms: [] })).body.error, /已經有/);
  assert.equal((await post(env, adm, '/admin/staff-groups', { id: view, name: '只看', perms: ['view'] })).status, 200);
  await post(env, adm, '/admin/staff', { id: 'V1', name: '看', group: view });
  const del = await call(env, '/admin/staff-groups/' + view, { method: 'DELETE', headers: adm });
  assert.equal(del.status, 400); assert.match(del.body.error, /還有 1 人/);
  await call(env, '/admin/staff/V1', { method: 'DELETE', headers: adm });
  const ok = await call(env, '/admin/staff-groups/' + view, { method: 'DELETE', headers: adm });
  assert.equal(ok.status, 200); assert.ok(!ok.body.data.groups.some((g) => g.id === view));
});

test('操作紀錄：寫入、依編號篩選、管理憑證才能看、90 天清除', async (t) => {
  const { env, adm } = await setup(t);
  const { audit, cleanupAudit } = await sm();
  await audit(env, { uid: 'T1', name: '甲' }, 'publish', '111', '111_9');
  await audit(env, { uid: 'ADMIN', name: '管理員' }, 'delete', '111', '111_8');
  env.DB.raw.prepare("INSERT INTO fb_audit (at, uid, name, action) VALUES (?, 'T1', '甲', 'old')").run(Date.now() - 91 * 86400000);
  assert.equal((await call(env, '/admin/audit')).status, 401);
  const all = await call(env, '/admin/audit?days=90', { headers: adm });
  assert.deepEqual(all.body.data.map((r) => r.action), ['delete', 'publish']);
  assert.deepEqual((await call(env, '/admin/audit?uid=t1', { headers: adm })).body.data.map((r) => [r.uid, r.page, r.post]), [['T1', '111', '111_9']]);
  await cleanupAudit(env, Date.now());
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM fb_audit').get().n, 2);
});

test('分機：自己讀寫 /staff/me、格式驗證、只能改自己；公司密碼憑證不行；管理頁可改與新增時帶入', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  const g = groupId(d, '檢視');
  assert.equal((await post(env, adm, '/admin/staff', { id: 'C1', name: '甲', group: g, contact: 'abc' })).status, 400);
  const add = await post(env, adm, '/admin/staff', { id: 'C1', name: '甲', group: g, contact: ' 0912-345-678 ' });
  assert.equal(add.body.data.staff[0].contact, '0912-345-678');
  await post(env, adm, '/admin/staff', { id: 'C2', name: '乙', group: g });
  assert.equal((await call(env, '/staff/me')).status, 401);
  const { signToken } = await tok();
  assert.equal((await call(env, '/staff/me', { headers: bearer(await signToken(env.SESSION_SECRET, 'company', nowSec() + 600)) })).status, 401, '沒有員工編號的舊公司憑證無效');
  const h = bearer((await login(env, 'C2')).body.data.token);
  assert.deepEqual((await call(env, '/staff/me', { headers: h })).body.data, { id: 'C2', name: '乙', group: '檢視', contact: '', level: 'user' });
  assert.equal((await post(env, h, '/staff/me', { contact: '1'.repeat(31) })).status, 400);
  assert.equal((await post(env, h, '/staff/me', { contact: '<b>' })).status, 400);
  const saved = await post(env, h, '/staff/me', { contact: '#12345', id: 'C1', name: '改名' });
  assert.deepEqual(saved.body.data, { id: 'C2', name: '乙', group: '檢視', contact: '#12345', level: 'user' }, '只改自己的分機，不能改姓名或別人');
  const list = (await call(env, '/admin/staff', { headers: adm })).body.data.staff;
  assert.deepEqual(list.map((s) => [s.id, s.contact]), [['C1', '0912-345-678'], ['C2', '#12345']]);
  assert.equal((await post(env, adm, '/admin/staff/C2', { contact: '' })).body.data.staff[1].contact, '');
  assert.equal((await post(env, adm, '/admin/staff/C2', { contact: 'x' })).status, 400);
});

test('舊的 staff 表沒有 contact 欄：自動補上', async (t) => {
  const { env, adm } = await setup(t);
  env.DB.raw.exec('DROP TABLE staff; CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, grp INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, updated INTEGER NOT NULL, last_login INTEGER)');
  env.DB.raw.prepare("INSERT INTO staff (id, name, grp, enabled, created, updated) VALUES ('OLD', '舊', 1, 1, 1, 1)").run();
  const r = await call(env, '/admin/staff', { headers: adm });
  assert.equal(r.status, 200); assert.equal(r.body.data.staff[0].contact, '');
});
