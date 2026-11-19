const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mkEnv } = require('../helpers/fake-env.js');

const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const call = async (env, path, init = {}) => (await load()).fetch(new Request('https://api.test' + path, init), env, { waitUntil() {} });
async function adminAuth(env) {
  const { signToken } = (tokMod = tokMod || (await import('../../server/core/token.js')));
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)), origin: 'https://unnn3ing-oss.github.io' };
}
const SECRET = 'abcdef0123456789ABCDEF0123456789';
const sign = (body, secret = SECRET) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
const EVENT = JSON.stringify({ object: 'page', entry: [{ id: '111', time: 1, changes: [{ field: 'feed', value: { message: '私密內容', from: { name: '某人' } } }] }] });

test('GET /fbhook：驗證權杖對才回 challenge（純文字）；錯的、缺的、怪字元一律 403', async () => {
  const env = mkEnv();
  const { verifyToken } = await import('../../server/fb/webhook.js');
  const vt = await verifyToken(env);
  assert.match(vt, /^[0-9a-f]{32}$/);
  const q = (o) => '/fbhook?' + new URLSearchParams(o);
  const r = await call(env, q({ 'hub.mode': 'subscribe', 'hub.verify_token': vt, 'hub.challenge': '1158201444' }));
  assert.equal(r.status, 200); assert.equal(await r.text(), '1158201444');
  assert.match(r.headers.get('content-type'), /text\/plain/);
  assert.equal((await call(env, q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x'.repeat(32), 'hub.challenge': '1' }))).status, 403);
  assert.equal((await call(env, q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': vt, 'hub.challenge': '1' }))).status, 403);
  assert.equal((await call(env, q({ 'hub.mode': 'subscribe', 'hub.verify_token': vt, 'hub.challenge': '<script>' }))).status, 403);
  assert.equal((await call(env, '/fbhook')).status, 403);
  const other = mkEnv({ SESSION_SECRET: 'z'.repeat(40) });
  assert.notEqual(await verifyToken(other), vt, 'SESSION_SECRET 不同權杖就不同');
});

test('POST /fbhook：沒 App 密鑰或簽章錯 403；簽章對只記時間與事件種類，不存內容', async () => {
  const env = mkEnv();
  const post = (body, sig) => call(env, '/fbhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) }, body });
  assert.equal((await post(EVENT, sign(EVENT))).status, 403, '沒設 App 密鑰');
  const env2 = mkEnv({ FB_APP_ID: '555', FB_APP_SECRET: SECRET });
  const post2 = (body, sig) => call(env2, '/fbhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-hub-signature-256': sig } : {}) }, body });
  assert.equal((await post2(EVENT)).status, 403, '沒簽章');
  assert.equal((await post2(EVENT, sign(EVENT, 'f'.repeat(32)))).status, 403, '簽章錯');
  assert.equal((await post2(EVENT + ' ', sign(EVENT))).status, 403, '內容被改');
  const r = await post2(EVENT, sign(EVENT));
  assert.equal(r.status, 200); assert.equal(await r.text(), 'EVENT_RECEIVED');
  const rows = (await env2.DB.prepare('SELECT k, v FROM fb_settings').all()).results;
  assert.equal(rows.length, 1);
  const v = JSON.parse(rows[0].v);
  assert.deepEqual({ object: v.object, fields: v.fields }, { object: 'page', fields: ['feed'] });
  assert.ok(!rows[0].v.includes('私密內容') && !rows[0].v.includes('某人'), '不存內容');
  const bad = 'not json';
  assert.equal((await post2(bad, sign(bad))).status, 400);
  assert.equal((await call(env2, '/fbhook', { method: 'PUT' })).status, 405);
});

test('GET /admin/fb/webhook：只限管理憑證；回網址、驗證權杖、簽章狀態、最後收到', async () => {
  const env = mkEnv({ FB_APP_ID: '555', FB_APP_SECRET: SECRET });
  assert.equal((await call(env, '/admin/fb/webhook', { headers: { origin: 'https://unnn3ing-oss.github.io' } })).status, 401);
  const h = await adminAuth(env);
  let d = (await (await call(env, '/admin/fb/webhook', { headers: h })).json()).data;
  assert.equal(d.url, 'https://api.test/fbhook');
  assert.match(d.verifyToken, /^[0-9a-f]{32}$/);
  assert.equal(d.signReady, true); assert.equal(d.last, null);
  await call(env, '/fbhook', { method: 'POST', headers: { 'x-hub-signature-256': sign(EVENT) }, body: EVENT });
  d = (await (await call(env, '/admin/fb/webhook', { headers: h })).json()).data;
  assert.equal(d.last.object, 'page'); assert.deepEqual(d.last.fields, ['feed']); assert.ok(d.last.at > 0);
  assert.ok(!JSON.stringify(d).includes(SECRET));
  const env2 = mkEnv();
  assert.equal((await (await call(env2, '/admin/fb/webhook', { headers: await adminAuth(env2) })).json()).data.signReady, false);
});
