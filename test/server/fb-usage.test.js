// 速率限制用量：graph() 讀回應標頭記到 D1；被限流記最後一次；管理頁讀取／立即查詢
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, init = {}) {
  const w = await load();
  return w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } }), env, { waitUntil() {} });
}
async function adm(env) {
  const { signToken } = await tok();
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', Math.floor(Date.now() / 1000) + 600)) };
}
const buc = (id, o) => JSON.stringify({ [id]: [{ type: 'pages', call_count: 0, total_cputime: 0, total_time: 0, estimated_time_to_regain_access: 0, ...o }] });
const withHeaders = (body, h) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...h } });

test('parseUsage：解析 X-App-Usage 與 X-Business-Use-Case-Usage；壞值略過', async () => {
  const { parseUsage } = await import('../../server/fb/usage.js');
  const h = new Headers({ 'x-app-usage': '{"call_count":28,"total_time":25,"total_cputime":9}', 'x-business-use-case-usage': buc('111', { call_count: 81, total_time: 3, regain: 0, estimated_time_to_regain_access: 12 }) });
  const u = parseUsage(h, 1000);
  assert.deepEqual(u.app, { callCount: 28, totalTime: 25, totalCputime: 9, at: 1000 });
  assert.deepEqual(u.pages['111'], { type: 'pages', callCount: 81, totalCputime: 0, totalTime: 3, regainMin: 12, at: 1000 });
  const bad = parseUsage(new Headers({ 'x-app-usage': 'not json', 'x-business-use-case-usage': '{"<x>":[{}],"222":"no"}' }));
  assert.equal(bad.app, null); assert.deepEqual(bad.pages, {});
});

test('graph()：記用量（≥75% 立即寫、平常每 60 秒最多一次）；限流記錯誤碼；管理頁讀得到並對上粉專名稱', async (t) => {
  let pageHdr = buc('111', { call_count: 10 });
  const f = installFetch({
    'GET /me/accounts': () => ({ data: [{ id: '111', name: 'TVBS 新聞', access_token: 'PT111' }] }),
    'GET /111': () => withHeaders({ id: '111' }, { 'x-business-use-case-usage': pageHdr }),
    'GET /me': () => withHeaders({ id: 'u' }, { 'x-app-usage': '{"call_count":5,"total_time":1,"total_cputime":1}' }),
    'GET /222': () => withHeaders({ error: { code: 80001, message: 'There have been too many calls to this Page account' } }, { 'x-business-use-case-usage': buc('222', { call_count: 100, estimated_time_to_regain_access: 30 }) })
  }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'UT' });
  const { graph } = await import('../../server/fb/graph.js');
  const { readUsage } = await import('../../server/fb/usage.js');
  await graph(env, 'GET', '/111', { fields: 'id' }, 'PT111');
  const row = async () => JSON.parse(((await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'rate_usage'").first()) || { v: 'null' }).v);
  assert.equal((await row()).pages['111'].callCount, 10, '第一次會寫');
  pageHdr = buc('111', { call_count: 20 });
  await graph(env, 'GET', '/111', { fields: 'id' }, 'PT111');
  assert.equal((await row()).pages['111'].callCount, 10, '60 秒內不重寫');
  assert.equal((await readUsage(env)).pages['111'].callCount, 20, '讀取時補上還沒寫進去的');
  const { noteUsage } = await import('../../server/fb/usage.js');
  await noteUsage(env, new Headers({ 'x-business-use-case-usage': buc('111', { call_count: 80 }) }), { now: Date.now() + 2000 });
  assert.equal((await row()).pages['111'].callCount, 10, '≥75% 也至少隔 10 秒');
  await noteUsage(env, new Headers({ 'x-business-use-case-usage': buc('111', { call_count: 80 }) }), { now: Date.now() + 11000 });
  assert.equal((await row()).pages['111'].callCount, 80, '≥75% 隔 10 秒就寫（不用等 60 秒）');
  await assert.rejects(graph(env, 'GET', '/222', { fields: 'id' }, 'PT222'), (e) => e.code === 80001);
  const r = await row();
  assert.equal(r.throttle.code, 80001);
  assert.equal(r.pages['222'].regainMin, 30);
  // 管理頁
  const res = await call(env, '/admin/fb/usage', { headers: await adm(env) });
  const txt = await res.text();
  assert.equal(res.status, 200, txt);
  assert.ok(!txt.includes('PT111') && !txt.includes('UT'), '不含權杖');
  const d = JSON.parse(txt).data;
  assert.equal(d.pages.find((p) => p.id === '111').name, 'TVBS 新聞');
  assert.equal(d.throttle.code, 80001);
  assert.equal((await call(env, '/admin/fb/usage')).status, 401);
});

test('立即查詢：每個粉專打一次 /{id}?fields=id（粉專權杖）＋使用者權杖 /me，強制寫入', async (t) => {
  const f = installFetch({
    'GET /me/accounts': () => ({ data: [{ id: '111', name: '新聞', access_token: 'PT111' }, { id: '333', name: '氣象', access_token: 'PT333' }] }),
    'GET /debug_token': () => ({ data: {} }),
    'GET /111': () => withHeaders({ id: '111' }, { 'x-business-use-case-usage': buc('111', { call_count: 3 }) }),
    'GET /333': () => gErr(100),
    'GET /me': () => withHeaders({ id: 'u' }, { 'x-app-usage': '{"call_count":7,"total_time":2,"total_cputime":1}' })
  }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'UT' });
  const r = await call(env, '/admin/fb/usage/refresh', { method: 'POST', headers: await adm(env) });
  const d = (await r.json()).data;
  assert.equal(d.asked, 3); assert.equal(d.failed, 1);
  assert.equal(d.app.callCount, 7);
  assert.equal(d.pages.find((p) => p.id === '111').callCount, 3);
  const calls = f.calls.filter((c) => c.path === '/111');
  assert.equal(calls.length, 1); assert.equal(calls[0].query.access_token, 'PT111'); assert.equal(calls[0].query.fields, 'id');
});
