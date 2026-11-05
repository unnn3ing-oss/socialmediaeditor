const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const DAY = 86400000;
let worker, tokenMod, logsMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const loadToken = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const loadLogs = async () => (logsMod = logsMod || (await import('../../server/core/logs.js')));
const nowSec = () => Math.floor(Date.now() / 1000);

async function call(path, init = {}, env) {
  const w = await load();
  return w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } }), env, { waitUntil() {} });
}
const post = (env, body) => call('/logs', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }, env);
const dump = (env) => JSON.stringify(env.DB.raw.prepare('SELECT * FROM logs').all());

test('logs strips content fields', async () => {
  const env = mkEnv();
  const res = await post(env, { tool: 'sample', code: 'save_failed', ver: '1.00', ua: 'UA/1', title: '颱風', url: 'https://example.com/news/typhoon' });
  assert.equal(res.status, 200);
  const rows = env.DB.raw.prepare('SELECT * FROM logs').all();
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'code', 'id', 'tool', 'ua', 'ver']);
  assert.equal(rows[0].tool, 'sample');
  assert.equal(rows[0].code, 'save_failed');
  assert.ok(!dump(env).includes('颱風'));
  assert.ok(!dump(env).includes('typhoon'));
  assert.equal(env.FILES.store.size, 0);
  assert.equal(env.CACHE.store.size, 0);
});

test('3 KB body → too_large', async () => {
  const env = mkEnv();
  const res = await post(env, { tool: 'sample', code: 'x', ua: 'a'.repeat(3000) });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, 'too_large');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM logs').get().n, 0);
});

test('tool／code 格式不對 → bad_request；ver、ua 超長會被截斷', async () => {
  const env = mkEnv();
  assert.equal((await post(env, { tool: 'Bad Tool', code: 'x' })).status, 400);
  assert.equal((await post(env, { tool: 'sample', code: 'UPPER' })).status, 400);
  assert.equal((await post(env, { tool: 'sample', code: 'a'.repeat(61) })).status, 400);
  assert.equal((await post(env, 'not json')).status, 400);
  assert.equal((await post(env, [1, 2])).status, 400);
  assert.equal((await post(env, { tool: 'sample', code: 'ok', ver: 'v'.repeat(50), ua: 'u'.repeat(500) })).status, 200);
  const row = env.DB.raw.prepare('SELECT ver, ua FROM logs').get();
  assert.equal(row.ver.length, 20);
  assert.equal(row.ua.length, 200);
});

test('GET /admin/logs：需要 admin，最新的在前，依天數過濾', async () => {
  const env = mkEnv();
  const { signToken } = await loadToken();
  const admin = await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600);
  const ins = env.DB.raw.prepare('INSERT INTO logs (at, tool, code) VALUES (?, ?, ?)');
  const now = Date.now();
  ins.run(now - 10 * DAY, 'old', 'x');
  ins.run(now - 2 * DAY, 'mid', 'x');
  ins.run(now - 1000, 'new', 'x');
  assert.equal((await call('/admin/logs', {}, env)).status, 401);
  const h = { authorization: 'Bearer ' + admin };
  const week = (await (await call('/admin/logs?days=7', { headers: h }, env)).json()).data;
  assert.deepEqual(week.map((r) => r.tool), ['new', 'mid']);
  const all = (await (await call('/admin/logs?days=30', { headers: h }, env)).json()).data;
  assert.deepEqual(all.map((r) => r.tool), ['new', 'mid', 'old']);
});

test('GET /admin/logs 最多 500 筆', async () => {
  const env = mkEnv();
  const { signToken } = await loadToken();
  const admin = await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600);
  const ins = env.DB.raw.prepare('INSERT INTO logs (at, tool, code) VALUES (?, ?, ?)');
  for (let i = 0; i < 520; i++) ins.run(Date.now() - i, 'bulk', 'x');
  const data = (await (await call('/admin/logs?days=7', { headers: { authorization: 'Bearer ' + admin } }, env)).json()).data;
  assert.equal(data.length, 500);
});

test('cleanup 刪除 31 天前的，保留 29 天前的', async () => {
  const env = mkEnv();
  const { cleanup } = await loadLogs();
  const now = Date.now();
  const ins = env.DB.raw.prepare('INSERT INTO logs (at, tool, code) VALUES (?, ?, ?)');
  ins.run(now - 31 * DAY, 'gone', 'x');
  ins.run(now - 29 * DAY, 'kept', 'x');
  await cleanup(env, now);
  assert.deepEqual(env.DB.raw.prepare('SELECT tool FROM logs').all().map((r) => r.tool), ['kept']);
});

test('scheduled 會呼叫 cleanup', async () => {
  const env = mkEnv();
  env.DB.raw.prepare('INSERT INTO logs (at, tool, code) VALUES (?, ?, ?)').run(Date.now() - 40 * DAY, 'gone', 'x');
  const w = await load();
  let waited;
  await w.scheduled({}, env, { waitUntil: (p) => { waited = p; } });
  await waited;
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM logs').get().n, 0);
});
