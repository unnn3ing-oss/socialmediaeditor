const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const TOKEN_A = 'EAAPageTokenAAAAAAAAAAAAAAAAAAAAAAAA111';
const TOKEN_B = 'EAAPageTokenBBBBBBBBBBBBBBBBBBBBBBBB222';
const SECRET = 'app-secret-xyz-123456';
const TOKEN_U = 'EAAUserTokenUUUUUUUUUUUUUUUUUUUUUUUUU999';
const PT = { '333': 'EAADerivedPage333333333333333333333333', '444': 'EAADerivedPage444444444444444444444444', '111': 'EAADerivedPage111111111111111111111111' };
// 用戶 token 的 /me/accounts（兩頁，用 after 游標翻）
let accounts;
const hasPagesCache = (env) => [...env.CACHE.store.keys()].some((k) => k.startsWith('fb:pages:'));
let worker, tokenMod, fbMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const loadToken = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const loadFb = async () => (fbMod = fbMod || (await import('../../server/core/fb.js')));
const nowSec = () => Math.floor(Date.now() / 1000);

const fbEnv = (extra = {}) => mkEnv({ FB_TOKEN: `${TOKEN_A},\n${TOKEN_B}`, ...extra });

// 假 Graph：依 token 決定是哪個粉專；routes 可覆寫
let calls, realFetch, routes;
const PAGES = { [TOKEN_A]: { id: '111', name: '新聞粉專' }, [TOKEN_B]: { id: '222', name: '娛樂粉專' } };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fbErr = (code, message, status = 400) => reply({ error: { code, message, type: 'OAuthException' } }, status);

async function tokenOf(url, init) {
  const u = new URL(url);
  if (u.searchParams.get('access_token')) return u.searchParams.get('access_token');
  if (init && init.body instanceof FormData) return init.body.get('access_token');
  return null;
}

test.beforeEach(async () => {
  (await loadFb())._resetFbMemory();
  accounts = [
    [{ id: '333', name: '用戶粉專甲', access_token: PT['333'], tasks: ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE'] }],
    [{ id: '444', name: '用戶粉專乙', access_token: PT['444'], tasks: ['ANALYZE'] }]
  ];
  calls = [];
  routes = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    const tok = await tokenOf(url, init);
    calls.push({ url, init, tok, path: new URL(url).pathname });
    for (const [re, fn] of routes) if (re.test(new URL(url).pathname)) return fn(url, init, tok);
    const p = new URL(url).pathname;
    if (p.endsWith('/me/accounts') && tok === TOKEN_U) {
      const after = new URL(url).searchParams.get('after');
      const i = after ? Number(after.replace('CUR', '')) : 0;
      const last = i >= accounts.length - 1;
      return reply({ data: accounts[i] || [], paging: last ? { cursors: { after: 'CUR' + i } } : { cursors: { after: 'CUR' + (i + 1) }, next: `https://graph.facebook.com/v26.0/me/accounts?access_token=${TOKEN_U}&after=CUR${i + 1}` } });
    }
    if (p.endsWith('/me') && tok === TOKEN_U) return fbErr(100, '(#100) Tried accessing nonexisting field (followers_count) on node type (User)');
    if (p.endsWith('/me')) return PAGES[tok] ? reply({ ...PAGES[tok], link: 'https://fb.com/x', followers_count: 1000 }) : fbErr(190, 'Invalid OAuth access token ' + tok);
    return reply({ data: [] });
  };
});
test.afterEach(() => { globalThis.fetch = realFetch; });

async function call(path, init = {}, env) {
  const w = await load();
  const headers = Object.assign({ origin: ORIGIN }, init.headers || {});
  return w.fetch(new Request('https://api.test' + path, { ...init, headers }), env, { waitUntil() {} });
}
async function auth(env, kind = 'company') {
  const { signToken } = await loadToken();
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600)) };
}
async function getJ(env, path, kind) {
  const res = await call(path, { headers: await auth(env, kind) }, env);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}
async function postJ(env, body) {
  const res = await call('/fb/post', { method: 'POST', headers: { ...(await auth(env)), 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}
const noToken = (text) => { for (const t of [TOKEN_A, TOKEN_B, SECRET, TOKEN_U, ...Object.values(PT)]) assert.ok(!text.includes(t), '回應不可含 token／secret'); };

test('沒有公司憑證回 401，也不會打 Graph', async () => {
  const env = fbEnv();
  const res = await call('/fb/pages', {}, env);
  assert.equal(res.status, 401);
  const admin = await getJ(env, '/fb/pages', 'admin');
  assert.equal(admin.res.status, 401);
  assert.equal(calls.length, 0);
});

test('沒設 FB_TOKEN 回 fb_not_configured', async () => {
  const env = mkEnv();
  const { res, body } = await getJ(env, '/fb/pages');
  assert.equal(res.status, 503);
  assert.equal(body.code, 'fb_not_configured');
});

test('粉專清單：每組 token 對應一個粉專，回應不含 token，第二次走快取', async () => {
  const env = fbEnv();
  const { res, body, text } = await getJ(env, '/fb/pages');
  assert.equal(res.status, 200);
  assert.deepEqual(body.data.map((p) => [p.id, p.name, p.followers]), [['222', '娛樂粉專', 1000], ['111', '新聞粉專', 1000]]);
  assert.ok(!('idx' in body.data[0]));
  noToken(text);
  for (const v of env.CACHE.store.values()) noToken(v.value);
  const n = calls.length;
  await getJ(env, '/fb/pages');
  assert.equal(calls.length, n);
});

test('有 FB_APP_SECRET 時帶 appsecret_proof（HMAC-SHA256 hex）', async () => {
  const env = fbEnv({ FB_APP_SECRET: SECRET });
  await getJ(env, '/fb/pages');
  const crypto = require('node:crypto');
  const expect = crypto.createHmac('sha256', SECRET).update(TOKEN_A).digest('hex');
  const c = calls.find((x) => x.tok === TOKEN_A);
  assert.equal(new URL(c.url).searchParams.get('appsecret_proof'), expect);
  assert.match(c.url, /graph\.facebook\.com\/v26\.0\//);
});

test('貼文列表：用對應粉專的 token，整理欄位與下一頁游標', async () => {
  const env = fbEnv();
  routes.push([/\/222\/published_posts$/, () => reply({
    data: [{ id: '222_9', message: '哈囉', created_time: '2026-11-01T00:00:00+0000', permalink_url: 'https://fb.com/p', full_picture: 'https://img', status_type: 'added_photos', shares: { count: 3 }, comments: { summary: { total_count: 4 } }, reactions: { summary: { total_count: 5 } } }],
    paging: { cursors: { after: 'CUR1' }, next: 'https://graph.facebook.com/next' }
  })]);
  const { res, body } = await getJ(env, '/fb/posts?page=222&limit=5');
  assert.equal(res.status, 200);
  assert.deepEqual(body.data.items[0], { id: '222_9', message: '哈囉', created: '2026-11-01T00:00:00+0000', url: 'https://fb.com/p', picture: 'https://img', type: 'added_photos', shares: 3, comments: 4, reactions: 5 });
  assert.equal(body.data.next, 'CUR1');
  const c = calls.find((x) => x.path.endsWith('/published_posts'));
  assert.equal(c.tok, TOKEN_B);
  assert.equal(new URL(c.url).searchParams.get('limit'), '5');
});

test('不在設定裡的粉專回 404；參數格式錯回 400', async () => {
  const env = fbEnv();
  assert.equal((await getJ(env, '/fb/posts?page=999')).body.code, 'fb_unknown_page');
  assert.equal((await getJ(env, '/fb/posts?page=../me')).res.status, 400);
  assert.equal((await getJ(env, '/fb/posts?page=111&after=a%26b')).res.status, 400);
  assert.equal((await getJ(env, '/fb/insights?post=111')).res.status, 400);
  assert.equal((await getJ(env, '/fb/insights?post=999_1')).body.code, 'fb_unknown_page');
  assert.equal((await getJ(env, '/fb/whatever')).res.status, 404);
});

test('成效：整批失敗時逐一重問，被停用的指標列在 missing', async () => {
  const env = fbEnv();
  routes.push([/\/111_7\/insights$/, (url) => {
    const m = new URL(url).searchParams.get('metric');
    if (m.includes(',') || m === 'post_clicks') return fbErr(100, '(#100) The value must be a valid insights metric');
    return reply({ data: [{ name: m, values: [{ value: m === 'post_reactions_by_type_total' ? { like: 2 } : 42 }] }] });
  }]);
  const { body } = await getJ(env, '/fb/insights?post=111_7');
  assert.deepEqual(body.data.metrics, { post_media_view: 42, post_total_media_view_unique: 42, post_reactions_by_type_total: { like: 2 } });
  assert.deepEqual(body.data.missing, ['post_clicks']);
});

test('發文（文字＋連結）走 /feed，token 放本文不放網址', async () => {
  const env = fbEnv();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_55' })]);
  const { res, body, text } = await postJ(env, { page: '111', message: '新聞來了', link: 'https://news.tvbs.com.tw/x' });
  assert.equal(res.status, 200);
  assert.deepEqual(body.data, { id: '111_55', scheduled: false, at: null, comment: { status: 'none' } });
  noToken(text);
  const c = calls.find((x) => x.path.endsWith('/feed'));
  assert.equal(c.init.method, 'POST');
  assert.ok(!c.url.includes('access_token'));
  assert.equal(c.init.body.get('message'), '新聞來了');
  assert.equal(c.init.body.get('link'), 'https://news.tvbs.com.tw/x');
  assert.equal(c.init.body.get('published'), null);
  const log = env.DB.raw.prepare('SELECT tool, code FROM logs').all();
  assert.deepEqual(log.map((r) => ({ ...r })), [{ tool: 'fb', code: 'post-published' }]);
});

test('排程發圖（網址）走 /photos，帶 published=false 與排程時間', async () => {
  const env = fbEnv();
  routes.push([/\/222\/photos$/, () => reply({ id: '9', post_id: '222_9' })]);
  const at = nowSec() + 3600;
  const { body } = await postJ(env, { page: '222', message: '圖說', imageUrl: 'https://example.com/a.jpg', scheduledAt: at });
  assert.deepEqual(body.data, { id: '222_9', scheduled: true, at, comment: { status: 'none' } });
  const fd = calls.find((x) => x.path.endsWith('/photos')).init.body;
  assert.equal(fd.get('caption'), '圖說');
  assert.equal(fd.get('url'), 'https://example.com/a.jpg');
  assert.equal(fd.get('published'), 'false');
  assert.equal(fd.get('scheduled_publish_time'), String(at));
});

test('multipart 上傳圖片檔轉成 source', async () => {
  const env = fbEnv();
  routes.push([/\/111\/photos$/, () => reply({ id: '1', post_id: '111_1' })]);
  const fd = new FormData();
  fd.append('page', '111');
  fd.append('message', '有圖');
  fd.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2])], { type: 'image/jpeg' }), 'a.jpg');
  const res = await call('/fb/post', { method: 'POST', headers: await auth(env), body: fd }, env);
  assert.equal(res.status, 200);
  const src = calls.find((x) => x.path.endsWith('/photos')).init.body.get('source');
  assert.equal(src.size, 5);
});

test('發文檢查：時間範圍、連結＋圖片衝突、空內容、圖片類型', async () => {
  const { checkPost } = await loadFb();
  const now = 1_800_000_000;
  assert.match(checkPost({ page: '1', message: 'x', scheduledAt: now + 60 }, now), /10 分鐘/);
  assert.match(checkPost({ page: '1', message: 'x', scheduledAt: now + 31 * 86400 }, now), /30 天/);
  assert.match(checkPost({ page: '1', link: 'https://a', imageUrl: 'https://b' }, now), /擇一/);
  assert.match(checkPost({ page: '1', message: '  ' }, now), /至少/);
  assert.match(checkPost({ page: '1', imageUrl: 'http://b' }, now), /https/);
  assert.match(checkPost({ page: '1', image: { size: 10, type: 'application/pdf' } }, now), /只支援/);
  assert.equal(typeof checkPost({ page: '1', message: 'ok', scheduledAt: now + 3600 }, now), 'object');
  const env = fbEnv();
  const { res } = await postJ(env, { page: '111', message: 'x', scheduledAt: nowSec() + 60 });
  assert.equal(res.status, 400);
  assert.equal(calls.filter((x) => x.path.endsWith('/feed')).length, 0);
});

test('token 失效：回 502、清掉粉專快取、錯誤訊息不含 token，並記錄失敗', async () => {
  const env = fbEnv();
  await getJ(env, '/fb/pages');
  assert.ok(hasPagesCache(env));
  routes.push([/\/111\/feed$/, () => fbErr(190, `Error validating access token: ${TOKEN_A} has expired`)]);
  const { res, body, text } = await postJ(env, { page: '111', message: 'x' });
  assert.equal(res.status, 502);
  assert.equal(body.code, 'fb_token_invalid');
  noToken(text);
  assert.ok(!hasPagesCache(env));
  const codes = env.DB.raw.prepare('SELECT code FROM logs').all().map((r) => r.code);
  assert.deepEqual(codes, ['post-failed-190']);
});

test('權限不足、呼叫太頻繁對應到各自的代碼', async () => {
  const env = fbEnv();
  routes.push([/\/111\/scheduled_posts$/, () => fbErr(200, 'Requires pages_manage_posts')]);
  routes.push([/\/222\/scheduled_posts$/, () => fbErr(4, 'Application request limit reached')]);
  assert.equal((await getJ(env, '/fb/scheduled?page=111')).res.status, 403);
  assert.equal((await getJ(env, '/fb/scheduled?page=222')).body.code, 'fb_rate_limited');
});

test('管理頁：列出每組 token 的狀態與缺少的權限，不含 token；要管理憑證', async () => {
  const env = fbEnv({ FB_APP_ID: '12345', FB_APP_SECRET: SECRET });
  routes.push([/\/debug_token$/, (url, init, tok) => {
    assert.equal(tok, `12345|${SECRET}`);
    const input = new URL(url).searchParams.get('input_token');
    return reply({ data: { is_valid: true, type: 'PAGE', expires_at: 0, scopes: input === TOKEN_A ? ['pages_show_list', 'pages_read_engagement', 'read_insights', 'pages_manage_posts'] : ['pages_show_list'] } });
  }]);
  assert.equal((await call('/admin/fb', { headers: await auth(env, 'company') }, env)).status, 401);
  const { res, body, text } = await getJ(env, '/admin/fb', 'admin');
  assert.equal(res.status, 200);
  noToken(text);
  assert.equal(body.data.version, 'v26.0');
  assert.deepEqual(body.data.tokens.map((t) => [t.pages[0].name, t.valid, t.type, t.expiresAt, t.missingScopes.length]),
    [['新聞粉專', true, 'PAGE', 0, 1], ['娛樂粉專', true, 'PAGE', 0, 4]]);
});

test('scrub 會抹掉 token 與 access_token 參數', async () => {
  const { scrub, pageTokens } = await import('../../server/core/graph.js');
  const env = { FB_TOKEN: `${TOKEN_A} ${TOKEN_A} short`, FB_APP_SECRET: SECRET };
  assert.deepEqual(pageTokens(env), [TOKEN_A]);
  const s = scrub(env, `bad ${TOKEN_A} ${SECRET} https://x?access_token=zzz&y=1`);
  noToken(s);
  assert.ok(!s.includes('zzz'));
});

test('暫時性失敗（限流）不快取粉專清單，下次會重問', async () => {
  const env = fbEnv();
  let n = 0;
  routes.push([/\/me$/, (url, init, tok) => (n++ === 0 ? fbErr(4, 'rate') : reply({ ...PAGES[tok], link: '' }))]);
  const a = await getJ(env, '/fb/pages');
  assert.equal(a.body.data.length, 1);
  const b = await getJ(env, '/fb/pages');
  assert.equal(b.body.data.length, 2);
});

// ---- 用戶 token（B 版） ----
const userEnv = (extra = {}) => mkEnv({ FB_TOKEN: TOKEN_U, ...extra });
const dumpStores = (env) => [...env.CACHE.store.values()].map((v) => v.value).join('\n') + JSON.stringify(env.DB.raw.prepare('SELECT * FROM logs').all());

test('用戶 token：用 /me/accounts 換出粉專（after 游標翻頁，不跟 next），KV 與回應不含任何 token', async () => {
  const env = userEnv();
  const { res, body, text } = await getJ(env, '/fb/pages');
  assert.equal(res.status, 200);
  assert.deepEqual(body.data.map((p) => [p.id, p.name]), [['444', '用戶粉專乙'], ['333', '用戶粉專甲']]);
  noToken(text);
  noToken(dumpStores(env));
  const acc = calls.filter((c) => c.path.endsWith('/me/accounts'));
  assert.equal(acc.length, 2);
  assert.equal(new URL(acc[1].url).searchParams.get('after'), 'CUR1');
  assert.ok(acc.every((c) => c.url.startsWith('https://graph.facebook.com/v26.0/me/accounts?')));
});

test('用戶 token：發文用換出的粉專 token；記憶體清掉後會重新換', async () => {
  const env = userEnv();
  routes.push([/\/333\/feed$/, () => reply({ id: '333_1' })]);
  const r1 = await postJ(env, { page: '333', message: 'hi' });
  assert.equal(r1.res.status, 200);
  assert.equal(calls.find((c) => c.path.endsWith('/333/feed')).tok, PT['333']);
  noToken(r1.text);
  (await loadFb())._resetFbMemory();
  const before = calls.filter((c) => c.path.endsWith('/me/accounts')).length;
  await postJ(env, { page: '333', message: 'hi2' });
  assert.ok(calls.filter((c) => c.path.endsWith('/me/accounts')).length > before);
  assert.equal(calls.filter((c) => c.path.endsWith('/333/feed')).pop().tok, PT['333']);
});

test('用戶 token：換出的粉專 token 出現在臉書錯誤訊息裡也會被抹掉', async () => {
  const env = userEnv();
  routes.push([/\/333\/feed$/, () => fbErr(190, `Error validating access token: ${PT['333']} expired; user ${TOKEN_U}`)]);
  const { res, body, text } = await postJ(env, { page: '333', message: 'x' });
  assert.equal(res.status, 502);
  assert.equal(body.code, 'fb_token_invalid');
  noToken(text);
  noToken(dumpStores(env));
});

test('同一粉專：直接的粉專 token 優先（即使用戶 token 排在前面）', async () => {
  accounts = [[{ id: '111', name: '新聞粉專', access_token: PT['111'], tasks: ['CREATE_CONTENT', 'ANALYZE'] }, { id: '333', name: '用戶粉專甲', access_token: PT['333'], tasks: ['CREATE_CONTENT'] }]];
  const env = mkEnv({ FB_TOKEN: `${TOKEN_U},${TOKEN_A}` });
  routes.push([/\/111\/feed$/, () => reply({ id: '111_1' })]);
  const { body } = await getJ(env, '/fb/pages');
  assert.deepEqual(body.data.map((p) => p.id).sort(), ['111', '333']);
  await postJ(env, { page: '111', message: 'x' });
  assert.equal(calls.find((c) => c.path.endsWith('/111/feed')).tok, TOKEN_A);
});

test('粉專已不在授權清單：回 fb_unknown_page，不是 500', async () => {
  const env = userEnv();
  await getJ(env, '/fb/pages');                       // 快取裡有 444
  (await loadFb())._resetFbMemory();
  accounts = [[accounts[0][0]]];                      // 444 被撤銷
  const { res, body } = await postJ(env, { page: '444', message: 'x' });
  assert.equal(res.status, 404);
  assert.equal(body.code, 'fb_unknown_page');
});

test('快取鍵跟著 FB_TOKEN 變：換 token 不會讀到舊的對應', async () => {
  const env = fbEnv();
  await getJ(env, '/fb/pages');
  env.FB_TOKEN = TOKEN_U;
  const { body } = await getJ(env, '/fb/pages');
  assert.deepEqual(body.data.map((p) => p.id).sort(), ['333', '444']);
});

test('管理頁：用戶 token 列出所有粉專、權限不足標記、資料存取到期，不含任何 token', async () => {
  accounts = [[{ id: '111', name: '新聞粉專', access_token: PT['111'], tasks: ['CREATE_CONTENT', 'ANALYZE'] }, { id: '444', name: '用戶粉專乙', access_token: PT['444'], tasks: ['ANALYZE'] }]];
  const env = mkEnv({ FB_TOKEN: `${TOKEN_U},${TOKEN_A}` });
  const dax = nowSec() + 80 * 86400;
  routes.push([/\/debug_token$/, (url) => {
    const input = new URL(url).searchParams.get('input_token');
    return reply({ data: { is_valid: true, type: input === TOKEN_U ? 'USER' : 'PAGE', expires_at: 0, data_access_expires_at: input === TOKEN_U ? dax : 0, scopes: ['pages_show_list', 'pages_read_engagement', 'read_insights', 'pages_manage_posts'] } });
  }]);
  const { body, text } = await getJ(env, '/admin/fb', 'admin');
  noToken(text);
  const [u, a] = body.data.tokens;
  assert.equal(u.kind, 'user');
  assert.equal(u.dataAccessExpiresAt, dax);
  assert.deepEqual(u.pages.map((p) => [p.id, p.usedBy || null, p.canPost]), [['111', 2, true], ['444', null, false]]);
  assert.equal(a.kind, 'page');
  assert.equal(a.dataAccessExpiresAt, null);
  assert.deepEqual(a.pages.map((p) => [p.id, p.canPost, p.canInsights]), [['111', true, true]]);
});

test('用戶 token 沒授權任何粉專：清單是空的，管理頁標示 user', async () => {
  accounts = [[]];
  const env = userEnv();
  assert.deepEqual((await getJ(env, '/fb/pages')).body.data, []);
  routes.push([/\/debug_token$/, () => reply({ data: { is_valid: true, type: 'USER', expires_at: 0, scopes: [] } })]);
  const t = (await getJ(env, '/admin/fb', 'admin')).body.data.tokens[0];
  assert.equal(t.kind, 'user');
  assert.deepEqual(t.pages, []);
});

// ---- 版本 1：/me/accounts 是空的，改從授權範圍（granular_scopes）找粉專 ----
const GP = { '555': 'EAAGranularPage555555555555555555555555', '666': 'EAAGranularPage666666666666666666666666' };
const noTokenG = (text) => { noToken(text); for (const t of Object.values(GP)) assert.ok(!text.includes(t), '回應不可含換出的 token'); };
function granularRoutes({ debugFail = false } = {}) {
  accounts = [[]];
  routes.push([/\/debug_token$/, (url, init, tok) => {
    if (debugFail) return fbErr(100, 'debug not allowed');
    return reply({ data: { is_valid: true, type: 'USER', expires_at: 0, scopes: ['pages_show_list', 'pages_manage_posts', 'read_insights', 'pages_read_engagement'],
      granular_scopes: [
        { scope: 'pages_show_list', target_ids: ['555', '666', '777'] },
        { scope: 'pages_manage_posts', target_ids: ['555', '666'] },
        { scope: 'read_insights', target_ids: ['555'] },
        { scope: 'public_profile' }
      ] } });
  }]);
  routes.push([/^\/v26\.0\/(555|666|777)$/, (url, init, tok) => {
    const id = new URL(url).pathname.split('/').pop();
    assert.equal(tok, TOKEN_U);
    if (id === '777') return fbErr(10, 'no role on this page');
    return reply({ id, name: '企業粉專' + id, followers_count: 10, access_token: GP[id] });
  }]);
}

test('授權範圍備援：/me/accounts 空的時候從 granular_scopes 換出粉專，KV／回應不含 token', async () => {
  granularRoutes();
  const env = userEnv();
  const { res, body, text } = await getJ(env, '/fb/pages');
  assert.equal(res.status, 200);
  assert.deepEqual(body.data.map((p) => p.id), ['555', '666']);
  noTokenG(text);
  noTokenG(dumpStores(env));
});

test('授權範圍備援：排程發文用換出的粉專 token；記憶體清掉後重新換', async () => {
  granularRoutes();
  const env = userEnv();
  routes.push([/\/555\/feed$/, () => reply({ id: '555_1' })]);
  const at = nowSec() + 7200;
  const r = await postJ(env, { page: '555', message: '排程測試', scheduledAt: at });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body.data, { id: '555_1', scheduled: true, at, comment: { status: 'none' } });
  const feed = calls.find((c) => c.path.endsWith('/555/feed'));
  assert.equal(feed.tok, GP['555']);
  assert.equal(feed.init.body.get('published'), 'false');
  noTokenG(r.text);
  (await loadFb())._resetFbMemory();
  await postJ(env, { page: '555', message: '再一次' });
  assert.equal(calls.filter((c) => c.path.endsWith('/555/feed')).pop().tok, GP['555']);
});

test('授權範圍備援：換出的 token 出現在錯誤訊息裡也會被抹掉', async () => {
  granularRoutes();
  const env = userEnv();
  routes.push([/\/666\/feed$/, () => fbErr(190, `Error validating access token: ${GP['666']} invalid`)]);
  const { res, text } = await postJ(env, { page: '666', message: 'x' });
  assert.equal(res.status, 502);
  noTokenG(text);
  noTokenG(dumpStores(env));
});

test('有 FB_APP_ID／SECRET 時用 App 身分查授權範圍', async () => {
  granularRoutes();
  const env = userEnv({ FB_APP_ID: '12345', FB_APP_SECRET: SECRET });
  await getJ(env, '/fb/pages');
  const d = calls.find((c) => c.path.endsWith('/debug_token'));
  assert.equal(d.tok, `12345|${SECRET}`);
  assert.equal(new URL(d.url).searchParams.get('input_token'), TOKEN_U);
});

test('管理頁：授權範圍路線標示發文／成效權限、換不到 token 的粉專數', async () => {
  granularRoutes();
  const env = userEnv();
  const { body, text } = await getJ(env, '/admin/fb', 'admin');
  noTokenG(text);
  const t = body.data.tokens[0];
  assert.equal(t.kind, 'user');
  assert.equal(t.skipped, 1);
  assert.deepEqual(t.pages.map((p) => [p.id, p.canPost, p.canInsights]), [['555', true, true], ['666', true, false]]);
});

test('讀不到授權範圍：管理頁提示 debug_failed', async () => {
  granularRoutes({ debugFail: true });
  const env = userEnv();
  assert.deepEqual((await getJ(env, '/fb/pages')).body.data, []);
  const t = (await getJ(env, '/admin/fb', 'admin')).body.data.tokens[0];
  assert.equal(t.hint, 'debug_failed');
});

test('查授權範圍被限流：不快取，下次重問', async () => {
  accounts = [[]];
  let n = 0;
  routes.push([/\/debug_token$/, () => (n++ === 0 ? fbErr(4, 'rate') : reply({ data: { granular_scopes: [{ scope: 'pages_manage_posts', target_ids: ['555'] }] } }))]);
  routes.push([/^\/v26\.0\/555$/, () => reply({ id: '555', name: 'x', access_token: GP['555'] })]);
  const env = userEnv();
  assert.deepEqual((await getJ(env, '/fb/pages')).body.data, []);
  assert.ok(!hasPagesCache(env));
  assert.deepEqual((await getJ(env, '/fb/pages')).body.data.map((p) => p.id), ['555']);
});

test('授權範圍備援：單一粉專遇到臉書暫時錯誤（code 1）整組失敗、不快取，下次重問', async () => {
  accounts = [[]];
  let n = 0;
  routes.push([/\/debug_token$/, () => reply({ data: { granular_scopes: [{ scope: 'pages_manage_posts', target_ids: ['555'] }] } })]);
  routes.push([/^\/v26\.0\/555$/, () => (n++ === 0 ? fbErr(1, 'temporary') : reply({ id: '555', name: 'x', access_token: GP['555'] }))]);
  const env = userEnv();
  assert.deepEqual((await getJ(env, '/fb/pages')).body.data, []);
  assert.ok(!hasPagesCache(env));
  assert.deepEqual((await getJ(env, '/fb/pages')).body.data.map((p) => p.id), ['555']);
});

test('授權範圍備援：單一粉專一直出錯（code 803）只略過它，其他粉專照常並可快取', async () => {
  accounts = [[]];
  routes.push([/\/debug_token$/, () => reply({ data: { granular_scopes: [{ scope: 'pages_manage_posts', target_ids: ['555', '666'] }] } })]);
  routes.push([/^\/v26\.0\/666$/, () => fbErr(803, 'Some of the aliases you requested do not exist')]);
  routes.push([/^\/v26\.0\/555$/, () => reply({ id: '555', name: 'x', access_token: GP['555'] })]);
  const env = userEnv();
  assert.deepEqual((await getJ(env, '/fb/pages')).body.data.map((p) => p.id), ['555']);
  assert.ok(hasPagesCache(env));
});

// ---- 取消排程、原生彩色背景 ----
async function cancelJ(env, body) {
  const res = await call('/fb/cancel', { method: 'POST', headers: { ...(await auth(env)), 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

test('取消排程：未發布 → DELETE、稽核 post-canceled；回應不含 token', async () => {
  const env = fbEnv();
  routes.push([/\/111_9$/, (url, init) => (init.method === 'DELETE' ? reply({ success: true }) : reply({ id: '111_9', is_published: false }))]);
  const { res, body, text } = await cancelJ(env, { post: '111_9' });
  assert.equal(res.status, 200);
  assert.deepEqual(body.data, { post: '111_9', canceled: true });
  const del = calls.find((c) => c.init.method === 'DELETE');
  assert.ok(del && del.path.endsWith('/111_9'));
  assert.equal(del.tok, TOKEN_A);
  noToken(text);
  assert.ok(env.DB.raw.prepare('SELECT code FROM logs').all().some((r) => r.code === 'post-canceled'));
});

test('取消排程：已發布的貼文拒絕，不會 DELETE', async () => {
  const env = fbEnv();
  routes.push([/\/111_9$/, () => reply({ id: '111_9', is_published: true })]);
  const { res, body } = await cancelJ(env, { post: '111_9' });
  assert.equal(res.status, 400);
  assert.match(body.error, /已經發布/);
  assert.ok(!calls.some((c) => c.init.method === 'DELETE'));
});

test('取消排程：ID 格式錯、未知粉專', async () => {
  const env = fbEnv();
  assert.equal((await cancelJ(env, { post: '111' })).body.code, 'bad_request');
  assert.equal((await cancelJ(env, { post: '../me' })).body.code, 'bad_request');
  assert.equal((await cancelJ(env, { post: '999_1' })).body.code, 'fb_unknown_page');
  assert.ok(!calls.some((c) => c.init.method === 'DELETE'));
});

test('取消排程：臉書刪除失敗 → 錯誤碼對應、稽核 cancel-failed', async () => {
  const env = fbEnv();
  routes.push([/\/111_9$/, (url, init) => (init.method === 'DELETE' ? fbErr(200, 'Permissions error ' + TOKEN_A, 403) : reply({ is_published: false }))]);
  const { res, body, text } = await cancelJ(env, { post: '111_9' });
  assert.equal(res.status, 403);
  assert.equal(body.code, 'fb_permission');
  noToken(text);
  assert.ok(env.DB.raw.prepare('SELECT code FROM logs').all().some((r) => r.code === 'cancel-failed-200'));
});

test('原生彩色背景：純文字帶 text_format_preset_id；有圖或連結就拒絕', async () => {
  const env = fbEnv();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_5' })]);
  const okR = await postJ(env, { page: '111', message: '今天天氣好', textPreset: '106018623298955' });
  assert.equal(okR.res.status, 200);
  const sent = calls.find((c) => c.path.endsWith('/111/feed'));
  assert.equal(sent.init.body.get('text_format_preset_id'), '106018623298955');
  assert.match((await postJ(env, { page: '111', message: 'x', textPreset: 'abc' })).body.error, /背景代碼/);
  assert.match((await postJ(env, { page: '111', message: 'x', link: 'https://a.tw', textPreset: '12345' })).body.error, /純文字/);
  assert.match((await postJ(env, { page: '111', message: ' ', textPreset: '12345' })).body.error, /至少|需要內文/);
});

test('一般文字貼文不帶 text_format_preset_id', async () => {
  const env = fbEnv();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_6' })]);
  await postJ(env, { page: '111', message: '一般' });
  const sent = calls.find((c) => c.path.endsWith('/111/feed'));
  assert.equal(sent.init.body.get('text_format_preset_id'), null);
});
