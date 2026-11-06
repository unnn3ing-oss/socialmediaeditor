const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
let worker;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);

const HTML = `<!doctype html><html><head><title>備用標題</title>
<meta property="og:title" content="颱風來襲 &amp; 停班停課">
<meta content="/img/cover.jpg" property="og:image">
<meta property="og:description" content="這是描述">
</head><body>x</body></html>`;

let calls, realFetch, handler;
test.beforeEach(() => {
  calls = [];
  realFetch = globalThis.fetch;
  handler = () => new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url)); };
});
test.afterEach(() => { globalThis.fetch = realFetch; });

async function get(env, target) {
  const w = await load();
  const res = await w.fetch(new Request('https://api.test/fetch?url=' + encodeURIComponent(target), { headers: { origin: ORIGIN } }), env, { waitUntil() {} });
  return { res, body: await res.json() };
}

test('白名單網域可抓，回 og 標題、圖、描述', async () => {
  const { res, body } = await get(mkEnv(), 'https://news.tvbs.com.tw/x');
  assert.equal(res.status, 200);
  assert.deepEqual(body.data, {
    url: 'https://news.tvbs.com.tw/x', title: '颱風來襲 & 停班停課',
    image: 'https://news.tvbs.com.tw/img/cover.jpg', description: '這是描述'
  });
  assert.equal(calls.length, 1);
});

test('沒有 og:title 就用 <title>；缺的欄位回空字串', async () => {
  handler = () => new Response('<html><head><title>只有標題</title></head></html>');
  const { body } = await get(mkEnv(), 'https://tvbs.com.tw/a');
  assert.deepEqual(body.data, { url: 'https://tvbs.com.tw/a', title: '只有標題', image: '', description: '' });
});

test('不在白名單、偽裝網域、http、帶帳密或不是網址 → bad_request，且不打上游', async () => {
  const env = mkEnv();
  for (const u of ['https://evil.com', 'https://tvbs.com.tw.evil.com', 'https://eviltvbs.com.tw/x', 'http://news.tvbs.com.tw/x',
    'https://user:pw@news.tvbs.com.tw/x', 'https://news.tvbs.com.tw:8443/x', 'ftp://tvbs.com.tw', 'not a url', '']) {
    const { res, body } = await get(env, u);
    assert.equal(res.status, 400, u);
    assert.equal(body.code, 'bad_request', u);
  }
  assert.equal(calls.length, 0);
});

test('FETCH_HOSTS 可自訂（逗號分隔）', async () => {
  const env = mkEnv({ FETCH_HOSTS: 'example.org, news.test' });
  assert.equal((await get(env, 'https://a.example.org/x')).res.status, 200);
  assert.equal((await get(env, 'https://news.test/x')).res.status, 200);
  assert.equal((await get(env, 'https://news.tvbs.com.tw/x')).res.status, 400);
});

test('第二次請求不打上游（KV 命中，快取 3600 秒）', async () => {
  const env = mkEnv();
  const a = await get(env, 'https://news.tvbs.com.tw/x');
  const b = await get(env, 'https://news.tvbs.com.tw/x');
  assert.equal(calls.length, 1);
  assert.deepEqual(a.body, b.body);
  assert.equal(env.CACHE.store.get('fetch:https://news.tvbs.com.tw/x').ttl, 3600);
});

test('轉址到白名單外 → bad_request；白名單內可跟隨', async () => {
  handler = (u) => u.includes('tvbs.com.tw/a')
    ? new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } })
    : new Response(HTML);
  const bad = await get(mkEnv(), 'https://news.tvbs.com.tw/a');
  assert.equal(bad.res.status, 400);
  assert.equal(calls.length, 1);
  calls.length = 0;
  handler = (u) => u.endsWith('/a')
    ? new Response(null, { status: 301, headers: { location: '/b' } })
    : new Response(HTML);
  const good = await get(mkEnv(), 'https://news.tvbs.com.tw/a');
  assert.equal(good.res.status, 200);
  assert.equal(calls.length, 2);
});

test('上游失敗 → bad_request，且不寫快取', async () => {
  handler = () => new Response('oops', { status: 500 });
  const env = mkEnv();
  const { res } = await get(env, 'https://news.tvbs.com.tw/x');
  assert.equal(res.status, 400);
  assert.equal(env.CACHE.store.size, 0);
});

test('最多只讀 2 MB', async () => {
  const filler = 'a'.repeat(3 * 1024 * 1024);
  handler = () => new Response('<html><head><meta property="og:title" content="前面的標題"></head><body>' + filler + '<meta property="og:image" content="https://x/late.jpg"></body></html>');
  const { body } = await get(mkEnv(), 'https://news.tvbs.com.tw/big');
  assert.equal(body.data.title, '前面的標題');
  assert.equal(body.data.image, '');
});

// ---- /fetch/image：白名單圖片代理 ----
async function getImg(env, target) {
  const w = await load();
  return w.fetch(new Request('https://api.test/fetch/image?url=' + encodeURIComponent(target), { headers: { origin: ORIGIN } }), env, { waitUntil() {} });
}
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

test('圖片代理：白名單圖片原樣回傳，帶 CORS 與圖片類型', async () => {
  handler = () => new Response(PNG, { headers: { 'content-type': 'image/png' } });
  const res = await getImg(mkEnv(), 'https://cc.tvbs.com.tw/img/a.png');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
});

test('圖片代理：白名單外、不是圖片、轉址到白名單外都拒絕', async () => {
  let res = await getImg(mkEnv(), 'https://evil.com/a.png');
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
  handler = () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  res = await getImg(mkEnv(), 'https://tvbs.com.tw/a.png');
  assert.equal((await res.json()).code, 'bad_request');
  handler = () => new Response(null, { status: 302, headers: { location: 'https://evil.com/x.png' } });
  res = await getImg(mkEnv(), 'https://tvbs.com.tw/a.png');
  assert.equal(res.status, 400);
  assert.equal(calls.length, 2);
});

test('圖片代理：超過 10 MB 回 too_large（不管有沒有 content-length）', async () => {
  handler = () => new Response(new Uint8Array(10), { headers: { 'content-type': 'image/jpeg', 'content-length': String(11 * 1024 * 1024) } });
  let res = await getImg(mkEnv(), 'https://tvbs.com.tw/a.jpg');
  assert.equal((await res.json()).code, 'too_large');
  const big = new Uint8Array(1024 * 1024);
  handler = () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 11; i++) c.enqueue(big); c.close(); } }), { headers: { 'content-type': 'image/jpeg' } });
  res = await getImg(mkEnv(), 'https://tvbs.com.tw/b.jpg');
  assert.equal((await res.json()).code, 'too_large');
});
