const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const loadToken = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const nowSec = () => Math.floor(Date.now() / 1000);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);

async function call(path, init = {}, env) {
  const w = await load();
  const headers = Object.assign({ origin: ORIGIN }, init.headers || {});
  return w.fetch(new Request('https://api.test' + path, { ...init, headers }), env, { waitUntil() {} });
}
async function tok(env, kind) {
  const { signToken } = await loadToken();
  return signToken(env.SESSION_SECRET, kind, nowSec() + 600);
}
const bearer = (t) => ({ authorization: 'Bearer ' + t });
async function put(env, key, bytes, tier, token) {
  return call('/admin/assets/' + key, { method: 'PUT', headers: { ...(token ? bearer(token) : {}), 'x-tier': tier === undefined ? 'company' : tier }, body: bytes }, env);
}

test('company 素材：未登入看不到也拿不到，登入後可以', async () => {
  const env = mkEnv();
  const admin = await tok(env, 'admin');
  const up = await put(env, 'logo.png', PNG, 'company', admin);
  assert.equal(up.status, 200);
  assert.equal((await up.json()).ok, true);
  await put(env, 'plain.png', PNG, 'public', admin);

  const m1 = (await (await call('/assets/manifest', {}, env)).json()).data;
  assert.deepEqual(m1.map((a) => a.key), ['plain.png']);
  assert.equal((await call('/assets/logo.png', {}, env)).status, 401);

  const company = await tok(env, 'company');
  const m2 = (await (await call('/assets/manifest', { headers: bearer(company) }, env)).json()).data;
  assert.deepEqual(m2.map((a) => a.key).sort(), ['logo.png', 'plain.png']);
  assert.deepEqual(Object.keys(m2[0]).sort(), ['key', 'size', 'tier', 'type', 'updated']);
  const got = await call('/assets/logo.png', { headers: bearer(company) }, env);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.equal(got.headers.get('cache-control'), 'private, max-age=300');
  assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [...PNG]);
  // admin 憑證不能當公司憑證
  assert.equal((await call('/assets/logo.png', { headers: bearer(admin) }, env)).status, 401);
});

test('public 素材不需登入，可公開快取', async () => {
  const env = mkEnv();
  await put(env, 'plain.png', PNG, 'public', await tok(env, 'admin'));
  const res = await call('/assets/plain.png', {}, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await call('/assets/missing.png', {}, env)).status, 404);
});

test('R2 物件鍵是 assets/<key>，型別由檔頭判斷', async () => {
  const env = mkEnv();
  const admin = await tok(env, 'admin');
  const cases = [['a.png', PNG, 'image/png'], ['b.jpg', JPG, 'image/jpeg'], ['c.webp', WEBP, 'image/webp'],
    ['d.woff2', WOFF2, 'font/woff2'], ['e.svg', SVG, 'image/svg+xml']];
  for (const [key, bytes, type] of cases) {
    assert.equal((await put(env, key, bytes, 'public', admin)).status, 200, key);
    assert.equal(env.FILES.store.get('assets/' + key).httpMetadata.contentType, type);
  }
  const svg = await call('/assets/e.svg', {}, env);
  assert.match(svg.headers.get('content-security-policy'), /sandbox/);
});

test('不是圖片或字型 → bad_request', async () => {
  const env = mkEnv();
  const res = await put(env, 'x.png', EXE, 'company', await tok(env, 'admin'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'bad_request');
  assert.equal(env.FILES.store.size, 0);
});

test('key 或等級不合法 → bad_request', async () => {
  const env = mkEnv();
  const admin = await tok(env, 'admin');
  assert.equal((await put(env, 'Bad_Key.png', PNG, 'public', admin)).status, 400);
  assert.equal((await put(env, 'ok.png', PNG, 'secret', admin)).status, 400);
  assert.equal((await put(env, 'ok.png', PNG, '', admin)).status, 400);
});

test('11 MB → too_large', async () => {
  const env = mkEnv();
  const big = new Uint8Array(11 * 1024 * 1024);
  big.set(PNG);
  const res = await put(env, 'big.png', big, 'company', await tok(env, 'admin'));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, 'too_large');
});

test('非 admin 呼叫 PUT／DELETE／list → 401', async () => {
  const env = mkEnv();
  assert.equal((await put(env, 'a.png', PNG, 'company')).status, 401);
  assert.equal((await put(env, 'a.png', PNG, 'company', await tok(env, 'company'))).status, 401);
  assert.equal((await call('/admin/assets/a.png', { method: 'DELETE' }, env)).status, 401);
  assert.equal((await call('/admin/assets', {}, env)).status, 401);
});

test('替換同一個 key 會更新內容與型別', async () => {
  const env = mkEnv();
  const admin = await tok(env, 'admin');
  await put(env, 'a.png', PNG, 'company', admin);
  await put(env, 'a.png', JPG, 'public', admin);
  const list = (await (await call('/admin/assets', { headers: bearer(admin) }, env)).json()).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'image/jpeg');
  assert.equal(list[0].tier, 'public');
  assert.equal(list[0].size, JPG.length);
});

test('DELETE 後 manifest 與 R2 都沒有', async () => {
  const env = mkEnv();
  const admin = await tok(env, 'admin');
  await put(env, 'a.png', PNG, 'company', admin);
  const del = await call('/admin/assets/a.png', { method: 'DELETE', headers: bearer(admin) }, env);
  assert.equal(del.status, 200);
  assert.equal(env.FILES.store.size, 0);
  const m = (await (await call('/assets/manifest', { headers: bearer(await tok(env, 'company')) }, env)).json()).data;
  assert.deepEqual(m, []);
  assert.equal((await call('/admin/assets/a.png', { method: 'DELETE', headers: bearer(admin) }, env)).status, 404);
});

test('/admin/login：正確密碼得到 12 小時的 admin 憑證', async () => {
  const env = mkEnv();
  const login = (password) => call('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }, env);
  const bad = await (await login('x')).json();
  assert.equal(bad.code, 'bad_password');
  const good = (await (await login('admin-pass-456')).json()).data;
  const { readToken } = await loadToken();
  const t = await readToken(env.SESSION_SECRET, good.token, nowSec());
  assert.equal(t.kind, 'admin');
  assert.ok(Math.abs(good.exp - (nowSec() + 12 * 3600)) < 5);
  // 公司密碼不能登入管理
  assert.equal((await (await call('/admin/login', { method: 'POST', body: JSON.stringify({ password: 'company-pass-123' }) }, env)).json()).code, 'bad_password');
  assert.equal((await (await call('/admin/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) }, mkEnv({ ADMIN_PASSWORD: undefined }))).json()).code, 'misconfigured');
});

test('GET /admin 回 HTML 管理頁（不需登入）', async () => {
  const res = await call('/admin', {}, mkEnv());
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<html lang="zh-Hant"/);
  assert.match(html, /刪除這個素材/);
  assert.match(html, /管理密碼/);
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}]/u, '不用 emoji 或箭頭');
});
