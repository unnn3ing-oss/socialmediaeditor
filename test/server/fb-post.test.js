const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr, fakeNamespace } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, postMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const lp = async () => (postMod = postMod || (await import('../../server/fb/post.js')));

const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }, { id: '222', name: '少康', access_token: 'PT222' }] };

// 記錄 arm 的替身計時器
class RecTimer { constructor(state) { this.state = state; } async fetch(req) { const u = new URL(req.url); const b = await req.json().catch(() => ({})); RecTimer.log.push([u.pathname, b]); return Response.json({ ok: true }); } }
RecTimer.log = [];

async function setup(t, handlers) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, ...handlers }); t.after(f.restore);
  let env;
  env = mkEnv({ FB_USER_TOKEN: 'U', FB_TIMER: fakeNamespace(RecTimer, () => env) });
  RecTimer.log = [];
  env.DB.raw.prepare("INSERT INTO fb_pages (id, short, utm, rd, ord, show, updated) VALUES ('111','新聞','?&utm_source=facebook&utm_medium=fbarticlepic','news',0,1,0), ('222','少康','?&utm_source=facebook&utm_medium=2100roompic','shaokang',1,1,0)").run();
  const { signToken } = await tok();
  const headers = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, true)) };
  return { f, env, headers };
}
async function send(env, headers, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const w = await load();
  const r = await w.fetch(new Request('https://api.test/fb/post', { method: 'POST', body: fd, headers: { origin: ORIGIN, ...headers } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const img = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
const LINK = 'https://news.tvbs.com.tw/sports/4051394';

test('commentLink／commentText', async () => {
  const { commentLink, commentText } = await lp();
  assert.equal(commentLink(LINK, '?&utm_source=facebook&utm_medium=2100roomcomments'), LINK + '?&utm_source=facebook&utm_medium=2100roomcomments');
  assert.equal(commentLink('https://x.tw/a?a=1', '?&utm_source=f'), 'https://x.tw/a?a=1&utm_source=f');
  assert.equal(commentLink('https://x.tw/a?', '&utm_source=f'), 'https://x.tw/a?utm_source=f');
  assert.equal(commentLink('https://x.tw/a#x', '?&utm_source=f'), 'https://x.tw/a?&utm_source=f#x');
  assert.equal(commentLink(LINK, ''), LINK);
  assert.equal(commentText(LINK, ''), '看更多新聞內容\n' + LINK);
});

test('有圖立即：/photos 帶 caption → 馬上留言，各粉專各自 UTM', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /222/photos': () => ({ id: 'P2', post_id: '222_9' }),
    'POST /111_9/comments': () => ({ id: 'C1' }),
    'POST /222_9/comments': () => ({ id: 'C2' })
  });
  const r = await send(env, headers, { message: '【標題】', link: LINK, image: img(), targets: JSON.stringify([{ page: '111', at: null }, { page: '222', at: null }]) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const res = r.body.data.results;
  assert.deepEqual(res.map((x) => [x.page, x.ok, x.postId, x.scheduled, x.comment]), [['111', true, '111_9', false, 'done'], ['222', true, '222_9', false, 'done']]);
  const ph = f.calls.find((c) => c.path === '/111/photos');
  assert.equal(ph.body.caption, '【標題】');
  assert.equal(ph.body.access_token, 'PT111');
  assert.ok(ph.body.source, '有附圖檔');
  const c1 = f.calls.find((c) => c.path === '/111_9/comments').body.message;
  const c2 = f.calls.find((c) => c.path === '/222_9/comments').body.message;
  assert.equal(c1, '看更多新聞內容\n' + LINK + '?&utm_source=facebook&utm_medium=fbarticlepic');
  assert.equal(c2, '看更多新聞內容\n' + LINK + '?&utm_source=facebook&utm_medium=2100roompic');
});

test('有圖排程：暫存照片 → /feed attached_media＋SCHEDULED；不留言，設計時器', async (t) => {
  const at = nowSec() + 3600;
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'TMP1' }),
    'POST /111/feed': () => ({ id: '111_77' })
  });
  const r = await send(env, headers, { message: '內文', link: LINK, image: img(), targets: JSON.stringify([{ page: '111', at }]) });
  const x = r.body.data.results[0];
  assert.deepEqual([x.ok, x.postId, x.scheduled, x.at, x.comment], [true, '111_77', true, at, 'armed']);
  const ph = f.calls.find((c) => c.path === '/111/photos').body;
  assert.equal(ph.published, 'false'); assert.equal(ph.temporary, 'true');
  const feed = f.calls.find((c) => c.path === '/111/feed').body;
  assert.equal(feed.message, '內文');
  assert.equal(feed['attached_media[0]'], JSON.stringify({ media_fbid: 'TMP1' }));
  assert.equal(feed.published, 'false');
  assert.equal(feed.scheduled_publish_time, String(at));
  assert.equal(feed.unpublished_content_type, 'SCHEDULED');
  assert.ok(!f.calls.some((c) => /comments/.test(c.path)));
  assert.equal(RecTimer.log.length, 1);
  assert.equal(RecTimer.log[0][0], '/arm');
  assert.deepEqual(RecTimer.log[0][1], { pageId: '111', postId: '111_77', message: '看更多新聞內容\n' + LINK + '?&utm_source=facebook&utm_medium=fbarticlepic', at });
});

test('純文字（無圖）排程走 /feed；沒 link 不留言', async (t) => {
  const at = nowSec() + 3600;
  const { f, env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_5' }) });
  const r = await send(env, headers, { message: 'hi', targets: JSON.stringify([{ page: '111', at }]) });
  const x = r.body.data.results[0];
  assert.equal(x.ok, true); assert.equal(x.comment, 'none');
  const feed = f.calls.find((c) => c.path === '/111/feed').body;
  assert.equal(feed.scheduled_publish_time, String(at));
  assert.equal(RecTimer.log.length, 0);
});

test('第一個粉專失敗不影響第二個；時間超出範圍不呼叫臉書', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => gErr(200, 403, 'no permission'),
    'POST /222/photos': () => ({ id: 'P2', post_id: '222_1' }),
    'POST /222_1/comments': () => gErr(1, 500, 'boom')
  });
  const r = await send(env, headers, { message: 'm', link: LINK, image: img(), targets: JSON.stringify([{ page: '111', at: null }, { page: '222', at: null }]) });
  const [a, b] = r.body.data.results;
  assert.equal(a.ok, false); assert.match(a.error, /no permission/);
  assert.equal(b.ok, true); assert.equal(b.comment, 'failed'); assert.match(b.commentError, /boom/);
  const n = f.calls.length;
  const r2 = await send(env, headers, { message: 'm', image: img(), targets: JSON.stringify([{ page: '111', at: nowSec() + 300 }, { page: '222', at: nowSec() + 31 * 86400 }]) });
  assert.deepEqual(r2.body.data.results.map((x) => [x.ok, x.error]), [[false, 'fb_bad_time'], [false, 'fb_bad_time']]);
  assert.equal(f.calls.length, n, '沒有呼叫臉書');
});

test('請求驗證：粉專不在清單、targets 壞掉、圖檔型別', async (t) => {
  const { env, headers } = await setup(t, {});
  assert.equal((await send(env, headers, { message: 'm', targets: 'nope' })).status, 400);
  assert.equal((await send(env, headers, { message: 'm', targets: '[]' })).status, 400);
  assert.equal((await send(env, headers, { message: 'm', link: 'javascript:x', targets: JSON.stringify([{ page: '111', at: null }]) })).status, 400);
  assert.equal((await send(env, headers, { message: 'm', image: new File(['x'], 'a.gif', { type: 'image/gif' }), targets: JSON.stringify([{ page: '111', at: null }]) })).status, 400);
  const r = await send(env, headers, { message: 'm', targets: JSON.stringify([{ page: '999', at: null }]) });
  assert.equal(r.body.data.results[0].ok, false);
  assert.match(r.body.data.results[0].error, /粉專/);
});

test('排程成功後真的計時器有紀錄（整合）', async (t) => {
  const { FbCommentTimer } = await import('../../server/fb/timer.js');
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, 'POST /111/feed': () => ({ id: '111_8' }) }); t.after(f.restore);
  let env;
  env = mkEnv({ FB_USER_TOKEN: 'U', FB_TIMER: fakeNamespace(FbCommentTimer, () => env) });
  const { signToken } = await tok();
  const headers = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, true)) };
  const at = nowSec() + 3600;
  const r = await send(env, headers, { message: 'm', link: LINK, targets: JSON.stringify([{ page: '111', at }]) });
  assert.equal(r.body.data.results[0].comment, 'armed');
  const { state } = env.FB_TIMER.instances.get('111_8');
  assert.equal((await state.storage.get('rec')).status, 'pending');
  assert.equal(await state.storage.getAlarm(), (at + 60) * 1000);
});
