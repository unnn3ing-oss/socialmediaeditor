const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, headers, body) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const auth = async (env, kind, adm) => { const { signToken } = await tok(); return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, adm)) }; };

test('活動留言：管理頁整份存、讀；排程發布讀得到；驗證', async () => {
  const env = mkEnv();
  const adm = await auth(env, 'admin');
  assert.deepEqual((await call(env, '/admin/fb/presets', adm)).body.data, []);
  const list = [{ name: '雙11抽獎', body: '留言＋分享抽 AirPods！\nhttps://example.com/a' }, { name: '訂閱', body: '記得訂閱 YouTube' }];
  const r = await call(env, '/admin/fb/presets', adm, { presets: list });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data, list);
  // 整份取代
  assert.deepEqual((await call(env, '/admin/fb/presets', adm, { presets: [list[1]] })).body.data, [list[1]]);
  // 排程發布（管理員前端憑證）讀得到；一般公司憑證測試期間 403；沒憑證 401
  assert.deepEqual((await call(env, '/fb/presets', await auth(env, 'company', true))).body.data, [list[1]]);
  assert.equal((await call(env, '/fb/presets', await auth(env, 'company', false))).status, 401);
  assert.equal((await call(env, '/fb/presets', {})).status, 401);
  // 公司密碼憑證不能進 /admin
  assert.equal((await call(env, '/admin/fb/presets', await auth(env, 'company', false), { presets: [] })).status, 401);
  // 驗證
  const bad = async (presets) => (await call(env, '/admin/fb/presets', adm, { presets })).status;
  assert.equal(await bad([{ name: '', body: 'x' }]), 400);
  assert.equal(await bad([{ name: '字'.repeat(21), body: 'x' }]), 400);
  assert.equal(await bad([{ name: 'a', body: '' }]), 400);
  assert.equal(await bad([{ name: 'a', body: 'x'.repeat(8001) }]), 400);
  assert.equal(await bad(Array.from({ length: 21 }, (_, i) => ({ name: 'n' + i, body: 'b' }))), 400);
  assert.equal(await bad('nope'), 400);
  assert.deepEqual((await call(env, '/admin/fb/presets', adm)).body.data, [list[1]], '失敗時不動既有資料');
});
