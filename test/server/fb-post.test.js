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
  env.DB.raw.prepare("UPDATE fb_pages SET utm_text = '?&utm_source=facebook&utm_medium=fbarticletext' WHERE id = '111'").run();
  const { signToken } = await tok();
  env.SYS_STAFF_ID = 'SYS1';
  const headers = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, 'SYS1', 1)) };
  return { f, env, headers };
}
async function send(env, headers, fields) {
  if (!('link' in fields)) fields = { link: 'https://news.tvbs.com.tw/sports/4051394', ...fields };   // 文章網址必填：沒指定就帶預設
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, v);
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
  assert.deepEqual(RecTimer.log[0][1], { pageId: '111', postId: '111_77', at, by: 'SYS1', title: '內文', pageName: '新聞', items: [{ message: '看更多新聞內容\n' + LINK + '?&utm_source=facebook&utm_medium=fbarticlepic', offset: 0, n: 1 }] });
});

test('純文字（無圖）排程走 /feed；沒有文章網址 → 400', async (t) => {
  const at = nowSec() + 3600;
  const { f, env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_5' }) });
  const r = await send(env, headers, { message: 'hi', targets: JSON.stringify([{ page: '111', at }]) });
  assert.equal(r.body.data.results[0].comment, 'armed');
  assert.equal(f.calls.find((c) => c.path === '/111/feed').body.scheduled_publish_time, String(at));
  for (const link of [undefined, '', '   ']) {
    assert.equal((await send(env, headers, { message: 'hi', link, targets: JSON.stringify([{ page: '111', at }]) })).status, 400, '文章網址必填：' + JSON.stringify(link));
  }
});

test('文字背景：純文字立即／排程帶 text_format_preset_id；沒選不帶', async (t) => {
  const at = nowSec() + 3600;
  const { f, env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_5' }), 'POST /111_5/comments': () => ({ id: 'C' }) });
  const BG = '106018623298955';
  assert.equal((await send(env, headers, { message: '短句', bg: BG, targets: JSON.stringify([{ page: '111', at: null }]) })).status, 200);
  assert.equal(f.calls.filter((c) => c.path === '/111/feed').at(-1).body.text_format_preset_id, BG);
  assert.equal((await send(env, headers, { message: '短句', bg: BG, targets: JSON.stringify([{ page: '111', at }]) })).status, 200);
  const sch = f.calls.filter((c) => c.path === '/111/feed').at(-1).body;
  assert.equal(sch.text_format_preset_id, BG);
  assert.equal(sch.scheduled_publish_time, String(at));
  await send(env, headers, { message: '沒背景', targets: JSON.stringify([{ page: '111', at: null }]) });
  assert.equal(f.calls.filter((c) => c.path === '/111/feed').at(-1).body.text_format_preset_id, undefined);
});

test('文字背景：不在清單、超過 130 字、附圖 → 400，不呼叫臉書', async (t) => {
  const { f, env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_5' }) });
  const tg = JSON.stringify([{ page: '111', at: null }]);
  assert.equal((await send(env, headers, { message: '短句', bg: '999999999', targets: tg })).status, 400);
  assert.equal((await send(env, headers, { message: '短句', bg: '303063890126415', targets: tg })).status, 400, '圖樣類未開放');
  assert.equal((await send(env, headers, { message: '字'.repeat(131), bg: '106018623298955', targets: tg })).status, 400);
  assert.equal((await send(env, headers, { message: '字'.repeat(130), bg: 'abc', targets: tg })).status, 400);
  assert.equal((await send(env, headers, { message: '短句', bg: '106018623298955', image: img(), targets: tg })).status, 400);
  assert.ok(!f.calls.some((c) => c.path === '/111/feed' || c.path === '/111/photos'));
});

test('GET /fb/backgrounds：回清單（id、name、css）', async (t) => {
  const { env, headers } = await setup(t, {});
  const w = await load();
  const r = await w.fetch(new Request('https://api.test/fb/backgrounds', { headers: { origin: ORIGIN, ...headers } }), env, { waitUntil() {} });
  assert.equal(r.status, 200);
  const list = (await r.json()).data;
  assert.equal(list.length, 11, '臉書實際清單：純色 7＋漸層 4（圖樣類未開放）');
  assert.ok(list.every((b) => /^\d+$/.test(b.id) && b.name && b.css && /^#[0-9A-F]{6}$/i.test(b.text) && ['solid', 'gradient'].includes(b.type)));
  assert.deepEqual([...new Set(list.map((b) => b.type))], ['solid', 'gradient'], '純色在前、漸層在後');
  const purple = list.find((b) => b.id === '106018623298955');
  assert.deepEqual(purple, { id: '106018623298955', name: '純紫', type: 'solid', css: '#C600FF', text: '#FFFFFF', rnd: true });
  assert.equal(list.find((b) => b.id === '249307305544279').css, 'linear-gradient(to top right,#FF0047,#2C34C7)');
  assert.ok(!list.some((b) => b.id === '204187940028597'), '臉書選單已沒有的舊代號不再列出');
});

test('文字背景：圖樣類與格式不對的資料不開放', async () => {
  const { toBackground } = await import('../../server/fb/bgpresets.js');
  assert.equal(toBackground({ preset_id: '303063890126415', type: 'image', background_color: '#DC7A5A', text_color: '#FFFFFF' }), null);
  assert.equal(toBackground({ preset_id: '1', type: 'solid', background_color: '#000000', text_color: '#FFFFFF' }), null);
  assert.equal(toBackground({ preset_id: '1881421442117417', type: 'solid', background_color: 'red;x', text_color: '#FFFFFF' }), null);
  assert.equal(toBackground({ preset_id: '1881421442117417', type: 'gradient', background_color: '#000000', text_color: '#FFFFFF' }), null, '漸層缺第二色');
  assert.equal(toBackground({ preset_id: '1881421442117417', type: 'solid', background_color: '#111111', text_color: '#FFFFFF', fb_description: '黑色' }).name, '黑色', '沒有 label 用臉書描述');
});

test('立即發布第 1 則留言失敗：交給計時器重試，第 2、3 則排在它後面', async (t) => {
  const { env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => Response.json({ error: { code: 2, message: 'temporary' } }, { status: 500 })
  });
  const before = nowSec();
  const r = await send(env, headers, { message: 'm', image: img(), targets: JSON.stringify([{ page: '111', at: null }]), comments: JSON.stringify([{ message: '二', delay: 5 }]) });
  const x = r.body.data.results[0];
  assert.equal(x.comment, 'retry'); assert.match(x.commentError, /臉書服務暫時無法使用/);
  assert.equal(x.extra, 1);
  assert.equal(RecTimer.log.length, 1);
  const arm = RecTimer.log[0][1];
  assert.ok(arm.at >= before - 1);
  assert.deepEqual(arm.items.map((i) => [i.offset, i.message.split('\n')[0]]), [[0, '看更多新聞內容'], [5, '二']], '第 1 則排第一個，馬上重試');
  assert.equal(arm.items[0].recheck, true, '第 1 則可能其實已留成功：計時器先查再留');
});

test('立即發布第 1 則留言臉書明確回錯誤：確定沒留，計時器直接重留（不帶 recheck）', async (t) => {
  const { env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => gErr(100, 400, 'bad')
  });
  await send(env, headers, { message: 'm', image: img(), targets: JSON.stringify([{ page: '111', at: null }]) });
  const arm = RecTimer.log[0][1];
  assert.equal(arm.items[0].recheck, undefined);
  assert.equal(arm.items[0].n, 1);
  assert.equal(arm.published, true);
});

test('第一個粉專失敗不影響第二個；時間超出範圍不呼叫臉書', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => gErr(200, 403, 'no permission'),
    'POST /222/photos': () => ({ id: 'P2', post_id: '222_1' }),
    'POST /222_1/comments': () => gErr(1, 500, 'boom')
  });
  const r = await send(env, headers, { message: 'm', link: LINK, image: img(), targets: JSON.stringify([{ page: '111', at: null }, { page: '222', at: null }]) });
  const [a, b] = r.body.data.results;
  assert.equal(a.ok, false); assert.match(a.error, /權限不足.*臉書碼 200/);
  assert.equal(b.ok, true); assert.equal(b.comment, 'retry', '第 1 則失敗交給計時器重試'); assert.match(b.commentError, /未知錯誤/);
  assert.deepEqual(env.DB.raw.prepare('SELECT uid, action, page, post FROM fb_audit').all().map((x) => ({ ...x })),
    [{ uid: 'SYS1', action: 'publish', page: '222', post: '222_1' }], '操作紀錄只記成功的粉專');
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
  env.SYS_STAFF_ID = 'SYS1';
  const headers = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, 'SYS1', 1)) };
  const at = nowSec() + 3600;
  const r = await send(env, headers, { message: 'm', link: LINK, targets: JSON.stringify([{ page: '111', at }]) });
  assert.equal(r.body.data.results[0].comment, 'armed');
  const { state } = env.FB_TIMER.instances.get('111_8');
  assert.equal((await state.storage.get('rec')).items[0].status, 'pending');
  assert.equal(await state.storage.getAlarm(), (at + 60) * 1000);
});

test('留言開頭文字：預設、自訂、空白只放連結、太長 400', async (t) => {
  const { commentText } = await lp();
  assert.equal(commentText(LINK, ''), '看更多新聞內容\n' + LINK);
  assert.equal(commentText(LINK, '', '完整報導'), '完整報導\n' + LINK);
  assert.equal(commentText(LINK, '', '  '), LINK);
  assert.equal(commentText(LINK, '', ''), LINK);
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => ({ id: 'C1' })
  });
  await send(env, headers, { message: 'm', link: LINK, commentLead: '點我看', image: img(), targets: JSON.stringify([{ page: '111', at: null }]) });
  assert.equal(f.calls.find((c) => /comments$/.test(c.path)).body.message, '點我看\n' + LINK + '?&utm_source=facebook&utm_medium=fbarticlepic');
  const empty = await send(env, headers, { message: 'm', link: LINK, commentLead: '', image: img(), targets: JSON.stringify([{ page: '111', at: null }]) });
  assert.equal(empty.status, 200);
  assert.equal(f.calls.filter((c) => /comments$/.test(c.path)).pop().body.message, LINK + '?&utm_source=facebook&utm_medium=fbarticlepic');
  const long = await send(env, headers, { message: 'm', link: LINK, commentLead: '字'.repeat(201), image: img(), targets: JSON.stringify([{ page: '111', at: null }]) });
  assert.equal(long.status, 400);
});

test('第 2、3 則留言：立即發布＝第 1 則馬上留、其餘交給計時器（距上一則累加）', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => ({ id: 'C1' })
  });
  const before = nowSec();
  const r = await send(env, headers, { message: 'm', link: LINK, image: img(), targets: JSON.stringify([{ page: '111', at: null }]), comments: JSON.stringify([{ message: '第二則', delay: 5 }, { message: '第三則', delay: 10 }]) });
  const x = r.body.data.results[0];
  assert.equal(x.comment, 'done'); assert.equal(x.extra, 2);
  assert.equal(f.calls.filter((c) => /comments$/.test(c.path)).length, 1, '只馬上留第 1 則');
  assert.equal(RecTimer.log.length, 1);
  const arm = RecTimer.log[0][1];
  assert.ok(arm.at >= before && arm.at <= nowSec());
  assert.deepEqual(arm.items, [{ message: '第二則', offset: 5, n: 2 }, { message: '第三則', offset: 15, n: 3 }]);
  assert.equal(arm.published, true, '立即發布：計時器不用再問發布了沒');
});

test('第 2、3 則留言：排程＝三則一起交給計時器', async (t) => {
  const at = nowSec() + 3600;
  const { env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_7' }) });
  await send(env, headers, { message: 'm', link: LINK, targets: JSON.stringify([{ page: '111', at }]), comments: JSON.stringify([{ message: '二', delay: 5 }]) });
  assert.deepEqual(RecTimer.log[0][1].items, [{ message: '看更多新聞內容\n' + LINK + '?&utm_source=facebook&utm_medium=fbarticletext', offset: 0, n: 1 }, { message: '二', offset: 5, n: 2 }]);
  assert.equal(RecTimer.log[0][1].at, at);

});

test('第 2、3 則留言驗證：最多 2 則、5 分鐘倍數、5～1440、內容不可空白', async (t) => {
  const { env, headers } = await setup(t, {});
  const go = (comments) => send(env, headers, { message: 'm', targets: JSON.stringify([{ page: '111', at: null }]), comments: JSON.stringify(comments) });
  for (const c of [[{ message: 'a', delay: 7 }], [{ message: 'a', delay: 0 }], [{ message: 'a', delay: 1445 }], [{ message: ' ', delay: 5 }], [{ message: 'a', delay: 5 }, { message: 'b', delay: 5 }, { message: 'c', delay: 5 }]]) {
    assert.equal((await go(c)).status, 400, JSON.stringify(c));
  }
});

test('純文字（沒附圖）第 1 則留言用「文字」UTM，沒設定就不加 UTM', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/feed': () => ({ id: '111_5' }),
    'POST /222/feed': () => ({ id: '222_5' }),
    'POST /111_5/comments': () => ({ id: 'C1' }),
    'POST /222_5/comments': () => ({ id: 'C2' })
  });
  const r = await send(env, headers, { message: '只有字', link: LINK, targets: JSON.stringify([{ page: '111', at: null }, { page: '222', at: null }]) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(f.calls.find((c) => c.path === '/111_5/comments').body.message, '看更多新聞內容\n' + LINK + '?&utm_source=facebook&utm_medium=fbarticletext');
  assert.equal(f.calls.find((c) => c.path === '/222_5/comments').body.message, '看更多新聞內容\n' + LINK, '少康沒設文字 UTM：不加');
});

// ── 防重複發文（sendId）──
const SID = 'abcd1234-ef56-7890-abcd-1234567890ab';
const rowOf = (env, page) => env.DB.raw.prepare('SELECT status, post_id FROM fb_sends WHERE send_id = ? AND page = ?').get(SID, page);

test('防重複：部分失敗後同一 sendId 再送，只重送失敗的粉專；成功的回 dup、不留言、不記操作紀錄', async (t) => {
  let fail111 = true;
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => (fail111 ? gErr(200, 403, 'no permission') : { id: 'P1', post_id: '111_1' }),
    'POST /222/photos': () => ({ id: 'P2', post_id: '222_1' }),
    'POST /111_1/comments': () => ({ id: 'C1' }),
    'POST /222_1/comments': () => ({ id: 'C2' })
  });
  const targets = JSON.stringify([{ page: '111', at: null }, { page: '222', at: null }]);
  const r1 = await send(env, headers, { message: 'm', image: img(), targets, sendId: SID });
  assert.deepEqual(r1.body.data.results.map((x) => x.ok), [false, true]);
  assert.equal(rowOf(env, '111').status, 'failed');
  assert.deepEqual({ ...rowOf(env, '222') }, { status: 'ok', post_id: '222_1' });
  fail111 = false;
  const n = f.calls.length;
  const r2 = await send(env, headers, { message: 'm', image: img(), targets, sendId: SID });
  const [a, b] = r2.body.data.results;
  assert.equal(a.ok, true); assert.ok(!a.dup);
  assert.equal(b.ok, true); assert.equal(b.dup, true); assert.equal(b.postId, '222_1'); assert.equal(b.comment, 'none');
  const later = f.calls.slice(n).map((c) => c.path);
  assert.ok(!later.includes('/222/photos'), '222 不重送'); assert.ok(!later.includes('/222_1/comments'), '222 不重留言');
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM fb_audit WHERE page = '222'").get().n, 1, '222 操作紀錄只有一筆');
});

test('防重複：發布請求連不上臉書＝待確認；同 sendId 再送不重送，帶 retry 才重送', async (t) => {
  let down = true;
  const { f, env, headers } = await setup(t, {
    'POST /111/feed': () => { if (down) throw new TypeError('network'); return { id: '111_5' }; },
    'POST /111_5/comments': () => ({ id: 'C' })
  });
  const targets = JSON.stringify([{ page: '111', at: null }]);
  const r1 = (await send(env, headers, { message: 'm', targets, sendId: SID })).body.data.results[0];
  assert.equal(r1.ok, false); assert.equal(r1.unknown, true);
  assert.equal(rowOf(env, '111').status, 'unknown');
  down = false;
  const n = f.calls.filter((c) => c.path === '/111/feed').length;
  const r2 = (await send(env, headers, { message: 'm', targets, sendId: SID })).body.data.results[0];
  assert.equal(r2.ok, false); assert.equal(r2.unknown, true);
  assert.equal(f.calls.filter((c) => c.path === '/111/feed').length, n, '沒帶 retry 不重送');
  const r3 = (await send(env, headers, { message: 'm', targets, sendId: SID, retry: JSON.stringify(['111']) })).body.data.results[0];
  assert.equal(r3.ok, true); assert.equal(r3.postId, '111_5');
  assert.equal(rowOf(env, '111').status, 'ok');
});

test('防重複：有圖排程暫存照片那步連不上＝一般失敗（可直接重送）；/feed 那步連不上＝待確認', async (t) => {
  let step = 'photo';
  const { env, headers } = await setup(t, {
    'POST /111/photos': () => { if (step === 'photo') throw new TypeError('network'); return { id: 'TMP' }; },
    'POST /111/feed': () => { throw new TypeError('network'); }
  });
  const targets = JSON.stringify([{ page: '111', at: nowSec() + 3600 }]);
  const r1 = (await send(env, headers, { message: 'm', image: img(), targets, sendId: SID })).body.data.results[0];
  assert.equal(r1.ok, false); assert.ok(!r1.unknown); assert.equal(rowOf(env, '111').status, 'failed');
  step = 'feed';
  const r2 = (await send(env, headers, { message: 'm', image: img(), targets, sendId: SID })).body.data.results[0];
  assert.equal(r2.unknown, true); assert.equal(rowOf(env, '111').status, 'unknown');
});

test('防重複：處理中（pending）不重送；retry 也要等超過 2 分鐘才重送', async (t) => {
  const { f, env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_6' }), 'POST /111_6/comments': () => ({ id: 'C' }) });
  const sends = await import('../../server/fb/sends.js');
  assert.equal((await sends.claimSend(env, SID, '111')).claimed, true);
  const targets = JSON.stringify([{ page: '111', at: null }]);
  const r1 = (await send(env, headers, { message: 'm', targets, sendId: SID, retry: JSON.stringify(['111']) })).body.data.results[0];
  assert.equal(r1.unknown, true); assert.match(r1.error, /還沒有結果/);
  assert.ok(!f.calls.some((c) => c.path === '/111/feed'));
  env.DB.raw.prepare('UPDATE fb_sends SET updated = ?').run(Date.now() - 3 * 60 * 1000);
  const r2 = (await send(env, headers, { message: 'm', targets, sendId: SID, retry: JSON.stringify(['111']) })).body.data.results[0];
  assert.equal(r2.ok, true);
});

test('防重複：sendId／retry 格式驗證、沒帶 sendId 照舊、清理 7 天前紀錄', async (t) => {
  const { env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_7' }), 'POST /111_7/comments': () => ({ id: 'C' }) });
  const targets = JSON.stringify([{ page: '111', at: null }]);
  assert.equal((await send(env, headers, { message: 'm', targets, sendId: 'x' })).status, 400);
  assert.equal((await send(env, headers, { message: 'm', targets, sendId: SID, retry: JSON.stringify(['222']) })).status, 400, 'retry 只能是這次的粉專');
  assert.equal((await send(env, headers, { message: 'm', targets, sendId: SID, retry: 'x' })).status, 400);
  assert.equal((await send(env, headers, { message: 'm', targets })).body.data.results[0].ok, true);
  const sends = await import('../../server/fb/sends.js');
  assert.equal((await send(env, headers, { message: 'm', targets, sendId: SID })).body.data.results[0].ok, true);
  await sends.claimSend(env, 'fresh-0001', '111');
  env.DB.raw.prepare("UPDATE fb_sends SET updated = ? WHERE send_id = ?").run(Date.now() - 8 * 86400000, SID);
  await sends.cleanupSends(env, Date.now());
  assert.deepEqual(env.DB.raw.prepare('SELECT send_id FROM fb_sends').all().map((x) => x.send_id), ['fresh-0001'], '只刪 7 天前的');
});

test('防重複：臉書回 5xx／錯誤碼 2 也是待確認，不能直接重送；一般錯誤仍是失敗', async (t) => {
  let mode = 503;
  const { env, headers } = await setup(t, { 'POST /111/feed': () => (mode === 503 ? gErr(2, 503, 'temporarily unavailable') : gErr(100, 400, 'bad')) });
  const targets = JSON.stringify([{ page: '111', at: null }]);
  const r1 = (await send(env, headers, { message: 'm', targets, sendId: SID })).body.data.results[0];
  assert.equal(r1.unknown, true); assert.equal(rowOf(env, '111').status, 'unknown');
  mode = 400;
  const SID2 = 'other-send-0002';
  const r3 = (await send(env, headers, { message: 'm', targets, sendId: SID2 })).body.data.results[0];
  assert.ok(!r3.unknown);
  assert.equal(env.DB.raw.prepare('SELECT status FROM fb_sends WHERE send_id = ?').get(SID2).status, 'failed');
});

test('parsePostForm：文字背景的字數以 LF 計（瀏覽器 FormData 會把換行轉成 CRLF）', async () => {
  const { parsePostForm } = await lp();
  const fd = new FormData();
  fd.set('message', Array(65).fill('字').join('\r\n') + '字'.repeat(0));   // 65 字＋64 換行：LF 計 129、CRLF 計 193
  fd.set('link', 'https://news.tvbs.com.tw/life/1');
  fd.set('targets', JSON.stringify([{ page: '111', at: null }]));
  fd.set('bg', '106018623298955');
  assert.ok(parsePostForm(fd));
});

test('操作紀錄：發文類型 kind（套版／字圖／文字）寫進 detail；不認得的不記', async (t) => {
  const at = nowSec() + 3600;
  const { env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_5' }), 'POST /111_5/comments': () => ({ id: 'C' }) });
  assert.equal((await send(env, headers, { message: 'a', kind: 'text', targets: JSON.stringify([{ page: '111', at }]) })).status, 200);
  assert.equal((await send(env, headers, { message: 'b', kind: 'textimg', targets: JSON.stringify([{ page: '111', at: null }]) })).status, 200);
  assert.equal((await send(env, headers, { message: 'c', kind: 'evil', targets: JSON.stringify([{ page: '111', at: null }]) })).status, 200);
  const log = env.DB.raw.prepare('SELECT action, detail FROM fb_audit ORDER BY id').all().map((r) => [r.action, r.detail]);
  assert.deepEqual(log, [['schedule', 'at=' + at + ' kind=text'], ['publish', 'kind=textimg'], ['publish', '']]);
});

test('summaryOf：整行【標題】優先、否則第一行有字的、超過 40 字截斷', async () => {
  const { summaryOf } = await import('../../server/fb/post.js');
  assert.equal(summaryOf('\n【颱風最新】\n內文第一段'), '颱風最新');
  assert.equal(summaryOf('\n\n小編文\n內文'), '小編文');
  assert.equal(summaryOf(''), '');
  assert.equal(summaryOf('字'.repeat(45)), '字'.repeat(40) + '…');
});

test('實驗功能（第 1 則留言再編輯）：全部人／指定員工（看發文者）；管理頁 comment-opts 敏感卡片', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => ({ id: 'C1' }),
    'POST /C1': () => ({ success: true })
  });
  const w = await load();
  const { signToken } = await tok();
  const adm = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)) };
  const admin = async (h, body) => {
    const r = await w.fetch(new Request('https://api.test/admin/fb/comment-opts', { method: body ? 'POST' : 'GET', headers: { origin: ORIGIN, 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await admin(headers)).status, 403, '系統管理者未解鎖不能進實驗功能');
  const g = (await admin(adm)).body.data;
  assert.deepEqual([g.edit, g.who, g.staff], [false, 'all', []]);
  assert.ok(Array.isArray(g.people));
  assert.equal((await admin(adm, { edit: 'yes' })).status, 400);
  assert.equal((await admin(adm, { edit: true, who: 'some', staff: ['bad id!'] })).status, 400);
  const edits = () => f.calls.filter((c) => c.method === 'POST' && c.path === '/C1').length;
  const go = () => send(env, headers, { message: '【標題】', link: LINK, image: img(), targets: JSON.stringify([{ page: '111', at: null }]) });
  // 指定別人：發文者 SYS1 不在名單 → 不編輯
  const s1 = (await admin(adm, { edit: true, who: 'some', staff: ['a123'] })).body.data;
  assert.deepEqual(s1.staff, ['A123'], '編號轉大寫');
  assert.equal((await go()).body.data.results[0].comment, 'done');
  assert.equal(edits(), 0);
  // 名單有發文者 → 編輯（相同內容）
  await admin(adm, { edit: true, who: 'some', staff: ['A123', 'sys1'] });
  await go();
  assert.equal(edits(), 1);
  const e = f.calls.filter((c) => c.method === 'POST' && c.path === '/C1')[0];
  assert.equal(e.body.message, f.calls.find((c) => c.path === '/111_9/comments').body.message);
  // 全部人
  await admin(adm, { edit: true, who: 'all' });
  await go();
  assert.equal(edits(), 2);
  const { editAfterPost, editApplies, normOpts } = await import('../../server/fb/comment.js');
  assert.equal(await editAfterPost(env, 'T', 'C2', '只有文字', 'SYS1'), 'skip');
  assert.deepEqual(normOpts({ edit: true }), { edit: true, who: 'all', staff: [] }, '舊設定＝全部人');
  assert.equal(editApplies(normOpts({ edit: true, who: 'some', staff: ['A1'] }), ''), false, '沒有發文者＝指定員工時不適用');
});

test('實驗功能（第 1 則留言移除預覽）：開啟＋適用＋這次勾選才做；A＝先文字再編輯加連結、B＝完整留言後帶空附件編輯；排程帶 np；/fb/me 回 noPreview', async (t) => {
  let n = 0;
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => ({ id: 'C' + (++n) }),
    'POST /C1': () => ({ success: true }), 'POST /C2': () => ({ success: true }), 'POST /C3': () => ({ success: true }), 'POST /C4': () => ({ success: true }),
    'POST /111/feed': () => ({ id: '111_7' })
  });
  const w = await load();
  const { signToken } = await tok();
  const adm = { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)) };
  const call = async (path, h, body) => {
    const r = await w.fetch(new Request('https://api.test' + path, { method: body ? 'POST' : 'GET', headers: { origin: ORIGIN, 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await call('/admin/fb/preview-opts', headers)).status, 403, '未解鎖不能進實驗功能');
  const g = (await call('/admin/fb/preview-opts', adm)).body.data;
  assert.deepEqual([g.on, g.who, g.staff, g.method], [false, 'all', [], 'a']);
  assert.ok(Array.isArray(g.people));
  assert.equal((await call('/admin/fb/preview-opts', adm, { on: 'y' })).status, 400);
  assert.equal((await call('/admin/fb/preview-opts', adm, { on: true, method: 'c' })).status, 400);
  assert.equal((await call('/fb/me', headers)).body.data.noPreview, false, '預設關');
  const comments = () => f.calls.filter((c) => c.path === '/111_9/comments');
  const edits = () => f.calls.filter((c) => /^\/C\d$/.test(c.path));
  const go = (extra) => send(env, headers, { message: '【標題】', link: LINK, image: img(), targets: JSON.stringify([{ page: '111', at: null }]), ...extra });
  // 關閉：勾了也不做
  let r = (await go({ noPreview: '1' })).body.data.results[0];
  assert.deepEqual([r.comment, r.preview], ['done', undefined]); assert.equal(edits().length, 0);
  // 開啟 A、全部人：沒勾不做
  await call('/admin/fb/preview-opts', adm, { on: true, who: 'all', method: 'a' });
  assert.equal((await call('/fb/me', headers)).body.data.noPreview, true);
  await go(); assert.equal(edits().length, 0, '這次沒勾');
  // 勾了：先留「看更多新聞內容」，再編輯成完整內容
  r = (await go({ noPreview: '1' })).body.data.results[0];
  const full = comments()[0].body.message;
  assert.equal(comments().at(-1).body.message, '看更多新聞內容', 'A：第一次只留文字');
  assert.equal(edits().at(-1).body.message, full, 'A：編輯成完整內容');
  assert.equal(edits().at(-1).body.attachment_share_url, undefined);
  assert.deepEqual([r.comment, r.preview], ['done', 'tried']);
  // B：完整留言，再帶空附件編輯
  await call('/admin/fb/preview-opts', adm, { on: true, who: 'all', method: 'b' });
  r = (await go({ noPreview: '1' })).body.data.results[0];
  assert.equal(comments().at(-1).body.message, full);
  assert.deepEqual([edits().at(-1).body.message, edits().at(-1).body.attachment_share_url], [full, '']);
  assert.equal(r.preview, 'tried');
  // 指定別人：不適用
  await call('/admin/fb/preview-opts', adm, { on: true, who: 'some', staff: ['A1'] });
  const before = edits().length;
  await go({ noPreview: '1' }); assert.equal(edits().length, before);
  // 排程：第 1 則帶 np 交給計時器，第 2 則不帶
  await call('/admin/fb/preview-opts', adm, { on: true, who: 'all', method: 'a' });
  RecTimer.log = [];
  r = (await send(env, headers, { message: '純文字', link: LINK, noPreview: '1', comments: JSON.stringify([{ message: '第二則', delay: 5 }]), targets: JSON.stringify([{ page: '111', at: nowSec() + 3600 }]) })).body.data.results[0];
  assert.equal(r.comment, 'armed');
  const arm = RecTimer.log.find((x) => x[0] === '/arm')[1];
  assert.deepEqual(arm.items.map((x) => [x.n, x.np || null]), [[1, 'a'], [2, null]]);
});

test('第 1 則留言移除預覽：A 法編輯兩次都失敗＝留言只有文字，結果明講；不影響發文', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => ({ id: 'C1' }),
    'POST /C1': () => gErr(10, 400, 'Permission denied')
  });
  const { saveNpOpts, npHead } = await import('../../server/fb/comment.js');
  await saveNpOpts(env, { on: true, method: 'a' });
  const r = (await send(env, headers, { message: '【標題】', link: LINK, image: img(), noPreview: '1', targets: JSON.stringify([{ page: '111', at: null }]) })).body.data.results[0];
  assert.deepEqual([r.ok, r.comment, r.preview], [true, 'done', 'failed']);
  assert.match(r.previewError, /只有文字、沒有連結/);
  assert.equal(f.calls.filter((c) => c.path === '/C1').length, 2, 'A 法編輯失敗再試一次');
  assert.equal(npHead('看更多新聞內容\nhttps://x'), '看更多新聞內容');
  assert.equal(npHead('https://x'), '');
});

test('警語留言：立即＝第 1 則成功後馬上留，不佔第 2、3 則名額', async (t) => {
  const { f, env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => ({ id: 'C1' })
  });
  const r = await send(env, headers, { message: 'm', image: img(), targets: JSON.stringify([{ page: '111', at: null }]), warn: '💬珍愛生命請撥打1925', comments: JSON.stringify([{ message: '二', delay: 5 }, { message: '三', delay: 5 }]) });
  assert.equal(r.status, 200);
  const x = r.body.data.results[0];
  assert.equal(x.comment, 'done'); assert.equal(x.warn, 'done'); assert.equal(x.extra, 2);
  const cs = f.calls.filter((c) => /comments$/.test(c.path));
  assert.equal(cs.length, 2, '第 1 則＋警語馬上留');
  const arm = RecTimer.log[0][1];
  assert.deepEqual(arm.items.map((i) => [i.n, i.message, i.offset]), [[3, '二', 5], [4, '三', 10]], '警語佔第 2 則，後面照編號');
});

test('警語留言：排程＝排在第 1 則之後、同一時間（offset 0）', async (t) => {
  const at = nowSec() + 3600;
  const { env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_7' }) });
  const r = await send(env, headers, { message: 'm', targets: JSON.stringify([{ page: '111', at }]), warn: '▲危險動作，請勿模仿' });
  assert.equal(r.body.data.results[0].warn, 'armed');
  assert.deepEqual(RecTimer.log[0][1].items.map((i) => [i.n, i.offset]), [[1, 0], [2, 0]]);
  assert.equal(RecTimer.log[0][1].items[1].message, '▲危險動作，請勿模仿');
});

test('警語留言：第 1 則失敗＝警語交給計時器排在第 1 則後面；臉書沒回應＝先查再留', async (t) => {
  let n = 0;
  const { env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => (++n === 1 ? gErr(100, 400, 'bad') : ({ id: 'C' }))
  });
  const r = await send(env, headers, { message: 'm', image: img(), targets: JSON.stringify([{ page: '111', at: null }]), warn: 'W' });
  assert.equal(r.body.data.results[0].warn, 'retry');
  assert.equal(n, 1, '第 1 則沒留上前不留警語');
  assert.deepEqual(RecTimer.log[0][1].items.map((i) => [i.n, i.message.split('\n')[0]]), [[1, '看更多新聞內容'], [2, 'W']]);
});

test('警語留言：第 1 則成功、警語沒收到回應＝計時器先查再留（recheck）', async (t) => {
  let n = 0;
  const { env, headers } = await setup(t, {
    'POST /111/photos': () => ({ id: 'P1', post_id: '111_9' }),
    'POST /111_9/comments': () => (++n === 1 ? ({ id: 'C1' }) : Response.json({ error: { code: 2, message: 'temporary' } }, { status: 500 }))
  });
  const r = await send(env, headers, { message: 'm', image: img(), targets: JSON.stringify([{ page: '111', at: null }]), warn: 'W' });
  assert.equal(r.body.data.results[0].warn, 'retry');
  const it = RecTimer.log[0][1].items;
  assert.equal(it.length, 1); assert.equal(it[0].n, 2); assert.equal(it[0].recheck, true);
});

test('警語留言驗證：超過 2000 字 400；空白＝不留', async (t) => {
  const { env, headers } = await setup(t, { 'POST /111/feed': () => ({ id: '111_7' }) });
  const at = nowSec() + 3600;
  assert.equal((await send(env, headers, { message: 'm', targets: JSON.stringify([{ page: '111', at }]), warn: 'x'.repeat(2001) })).status, 400);
  const r = await send(env, headers, { message: 'm', targets: JSON.stringify([{ page: '111', at }]), warn: '  ' });
  assert.equal(r.body.data.results[0].warn, undefined);
  assert.equal(RecTimer.log[0][1].items.length, 1);
});
