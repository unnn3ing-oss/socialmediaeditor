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
  return { f, state, obj, post, env };
}
const REC = (at) => ({ pageId: '111', postId: '111_5', message: '看更多新聞內容\nhttps://x', at });
// 對排程中（還沒發布）的貼文留言：臉書回 (#100) subcode 33
const NOT_YET = () => Response.json({ error: { code: 100, error_subcode: 33, message: "Unsupported post request. Object with ID '111_5' does not exist, cannot be loaded due to missing permissions" } }, { status: 400 });
const comments = (f) => f.calls.filter((c) => c.method === 'POST' && /\/comments$/.test(c.path));
// 留言都結束後：鬧鐘改排 14 天後清除
const DAY = 86400 * 1000;
async function assertPurge(state) {
  const a = await state.storage.getAlarm();
  assert.ok(a > Date.now() + 14 * DAY - 60000 && a <= Date.now() + 14 * DAY, '應排 14 天後清除，實際 ' + a);
}

test('arm：鬧鐘＝排定時間＋60 秒', async (t) => {
  const { state, post } = await mk(t, {});
  const at = nowSec() + 3600;
  assert.equal((await post('arm', REC(at))).ok, true);
  assert.equal(await state.storage.getAlarm(), (at + 60) * 1000);
  assert.equal((await post('status')).status, 'pending');
});

test('立即貼文的零延遲留言立即到點，依原順序發送', async (t) => {
  const { f, state, obj, post } = await mk(t, { 'POST /111_5/comments': () => ({ id: 'C9' }) });
  const at = nowSec();
  assert.equal((await post('arm', { ...REC(at), published: true, immediateExtras: true, items: [{ message: '二', offset: 0 }, { message: '三', offset: 0 }, { message: '稍後', offset: 5 }] })).ok, true);
  assert.equal(await state.storage.getAlarm(), at * 1000);
  await obj.alarm();
  assert.deepEqual(comments(f).map(call => call.body.message), ['二', '三']);
  assert.equal(await state.storage.getAlarm(), (at + 360) * 1000);
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

test('先留言；臉書回 100-33 才查，臉書時間變了 → 跟著新時間、次數歸零、不提醒', async (t) => {
  const newAt = nowSec() + 7200;
  const { f, state, obj, post } = await mk(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': () => ({ id: '111_5', is_published: false, scheduled_publish_time: newAt }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'pending'); assert.equal(s.at, newAt); assert.equal(s.retimes, 1);
  assert.equal(s.items[0].attempts, 0); assert.equal(s.alert, null);
  assert.equal(await state.storage.getAlarm(), (newAt + 60) * 1000);
  assert.equal(comments(f).length, 1, '先試留一次');
});

test('臉書時間是 ISO 字串也能比對', async (t) => {
  const newAt = nowSec() + 7200;
  const { obj, post } = await mk(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': () => ({ id: '111_5', is_published: false, scheduled_publish_time: new Date(newAt * 1000).toISOString() }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).at, newAt);
});

test('留言 100-33、查貼文也不存在（HTTP 404）→ canceled，操作紀錄記一筆', async (t) => {
  const { f, obj, post, env } = await mk(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': () => gErr(100, 404, 'does not exist') });
  await post('arm', { ...REC(nowSec() - 60), title: '測試標題' });
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'canceled'); assert.equal(s.alert, null);
  assert.equal(comments(f).length, 1);
  const a = env.DB.raw.prepare("SELECT * FROM fb_audit WHERE action = 'post_gone'").all();
  assert.equal(a.length, 1); assert.equal(a[0].uid, 'SYSTEM'); assert.equal(a[0].page, '111'); assert.equal(a[0].post, '111_5'); assert.match(a[0].detail, /測試標題/);
});

test('posting 中斷後重跑：臉書上已有相同留言 → done，不再留言', async (t) => {
  const { f, state, obj, post } = await mk(t, {
    'GET /111_5': () => ({ id: '111_5', is_published: true }),
    'GET /111_5/comments': () => ({ data: [{ id: 'C1', from: { id: '111' }, message: '看更多新聞內容\nhttps://x' }] })
  });
  await post('arm', REC(nowSec() - 60));
  const rec = await state.storage.get('rec'); rec.items[0].status = 'posting'; await state.storage.put('rec', rec);
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'done'); assert.equal(s.commentId, 'C1');
  assert.equal(comments(f).length, 0);
});

test('一般錯誤重試 30/30/60/240 秒（到點、+30、+60、+120、+360），第 5 次失敗 → failed', async (t) => {
  const { f, state, obj, post } = await mk(t, {
    'POST /111_5/comments': () => gErr(2, 500, 'temporary'),
    'GET /111_5/comments': () => ({ data: [] })
  });
  await post('arm', REC(nowSec() - 60));
  const gaps = [];
  for (let i = 0; i < 4; i++) {
    const before = Date.now();
    await obj.alarm();
    gaps.push(Math.round(((await state.storage.getAlarm()) - before) / 1000));
    assert.equal((await post('status')).items[0].status, 'posting');
  }
  assert.deepEqual(gaps, [30, 30, 60, 240]);
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'failed'); assert.equal(s.attempts, 5); assert.match(s.error, /暫時無法使用/);
  assert.ok(!f.calls.some((c) => c.method === 'GET' && c.path === '/111_5'), '不是 100-33 不查貼文狀態');
});

test('限流錯誤 → 立刻 failed', async (t) => {
  const { obj, post } = await mk(t, { 'POST /111_5/comments': () => gErr(32, 400, 'page rate limit') });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'failed'); assert.match(s.error, /限流/);
});

test('cancel 後觸發不呼叫臉書；retime 只在 pending 有效', async (t) => {
  const { f, state, obj, post } = await mk(t, { 'GET /111_5': () => ({ is_published: true }), 'POST /111_5/comments': () => ({ id: 'C' }) });
  await post('arm', REC(nowSec() + 3600));
  const at2 = nowSec() + 9000;
  assert.equal((await post('retime', { at: at2 })).ok, true);
  assert.equal(await state.storage.getAlarm(), (at2 + 60) * 1000);
  await post('cancel');
  await assertPurge(state);
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

test('還沒發布、臉書沒給新時間：照重試，第 4 次（2 分鐘）提醒「貼文還沒發布」，第 5 次 failed', async (t) => {
  const { obj, state, post } = await mk(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': () => ({ is_published: false }) });
  await post('arm', REC(nowSec() - 60));
  for (let i = 0; i < 3; i++) await obj.alarm();
  assert.equal((await post('status')).alert, null);
  await obj.alarm();
  assert.equal((await post('status')).alert.error, '貼文還沒發布');
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'failed'); assert.equal(s.alert.error, '貼文還沒發布');
  await assertPurge(state);
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
  assert.equal((await post('status')).items[0].status, 'posting', '狀態保持 posting，下次先查');
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'done'); assert.equal(s.commentId, 'C7');
  assert.equal(n, 1);
});

test('code 100 但不是「物件不存在」→ 不查貼文、不當成取消，走重試', async (t) => {
  const { obj, post } = await mk(t, { 'POST /111_5/comments': () => Response.json({ error: { code: 100, message: 'Tried accessing nonexisting field' } }, { status: 400 }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  const s = await post('status');
  assert.notEqual(s.status, 'canceled');
  assert.equal(s.attempts, 1);
});

test('留言 100-33、查貼文也 100-33（物件不存在）→ canceled', async (t) => {
  const { obj, post } = await mk(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': () => Response.json({ error: { code: 100, error_subcode: 33, message: 'does not exist' } }, { status: 400 }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).status, 'canceled');
});

// ---- 多則留言：第 1 則＋第 2、3 則（各自距發布 offset 分鐘） ----
const MULTI = (at) => ({ pageId: '111', postId: '111_5', at, items: [{ message: '看更多\nhttps://x', offset: 0 }, { message: '第二則', offset: 5 }, { message: '第三則', offset: 15 }] });

test('多則留言：到點的依序留，沒到的排下一個鬧鐘；全部留完 done', async (t) => {
  let n = 0;
  const { f, state, obj, post } = await mk(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => ({ id: 'C' + (++n) })
  });
  const at = nowSec() - 120;                        // 第 1 則已到點；第 2 則在 at+60+300
  await post('arm', MULTI(at));
  assert.equal(await state.storage.getAlarm(), (at + 60) * 1000);
  await obj.alarm();
  let s = await post('status');
  assert.deepEqual(s.items.map((x) => x.status), ['done', 'pending', 'pending']);
  assert.equal(s.status, 'pending', '還有沒留的');
  assert.equal(await state.storage.getAlarm(), (at + 60 + 300) * 1000);
  assert.deepEqual(comments(f).map((c) => c.body.message), ['看更多\nhttps://x']);
  // 時間快轉：全部到點
  const rec = await state.storage.get('rec'); rec.at = nowSec() - 2000; await state.storage.put('rec', rec);
  await obj.alarm();
  s = await post('status');
  assert.deepEqual(s.items.map((x) => x.status), ['done', 'done', 'done']);
  assert.equal(s.status, 'done');
  assert.deepEqual(comments(f).map((c) => c.body.message), ['看更多\nhttps://x', '第二則', '第三則'], '依序留');
  await assertPurge(state);
  assert.equal(f.calls.filter((c) => c.method === 'GET' && c.path === '/111_5').length, 0, '排程貼文不先查發布，直接留');
});

test('多則留言：中間一則失敗重試，不影響已留的；取消後剩下的不留', async (t) => {
  let fail = true;
  const { f, obj, state, post } = await mk(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': (c) => (c.body.message === '第二則' && fail ? gErr(2, 500, 'temp') : { id: 'C' }),
    'GET /111_5/comments': () => ({ data: [] })
  });
  await post('arm', MULTI(nowSec() - 1000));
  await obj.alarm();
  let s = await post('status');
  assert.deepEqual(s.items.map((x) => x.status), ['done', 'posting', 'pending']);
  assert.equal(s.items[1].attempts, 1);
  fail = false;
  await obj.alarm();
  s = await post('status');
  assert.deepEqual(s.items.map((x) => x.status), ['done', 'done', 'done']);
  // 新的一組：取消後不留
  const st2 = await mk(t, { 'GET /111_5': () => ({ is_published: true }), 'POST /111_5/comments': () => ({ id: 'C' }) });
  await st2.post('arm', MULTI(nowSec() - 120));
  await st2.obj.alarm();
  await st2.post('cancel');
  const s2 = await st2.post('status');
  assert.deepEqual(s2.items.map((x) => x.status), ['done', 'canceled', 'canceled']);
  await assertPurge(st2.state);
});

test('多則留言：改時間後全部跟著平移', async (t) => {
  const { state, post } = await mk(t, {});
  const at = nowSec() + 3600, at2 = nowSec() + 7200;
  await post('arm', MULTI(at));
  await post('retime', { at: at2 });
  assert.equal((await post('status')).at, at2);
  assert.equal(await state.storage.getAlarm(), (at2 + 60) * 1000);
});

test('arm 驗證：最多 4 則（含警語）、offset 不可倒退', async (t) => {
  const { post } = await mk(t, {});
  const at = nowSec() + 3600;
  assert.equal((await post('arm', { ...MULTI(at), items: [...MULTI(at).items, { message: 'x', offset: 20 }, { message: 'y', offset: 25 }] })).ok, false);
  assert.equal((await post('arm', { ...MULTI(at), items: [{ message: 'a', offset: 10 }, { message: 'b', offset: 5 }] })).ok, false);
});

test('兩則內容相同：第 2 則中斷後重查，不能把第 1 則當成它', async (t) => {
  let n = 0;
  const { f, state, obj, post } = await mk(t, {
    'GET /111_5': () => ({ is_published: true }),
    'GET /111_5/comments': () => ({ data: [{ id: 'C1', from: { id: '111' }, message: '一樣' }] }),
    'POST /111_5/comments': () => ({ id: 'C' + (++n + 1) })
  });
  await post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 1000, items: [{ message: '一樣', offset: 0 }, { message: '一樣', offset: 5 }] });
  const rec = await state.storage.get('rec');
  Object.assign(rec.items[0], { status: 'done', commentId: 'C1' });
  rec.items[1].status = 'posting'; rec.published = true;
  await state.storage.put('rec', rec);
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.items[1].status, 'done');
  assert.notEqual(s.items[1].commentId, 'C1', '不能沿用第 1 則的留言');
  assert.equal(comments(f).length, 1, '第 2 則真的有留');
});

test('前一則失敗（例如限流）：後面的也標失敗，不跳著留', async (t) => {
  const { f, obj, post } = await mk(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': (c) => (c.body.message === '第二則' ? gErr(32, 400, 'page rate limit') : { id: 'C' })
  });
  await post('arm', MULTI(nowSec() - 2000));
  await obj.alarm();
  const s = await post('status');
  assert.deepEqual(s.items.map((x) => x.status), ['done', 'failed', 'failed']);
  assert.match(s.items[2].error, /前一則/);
  assert.ok(!comments(f).some((c) => c.body.message === '第三則'), '第三則沒有留');
});

test('arm 帶 recheck：第 1 則可能已留過（回應錯誤但其實成功）→ 先查，有就不再留', async (t) => {
  const { f, obj, post } = await mk(t, {
    'GET /111_5': () => ({ is_published: true }),
    'GET /111_5/comments': () => ({ data: [{ id: 'C9', from: { id: '111' }, message: '看更多\nhttps://x' }] })
  });
  await post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 60, items: [{ message: '看更多\nhttps://x', offset: 0, recheck: true }] });
  assert.equal((await post('status')).items[0].status, 'posting');
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.items[0].status, 'done'); assert.equal(s.items[0].commentId, 'C9');
  assert.equal(comments(f).length, 0);
});

test('錯誤說明標出步驟：確認是否已留被擋（#10）→「確認是否已留：」，不是「留言：」', async (t) => {
  const deny = () => Response.json({ error: { code: 10, message: "(#10) This endpoint requires the 'pages_read_engagement' permission" } }, { status: 400 });
  const { f, obj, post } = await mk(t, { 'GET /111_5': () => ({ is_published: true }), 'GET /111_5/comments': deny });
  await post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 60, items: [{ message: '看更多\nhttps://x', offset: 0, recheck: true }] });
  await obj.alarm();
  const s = await post('status');
  assert.match(s.items[0].error, /^確認是否已留：/);
  assert.equal(comments(f).length, 0, '讀不到不能直接再留（可能重複）');
});

test('錯誤說明標出步驟：確認發布失敗 →「確認發布：」；留言本身失敗 →「留言：」', async (t) => {
  const deny = () => Response.json({ error: { code: 10, message: 'denied' } }, { status: 400 });
  const a = await mk(t, { 'GET /111_5': () => gErr(2, 500, '(#2) temporary') });
  await a.post('arm', { ...REC(nowSec() - 60), kind: 'video' });   // 只有影片先查發布
  await a.obj.alarm();
  assert.match((await a.post('status')).error, /^確認發布：/);
  a.f.restore();
  const b = await mk(t, { 'GET /111_5': () => ({ is_published: true }), 'POST /111_5/comments': deny });
  await b.post('arm', REC(nowSec() - 60));
  await b.obj.alarm();
  assert.match((await b.post('status')).error, /^留言：/);
});

test('確認發布被擋（#10）：不卡住，直接留言，以臉書回應為準', async (t) => {
  const { f, obj, post } = await mk(t, {
    'GET /111_5': () => Response.json({ error: { code: 10, message: "(#10) requires the 'pages_read_engagement' permission" } }, { status: 400 }),
    'POST /111_5/comments': () => ({ id: 'C9' })
  });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'done'); assert.equal(s.commentId, 'C9'); assert.equal(s.alert, null);
  assert.equal(comments(f).length, 1);
});

test('arm 帶 published：立即發布不再問「發布了沒」；n＝第幾則（通知顯示第 2 則）', async (t) => {
  const { f, obj, post } = await mk(t, { 'POST /111_5/comments': () => gErr(32, 400, 'page rate limit') });
  await post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 60, published: true, items: [{ message: '第二則', offset: 0, n: 2 }] });
  await obj.alarm();
  const s = await post('status');
  assert.ok(!f.calls.some((c) => c.method === 'GET' && c.path === '/111_5'), '不讀貼文發布狀態');
  assert.equal(s.alert.seq, 2);
});

test('留言沒收到臉書回應（5xx）：下次先查留言清單，有就完成、不重留', async (t) => {
  let n = 0;
  const { f, obj, post } = await mk(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => (n++ === 0 ? gErr(1, 500, '(#1) unknown') : { id: 'X' }),
    'GET /111_5/comments': () => ({ data: [{ id: 'C9', from: { id: '111' }, message: '看更多新聞內容\nhttps://x' }] })
  });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).items[0].status, 'posting');
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.status, 'done'); assert.equal(s.commentId, 'C9');
  assert.equal(comments(f).length, 1, '只送過一次');
});

test('提醒後自動重試成功：通知消失，錯誤日誌保留並由系統結案', async (t) => {
  let fail = true;
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => (fail ? gErr(100, 400, 'bad') : { id: 'C1' })
  });
  await post('arm', REC(nowSec() - 60));
  for (let i = 0; i < 4; i++) await obj.alarm();
  assert.equal(notices(env).length, 1);
  assert.equal(failLogs(env).length, 1);
  fail = false;
  await obj.alarm();
  assert.equal((await post('status')).status, 'done');
  assert.equal(notices(env).length, 0, '通知消失');
  assert.equal(failLogs(env).length, 1, '錯誤日誌保留');
  assert.equal(failLogs(env)[0].st, 'closed');
});

test('通知只放簡短概述；錯誤日誌 detail 放完整說明（含步驟）＋臉書原文', async (t) => {
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => Response.json({ error: { code: 10, message: '(#10) Permission denied' } }, { status: 400 })
  });
  await post('arm', REC(nowSec() - 60));
  for (let i = 0; i < 4; i++) await obj.alarm();
  assert.equal(notices(env)[0].error, '權限不足');
  assert.equal((await post('status')).alert.error, '權限不足');
  const d = failLogs(env)[0].detail;
  assert.match(d, /^留言：/); assert.match(d, /臉書原文：\(#10\) Permission denied/);
});

test('briefOf：各種錯誤的概述', async () => {
  const { briefOf } = await lm();
  assert.equal(briefOf({ ecode: 32 }), '臉書限流');
  assert.equal(briefOf({ ecode: 190 }), '權杖失效');
  assert.equal(briefOf({ ecode: 2 }), '臉書暫時無法服務');
  assert.equal(briefOf({ error: '前一則留言失敗，未留' }), '前一則失敗，未留');
  assert.equal(briefOf({ status: 'failed', unsure: true, ecode: 10 }), '可能已留上，請到臉書確認');
  assert.equal(briefOf({}), '留言沒有成功');
});

test('舊紀錄（部署前已失敗、沒有 v）按重新留言：有試過的先查再留', async (t) => {
  const { state, post } = await mk(t, {});
  await state.storage.put('rec', { pageId: '111', postId: '111_5', at: nowSec() - 600, published: true, retimes: 0, items: [{ message: 'm', offset: 0, status: 'failed', attempts: 5, error: 'x' }] });
  assert.equal((await post('retry', { pageId: '111' })).ok, true);
  assert.equal((await post('status')).items[0].status, 'posting');
});

test('armTimer：計時器拒收（資料不完整）會丟錯，不能當成排好了', async () => {
  const { armTimer } = await lm();
  const env = { FB_TIMER: { idFromName: (n) => ({ name: n }), get: () => ({ fetch: async () => Response.json({ ok: false, error: '資料不完整' }) }) } };
  await assert.rejects(() => armTimer(env, { postId: '1_2', items: [] }), /資料不完整/);
});

test('留言都結束 14 天後：整筆紀錄刪除，status 回 none；還沒到不刪', async (t) => {
  const { f, state, obj, post } = await mk(t, {
    'GET /111_5': () => ({ id: '111_5', is_published: true }),
    'POST /111_5/comments': () => ({ id: 'C9' })
  });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  await assertPurge(state);
  await obj.alarm();   // 清除時間還沒到：不刪、不呼叫臉書
  assert.equal((await post('status')).status, 'done');
  const calls = f.calls.length;
  const rec = await state.storage.get('rec');
  rec.purgeAt = Date.now() - 1;
  await state.storage.put('rec', rec);
  await obj.alarm();
  assert.equal((await post('status')).status, 'none');
  assert.equal(state.storage.map.size, 0);
  assert.equal(await state.storage.getAlarm(), null);
  assert.equal(f.calls.length, calls, '清除不呼叫臉書');
});

test('取消後也排 14 天清除；之前已結束但沒有 purgeAt 的舊紀錄，觸發時補排', async (t) => {
  const { state, obj, post } = await mk(t, {});
  await post('arm', REC(nowSec() + 3600));
  await post('cancel');
  await assertPurge(state);
  const rec = await state.storage.get('rec');
  delete rec.purgeAt;
  await state.storage.put('rec', rec);
  await state.storage.deleteAlarm();
  await obj.alarm();
  await assertPurge(state);
  assert.equal((await post('status')).status, 'canceled');
});

test('同一貼文重新 arm：清除排程取消，回到等待留言', async (t) => {
  const { state, post } = await mk(t, {});
  await post('arm', REC(nowSec() + 3600));
  await post('cancel');
  const at = nowSec() + 7200;
  await post('arm', REC(at));
  assert.equal(await state.storage.getAlarm(), (at + 60) * 1000);
  assert.equal((await state.storage.get('rec')).purgeAt, undefined);
});

test('舊紀錄已結束、沒有鬧鐘也沒有 purgeAt：查 status 時補排 14 天清除', async (t) => {
  const { state, post } = await mk(t, {});
  await state.storage.put('rec', { pageId: '111', postId: '111_5', at: nowSec() - 9999, published: true, retimes: 0, items: [{ message: 'x', offset: 0, status: 'done', attempts: 0, commentId: 'C1' }] });
  assert.equal(await state.storage.getAlarm(), null);
  assert.equal((await post('status')).status, 'done');
  await assertPurge(state);
});

// ===== 多文（影片發布）=====
const ACC3 = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }, { id: '222', name: '少康', access_token: 'PT222' }, { id: '333', name: '國際', access_token: 'PT333' }] };
const XREC = (at, extra = {}) => ({ pageId: '111', postId: 'V1', at, kind: 'video', items: [], cross: ['222', '333'], ...extra });

test('多文：只有多文沒有留言也能 arm；發布後先 allow 再各粉專 crossposted_video_id', async (t) => {
  const { f, obj, post } = await mk(t, {
    'GET /me/accounts': () => ACC3,
    'GET /V1': () => ({ id: 'V1', published: true }),
    'POST /V1': () => ({ success: true }),
    'POST /222/videos': () => ({ id: 'X222' }),
    'POST /333/videos': () => ({ id: 'X333' })
  });
  assert.equal((await post('arm', XREC(nowSec() - 120))).ok, true);
  assert.equal((await post('status')).status, 'pending');
  await obj.alarm();
  const allow = f.calls.filter((c) => c.method === 'POST' && c.path === '/V1');
  assert.equal(allow.length, 1);
  assert.deepEqual(JSON.parse(allow[0].body.allow_crossposting_for_pages), [{ page_id: '222', allow: true }, { page_id: '333', allow: true }]);
  assert.equal(allow[0].body.access_token, 'PT111');
  const xs = f.calls.filter((c) => c.method === 'POST' && /^\/\d+\/videos$/.test(c.path));
  assert.deepEqual(xs.map((c) => [c.path, c.body.crossposted_video_id, c.body.access_token]), [['/222/videos', 'V1', 'PT222'], ['/333/videos', 'V1', 'PT333']]);
  const s = await post('status');
  assert.equal(s.status, 'done');
  assert.deepEqual(s.cross, [{ page: '222', status: 'done', videoId: 'X222' }, { page: '333', status: 'done', videoId: 'X333' }]);
  await obj.alarm();
  assert.equal(f.calls.filter((c) => c.method === 'POST' && /^\/\d+\/videos$/.test(c.path)).length, 2, '不重複多文');
});

test('多文：一個粉專失敗會拉長間隔重試、不影響另一個；限流立刻失敗', async (t) => {
  let n222 = 0;
  const { f, state, obj, post } = await mk(t, {
    'GET /me/accounts': () => ACC3,
    'GET /V1': () => ({ id: 'V1', published: true }),
    'POST /V1': () => ({ success: true }),
    'POST /222/videos': () => { n222++; return n222 === 1 ? gErr(1363026, 400, '影片還在處理') : { id: 'X222' }; },
    'POST /333/videos': () => gErr(4, 400, '限流')
  });
  await post('arm', XREC(nowSec() - 120));
  await obj.alarm();
  let s = await post('status');
  assert.deepEqual(s.cross.map((c) => c.status), ['pending', 'failed']);
  const a = await state.storage.getAlarm();
  assert.ok(a >= Date.now() + 55000 && a <= Date.now() + 61000, '第 1 次失敗 60 秒後再試');
  const rec = await state.storage.get('rec'); rec.cross[0].next = Date.now() - 1; await state.storage.put('rec', rec);
  await obj.alarm();
  s = await post('status');
  assert.deepEqual(s.cross.map((c) => c.status), ['done', 'failed']);
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path === '/V1').length, 1, 'allow 只做一次');
});

test('多文：posting 途中中斷 → 不重送，標結果不明', async (t) => {
  const { f, state, obj, post } = await mk(t, { 'GET /me/accounts': () => ACC3, 'GET /V1': () => ({ id: 'V1', published: true }) });
  await post('arm', XREC(nowSec() - 120, { cross: ['222'] }));
  const rec = await state.storage.get('rec'); rec.cross[0].status = 'posting'; rec.published = true; rec.crossAllowed = true; await state.storage.put('rec', rec);
  await obj.alarm();
  assert.equal((await post('status')).cross[0].status, 'unknown');
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
});

test('多文：cancel 一起取消；非影片不收 cross', async (t) => {
  const { post } = await mk(t, {});
  await post('arm', XREC(nowSec() + 3600));
  await post('cancel');
  const s = await post('status');
  assert.deepEqual(s.cross.map((c) => c.status), ['canceled', 'canceled']);
  assert.equal(s.status, 'done');
  assert.equal((await post('arm', { ...XREC(nowSec() + 3600), kind: undefined })).ok, false, '非影片：沒有留言又不能多文 → 不接受');
  assert.equal((await post('arm', XREC(nowSec() + 3600, { cross: ['abc'] }))).ok, false);
});

// ===== 留言失敗提醒（2026-11-22）：第 2 次失敗起紅字＋通知；最後失敗寫錯誤日誌一次；重新留言 =====
const notices = (env) => { try { return env.DB.raw.prepare('SELECT * FROM fb_notices').all(); } catch { return []; } };
const failLogs = (env) => env.DB.raw.prepare("SELECT * FROM logs WHERE code LIKE 'comment_failed%'").all();
async function mkEnvTimer(t, handlers, extra = {}) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, ...handlers }); t.after(f.restore);
  const { FbCommentTimer } = await lm();
  const state = { storage: fakeStorage() };
  const env = mkEnv({ FB_USER_TOKEN: 'U', ...extra });
  const obj = new FbCommentTimer(state, env);
  const post = async (action, body) => (await obj.fetch(new Request('https://timer/' + action, { method: 'POST', body: JSON.stringify(body || {}) }))).json();
  return { f, state, obj, post, env };
}

test('提醒：第 1～3 次失敗不提醒；第 4 次失敗（2 分鐘）起 alert＋通知＋寫一次錯誤日誌（含粉專 ID 與錯誤碼）', async (t) => {
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ id: '111_5', is_published: true }),
    'POST /111_5/comments': () => gErr(2, 500, '(#2) temporary'),
    'GET /111_5/comments': () => ({ data: [] })
  });
  await post('arm', REC(nowSec() - 60));
  for (let i = 0; i < 3; i++) await obj.alarm();
  assert.equal((await post('status')).alert, null);
  assert.equal(notices(env).length, 0);
  await obj.alarm();
  const s = await post('status');
  assert.deepEqual({ seq: s.alert.seq, failed: s.alert.failed }, { seq: 1, failed: false });
  const n = notices(env);
  assert.equal(n.length, 1); assert.equal(n[0].post_id, '111_5'); assert.equal(n[0].page, '111'); assert.equal(n[0].kind, 'post'); assert.equal(n[0].failed, 0);
  assert.equal(failLogs(env).length, 1, '跳出提醒就寫錯誤日誌');
  await obj.alarm();
  assert.equal((await post('status')).alert.failed, true);
  assert.equal(notices(env)[0].failed, 1);
  const logs = failLogs(env);
  assert.equal(logs.length, 1); assert.equal(logs[0].tool, 'fbpost'); assert.equal(logs[0].code, 'comment_failed:2'); assert.equal(logs[0].page, '111'); assert.ok(logs[0].detail, '錯誤日誌保留臉書英文原文');
  await obj.alarm(); await post('status');
  assert.equal(failLogs(env).length, 1, '同一則只記一次');
});

test('提醒：限流直接失敗也提醒；後面「前一則失敗未留」不另記錯誤日誌', async (t) => {
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': (c) => (c.body.message === '第二則' ? gErr(32, 400, 'page rate limit') : { id: 'C' })
  });
  await post('arm', MULTI(nowSec() - 2000));
  await obj.alarm();
  const s = await post('status');
  assert.equal(s.alert.seq, 2); assert.equal(s.alert.failed, true);
  assert.equal(notices(env)[0].seq, 2);
  assert.equal(failLogs(env).length, 1);
  assert.equal(failLogs(env)[0].code, 'comment_failed:32');
});

test('重新留言：粉專不符拒絕；失敗的那則起歸零；臉書明確回錯誤的直接重留（不讀留言），成功後通知刪除', async (t) => {
  let fail = true;
  const { f, state, obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': (c) => (fail && c.body.message === '第二則' ? gErr(32, 400, 'page rate limit') : { id: 'C-' + c.body.message }),
    'GET /111_5/comments': () => ({ data: [] })
  });
  await post('arm', MULTI(nowSec() - 2000));
  await obj.alarm();
  assert.equal(notices(env).length, 1);
  assert.equal((await post('retry', { pageId: '999' })).ok, false);
  fail = false;
  assert.equal((await post('retry', { pageId: '111' })).ok, true);
  const mid = await post('status');
  assert.deepEqual(mid.items.map((x) => x.status), ['done', 'pending', 'pending']);
  assert.equal(mid.alert, null);
  assert.deepEqual(notices(env).map((n) => [n.state, n.how]), [['handled', 'retry']], '重新留言＝已補留言，留給看全部的人（黃框）');
  assert.ok((await state.storage.getAlarm()) <= Date.now());
  await obj.alarm();
  const s = await post('status');
  assert.deepEqual(s.items.map((x) => x.status), ['done', 'done', 'done']);
  assert.ok(!f.calls.some((c) => c.method === 'GET' && c.path === '/111_5/comments'), '確定沒留的不用讀留言清單');
  assert.equal((await post('retry', { pageId: '111' })).ok, false, '都完成就沒有可重試的');
});

test('提醒：影片的留言 tool 記 fbvideo、通知 kind video', async (t) => {
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ id: '111_5', published: true }),
    'POST /111_5/comments': () => gErr(32, 400, 'rate limit')
  });
  await post('arm', { ...REC(nowSec() - 60), kind: 'video' });
  await obj.alarm();
  assert.equal(notices(env)[0].kind, 'video');
  assert.equal(failLogs(env)[0].tool, 'fbvideo');
});

test('提醒：取消（貼文刪除）後通知收掉；status 回 kind', async (t) => {
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => gErr(32, 400, 'rate limit')
  });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal(notices(env).length, 1);
  assert.equal((await post('status')).kind, 'post');
  await post('cancel');
  assert.equal(notices(env).length, 0);
  assert.equal((await post('status')).alert, null);
});

test('發文者：arm 帶 by 寫進通知；沒帶就空白', async (t) => {
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => gErr(32, 400, 'rate limit')
  });
  await post('arm', { ...REC(nowSec() - 60), by: 'P1' });
  await obj.alarm();
  assert.equal(notices(env)[0].by, 'P1');
});

test('通知帶貼文摘要：arm 帶 title 寫進 fb_notices', async (t) => {
  const { obj, post, env } = await mkEnvTimer(t, {
    'GET /111_5': () => ({ is_published: true }),
    'POST /111_5/comments': () => gErr(32, 400, 'rate limit')
  });
  await post('arm', { ...REC(nowSec() - 60), by: 'P1', title: '颱風最新' });
  await obj.alarm();
  assert.equal(notices(env)[0].title, '颱風最新');
});

test('第 1 則留言再編輯一次：開關打開才編輯（相同內容）；關閉不編輯；編輯失敗仍算留言成功', async (t) => {
  const { saveCommentOpts } = await import('../../server/fb/comment.js');
  const edits = (f) => f.calls.filter((c) => c.method === 'POST' && c.path === '/C9');
  // 關閉（預設）
  let m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }) });
  await m.post('arm', REC(nowSec() - 60)); await m.obj.alarm();
  assert.equal(edits(m.f).length, 0);
  // 打開
  m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }), 'POST /C9': () => ({ success: true }) });
  await saveCommentOpts(m.env, { edit: true });
  await m.post('arm', REC(nowSec() - 60)); await m.obj.alarm();
  assert.equal(edits(m.f).length, 1);
  assert.equal(edits(m.f)[0].body.message, '看更多新聞內容\nhttps://x');
  assert.equal(edits(m.f)[0].body.access_token, 'PT111');
  // 打開但編輯失敗：留言照樣 done
  m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }), 'POST /C9': () => gErr(100, 'nope') });
  await saveCommentOpts(m.env, { edit: true });
  await m.post('arm', REC(nowSec() - 60)); await m.obj.alarm();
  assert.equal((await m.post('status')).status, 'done');
  assert.equal(comments(m.f).length, 1);
  // 指定員工：看計時器記的發文者（by）
  m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }), 'POST /C9': () => ({ success: true }) });
  await saveCommentOpts(m.env, { edit: true, who: 'some', staff: ['A1'] });
  await m.post('arm', { ...REC(nowSec() - 60), by: 'B2' }); await m.obj.alarm();
  assert.equal(edits(m.f).length, 0, '發文者不在名單');
  m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }), 'POST /C9': () => ({ success: true }) });
  await saveCommentOpts(m.env, { edit: true, who: 'some', staff: ['A1'] });
  await m.post('arm', { ...REC(nowSec() - 60), by: 'A1' }); await m.obj.alarm();
  assert.equal(edits(m.f).length, 1, '發文者在名單');
});

test('第 1 則留言移除預覽（np）：A＝先文字再編輯、B＝帶空附件；結果記在 items；A 中斷後查到只有文字的留言會補編輯、不重留', async (t) => {
  const FULL = '看更多新聞內容\nhttps://x';
  const items = (np) => [{ message: FULL, offset: 0, n: 1, ...(np ? { np } : {}) }];
  const posts = (f) => comments(f).map((c) => c.body.message);
  const eds = (f) => f.calls.filter((c) => c.method === 'POST' && c.path === '/C9');
  // A
  let m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }), 'POST /C9': () => ({ success: true }) });
  await m.post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 60, items: items('a') }); await m.obj.alarm();
  assert.deepEqual(posts(m.f), ['看更多新聞內容']);
  assert.equal(eds(m.f)[0].body.message, FULL);
  let st = await m.post('status');
  assert.deepEqual([st.status, st.items[0].preview], ['done', 'tried']);
  // B
  m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }), 'POST /C9': () => ({ success: true }) });
  await m.post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 60, items: items('b') }); await m.obj.alarm();
  assert.deepEqual(posts(m.f), [FULL]);
  assert.equal(eds(m.f)[0].body.attachment_share_url, '');
  // 沒帶 np：照舊
  m = await mk(t, { 'GET /111_5': () => ({ id: '111_5', is_published: true }), 'POST /111_5/comments': () => ({ id: 'C9' }), 'POST /C9': () => ({ success: true }) });
  await m.post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 60, items: items(null) }); await m.obj.alarm();
  assert.equal(eds(m.f).length, 0);
  // A 中斷（上次可能已留前半）：查到只有文字的留言 → 不重留，補編輯
  m = await mk(t, {
    'GET /111_5': () => ({ id: '111_5', is_published: true }),
    'GET /111_5/comments': () => ({ data: [{ id: 'C9', from: { id: '111' }, message: '看更多新聞內容' }] }),
    'POST /111_5/comments': () => ({ id: 'C8' }), 'POST /C9': () => ({ success: true })
  });
  await m.post('arm', { pageId: '111', postId: '111_5', at: nowSec() - 60, published: true, items: [{ ...items('a')[0], recheck: true }] }); await m.obj.alarm();
  assert.equal(comments(m.f).length, 0, '不重複留言');
  assert.equal(eds(m.f)[0].body.message, FULL);
  st = await m.post('status');
  assert.deepEqual([st.status, st.items[0].commentId, st.items[0].preview], ['done', 'C9', 'tried']);
});

// ===== 2026-11-26：先留再查、讀取被拒通知、列表校正 =====
test('先留言：一次就成功只打留言一次，不查發布狀態', async (t) => {
  const { f, obj, post } = await mk(t, { 'POST /111_5/comments': () => ({ id: 'C1' }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).status, 'done');
  const fb = f.calls.filter((c) => c.path.startsWith('/111_5'));
  assert.deepEqual(fb.map((c) => c.method + ' ' + c.path), ['POST /111_5/comments']);
});

test('讀取被拒：馬上通知系統管理者＋錯誤紀錄 read_denied（同粉專 24 小時一次）；發文者照 2 分鐘規則', async (t) => {
  const deny = () => Response.json({ error: { code: 10, message: "(#10) requires 'pages_read_engagement'" } }, { status: 400 });
  const { obj, post, env } = await mkEnvTimer(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': deny }, { SYS_STAFF_ID: 'SYS1' });
  await post('arm', { ...REC(nowSec() - 60), pageName: '新聞', title: '標題甲', by: 'A1' });
  await obj.alarm();
  const msgs = () => env.DB.raw.prepare('SELECT m.body, t.uid FROM staff_msgs m JOIN staff_msg_to t ON t.msg_id = m.id').all();
  assert.equal(msgs().length, 1); assert.equal(msgs()[0].uid, 'SYS1'); assert.match(msgs()[0].body, /新聞 讀不到貼文狀態（臉書碼 10）.*標題甲/);
  assert.equal(env.DB.raw.prepare("SELECT * FROM logs WHERE code = 'read_denied'").all().length, 1);
  assert.equal(notices(env).length, 0, '發文者還沒通知');
  for (let i = 0; i < 2; i++) await obj.alarm();
  assert.equal(msgs().length, 1, '24 小時內不重複');
  assert.equal(notices(env).length, 0);
  await obj.alarm();
  assert.equal(notices(env).length, 1, '第 4 次（2 分鐘）通知發文者');
  assert.equal(notices(env)[0].error, '貼文還沒發布');
});

test('列表校正（已排程）：100-33 失敗的貼文，列表看到新時間 → 恢復等待、通知撤掉、改用臉書時間', async (t) => {
  const { obj, post, env, state } = await mkEnvTimer(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': () => ({ is_published: false }) });
  await post('arm', MULTI(nowSec() - 60));
  for (let i = 0; i < 5; i++) await obj.alarm();
  let s = await post('status');
  assert.deepEqual(s.items.map((x) => x.status), ['failed', 'failed', 'failed']);
  assert.equal(notices(env).length, 1);
  const newAt = nowSec() + 7200;
  s = await post('status', { sync: { at: newAt } });
  assert.deepEqual(s.items.map((x) => x.status), ['pending', 'pending', 'pending']);
  assert.equal(s.at, newAt); assert.equal(s.alert, null); assert.equal(s.items[0].attempts, 0);
  assert.equal(notices(env).length, 0, '通知撤掉');
  assert.equal(await state.storage.getAlarm(), (newAt + 60) * 1000);
});

test('列表校正（已排程）：時間相同且還在等 → 不動次數；時間不同（改早）→ 跟著改', async (t) => {
  const { obj, post, state } = await mk(t, { 'POST /111_5/comments': () => gErr(2, 500, 'temporary'), 'GET /111_5/comments': () => ({ data: [] }) });
  const at = nowSec() + 3600;
  await post('arm', REC(at));
  let s = await post('status', { sync: { at } });
  assert.equal(s.at, at);
  const rec = await state.storage.get('rec'); rec.items[0].attempts = 2; await state.storage.put('rec', rec);
  s = await post('status', { sync: { at } });
  assert.equal(s.items[0].attempts, 2, '同時間不歸零（才不會蓋掉提醒）');
  const early = nowSec() + 600;
  s = await post('status', { sync: { at: early } });
  assert.equal(s.at, early); assert.equal(await state.storage.getAlarm(), (early + 60) * 1000);
  void obj;
});

test('列表校正（已發佈）：計時器還在等較晚的時間（臉書改早）→ 當成已發布、馬上留', async (t) => {
  const { f, obj, post, state } = await mk(t, { 'POST /111_5/comments': () => ({ id: 'C1' }) });
  await post('arm', REC(nowSec() + 3600));
  await post('status', { sync: { published: true } });
  assert.ok((await state.storage.getAlarm()) <= Date.now());
  await obj.alarm();
  assert.equal((await post('status')).status, 'done');
  assert.equal(comments(f).length, 1);
});

test('列表校正：已發布確認過的、影片、沒紀錄都不動', async (t) => {
  const { post, state } = await mk(t, {});
  await post('arm', { ...REC(nowSec() + 3600), published: true });
  const before = (await state.storage.get('rec')).at;
  await post('status', { sync: { at: nowSec() + 9999 } });
  assert.equal((await state.storage.get('rec')).at, before);
  await post('arm', { ...REC(nowSec() + 3600), kind: 'video' });
  const vb = (await state.storage.get('rec')).at;
  await post('status', { sync: { published: true } });
  assert.equal((await state.storage.get('rec')).at, vb);
  assert.equal((await state.storage.get('rec')).published, false);
});

test('工具改時間（retime）也能救回 100-33 失敗的留言', async (t) => {
  const { obj, post } = await mk(t, { 'POST /111_5/comments': NOT_YET, 'GET /111_5': () => ({ is_published: false }) });
  await post('arm', REC(nowSec() - 60));
  for (let i = 0; i < 5; i++) await obj.alarm();
  assert.equal((await post('status')).status, 'failed');
  const at = nowSec() + 3600;
  assert.equal((await post('retime', { at })).ok, true);
  const s = await post('status');
  assert.equal(s.status, 'pending'); assert.equal(s.at, at);
});

test('已發布後留言 100-33（不是還沒發布）：不再查貼文，照一般重試', async (t) => {
  const { f, obj, post } = await mk(t, { 'POST /111_5/comments': NOT_YET });
  await post('arm', { ...REC(nowSec() - 60), published: true });
  await obj.alarm();
  assert.equal((await post('status')).items[0].attempts, 1);
  assert.ok(!f.calls.some((c) => c.method === 'GET' && c.path === '/111_5'));
});

test('先 100-33 後改因別的錯誤失敗：不再顯示「貼文還沒發布」', async (t) => {
  let n = 0;
  const { obj, post } = await mk(t, { 'POST /111_5/comments': () => (n++ === 0 ? NOT_YET() : gErr(2, 500, 'temporary')), 'GET /111_5': () => ({ is_published: false }), 'GET /111_5/comments': () => ({ data: [] }) });
  await post('arm', REC(nowSec() - 60));
  await obj.alarm();
  assert.equal((await post('status')).items[0].notYet, true);
  await obj.alarm();
  assert.equal((await post('status')).items[0].notYet, undefined);
});
