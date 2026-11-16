const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr, fakeStorage } = require('../helpers/fake-fb.js');

let mod;
const lm = async () => (mod = mod || (await import('../../server/fb/timer.js')));
const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }] };
const nowSec = () => Math.floor(Date.now() / 1000);

async function mk(t, handlers) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, ...handlers }); t.after(f.restore);
  const { FbCommentTimer } = await lm();
  const state = { storage: fakeStorage() };
  const env = mkEnv({ FB_USER_TOKEN: 'U' });
  const obj = new FbCommentTimer(state, env);
  const post = async (action, body) => (await obj.fetch(new Request('https://timer/' + action, { method: 'POST', body: JSON.stringify(body || {}) }))).json();
  return { f, state, obj, post };
}
const REC = (at) => ({ pageId: '111', postId: '111_5', message: '看更多新聞內容\nhttps://x', at });
const comments = (f) => f.calls.filter((c) => c.method === 'POST' && /\/comments$/.test(c.path));

test('arm：鬧鐘＝排定時間＋60 秒', async (t) => {
  const { state, post } = await mk(t, {});
  const at = nowSec() + 3600;
  assert.equal((await post('arm', REC(at))).ok, true);
  assert.equal(await state.storage.getAlarm(), (at + 60) * 1000);
  assert.equal((await post('status')).status, 'pending');
});

test('到點已發布 → 留言一次、done', async (t) => {
  const { f, obj, post } = await mk(t, {
    'GET /111_5': () => ({ id: '111_5', is_published: true }),
    'POST /111_5/comments': () => ({ id: 'C9' })
  });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'done'); assert.equal(s.commentId, 'C9');
  assert.equal(comments(f).length, 1);
  assert.equal(comments(f)[0].body.access_token, 'PT111');
  await obj.alarm();
  assert.equal(comments(f).length, 1, '再觸發也不重複留言');
});

test('到點未發布且臉書時間變了 → 跟著新時間，不留言', async (t) => {
  const newAt = nowSec() + 7200;
  const { f, state, obj, post } = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: false, scheduled_publish_time: newAt }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'pending'); assert.equal(s.at, newAt); assert.equal(s.retimes, 1);
  assert.equal(await state.storage.getAlarm(), (newAt + 60) * 1000);
  assert.equal(comments(f).length, 0);
});

test('臉書時間是 ISO 字串也能比對', async (t) => {
  const newAt = nowSec() + 7200;
  const { obj, post } = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: false, scheduled_publish_time: new Date(newAt * 1000).toISOString() }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).at, newAt);
});

test('貼文不存在 → canceled', async (t) => {
  const { f, obj, post } = await mk(t, { 'GET /111_5': () => gErr(100, 400, 'does not exist') });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).status, 'canceled');
  assert.equal(comments(f).length, 0);
});

test('posting 中斷後重跑：臉書上已有相同留言 → done，不再留言', async (t) => {
  const { f, state, obj, post } = await mk(t, {
    'GET /111_5': () => ({ id: '111_5', is_published: true }),
    'GET /111_5/comments': () => ({ data: [{ id: 'C1', from: { id: '111' }, message: '看更多新聞內容\nhttps://x' }] })
  });
  await post('arm', REC(nowSec() - 60));
  const rec = await state.storage.get('rec'); rec.status = 'posting'; await state.storage.put('rec', rec);
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'done'); assert.equal(s.commentId, 'C1');
  assert.equal(comments(f).length, 0);
});

test('一般錯誤重試 30/60/120/240 秒，第 5 次失敗 → failed', async (t) => {
  const { state, obj, post } = await mk(t, {
    'GET /111_5': () => ({ id: '111_5', is_published: true }),
    'POST /111_5/comments': () => gErr(2, 500, 'temporary'),
    'GET /111_5/comments': () => ({ data: [] })
  });
  await post('arm', REC(nowSec() - 60));
  const gaps = [];
  for (let i = 0; i < 4; i++) {
    const before = Date.now();
    await obj.alarm();
    gaps.push(Math.round(((await state.storage.getAlarm()) - before) / 1000));
    assert.equal((await post('status')).status, 'posting');
  }
  assert.deepEqual(gaps, [30, 60, 120, 240]);
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'failed'); assert.equal(s.attempts, 5); assert.match(s.error, /temporary/);
});

test('限流錯誤 → 立刻 failed', async (t) => {
  const { obj, post } = await mk(t, { 'GET /111_5': () => gErr(32, 400, 'page rate limit') });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'failed'); assert.match(s.error, /rate limit/);
});

test('cancel 後觸發不呼叫臉書；retime 只在 pending 有效', async (t) => {
  const { f, state, obj, post } = await mk(t, { 'GET /111_5': () => ({ is_published: true }), 'POST /111_5/comments': () => ({ id: 'C' }) });
  await post('arm', REC(nowSec() + 3600));
  const at2 = nowSec() + 9000;
  assert.equal((await post('retime', { at: at2 })).ok, true);
  assert.equal(await state.storage.getAlarm(), (at2 + 60) * 1000);
  await post('cancel');
  assert.equal(await state.storage.getAlarm(), null);
  const n = f.calls.length;
  await obj.alarm();
  assert.equal(f.calls.length, n);
  assert.equal((await post('status')).status, 'canceled');
  assert.equal((await post('retime', { at: at2 })).ok, false);
});

test('沒有紀錄時 status 回 none、retime／cancel 不出錯', async (t) => {
  const { post } = await mk(t, {});
  assert.equal((await post('status')).status, 'none');
  assert.equal((await post('retime', { at: nowSec() + 3600 })).ok, false);
  assert.equal((await post('cancel')).ok, true);
});

test('遲遲未發布：超過 20 次 → failed', async (t) => {
  const { obj, state, post } = await mk(t, { 'GET /111_5': () => ({ is_published: false }) });
  const at = nowSec() - 60;
  await post('arm', REC(at));
  for (let i = 0; i < 21; i++) await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'failed'); assert.match(s.error, /未發布/);
  assert.equal(await state.storage.getAlarm(), null);
});

test('留言送出後回應遺失：重試前先查，臉書上已有就不再留', async (t) => {
  let n = 0;
  const { f, obj, post } = await mk(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => { n++; throw new Error('network'); },
    'GET /111_5/comments': () => ({ data: [{ id: 'C7', from: { id: '111' }, message: '看更多新聞內容\nhttps://x' }] })
  });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).status, 'posting', '狀態保持 posting，下次先查');
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'done'); assert.equal(s.commentId, 'C7');
  assert.equal(n, 1);
});
