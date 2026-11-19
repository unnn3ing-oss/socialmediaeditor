// GET /fb/open：首頁用，不需登入，只回 { open }，不含關閉原因
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, init = {}) {
  const w = await load();
  return w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } }), env, { waitUntil() {} });
}

test('/fb/open：預設關閉；管理頁開放後 true；不外露原因；不需登入；有 CORS', async () => {
  const env = mkEnv({});
  let r = await call(env, '/fb/open');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await r.json()).data, { open: false });
  const { signToken } = await tok();
  const adm = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', Math.floor(Date.now() / 1000) + 600)) };
  const set = (body) => call(env, '/admin/fb/access', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await set({ mode: 'admin', reason: '權杖更換中' })).status, 200);
  r = await call(env, '/fb/open');
  const txt = await r.text();
  assert.ok(!txt.includes('權杖更換中'), '不含關閉原因');
  assert.deepEqual(JSON.parse(txt).data, { open: false });
  assert.equal((await set({ mode: 'company' })).status, 200);
  assert.deepEqual((await (await call(env, '/fb/open')).json()).data, { open: true });
  assert.equal((await call(env, '/fb/open', { method: 'POST' })).status, 404, '只有 GET');
});
