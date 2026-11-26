// 未登入時隱藏的工具：公開讀取、只有已解鎖系統管理者能改、預設關閉、輸入檢查
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, init = {}) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => null), cc: r.headers.get('cache-control') };
}
const sign = async (env, kind, uid = '') => { const { signToken } = await tok(); return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, false, uid, 1)) }; };
const post = (env, h, body) => call(env, '/admin/site/vis', { method: 'POST', headers: h, body: JSON.stringify(body) });

test('未登入隱藏工具：預設關閉；系統管理者解鎖才能改；公開讀取只回 hide', async () => {
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  const sys = await sign(env, 'admin'), adm = await sign(env, 'company', 'SYS1');
  let r = await call(env, '/site/vis');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, { hide: [] }, '沒存過＝關閉，不隱藏');
  assert.match(r.cc, /max-age=60/);
  assert.deepEqual((await call(env, '/admin/site/vis', { headers: sys })).body.data, { on: false, hide: ['fbpost', 'fbvideo', 'fbreports'] }, '預設勾三個');
  assert.equal((await call(env, '/admin/site/vis')).status, 401);
  assert.equal((await call(env, '/admin/site/vis', { headers: adm })).status, 403, '未解鎖不能讀寫');
  assert.equal((await post(env, adm, { on: true, hide: ['fbpost'] })).status, 403);
  for (const bad of [{ on: 'y', hide: [] }, { on: true, hide: 'fbpost' }, { on: true, hide: ['../x'] }, { on: true, hide: [1] }, { on: true, hide: Array.from({ length: 51 }, (_, i) => 't' + i) }]) {
    assert.equal((await post(env, sys, bad)).status, 400, JSON.stringify(bad));
  }
  r = await post(env, sys, { on: true, hide: ['fbpost', 'fbvideo', 'fbpost'] });
  assert.deepEqual(r.body.data, { on: true, hide: ['fbpost', 'fbvideo'] }, '去重');
  assert.deepEqual((await call(env, '/site/vis')).body.data, { hide: ['fbpost', 'fbvideo'] }, '同一執行個體存檔立即生效');
  await post(env, sys, { on: false, hide: ['fbpost'] });
  assert.deepEqual((await call(env, '/site/vis')).body.data, { hide: [] }, '關閉＝不隱藏');
  assert.equal((await call(env, '/site/vis', { method: 'POST' })).status, 404);
});

test('設定壞掉＝不隱藏', async () => {
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
  await env.DB.prepare("INSERT INTO fb_settings (k, v, updated) VALUES ('tool_vis', '{壞', 0)").run();
  assert.deepEqual((await call(env, '/site/vis')).body.data, { hide: [] });
});
