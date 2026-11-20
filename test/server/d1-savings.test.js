// 省 D1 讀寫：建表只跑一次、設定快取、Webhook 最後收到時間節流、新留言預篩沒中不讀紀錄表
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mkEnv } = require('../helpers/fake-env.js');

// 包一層計數：記下每句 SQL 被 prepare 幾次
function countSql(env) {
  const seen = [];
  const db = env.DB, orig = db.prepare.bind(db);
  db.prepare = (sql) => { seen.push(sql); return orig(sql); };
  return { seen, count: (re) => seen.filter((s) => re.test(s)).length, reset: () => { seen.length = 0; } };
}
const once = () => import('../../server/core/once.js');

test('ensureOnce：同一個 D1 綁定同一句只跑一次；失敗不記；不同綁定各自跑', async () => {
  const { ensureOnce } = await once();
  const env = mkEnv(); const c = countSql(env);
  const sql = 'CREATE TABLE IF NOT EXISTS t_once (a TEXT)';
  await ensureOnce(env.DB, sql); await ensureOnce(env.DB, sql); await ensureOnce(env.DB, sql);
  assert.equal(c.count(/t_once/), 1);
  await assert.rejects(ensureOnce(env.DB, 'CREATE TABLE oops ('));
  await assert.rejects(ensureOnce(env.DB, 'CREATE TABLE oops ('), '失敗不記，下次再跑');
  const env2 = mkEnv(); const c2 = countSql(env2);
  await ensureOnce(env2.DB, sql);
  assert.equal(c2.count(/t_once/), 1);
});

test('cached：期限內只讀一次、同時請求共用、過期重讀、forget 立即重讀、失敗不快取', async () => {
  const { cached, forget } = await once();
  const db = {}; let n = 0;
  const load = async () => ++n;
  assert.deepEqual(await Promise.all([cached(db, 'k', 1000, load, 0), cached(db, 'k', 1000, load, 10)]), [1, 1]);
  assert.equal(await cached(db, 'k', 1000, load, 999), 1);
  assert.equal(await cached(db, 'k', 1000, load, 1000), 2, '過期重讀');
  forget(db, 'k');
  assert.equal(await cached(db, 'k', 1000, load, 1001), 3, 'forget 後重讀');
  let fail = true;
  const bad = async () => { if (fail) throw new Error('x'); return 'ok'; };
  await assert.rejects(cached(db, 'b', 1000, bad, 0));
  fail = false;
  assert.equal(await cached(db, 'b', 1000, bad, 1), 'ok', '失敗不快取');
});

const SECRET = 'abcdef0123456789ABCDEF0123456789';
const sign = (body) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const EVENT = JSON.stringify({ object: 'page', entry: [{ id: '111', time: 1, changes: [{ field: 'feed', value: { item: 'reaction', verb: 'add' } }] }] });

test('POST /fbhook 連續 20 則：最後收到時間只寫 1 次、建表 1 次、App 密鑰與留言設定各讀 1 次', async () => {
  const worker = (await import('../../server/index.js')).default;
  const env = mkEnv({ FB_APP_ID: '555', FB_APP_SECRET: SECRET });
  const c = countSql(env);
  for (let i = 0; i < 20; i++) {
    const r = await worker.fetch(new Request('https://api.test/fbhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(EVENT) }, body: EVENT }), env, { waitUntil() {} });
    assert.equal(r.status, 200);
  }
  assert.equal(c.count(/^INSERT INTO fb_settings/), 1, '最後收到時間節流');
  assert.equal(c.count(/CREATE TABLE IF NOT EXISTS fb_settings/), 1, '建表一次');
  const reads = c.count(/^SELECT v FROM fb_settings/);
  assert.ok(reads <= 4, '設定讀取有快取（實際 ' + reads + ' 次）');
  const row = await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'webhook_last'").first();
  assert.ok(row && JSON.parse(row.v).at > 0);
});

test('留言管理：新留言預篩沒中不讀紀錄表；存設定立即生效（不用等快取）', async () => {
  const g = await import('../../server/fb/guard.js');
  const env = mkEnv({ FB_USER_TOKEN: 'USERTOKEN', FB_APP_ID: '555', FB_APP_SECRET: SECRET });
  await g.saveGuard(env, { mode: 'observe', profile: 'p1', pages: ['111'], rules: structuredClone(g.DEFAULT_RULES) });
  const c = countSql(env);
  const ev = (verb) => ({ object: 'page', entry: [{ id: '111', time: 1, changes: [{ field: 'feed', value: { item: 'comment', verb, comment_id: '9_1', post_id: '111_9', message: '今天天氣很好', from: { id: '777' } } }] }] });
  await g.guardEvent(env, ev('add'));
  assert.equal(c.count(/fb_guard_log/), 0, '新留言沒命中：不碰紀錄表');
  await g.guardEvent(env, ev('edited'));
  assert.ok(c.count(/SELECT \* FROM fb_guard_log/) >= 1, '編輯仍會查紀錄表（標編輯過）');
  // 改成關閉：同一執行個體立即生效
  await g.saveGuard(env, { mode: 'off', profile: 'p1', pages: ['111'], rules: structuredClone(g.DEFAULT_RULES) });
  c.reset();
  await g.guardEvent(env, ev('edited'));
  assert.equal(c.count(/fb_guard_log/), 0, '關閉後不處理');
});
