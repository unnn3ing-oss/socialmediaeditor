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
const login = (password, env, origin) => call('/auth', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ password }) }, env, origin);
const nowSec = () => Math.floor(Date.now() / 1000);

test('正確密碼拿到 company 憑證', async () => {
  const env = mkEnv();
  const body = await (await login('company-pass-123', env)).json();
  assert.equal(body.ok, true);
  const { readToken } = await loadToken();
  const t = await readToken(env.SESSION_SECRET, body.data.token, nowSec());
  assert.equal(t.kind, 'company');
  assert.ok(Math.abs(body.data.exp - (nowSec() + 30 * DAY)) < 5);
});

test('錯誤密碼回 bad_password', async () => {
  const body = await (await login('nope')).json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'bad_password');
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

test('剩 10 天時 status 帶 renew，剩 25 天時沒有', async () => {
  const env = mkEnv();
  const { signToken, readToken } = await loadToken();
  const a = await signToken(env.SESSION_SECRET, 'company', nowSec() + 10 * DAY);
  const ra = await (await call('/auth/status', { headers: { authorization: 'Bearer ' + a } }, env)).json();
  assert.equal(ra.data.company, true);
  assert.ok(ra.data.renew && ra.data.renew.token);
  const t = await readToken(env.SESSION_SECRET, ra.data.renew.token, nowSec());
  assert.equal(t.kind, 'company');
  assert.ok(t.exp > nowSec() + 29 * DAY);
  const b = await signToken(env.SESSION_SECRET, 'company', nowSec() + 25 * DAY);
  const rb = await (await call('/auth/status', { headers: { authorization: 'Bearer ' + b } }, env)).json();
  assert.equal(rb.data.renew, undefined);
});

test('CORS：允許的來源有標頭，其他來源沒有', async () => {
  const okRes = await login('company-pass-123', mkEnv(), ORIGIN);
  assert.equal(okRes.headers.get('access-control-allow-origin'), ORIGIN);
  const other = await login('company-pass-123', mkEnv(), 'https://evil.example');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const local = await login('company-pass-123', mkEnv(), 'http://localhost:8080');
  assert.equal(local.headers.get('access-control-allow-origin'), null);
  const local2 = await login('company-pass-123', mkEnv({ ALLOW_LOCALHOST: '1' }), 'http://localhost:8080');
  assert.equal(local2.headers.get('access-control-allow-origin'), 'http://localhost:8080');
});

test('OPTIONS 預檢回 204', async () => {
  const res = await call('/auth', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
});

test('SESSION_SECRET 太短或 COMPANY_PASSWORD 沒設 → misconfigured', async () => {
  const a = await (await login('company-pass-123', mkEnv({ SESSION_SECRET: 'short' }))).json();
  assert.equal(a.code, 'misconfigured');
  const res = await login('x', mkEnv({ COMPANY_PASSWORD: undefined }));
  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, 'misconfigured');
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
