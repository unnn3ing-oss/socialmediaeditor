const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv, fakeD1 } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const DAY = 86400;
let mod, tokenMod;
const load = async () => (mod = mod || (await import('../../server/index.js')).default);
const loadToken = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));

async function call(path, init = {}, env = mkEnv(), origin = ORIGIN) {
  const worker = await load();
  const headers = Object.assign(origin ? { origin } : {}, init.headers || {});
  return worker.fetch(new Request('https://api.test' + path, { ...init, headers }), env, { waitUntil() {} });
}
const nowSec = () => Math.floor(Date.now() / 1000);
const auth = (body, env, origin) => call('/auth', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) }, env, origin);
const j = async (r) => (await r).json();
// 管理頁新增一位員工 → 回設定碼
async function addStaff(env, id = 'T1', extra = {}) {
  const { signToken } = await loadToken();
  const h = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)), 'content-type': 'application/json' };
  const d = await j(call('/admin/staff', { headers: h }, env));
  const g = d.data.groups.find((x) => x.name === '發文').id;
  const r = await j(call('/admin/staff', { method: 'POST', headers: h, body: JSON.stringify({ id, name: '王小明', group: g, ...extra }) }, env));
  return { code: r.data.setup.code, h };
}

test('第一次登入：先查下一步＝setup；設定碼＋新密碼設好就登入（帶 uid、pv）；之後下一步＝password', async () => {
  const env = mkEnv();
  const { code } = await addStaff(env);
  assert.deepEqual((await j(auth({ staffId: 't1' }, env))).data, { next: 'setup' });
  assert.equal((await j(auth({ staffId: 'T1', password: 'whatever1' }, env))).code, 'need_setup');
  assert.match((await j(auth({ staffId: 'T1', code, newPassword: 'short' }, env))).error, /至少 8/);
  const r = await j(auth({ staffId: 'T1', code, newPassword: 'password-1' }, env));
  assert.equal(r.ok, true);
  const { readToken } = await loadToken();
  const t = await readToken(env.SESSION_SECRET, r.data.token, nowSec());
  assert.deepEqual([t.kind, t.uid, t.pv], ['company', 'T1', 2]);
  assert.ok(Math.abs(r.data.exp - (nowSec() + 30 * DAY)) < 5);
  assert.deepEqual((await j(auth({ staffId: 'T1' }, env))).data, { next: 'password' });
  // 設定碼只能用一次
  assert.equal((await j(auth({ staffId: 'T1', code, newPassword: 'password-2' }, env))).code, 'bad_request');
  const ok = await j(auth({ staffId: 'T1', password: 'password-1' }, env));
  assert.equal(ok.ok, true); assert.equal(ok.data.staff.name, '王小明');
});

test('密碼錯誤回 bad_password 與剩餘次數；連錯 5 次鎖住（locked 429），正確密碼也不行；管理頁重置可解鎖並讓舊憑證失效', async () => {
  const env = mkEnv({ FAIL_DELAY_MS: '0' });
  const { code, h } = await addStaff(env);
  const first = await j(auth({ staffId: 'T1', code, newPassword: 'password-1' }, env));
  for (let i = 4; i >= 1; i--) {
    const r = await j(auth({ staffId: 'T1', password: 'nope-nope' }, env));
    assert.equal(r.code, 'bad_password'); assert.equal(r.detail.left, i);
  }
  const lock = await auth({ staffId: 'T1', password: 'nope-nope' }, env);
  assert.equal(lock.status, 429);
  assert.equal((await auth({ staffId: 'T1', password: 'password-1' }, env)).status, 429);
  const reset = await j(call('/admin/staff/T1/reset', { method: 'POST', headers: h }, env));
  assert.match(reset.data.setup.code, /^\d{6}$/);
  assert.equal(reset.data.staff.find((s) => s.id === 'T1').pw, 'setup');
  assert.equal((await call('/auth/status', { headers: { authorization: 'Bearer ' + first.data.token } }, env)).status, 401, '重置後舊憑證失效');
  assert.equal((await j(auth({ staffId: 'T1', code: reset.data.setup.code, newPassword: 'password-9' }, env))).ok, true);
});

test('變更密碼：要目前密碼；成功回新憑證，其他裝置（舊憑證）登出', async () => {
  const env = mkEnv({ FAIL_DELAY_MS: '0' });
  const { code } = await addStaff(env);
  const a = await j(auth({ staffId: 'T1', code, newPassword: 'password-1' }, env));
  const b = await j(auth({ staffId: 'T1', password: 'password-1' }, env));
  const H = (t) => ({ authorization: 'Bearer ' + t, 'content-type': 'application/json' });
  assert.equal((await j(call('/staff/me/password', { method: 'POST', headers: H(a.data.token), body: JSON.stringify({ password: 'wrong-pass', newPassword: 'password-2' }) }, env))).code, 'bad_password');
  const c = await j(call('/staff/me/password', { method: 'POST', headers: H(a.data.token), body: JSON.stringify({ password: 'password-1', newPassword: 'password-2' }) }, env));
  assert.equal(c.ok, true);
  assert.equal((await call('/auth/status', { headers: H(b.data.token) }, env)).status, 401);
  assert.equal((await call('/auth/status', { headers: H(c.data.token) }, env)).status, 200);
  assert.equal((await j(auth({ staffId: 'T1', password: 'password-2' }, env))).ok, true);
});

test('公司密碼登入已拿掉：只有 password 沒有 staffId → bad_request；查不到員工 → bad_staff；設定碼過期 → setup_expired', async () => {
  const env = mkEnv({ FAIL_DELAY_MS: '0' });
  assert.equal((await auth({ password: 'company-pass-123' }, env)).status, 400);
  assert.equal((await auth({ password: env.ADMIN_PASSWORD }, env)).status, 400);
  assert.equal((await j(auth({ staffId: 'NOPE' }, env))).code, 'bad_staff');
  await addStaff(env);
  await env.DB.prepare('UPDATE staff SET setup_exp = 1 WHERE id = ?').bind('T1').run();
  assert.equal((await j(auth({ staffId: 'T1', code: '123456', newPassword: 'password-1' }, env))).code, 'setup_expired');
});

test('系統管理者（SYS_STAFF_ID）：名單沒有自動建立；可用管理員密碼代替設定碼；全部非敏感卡片；不能停用、刪除、改層級', async () => {
  const env = mkEnv({ SYS_STAFF_ID: '13082605', FAIL_DELAY_MS: '0' });
  assert.deepEqual((await j(auth({ staffId: '13082605' }, env))).data, { next: 'setup' });
  assert.equal((await j(auth({ staffId: '13082605', code: 'wrong', newPassword: 'password-1' }, env))).code, 'bad_password');
  const r = await j(auth({ staffId: '13082605', code: env.ADMIN_PASSWORD, newPassword: 'password-1' }, env));
  assert.equal(r.ok, true);
  assert.equal(r.data.staff.level, 'sys'); assert.equal(r.data.manage, true);
  const H = { authorization: 'Bearer ' + r.data.token, 'content-type': 'application/json' };
  const me = await j(call('/admin/me', { headers: H }, env));
  assert.equal(me.data.role, 'sys'); assert.equal(me.data.unlocked, false);
  assert.ok(me.data.cards.includes('staff')); assert.ok(!me.data.cards.includes('profiles'));
  const { signToken } = await loadToken();
  const A = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)), 'content-type': 'application/json' };
  assert.equal((await call('/admin/staff/13082605', { method: 'POST', headers: A, body: JSON.stringify({ enabled: false }) }, env)).status, 403);
  assert.equal((await call('/admin/staff/13082605', { method: 'POST', headers: A, body: JSON.stringify({ level: 'user' }) }, env)).status, 403);
  assert.equal((await call('/admin/staff/13082605', { method: 'DELETE', headers: A }, env)).status, 403);
  assert.equal((await call('/admin/staff/13082605', { method: 'POST', headers: A, body: JSON.stringify({ name: '莊' }) }, env)).status, 200);
  // 別人不能用管理員密碼代替設定碼
  await addStaff(env, 'T2');
  assert.equal((await j(auth({ staffId: 'T2', code: env.ADMIN_PASSWORD, newPassword: 'password-1' }, env))).ok, false);
});

test('admin 憑證不能用在 /auth/status', async () => {
  const env = mkEnv();
  const { signToken } = await loadToken();
  const token = await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600);
  const res = await call('/auth/status', { headers: { authorization: 'Bearer ' + token } }, env);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'unauthorized');
});

test('過期憑證回 401', async () => {
  const env = mkEnv();
  const { signToken } = await loadToken();
  const token = await signToken(env.SESSION_SECRET, 'company', nowSec() - 10);
  const res = await call('/auth/status', { headers: { authorization: 'Bearer ' + token } }, env);
  assert.equal(res.status, 401);
});

test('沒帶憑證回 401', async () => {
  assert.equal((await call('/auth/status')).status, 401);
});

test('剩 10 天時 status 帶 renew（保留 uid、pv），剩 25 天時沒有；沒有員工編號的舊公司憑證無效', async () => {
  const env = mkEnv();
  await addStaff(env);
  const { signToken, readToken } = await loadToken();
  assert.equal((await call('/auth/status', { headers: { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 10 * DAY)) } }, env)).status, 401);
  const a = await signToken(env.SESSION_SECRET, 'company', nowSec() + 10 * DAY, false, 'T1', 1);
  const ra = await (await call('/auth/status', { headers: { authorization: 'Bearer ' + a } }, env)).json();
  assert.equal(ra.data.company, true);
  assert.ok(ra.data.renew && ra.data.renew.token);
  const t = await readToken(env.SESSION_SECRET, ra.data.renew.token, nowSec());
  assert.deepEqual([t.kind, t.uid, t.pv], ['company', 'T1', 1]);
  assert.ok(t.exp > nowSec() + 29 * DAY);
  const b = await signToken(env.SESSION_SECRET, 'company', nowSec() + 25 * DAY, false, 'T1', 1);
  const rb = await (await call('/auth/status', { headers: { authorization: 'Bearer ' + b } }, env)).json();
  assert.equal(rb.data.renew, undefined);
});

test('CORS：允許的來源有標頭，其他來源沒有', async () => {
  const okRes = await auth({ staffId: 'X' }, mkEnv({ FAIL_DELAY_MS: '0' }), ORIGIN);
  assert.equal(okRes.headers.get('access-control-allow-origin'), ORIGIN);
  const other = await auth({ staffId: 'X' }, mkEnv({ FAIL_DELAY_MS: '0' }), 'https://evil.example');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const local = await auth({ staffId: 'X' }, mkEnv({ FAIL_DELAY_MS: '0' }), 'http://localhost:8080');
  assert.equal(local.headers.get('access-control-allow-origin'), null);
  const local2 = await auth({ staffId: 'X' }, mkEnv({ ALLOW_LOCALHOST: '1', FAIL_DELAY_MS: '0' }), 'http://localhost:8080');
  assert.equal(local2.headers.get('access-control-allow-origin'), 'http://localhost:8080');
});

test('OPTIONS 預檢回 204', async () => {
  const res = await call('/auth', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('SESSION_SECRET 太短 → misconfigured；不需要 COMPANY_PASSWORD', async () => {
  const res = await auth({ staffId: 'T1' }, mkEnv({ SESSION_SECRET: 'short' }));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, 'misconfigured');
  assert.equal((await j(auth({ staffId: 'NOPE' }, mkEnv({ COMPANY_PASSWORD: undefined, FAIL_DELAY_MS: '0' })))).code, 'bad_staff');
});

test('壞掉的本文回 bad_request', async () => {
  const res = await call('/auth', { method: 'POST', body: 'not json' });
  assert.equal(res.status, 400);
});

test('未知路徑與未註冊的工具路由回 not_found', async () => {
  assert.equal((await call('/nope')).status, 404);
  assert.equal((await call('/t/sample/x')).status, 404);
});

test('fakeD1 可以 insert 與 select', async () => {
  const db = fakeD1();
  await db.prepare('INSERT INTO logs (at, tool, code) VALUES (?, ?, ?)').bind(1, 'sample', 'x').run();
  const { results } = await db.prepare('SELECT tool, code FROM logs').all();
  assert.deepEqual(results, [{ tool: 'sample', code: 'x' }]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM logs').first()).n, 1);
});

// ---- 舊版首頁管理員憑證（adm:1）已不再接受 ----
test('舊版 adm 憑證：全部 401（/auth/status、/admin/*）', async () => {
  const env = mkEnv();
  const { signToken } = await loadToken();
  const old = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 3600, true)) };
  assert.equal((await call('/auth/status', { headers: old }, env)).status, 401);
  assert.equal((await call('/admin/assets', { headers: old }, env)).status, 401);
});

test('設定碼並行亂猜：連錯計數原子遞增，第 5 次就鎖並作廢設定碼；之後正確碼也不能用', async () => {
  const env = mkEnv({ FAIL_DELAY_MS: '0' });
  const { code } = await addStaff(env);
  const wrong = code === '000000' ? '111111' : '000000';
  const rs = await Promise.all(Array.from({ length: 12 }, () => j(auth({ staffId: 'T1', code: wrong, newPassword: 'password-1' }, env))));
  assert.ok(rs.some((r) => r.code === 'locked'), '並行也要鎖得住');
  const row = env.DB.raw.prepare("SELECT setup_hash, fails FROM staff WHERE id = 'T1'").get();
  assert.equal(row.setup_hash, null, '連錯達上限就作廢設定碼');
  env.DB.raw.prepare("UPDATE staff SET lock_until = NULL WHERE id = 'T1'").run();
  assert.equal((await j(auth({ staffId: 'T1', code, newPassword: 'password-1' }, env))).code, 'setup_expired');
});

test('設定碼只能用一次：條件式消耗，並行兩個正確請求只有一個成功', async () => {
  const env = mkEnv({ FAIL_DELAY_MS: '0' });
  const { code } = await addStaff(env);
  const rs = await Promise.all([auth({ staffId: 'T1', code, newPassword: 'password-1' }, env), auth({ staffId: 'T1', code, newPassword: 'password-2' }, env)].map(j));
  assert.equal(rs.filter((r) => r.ok).length, 1);
});

test('新增員工：不能用系統管理者編號；新增與重置寫操作紀錄（不含設定碼）', async () => {
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1', FAIL_DELAY_MS: '0' });
  const { h } = await addStaff(env, 'T1');
  const d = await j(call('/admin/staff', { headers: h }, env));
  const g = d.data.groups[0].id;
  const r = await call('/admin/staff', { method: 'POST', headers: h, body: JSON.stringify({ id: 'sys1', name: 'x', group: g }) }, env);
  assert.equal(r.status, 400);
  const rr = await j(call('/admin/staff/T1/reset', { method: 'POST', headers: h }, env));
  const log = env.DB.raw.prepare('SELECT action, detail FROM fb_audit ORDER BY id').all().map((x) => ({ ...x }));
  assert.deepEqual(log, [{ action: 'add', detail: 'T1' }, { action: 'reset', detail: 'T1' }]);
  assert.ok(!JSON.stringify(log).includes(rr.data.setup.code));
});
