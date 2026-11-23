const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, fakeNamespace } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, timerMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const tm = async () => (timerMod = timerMod || (await import('../../server/fb/timer.js')));
const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }] };

async function setup(t, handlers) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, ...handlers }); t.after(f.restore);
  const { FbCommentTimer, armTimer, timerStatus } = await tm();
  let env;
  env = mkEnv({ FB_USER_TOKEN: 'U', FB_TIMER: fakeNamespace(FbCommentTimer, () => env) });
  const { signToken } = await tok();
  env.SYS_STAFF_ID = 'SYS1';
  const headers = { origin: ORIGIN, authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, 'SYS1', 1)) };
  const w = await load();
  const call = async (path, init = {}) => {
    const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { ...headers, 'content-type': 'application/json' } }), env, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  return { f, env, call, armTimer, timerStatus };
}

test('已排程列表：欄位對應、縮圖、留言狀態', async (t) => {
  const at = nowSec() + 3600;
  const { f, env, call, armTimer } = await setup(t, {
    'GET /111/scheduled_posts': () => ({ data: [{ id: '111_1', message: '貼文', scheduled_publish_time: at, full_picture: 'https://cdn/x.jpg' }, { id: '111_2', scheduled_publish_time: new Date(at * 1000).toISOString() }] })
  });
  await armTimer(env, { pageId: '111', postId: '111_1', message: 'c', at });
  const r = await call('/fb/scheduled?page=111');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, [
    { id: '111_1', message: '貼文', at, picture: 'https://cdn/x.jpg', comment: 'pending' },
    { id: '111_2', message: '', at, picture: null, comment: 'none' }
  ]);
  const q = f.calls.find((c) => c.path === '/111/scheduled_posts').query;
  assert.match(q.fields, /full_picture/);
  assert.equal(q.access_token, 'PT111');
});

test('已發佈列表：分頁游標', async (t) => {
  const { f, call } = await setup(t, {
    'GET /111/published_posts': (c) => ({ data: [{ id: '111_3', message: 'm', created_time: '2026-11-16T01:00:00+0000', full_picture: 'p', permalink_url: 'https://fb/1' }], paging: { cursors: { after: 'CUR' }, next: 'https://next' } })
  });
  const r = await call('/fb/published?page=111&after=ABC');
  assert.deepEqual(r.body.data, { items: [{ id: '111_3', message: 'm', time: '2026-11-16T01:00:00+0000', picture: 'p', url: 'https://fb/1', comment: 'none' }], next: 'CUR' });
  assert.equal(f.calls.find((c) => c.path === '/111/published_posts').query.after, 'ABC');
});

test('改時間：範圍外 400 不呼叫臉書；成功後計時器跟著改', async (t) => {
  const at = nowSec() + 3600, at2 = nowSec() + 7200;
  const { f, env, call, armTimer, timerStatus } = await setup(t, { 'POST /111_1': () => ({ success: true }) });
  await armTimer(env, { pageId: '111', postId: '111_1', message: 'c', at });
  const n = f.calls.length;
  const bad = await call('/fb/posts/111_1/reschedule', { method: 'POST', body: JSON.stringify({ page: '111', at: nowSec() + 60 }) });
  assert.equal(bad.status, 400); assert.equal(bad.body.code, 'fb_bad_time');
  assert.equal(f.calls.length, n);
  const r = await call('/fb/posts/111_1/reschedule', { method: 'POST', body: JSON.stringify({ page: '111', at: at2 }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(f.calls.find((c) => c.path === '/111_1' && c.method === 'POST').body.scheduled_publish_time, String(at2));
  assert.equal((await timerStatus(env, '111_1')).at, at2);
  const log = env.DB.raw.prepare('SELECT uid, name, action, page, post FROM fb_audit').all().map((r) => ({ ...r }));
  assert.deepEqual(log, [{ uid: 'SYS1', name: '系統管理者', action: 'reschedule', page: '111', post: '111_1' }], '操作紀錄只記成功的改時間');
});

test('取消、刪除：DELETE 且計時器取消；沒有計時器也能刪', async (t) => {
  const { f, env, call, armTimer, timerStatus } = await setup(t, { 'DELETE /111_1': () => ({ success: true }), 'DELETE /111_9': () => ({ success: true }) });
  await armTimer(env, { pageId: '111', postId: '111_1', message: 'c', at: nowSec() + 3600 });
  assert.equal((await call('/fb/posts/111_1/cancel', { method: 'POST', body: JSON.stringify({ page: '111' }) })).status, 200);
  assert.equal((await timerStatus(env, '111_1')).status, 'canceled');
  assert.equal((await call('/fb/posts/111_9/delete', { method: 'POST', body: JSON.stringify({ page: '111' }) })).status, 200);
  assert.equal(f.calls.filter((c) => c.method === 'DELETE').length, 2);
  assert.equal(f.calls.find((c) => c.method === 'DELETE').query.access_token, 'PT111');
  assert.deepEqual(env.DB.raw.prepare('SELECT action, post FROM fb_audit ORDER BY id').all().map((r) => [r.action, r.post]), [['delete', '111_1'], ['delete', '111_9']]);
});

test('粉專不在清單 400；貼文 ID 格式不對 404', async (t) => {
  const { call } = await setup(t, {});
  assert.equal((await call('/fb/scheduled?page=999')).status, 400);
  assert.equal((await call('/fb/scheduled')).status, 400);
  assert.equal((await call('/fb/posts/111_1/cancel', { method: 'POST', body: JSON.stringify({ page: '999' }) })).status, 400);
  assert.equal((await call('/fb/posts/abc/cancel', { method: 'POST', body: JSON.stringify({ page: '111' }) })).status, 404);
  assert.equal((await call('/fb/posts/111_1%2Fx/cancel', { method: 'POST', body: JSON.stringify({ page: '111' }) })).status, 404);
});

test('臉書改時間成功但計時器出錯 → 仍回成功', async (t) => {
  const { env, call } = await setup(t, { 'POST /111_1': () => ({ success: true }), 'DELETE /111_1': () => ({ success: true }) });
  env.FB_TIMER = { idFromName: (n) => ({ name: n }), get: () => ({ fetch: async () => { throw new Error('DO down'); } }) };
  const r = await call('/fb/posts/111_1/reschedule', { method: 'POST', body: JSON.stringify({ page: '111', at: nowSec() + 7200 }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call('/fb/posts/111_1/cancel', { method: 'POST', body: JSON.stringify({ page: '111' }) })).status, 200);
});

// ===== 留言失敗提醒（2026-11-22）=====
test('已發佈列表：留言失敗回 alert 物件；重新留言 API 驗證、交給計時器、寫操作紀錄；通知 API 依 notify 權限', async (t) => {
  const { gErr } = require('../helpers/fake-fb.js');
  let fail = true;
  const { env, call, armTimer } = await setup(t, {
    'GET /111/published_posts': () => ({ data: [{ id: '111_7', message: 'm', created_time: '2026-11-16T01:00:00+0000' }] }),
    'GET /111_7': () => ({ is_published: true }),
    'POST /111_7/comments': () => (fail ? gErr(32, 400, 'page rate limit') : { id: 'C1' }),
    'GET /111_7/comments': () => ({ data: [] })
  });
  await armTimer(env, { pageId: '111', postId: '111_7', message: '看更多', at: nowSec() - 120 });
  const inst = env.FB_TIMER.instances.get('111_7');
  await inst.obj.alarm();
  const r = await call('/fb/published?page=111');
  const c = r.body.data.items[0].comment;
  assert.equal(c.alert, true); assert.equal(c.failed, true); assert.equal(c.seq, 1); assert.match(c.error, /粉專呼叫太頻繁.*臉書碼 32/);

  const n = await call('/staff/me/notices');
  assert.equal(n.body.data.enabled, true, '系統管理者一律收通知');
  assert.equal(n.body.data.all, true);
  assert.equal(n.body.data.items.length, 1);
  assert.deepEqual([n.body.data.items[0].postId, n.body.data.items[0].page, n.body.data.items[0].kind, n.body.data.items[0].canRetry], ['111_7', '111', 'post', true]);

  assert.equal((await call('/fb/comment/retry', { method: 'POST', body: JSON.stringify({ postId: 'x', page: '111' }) })).status, 400);
  assert.equal((await call('/fb/comment/retry', { method: 'POST', body: JSON.stringify({ postId: '111_7', page: '222' }) })).status, 400);
  fail = false;
  const ok = await call('/fb/comment/retry', { method: 'POST', body: JSON.stringify({ postId: '111_7', page: '111' }) });
  assert.equal(ok.status, 200);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM fb_audit WHERE action = 'comment_retry'").get().n, 1);
  assert.equal((await call('/staff/me/notices')).body.data.items.length, 0, '重新留言後通知收掉');
  await inst.obj.alarm();
  assert.equal((await call('/fb/published?page=111')).body.data.items[0].comment, 'done');
});

test('已發佈載入更多：長游標（800 字）可以翻頁；怪字元或超過 4000 字擋下', async (t) => {
  const long = 'QVFI' + 'a'.repeat(796);
  const { f, call } = await setup(t, { 'GET /111/published_posts': () => ({ data: [], paging: {} }) });
  assert.equal((await call('/fb/published?page=111&after=' + long)).status, 200);
  const req = f.calls.find((c) => c.path === '/111/published_posts');
  assert.equal(req.query.after, long, '游標原樣轉給臉書');
  assert.equal((await call('/fb/published?page=111&after=' + encodeURIComponent('a b<'))).status, 400);
  assert.equal((await call('/fb/published?page=111&after=' + 'a'.repeat(4001))).status, 400);
});
