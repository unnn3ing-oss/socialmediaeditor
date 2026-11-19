const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));

async function call(env, path, init = {}) {
  const w = await load();
  return w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } }), env, { waitUntil() {} });
}
async function auth(env, kind, adm = false) {
  const { signToken } = await tok();
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, adm)) };
}
const ACCOUNTS = { data: [{ id: '111', name: 'TVBS 新聞', access_token: 'PT111' }, { id: '222', name: '少康戰情室', access_token: 'PT222' }, { id: '333', name: '氣象站', access_token: 'PT333' }] };
const fbEnv = () => mkEnv({ FB_USER_TOKEN: 'USERTOKEN' });
// 授權名單裡加一個人（預設權限組 2＝發文，沒有 bypass），回帶 uid 的公司憑證標頭
async function staffAuth(env, id = 'A001', group = 2) {
  const adm = await auth(env, 'admin');
  const r = await call(env, '/admin/staff', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ id, name: '測試', group }) });
  assert.equal(r.status, 200);
  const { signToken } = await tok();
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, id)) };
}

test('/fb/pages：無憑證 401、公司密碼憑證 403（要員工編號）、管理員 200', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = fbEnv();
  assert.equal((await call(env, '/fb/pages')).status, 401);
  const r403 = await call(env, '/fb/pages', { headers: await auth(env, 'company') });
  assert.equal(r403.status, 403);
  assert.equal((await r403.json()).code, 'fb_need_staff');
  const r = await call(env, '/fb/pages', { headers: await auth(env, 'company', true) });
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.deepEqual(data.map((p) => p.id), ['111', '222', '333']);
  for (const p of data) { assert.ok(!('token' in p)); assert.ok(!('utm' in p)); assert.ok(!('access_token' in p)); }
  assert.equal(data[0].short, 'TVBS 新聞');
});

test('/fb/pages：只回顯示的、依順序排；/me/accounts 走快取', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  const save = await call(env, '/admin/fb/pages', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ pages: [
    { id: '111', short: '新聞', utm: '?&utm_source=facebook&utm_medium=fbarticlepic', rd: 'news', order: 1, show: true },
    { id: '222', short: '少康', utm: '?&utm_source=facebook&utm_medium=2100roompic', rd: 'shaokang', order: 0, show: true },
    { id: '333', short: '氣象', utm: '', rd: '', order: 2, show: false }
  ] }) });
  assert.equal(save.status, 200, JSON.stringify(await save.clone().json()));
  const { data } = await (await call(env, '/fb/pages', { headers: await auth(env, 'company', true) })).json();
  assert.deepEqual(data.map((p) => [p.id, p.short]), [['222', '少康'], ['111', '新聞']]);
  assert.deepEqual(data.map((p) => p.rd), ['shaokang', 'news'], '帶出 RD 區段（前端排入 RD 用）');
  const all = (await (await call(env, '/admin/fb/pages', { headers: adm })).json()).data;
  assert.equal(all.length, 3);
  assert.deepEqual(all.find((p) => p.id === '111'), { id: '111', name: 'TVBS 新聞', short: '新聞', utm: '?&utm_source=facebook&utm_medium=fbarticlepic', utmText: '', rd: 'news', order: 1, show: true });
  assert.equal(f.calls.filter((c) => c.path === '/me/accounts').length, 1, '第二次起走快取');
  assert.equal((await call(env, '/admin/fb/refresh', { method: 'POST', headers: adm })).status, 200);
  await call(env, '/admin/fb/pages', { headers: adm });
  assert.equal(f.calls.filter((c) => c.path === '/me/accounts').length, 2, 'refresh 後重抓');
});

test('沒設 FB_USER_TOKEN → fb_off；token 壞掉 → fb_token', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => gErr(190, 400, 'expired') }); t.after(f.restore);
  const env = mkEnv();
  const r1 = await call(env, '/fb/pages', { headers: await auth(env, 'company', true) });
  assert.equal(r1.status, 503); assert.equal((await r1.json()).code, 'fb_off');
  const env2 = fbEnv();
  const r2 = await call(env2, '/fb/pages', { headers: await auth(env2, 'company', true) });
  assert.equal(r2.status, 502); assert.equal((await r2.json()).code, 'fb_token');
});

test('POST /admin/fb/pages 驗證', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = fbEnv();
  const send = async (headers, pages) => call(env, '/admin/fb/pages', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ pages }) });
  const ok1 = { id: '111', short: '新聞', utm: '', rd: '', order: 0, show: true };
  assert.equal((await send(await auth(env, 'company', true), [ok1])).status, 401, '前端管理員憑證不能進 /admin');
  const adm = await auth(env, 'admin');
  assert.equal((await send(adm, [{ ...ok1, short: '字'.repeat(21) }])).status, 400);
  assert.equal((await send(adm, [{ ...ok1, short: '' }])).status, 400);
  assert.equal((await send(adm, [{ ...ok1, rd: 'bad' }])).status, 400);
  assert.equal((await send(adm, [{ ...ok1, utm: '?&a=<b>' }])).status, 400);
  assert.equal((await send(adm, [{ ...ok1, order: 1000 }])).status, 400);
  assert.equal((await send(adm, [ok1])).status, 200);
});

test('GET /admin/fb/status：缺權限、到期日不明', async (t) => {
  const f = installFetch({
    'GET /me/accounts': () => ACCOUNTS,
    'GET /me/permissions': () => ({ data: [{ permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_read_engagement', status: 'granted' }, { permission: 'pages_manage_posts', status: 'declined' }] }),
    'GET /debug_token': () => gErr(100)
  }); t.after(f.restore);
  const env = fbEnv();
  const r = await call(env, '/admin/fb/status', { headers: await auth(env, 'admin') });
  const { data } = await r.json();
  assert.equal(data.configured, true);
  assert.equal(data.valid, true);
  assert.equal(data.expires, null);
  assert.equal(data.pages, 3);
  assert.ok(data.missing.includes('pages_manage_posts'));
  assert.ok(data.missing.includes('pages_manage_engagement'));
  assert.ok(!data.missing.includes('pages_show_list'));
  const env2 = mkEnv();
  const d2 = (await (await call(env2, '/admin/fb/status', { headers: await auth(env2, 'admin') })).json()).data;
  assert.equal(d2.configured, false);
});

test('/me/accounts 回空：不快取，回 fb_no_pages', async (t) => {
  let n = 0;
  const f = installFetch({ 'GET /me/accounts': () => (++n === 1 ? { data: [] } : ACCOUNTS) }); t.after(f.restore);
  const env = fbEnv();
  const h = await auth(env, 'company', true);
  const r1 = await call(env, '/fb/pages', { headers: h });
  assert.equal(r1.status, 503);
  const b = await r1.json();
  assert.equal(b.code, 'fb_no_pages'); assert.match(b.error, /權限/);
  const r2 = await call(env, '/fb/pages', { headers: h });
  assert.equal(r2.status, 503, '60 秒內不重查');
  assert.equal(n, 1);
  await call(env, '/admin/fb/refresh', { method: 'POST', headers: await auth(env, 'admin') });
  const r3 = await call(env, '/fb/pages', { headers: h });
  assert.equal(r3.status, 200, '重新讀取後清掉空結果記錄');
});

test('/me/accounts 回空：改用精細範圍的粉專 ID 換粉專 token（去重、拿不到的略過）', async (t) => {
  const f = installFetch({
    'GET /me/accounts': () => ({ data: [{ id: '111', name: 'TVBS 新聞', access_token: 'PT111' }] }),
    'GET /debug_token': () => ({ data: { expires_at: 0, granular_scopes: [
      { scope: 'pages_show_list', target_ids: ['111', '222', '333', '444'] },
      { scope: 'pages_manage_posts', target_ids: ['111', '222', '444'] }] } }),
    'GET /222': () => ({ id: '222', name: '少康戰情室', access_token: 'PT222' }),
    'GET /444': () => gErr(10, 403, 'no permission')
  }); t.after(f.restore);
  const env = fbEnv();
  const r = await call(env, '/fb/pages', { headers: await auth(env, 'company', true) });
  assert.equal(r.status, 200);
  const { data } = await r.json();
  assert.deepEqual(data.map((p) => p.id), ['111', '222'], '只取有發文權限的；111 不重複；444 拿不到略過');
  assert.ok(!f.calls.some((c) => c.path === '/111'), '/me/accounts 已有的不再查');
  assert.ok(!f.calls.some((c) => c.path === '/333'), '沒有 pages_manage_posts 的不查');
});

test('/me/accounts 完全空、精細範圍有粉專 → 照樣拿到；token 失效 → fb_token', async (t) => {
  const f = installFetch({
    'GET /me/accounts': () => ({ data: [] }),
    'GET /debug_token': () => ({ data: { granular_scopes: [{ scope: 'pages_manage_posts', target_ids: ['259369087577045'] }] } }),
    'GET /259369087577045': () => ({ id: '259369087577045', name: 'TVBS 少康戰情室', access_token: 'PTSK' })
  }); t.after(f.restore);
  const env = fbEnv();
  const r = await call(env, '/fb/pages', { headers: await auth(env, 'company', true) });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).data.map((p) => p.short), ['TVBS 少康戰情室']);
  f.restore();
  const g = installFetch({ 'GET /me/accounts': () => ({ data: [] }), 'GET /debug_token': () => gErr(190, 400, 'expired') }); t.after(g.restore);
  const env2 = fbEnv();
  const r2 = await call(env2, '/fb/pages', { headers: await auth(env2, 'company', true) });
  assert.equal((await r2.json()).code, 'fb_token');
});

test('GET /admin/fb/status：expires_at 0＝永不過期（回 0）', async (t) => {
  const f = installFetch({
    'GET /me/accounts': () => ACCOUNTS,
    'GET /me/permissions': () => ({ data: [] }),
    'GET /debug_token': () => ({ data: { expires_at: 0 } })
  }); t.after(f.restore);
  const env = fbEnv();
  const { data } = await (await call(env, '/admin/fb/status', { headers: await auth(env, 'admin') })).json();
  assert.equal(data.expires, 0);
  assert.equal(data.pages, 3);
});

// ---- 管理頁換權杖 ----
const DEBUG_OK = (type = 'USER') => ({ data: { type, is_valid: true, expires_at: 0, application: 'NEW-APP', scopes: ['pages_show_list', 'pages_manage_posts'] } });
test('POST /admin/fb/token：驗證通過才加密存進 D1，之後優先用它；不回傳權杖；DELETE 改回 Secret', async (t) => {
  const seen = [];
  const f = installFetch({
    'GET /debug_token': (c) => { seen.push(c.query.access_token); return DEBUG_OK(); },
    'GET /me/accounts': (c) => (c.query.access_token === 'NEWTOKEN' ? ACCOUNTS : { data: [ACCOUNTS.data[0]] }),
    'GET /me/permissions': () => ({ data: [] })
  }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  const post = (body) => call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // 公司憑證不能換
  assert.equal((await call(env, '/admin/fb/token', { method: 'POST', headers: await auth(env, 'company', true), body: '{}' })).status, 401);
  assert.equal((await post({ token: '' })).status, 400);
  const r = await post({ token: 'NEWTOKEN' });
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.ok(!txt.includes('NEWTOKEN'), '回應不含權杖');
  const d = JSON.parse(txt).data;
  assert.equal(d.source, 'admin'); assert.equal(d.app, 'NEW-APP'); assert.equal(d.pages, 3); assert.equal(d.expires, 0);
  const row = await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'user_token'").first();
  assert.ok(row && row.v.startsWith('v1.') && !row.v.includes('NEWTOKEN'), 'D1 裡是加密後的值');
  assert.ok(f.calls.filter((c) => c.path === '/me/accounts').every((c) => c.query.access_token === 'NEWTOKEN'), '存好後改用新權杖');
  const del = await call(env, '/admin/fb/token', { method: 'DELETE', headers: adm });
  const dd = (await del.json()).data;
  assert.equal(dd.source, 'secret'); assert.equal(dd.pages, 1, '改回 Secret 後重新讀粉專');
});

test('POST /admin/fb/token：權杖類型不對、沒有粉專、無效都不存', async (t) => {
  let mode = 'page';
  const f = installFetch({
    'GET /debug_token': () => (mode === 'bad' ? gErr(190, 400, 'expired') : DEBUG_OK(mode === 'page' ? 'PAGE' : 'USER')),
    'GET /me/accounts': () => ({ data: [] })
  }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  const post = () => call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'X' }) });
  let b = await (await post()).json(); assert.equal(b.code, 'fb_token'); assert.match(b.error, /使用者權杖/);
  mode = 'user'; b = await (await post()).json(); assert.match(b.error, /換不到任何粉專/);
  mode = 'bad'; b = await (await post()).json(); assert.match(b.error, /無效或已過期/);
  const row = await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'user_token'").first().catch(() => null);
  assert.ok(!row, '都沒存');
});

test('tokenstore：加解密來回一致；SESSION_SECRET 不同就解不開', async () => {
  const { encryptToken, decryptToken } = await import('../../server/fb/tokenstore.js');
  const blob = await encryptToken({ SESSION_SECRET: 'a'.repeat(40) }, 'EAAB-token');
  assert.equal(await decryptToken({ SESSION_SECRET: 'a'.repeat(40) }, blob), 'EAAB-token');
  assert.equal(await decryptToken({ SESSION_SECRET: 'b'.repeat(40) }, blob), null);
  assert.equal(await decryptToken({ SESSION_SECRET: 'a'.repeat(40) }, 'junk'), null);
});

test('UTM 文字欄：存取、/fb/pages 只回有沒有設定（noTextUtm），不外露 UTM；格式驗證', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  const post = (pages) => call(env, '/admin/fb/pages', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ pages }) });
  const r = await post([
    { id: '111', short: '新聞', utm: '?&utm_medium=pic', utmText: '?&utm_medium=text', rd: 'news', order: 0, show: true },
    { id: '222', short: '少康', utm: '?&utm_medium=pic2', rd: '', order: 1, show: true }
  ]);
  assert.equal(r.status, 200);
  const all = (await r.json()).data;
  assert.equal(all.find((p) => p.id === '111').utmText, '?&utm_medium=text');
  assert.equal(all.find((p) => p.id === '222').utmText, '');
  const { data } = await (await call(env, '/fb/pages', { headers: await auth(env, 'company', true) })).json();
  assert.deepEqual(data.filter((p) => p.id !== '333').map((p) => [p.id, p.noTextUtm]), [['111', false], ['222', true]]);
  for (const p of data) assert.ok(!('utmText' in p));
  assert.equal((await post([{ id: '111', short: '新聞', utm: '', utmText: 'a b', rd: '', order: 0, show: true }])).status, 400);
  assert.equal((await post([{ id: '111', short: '新聞', utm: '', utmText: 'x'.repeat(201), rd: '', order: 0, show: true }])).status, 400);
});

test('舊資料表沒有 utm_text 欄位：自動補上', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = fbEnv();
  env.DB.raw.exec("DROP TABLE fb_pages; CREATE TABLE fb_pages (id TEXT PRIMARY KEY, short TEXT NOT NULL, utm TEXT NOT NULL DEFAULT '', rd TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL DEFAULT 999, show INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL); INSERT INTO fb_pages VALUES ('111','新聞','?&a=1','news',0,1,0);");
  const mod = await import('../../server/fb/pages.js');
  const s = await mod.pageSetting(env, '111');
  assert.deepEqual(s, { utm: '?&a=1', utmText: '', rd: 'news' });
});

test('開放／關閉：預設關閉；開放後名單內的人可用；關閉原因隨 403 回給前端、開放後保留；舊值與壞值', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  const company = await staffAuth(env);
  assert.equal((await call(env, '/fb/pages', { headers: await auth(env, 'company') })).status, 403, '公司密碼憑證不論開放關閉都不行');
  const set = (body, h = adm) => call(env, '/admin/fb/access', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual((await (await call(env, '/admin/fb/access', { headers: adm })).json()).data, { mode: 'admin', reason: '' });
  const r0 = await call(env, '/fb/pages', { headers: company });
  assert.equal(r0.status, 403);
  assert.deepEqual((await r0.json()).detail, { reason: '' });
  assert.equal((await set({ mode: 'company' }, company)).status, 401, '員工憑證不能切換');
  assert.equal((await set({ mode: 'everyone' })).status, 400);
  assert.equal((await set({ mode: 'admin', reason: '字'.repeat(101) })).status, 400);
  assert.equal((await set({ mode: 'admin', reason: 5 })).status, 400);
  // 關閉＋原因
  assert.deepEqual((await (await set({ mode: 'admin', reason: '  臉書權杖更換中 ' })).json()).data, { mode: 'admin', reason: '臉書權杖更換中' });
  const r1 = await call(env, '/fb/pages', { headers: company });
  const j1 = await r1.json();
  assert.equal(r1.status, 403); assert.equal(j1.code, 'fb_forbidden');
  assert.deepEqual(j1.detail, { reason: '臉書權杖更換中' });
  assert.equal((await call(env, '/fb/pages', { headers: await auth(env, 'company', true) })).status, 200, '管理員一直可用');
  // 開放（沒帶 reason＝保留）
  assert.deepEqual((await (await set({ mode: 'company' })).json()).data, { mode: 'company', reason: '臉書權杖更換中' });
  assert.equal((await call(env, '/fb/pages', { headers: company })).status, 200);
  assert.deepEqual((await (await call(env, '/fb/access', { headers: company })).json()).data, { mode: 'company' });
  assert.equal((await call(env, '/fb/pages')).status, 401, '沒登入仍不行');
  // 清空原因
  assert.deepEqual((await (await set({ mode: 'admin', reason: '' })).json()).data, { mode: 'admin', reason: '' });
  // 舊版純字串、壞值
  env.DB.raw.prepare("UPDATE fb_settings SET v = 'company' WHERE k = 'access'").run();
  assert.equal((await call(env, '/fb/pages', { headers: company })).status, 200, '舊版純字串仍有效');
  env.DB.raw.prepare("UPDATE fb_settings SET v = 'bogus' WHERE k = 'access'").run();
  assert.equal((await call(env, '/fb/pages', { headers: company })).status, 403);
});

// ---- 自動延長＋存粉專權杖 ----
const DAY = 86400;
// debug_token 替身：依 input_token 回不同結果；PT* 是粉專權杖
function debugBy(map) {
  return (c) => {
    const k = c.query.input_token;
    const v = map[k] !== undefined ? map[k] : map['*'];
    return typeof v === 'function' ? v(c) : v;
  };
}
const appEnv = (extra = {}) => mkEnv({ FB_USER_TOKEN: 'USERTOKEN', FB_APP_ID: '999', FB_APP_SECRET: 'SECRET', ...extra });

test('有 App 密鑰：短效權杖自動延長、換好粉專權杖加密存 D1；之後不再打 /me/accounts，使用者權杖過期也照用', async (t) => {
  let userDead = false;
  const f = installFetch({
    'GET /oauth/access_token': (c) => (c.query.client_secret === 'SECRET' && c.query.fb_exchange_token === 'SHORT' ? { access_token: 'LONG', token_type: 'bearer', expires_in: 5184000 } : gErr(100)),
    'GET /debug_token': debugBy({
      SHORT: { data: { type: 'USER', is_valid: true, app_id: '999', application: 'DEV-TOOL', expires_at: nowSec() + 3600, scopes: ['pages_manage_posts'] } },
      LONG: { data: { type: 'USER', is_valid: true, app_id: '999', application: 'DEV-TOOL', expires_at: nowSec() + 60 * DAY, scopes: ['pages_manage_posts'] } },
      '*': { data: { type: 'PAGE', is_valid: true, app_id: '999', application: 'DEV-TOOL', expires_at: 0, data_access_expires_at: nowSec() + 90 * DAY } }
    }),
    'GET /me/accounts': (c) => (userDead ? gErr(190, 400, 'expired') : c.query.access_token === 'LONG' ? ACCOUNTS : gErr(190, 400, 'short')),
    'GET /me/permissions': () => (userDead ? gErr(190, 400, 'expired') : { data: [] })
  }); t.after(f.restore);
  const env = appEnv();
  const adm = await auth(env, 'admin');
  const r = await call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'SHORT' }) });
  const txt = await r.text();
  assert.equal(r.status, 200, txt);
  for (const s of ['SHORT', 'LONG', 'PT111', 'SECRET']) assert.ok(!txt.includes(s), '回應不含權杖／密鑰：' + s);
  const d = JSON.parse(txt).data;
  assert.equal(d.extended, true); assert.equal(d.autoExtend, true);
  assert.equal(d.stored.pages, 3); assert.equal(d.stored.expires, 0);
  assert.ok(d.stored.dataExpires > nowSec() + 89 * DAY);
  assert.equal(d.warn, null);
  const rows = (await env.DB.prepare("SELECT k, v FROM fb_settings").all()).results;
  const pt = rows.find((x) => x.k === 'page_tokens');
  assert.ok(pt && pt.v.startsWith('v1.') && !pt.v.includes('PT111'), '粉專權杖加密存');
  const { storedToken } = await import('../../server/fb/tokenstore.js');
  assert.equal(await storedToken(env), 'LONG', '存的是延長後的權杖');
  // 之後：使用者權杖過期也能讀粉專，不打 /me/accounts
  userDead = true;
  const before = f.calls.filter((c) => c.path === '/me/accounts').length;
  const pr = await call(env, '/fb/pages', { headers: await auth(env, 'company', true) });
  assert.equal(pr.status, 200);
  assert.equal((await pr.json()).data.length, 3);
  assert.equal(f.calls.filter((c) => c.path === '/me/accounts').length, before);
  const st = (await (await call(env, '/admin/fb/status', { headers: adm })).json()).data;
  assert.equal(st.valid, true, '粉專權杖有效＝可發文'); assert.equal(st.userValid, false);
  assert.deepEqual(st.missing, []);
  // 重新整理粉專：使用者權杖過期 → 保留舊的
  const rf = (await (await call(env, '/admin/fb/refresh', { method: 'POST', headers: adm })).json()).data;
  assert.equal(rf.renewed, false); assert.equal(rf.reason, 'user_expired');
  assert.equal((await (await call(env, '/admin/fb/status', { headers: adm })).json()).data.stored.pages, 3);
  // 改回 Secret：粉專權杖一起刪
  await call(env, '/admin/fb/token', { method: 'DELETE', headers: adm });
  assert.ok(!(await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'page_tokens'").first()));
});

test('自動延長：權杖屬於別的 App、延長失敗都不存', async (t) => {
  let other = true;
  const f = installFetch({
    'GET /oauth/access_token': () => gErr(101, 400, 'bad secret'),
    'GET /debug_token': () => ({ data: { type: 'USER', is_valid: true, app_id: other ? '123' : '999', application: other ? 'OTHER' : 'DEV-TOOL', expires_at: nowSec() + 3600, scopes: ['pages_manage_posts'] } }),
    'GET /me/accounts': () => ACCOUNTS
  }); t.after(f.restore);
  const env = appEnv();
  const post = async () => (await call(env, '/admin/fb/token', { method: 'POST', headers: { ...(await auth(env, 'admin')), 'content-type': 'application/json' }, body: JSON.stringify({ token: 'SHORT' }) })).json();
  let b = await post(); assert.equal(b.code, 'fb_token'); assert.match(b.error, /另一個 App（OTHER）/);
  other = false; b = await post(); assert.match(b.error, /自動延長失敗/);
  assert.ok(!(await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'user_token'").first().catch(() => null)));
});

test('沒有 App 密鑰：粉專權杖會過期（貼了短效權杖）→ 拒存並提示先延長；已延長的照樣存', async (t) => {
  let pageExp = nowSec() + 3600;
  const f = installFetch({
    'GET /debug_token': debugBy({ X: { data: { type: 'USER', is_valid: true, expires_at: nowSec() + 3600, scopes: ['pages_manage_posts'] } }, '*': () => ({ data: { type: 'PAGE', is_valid: true, expires_at: pageExp } }) }),
    'GET /me/accounts': () => ACCOUNTS,
    'GET /me/permissions': () => ({ data: [] })
  }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  const post = async () => (await call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'X' }) })).json();
  const b = await post();
  assert.equal(b.code, 'fb_token'); assert.match(b.error, /Extend/);
  assert.ok(!f.calls.some((c) => c.path === '/oauth/access_token'), '沒密鑰不呼叫延長');
  assert.ok(!(await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'page_tokens'").first().catch(() => null)));
  pageExp = 0;
  const ok2 = await post();
  assert.equal(ok2.data.extended, false); assert.equal(ok2.data.autoExtend, false); assert.equal(ok2.data.stored.pages, 3);
});

test('重新整理粉專：使用者權杖有效就重新換（新粉專加進來）', async (t) => {
  let accounts = { data: [ACCOUNTS.data[0]] };
  const f = installFetch({
    'GET /debug_token': () => ({ data: { type: 'USER', is_valid: true, expires_at: 0, scopes: ['pages_manage_posts'] } }),
    'GET /me/accounts': () => accounts,
    'GET /me/permissions': () => ({ data: [] })
  }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  await call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'X' }) });
  accounts = ACCOUNTS;
  const rf = (await (await call(env, '/admin/fb/refresh', { method: 'POST', headers: adm })).json()).data;
  assert.equal(rf.renewed, true); assert.equal(rf.pages, 3);
  assert.equal((await (await call(env, '/admin/fb/pages', { headers: adm })).json()).data.length, 3);
});

test('粉專權杖失效（190）→ 記旗標：狀態與 /fb/me（管理員）顯示提醒；換新權杖後清掉', async (t) => {
  let dead = false;
  const f = installFetch({
    'GET /debug_token': (c) => (dead && c.query.access_token === 'PT111' ? gErr(190, 400, 'session invalidated') : { data: { type: 'USER', is_valid: true, expires_at: 0, scopes: ['pages_manage_posts'] } }),
    'GET /me/accounts': () => ACCOUNTS,
    'GET /me/permissions': () => ({ data: [] })
  }); t.after(f.restore);
  const env = fbEnv();
  const adm = await auth(env, 'admin');
  const save = () => call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'X' }) });
  await save();
  const me0 = (await (await call(env, '/fb/me', { headers: await auth(env, 'company', true) })).json()).data;
  assert.equal(me0.tokenWarn, null);
  dead = true;
  const st = (await (await call(env, '/admin/fb/status', { headers: adm })).json()).data;
  assert.equal(st.valid, false); assert.ok(st.broken); assert.equal(st.warn.level, 'bad');
  const me = (await (await call(env, '/fb/me', { headers: await auth(env, 'company', true) })).json()).data;
  assert.equal(me.tokenWarn.level, 'bad'); assert.match(me.tokenWarn.text, /失效/);
  dead = false;
  await save();
  const me2 = (await (await call(env, '/fb/me', { headers: await auth(env, 'company', true) })).json()).data;
  assert.equal(me2.tokenWarn, null, '換新權杖清掉旗標');
});

test('tokenWarn：14 天內提醒、過期為 bad；有存粉專權杖看資料存取期限', async () => {
  const { tokenWarn } = await import('../../server/fb/pages.js');
  const now = 1_000_000_000_000, s = now / 1000;
  assert.equal(tokenWarn({ stored: null, userExpires: 0, now }), null, '永不過期');
  assert.equal(tokenWarn({ stored: null, userExpires: s + 30 * DAY, now }), null);
  assert.deepEqual(tokenWarn({ stored: null, userExpires: s + 10 * DAY, now }).days, 10);
  assert.equal(tokenWarn({ stored: null, userExpires: s - 10, now }).level, 'bad');
  assert.equal(tokenWarn({ stored: { dataExpires: s + 5 * DAY }, userExpires: s - 10, now }).days, 5, '使用者權杖過期不影響，看資料存取期限');
  assert.equal(tokenWarn({ stored: { dataExpires: 0 }, userExpires: s - 10, now }), null);
  assert.equal(tokenWarn({ stored: null, userExpires: 0, broken: now, now }).level, 'bad');
});

// ---- App 密鑰（管理頁輸入）----
const SEC32 = 'abcdef0123456789ABCDEF0123456789';
test('App 密鑰：格式檢查、client_credentials 驗證通過才加密存；永不回傳 Secret；清除', async (t) => {
  const f = installFetch({
    'GET /oauth/access_token': (c) => (c.query.grant_type === 'client_credentials' && c.query.client_id === '555' && c.query.client_secret === SEC32 ? { access_token: '555|apptoken', token_type: 'bearer' } : gErr(1, 400, 'Error validating client secret'))
  }); t.after(f.restore);
  const env = mkEnv();
  const adm = await auth(env, 'admin');
  const post = (b) => call(env, '/admin/fb/app', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await call(env, '/admin/fb/app', { headers: await auth(env, 'company', true) })).status, 401, '公司憑證不能看');
  assert.deepEqual((await (await call(env, '/admin/fb/app', { headers: adm })).json()).data, { configured: false, appId: '', source: null, savedAt: null });
  let b = await (await post({ appId: '55a', secret: SEC32 })).json(); assert.match(b.error, /App ID/);
  b = await (await post({ appId: '555', secret: 'short' })).json(); assert.match(b.error, /32 位/);
  assert.ok(!f.calls.length, '格式不對不打臉書');
  b = await (await post({ appId: '555', secret: SEC32.replace('a', 'b') })).json(); assert.equal(b.code, 'fb_error'); assert.match(b.error, /對不上/);
  assert.ok(!(await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'app_cred'").first().catch(() => null)));
  const r = await post({ appId: ' 555 ', secret: SEC32 });
  const txt = await r.text();
  assert.equal(r.status, 200, txt);
  assert.ok(!txt.includes(SEC32) && !txt.includes('apptoken'), '不回傳 Secret 與 App 權杖');
  const d = JSON.parse(txt).data;
  assert.equal(d.configured, true); assert.equal(d.appId, '555'); assert.equal(d.source, 'admin'); assert.ok(d.savedAt);
  const row = await env.DB.prepare("SELECT v FROM fb_settings WHERE k = 'app_cred'").first();
  assert.ok(row.v.startsWith('v1.') && !row.v.includes(SEC32), '加密存');
  assert.ok(!('access_token' in f.calls.at(-1).query), '驗證時不帶 access_token');
  const del = (await (await call(env, '/admin/fb/app', { method: 'DELETE', headers: adm })).json()).data;
  assert.equal(del.configured, false);
});

test('App 密鑰：管理頁存的優先於 Secret；貼權杖時用它自動延長、比對 App ID', async (t) => {
  const f = installFetch({
    'GET /oauth/access_token': (c) => (c.query.grant_type === 'client_credentials' ? { access_token: 'x|y' }
      : c.query.client_id === '555' && c.query.client_secret === SEC32 ? { access_token: 'LONG2' } : gErr(101, 400, 'wrong app')),
    'GET /debug_token': debugBy({
      SHORT: { data: { type: 'USER', is_valid: true, app_id: '555', application: 'DEV-TOOL', expires_at: nowSec() + 3600, scopes: ['pages_manage_posts'] } },
      '*': { data: { type: 'USER', is_valid: true, app_id: '555', expires_at: 0, scopes: ['pages_manage_posts'] } }
    }),
    'GET /me/accounts': () => ACCOUNTS,
    'GET /me/permissions': () => ({ data: [] })
  }); t.after(f.restore);
  const env = appEnv();   // Secret 是 999
  const adm = await auth(env, 'admin');
  const app0 = (await (await call(env, '/admin/fb/app', { headers: adm })).json()).data;
  assert.equal(app0.source, 'secret'); assert.equal(app0.appId, '999');
  // 權杖是 555 的 → 用 Secret 999 會被擋
  let b = await (await call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'SHORT' }) })).json();
  assert.match(b.error, /App ID 999/);
  await call(env, '/admin/fb/app', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ appId: '555', secret: SEC32 }) });
  b = await (await call(env, '/admin/fb/token', { method: 'POST', headers: { ...adm, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'SHORT' }) })).json();
  assert.equal(b.ok, true, JSON.stringify(b)); assert.equal(b.data.extended, true); assert.equal(b.data.autoExtend, true);
  const { storedToken } = await import('../../server/fb/tokenstore.js');
  assert.equal(await storedToken(env), 'LONG2');
  // 「改回 Secret」（刪使用者權杖）不動 App 密鑰
  await call(env, '/admin/fb/token', { method: 'DELETE', headers: adm });
  assert.equal((await (await call(env, '/admin/fb/app', { headers: adm })).json()).data.source, 'admin');
});
