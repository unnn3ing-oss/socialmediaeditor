const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const GAS = 'https://script.google.com/macros/s/AKfy_abc-123/exec';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));

async function setup(t, gas, extra = {}) {
  const f = installFetch({ [GAS]: gas }); t.after(f.restore);
  const env = mkEnv({ RUNDOWN_URL: GAS, RUNDOWN_TOKEN: 'rd-token-123456', ...extra });
  const { signToken } = await tok();
  const h = async (kind, adm) => ({ origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, adm)) });
  const w = await load();
  const call = async (path, headers, body) => {
    const r = await w.fetch(new Request('https://api.test' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  return { f, env, h, call };
}
const E = (o = {}) => ({ page: 'news', date: '2026-11-16', time: '15:13', text: '4051394/圖文/秋冬衣櫃', ...o });

test('轉送：補 token、entries 原樣、回 results', async (t) => {
  const { f, h, call } = await setup(t, () => ({ ok: true, results: [{ ok: true, page: 'news', cell: '2026/11!AE255', status: 'insert' }] }));
  const r = await call('/rundown', await h('company', true), { entries: [E({ extra: 'x' })] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.results[0].cell, '2026/11!AE255');
  const sent = f.calls[0];
  assert.equal(sent.path, GAS);
  assert.deepEqual(sent.body, { token: 'rd-token-123456', action: 'add', entries: [E()] });
});

test('格式驗證', async (t) => {
  const { f, h, call } = await setup(t, () => ({ ok: true, results: [] }));
  const H = await h('company', true);
  for (const entries of [[E({ page: 'gkk' })], [E({ text: 'a\nb' })], [E({ text: 'x'.repeat(101) })], [E({ date: '2026/11/16' })], [E({ time: '9:30' })], [], Array(11).fill(E())]) {
    assert.equal((await call('/rundown', H, { entries })).status, 400, JSON.stringify(entries).slice(0, 60));
  }
  assert.equal(f.calls.length, 0);
});

test('權限：公司憑證 403、無憑證 401', async (t) => {
  const { h, call } = await setup(t, () => ({ ok: true, results: [] }));
  assert.equal((await call('/rundown', await h('company', false), { entries: [E()] })).status, 403);
  assert.equal((await call('/rundown', { origin: ORIGIN }, { entries: [E()] })).status, 401);
});

test('未設定或網址不對 → rundown_off；Apps Script 錯誤 → rundown_failed', async (t) => {
  const a = await setup(t, () => ({ ok: true }), { RUNDOWN_URL: 'https://evil.example/exec' });
  const r1 = await a.call('/rundown', await a.h('company', true), { entries: [E()] });
  assert.equal(r1.status, 503); assert.equal(r1.body.code, 'rundown_off');
  const b = await setup(t, () => ({ ok: false, error: '金鑰不對' }));
  const r2 = await b.call('/rundown', await b.h('company', true), { entries: [E()] });
  assert.equal(r2.status, 502); assert.equal(r2.body.code, 'rundown_failed'); assert.match(r2.body.error, /金鑰不對/);
  const c = await setup(t, () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
  const r3 = await c.call('/rundown', await c.h('company', true), { entries: [E()] });
  assert.equal(r3.status, 502);
});

test('管理頁：GET /admin/rundown 不回網址；ping 只給管理憑證', async (t) => {
  const { f, h, call } = await setup(t, () => ({ ok: true, title: 'FB RUNDOWN', sheets: ['2026/11'] }));
  const s = await call('/admin/rundown', await h('admin'));
  assert.deepEqual(s.body.data, { configured: true, state: 'ok' });
  assert.ok(!JSON.stringify(s.body).includes('script.google'));
  assert.equal((await call('/admin/rundown/ping', await h('company', true), {})).status, 401);
  const p = await call('/admin/rundown/ping', await h('admin'), {});
  assert.deepEqual(p.body.data, { title: 'FB RUNDOWN', sheets: ['2026/11'] });
  assert.deepEqual(f.calls[0].body, { token: 'rd-token-123456', action: 'ping' });
});

test('設定檢查：Workspace 網址可用、前後空白去掉、金鑰不限長度；狀態細分不回傳值', async () => {
  const { rundownState } = await import('../../server/fb/rundown.js');
  const U = 'https://script.google.com/macros/s/AKfy-123_x/exec';
  assert.equal(rundownState({}), 'missing');
  assert.equal(rundownState({ RUNDOWN_URL: U, RUNDOWN_TOKEN: 'abc' }), 'ok');
  assert.equal(rundownState({ RUNDOWN_URL: '  ' + U + '\n', RUNDOWN_TOKEN: ' abc\n' }), 'ok');
  assert.equal(rundownState({ RUNDOWN_URL: 'https://script.google.com/a/macros/tvbs.com.tw/s/AKfy123/exec', RUNDOWN_TOKEN: 'k' }), 'ok');
  assert.equal(rundownState({ RUNDOWN_URL: U + '?x=1', RUNDOWN_TOKEN: 'k' }), 'url');
  assert.equal(rundownState({ RUNDOWN_URL: 'https://evil.example/macros/s/a/exec', RUNDOWN_TOKEN: 'k' }), 'url');
  assert.equal(rundownState({ RUNDOWN_TOKEN: 'k' }), 'url');
  assert.equal(rundownState({ RUNDOWN_URL: U, RUNDOWN_TOKEN: '   ' }), 'token');
});
