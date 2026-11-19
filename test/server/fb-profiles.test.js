// 臉書權杖組別：命名、切換、刪除；?p= 設定指定組別；方案 A（其他組補粉專）；Webhook 任一組 App 密鑰
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, init = {}) {
  const w = await load();
  return w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } }), env, { waitUntil() {} });
}
async function auth(env, kind, adm = false) {
  const { signToken } = await tok();
  if (adm) env.SYS_STAFF_ID = 'SYS1';
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, false, adm ? 'SYS1' : '', adm ? 1 : 0)) };
}
const json = (b) => ({ 'content-type': 'application/json', body: JSON.stringify(b) });
async function api(env, adm, method, path, body) {
  const init = { method, headers: { ...adm } };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const r = await call(env, path, init);
  const txt = await r.text();
  return { status: r.status, txt, j: JSON.parse(txt) };
}

// 兩個 App：999（主管）換到粉專 111、222；888（我的）換到粉專 111、444
function fb() {
  return installFetch({
    'GET /oauth/access_token': (c) => {
      if (c.query.grant_type === 'client_credentials') return (c.query.client_id === '999' && c.query.client_secret === 'S'.repeat(32)) || (c.query.client_id === '888' && c.query.client_secret === 'M'.repeat(32)) ? { access_token: 'APP' } : gErr(101);
      if (c.query.client_id === '999' && c.query.fb_exchange_token === 'BOSS') return { access_token: 'BOSS_L' };
      if (c.query.client_id === '888' && c.query.fb_exchange_token === 'MINE') return { access_token: 'MINE_L' };
      return gErr(100);
    },
    'GET /debug_token': (c) => {
      const t = c.query.input_token;
      const app = /^(BOSS|PB)/.test(t) ? { app_id: '999', application: 'DEV-TOOL' } : { app_id: '888', application: 'socialmediaeditor' };
      if (/^(BOSS|MINE)$/.test(t)) return { data: { type: 'USER', is_valid: true, ...app, expires_at: nowSec() + 3600, scopes: ['pages_manage_posts'] } };
      if (/_L$/.test(t)) return { data: { type: 'USER', is_valid: true, ...app, expires_at: nowSec() + 60 * DAY, scopes: ['pages_manage_posts'] } };
      return { data: { type: 'PAGE', is_valid: true, ...app, expires_at: 0, data_access_expires_at: nowSec() + 90 * DAY } };
    },
    'GET /me/accounts': (c) => (c.query.access_token === 'BOSS_L' ? { data: [{ id: '111', name: '新聞', access_token: 'PB111' }, { id: '222', name: '少康', access_token: 'PB222' }] }
      : c.query.access_token === 'MINE_L' ? { data: [{ id: '111', name: '新聞', access_token: 'PM111' }, { id: '444', name: '評 Photography', access_token: 'PM444' }] } : gErr(190)),
    'GET /me/permissions': () => ({ data: [] })
  });
}

test('組別：預設只有 p1「預設」；新增、改名、名稱驗證、最多 5 組；不回傳權杖與 Secret', async (t) => {
  const f = fb(); t.after(f.restore);
  const env = mkEnv({});
  const adm = await auth(env, 'admin');
  assert.equal((await call(env, '/admin/fb/profiles', { headers: await auth(env, 'company', true) })).status, 403, '前端管理員憑證要解鎖');
  let r = await api(env, adm, 'GET', '/admin/fb/profiles');
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.data.list.map((x) => [x.id, x.name, x.active, x.hasToken]), [['p1', '預設', true, false]]);
  r = await api(env, adm, 'POST', '/admin/fb/profiles', { name: '  我的  權杖 ' });
  assert.equal(r.status, 200, r.txt);
  const mine = r.j.data.created;
  assert.match(mine, /^p[0-9a-f]{8}$/);
  assert.equal(r.j.data.list.find((x) => x.id === mine).name, '我的 權杖');
  assert.equal((await api(env, adm, 'POST', '/admin/fb/profiles', { name: '我的 權杖' })).status, 400, '不能同名');
  assert.equal((await api(env, adm, 'POST', '/admin/fb/profiles', { name: '' })).status, 400);
  assert.equal((await api(env, adm, 'POST', '/admin/fb/profiles', { name: '字'.repeat(21) })).status, 400);
  r = await api(env, adm, 'POST', '/admin/fb/profiles/p1', { name: '主管權杖' });
  assert.equal(r.status, 200);
  assert.equal(r.j.data.list[0].name, '主管權杖');
  for (const n of ['三', '四', '五']) assert.equal((await api(env, adm, 'POST', '/admin/fb/profiles', { name: n })).status, 200);
  r = await api(env, adm, 'POST', '/admin/fb/profiles', { name: '六' });
  assert.equal(r.status, 400); assert.match(r.j.error, /最多 5 組/);
  assert.equal((await api(env, adm, 'POST', '/admin/fb/profiles/pdeadbeef', { name: 'x' })).status, 400, '不存在的組別');
});

test('?p= 設定指定組別（App 密鑰、權杖各自存）；切換後粉專清單換成那組；方案 A 其他組補粉專；刪除', async (t) => {
  const f = fb(); t.after(f.restore);
  const env = mkEnv({});
  const adm = await auth(env, 'admin');
  // p1：主管
  assert.equal((await api(env, adm, 'POST', '/admin/fb/app', { appId: '999', secret: 'S'.repeat(32) })).status, 200);
  let r = await api(env, adm, 'POST', '/admin/fb/token', { token: 'BOSS' });
  assert.equal(r.status, 200, r.txt);
  // 我的：先建組別，再用 ?p= 設定
  const mine = (await api(env, adm, 'POST', '/admin/fb/profiles', { name: '我的' })).j.data.created;
  r = await api(env, adm, 'POST', '/admin/fb/profiles/' + mine + '/activate');
  assert.equal(r.status, 400, '沒有權杖不能切'); assert.match(r.j.error, /還沒有權杖/);
  assert.equal((await api(env, adm, 'POST', '/admin/fb/app?p=' + mine, { appId: '888', secret: 'M'.repeat(32) })).status, 200);
  r = await api(env, adm, 'POST', '/admin/fb/token?p=' + mine, { token: 'MINE' });
  assert.equal(r.status, 200, r.txt);
  assert.equal((await api(env, adm, 'GET', '/admin/fb/app')).j.data.appId, '999', '使用中那組的 App 密鑰沒被蓋掉');
  assert.equal((await api(env, adm, 'GET', '/admin/fb/app?p=' + mine)).j.data.appId, '888');
  assert.equal((await api(env, adm, 'GET', '/admin/fb/status?p=pdeadbeef')).status, 400);
  r = await api(env, adm, 'GET', '/admin/fb/profiles');
  for (const s of ['BOSS', 'MINE', 'PB111', 'PM444', 'S'.repeat(32), 'M'.repeat(32)]) assert.ok(!r.txt.includes(s), '不外露：' + s);
  const byId = Object.fromEntries(r.j.data.list.map((x) => [x.id, x]));
  assert.deepEqual(byId.p1.pages, ['新聞', '少康']); assert.equal(byId.p1.appName, 'DEV-TOOL'); assert.equal(byId.p1.appId, '999');
  assert.deepEqual(byId[mine].pages, ['新聞', '評 Photography']); assert.equal(byId[mine].appName, 'socialmediaeditor');
  assert.ok(byId[mine].dataExpires > nowSec() + 89 * DAY);
  // 工具端：使用中 p1 → 粉專只有主管那組
  const co = await auth(env, 'company', true);
  const names = async () => (await (await call(env, '/fb/pages', { headers: co })).json()).data.map((p) => p.short).sort();
  assert.deepEqual(await names(), ['少康', '新聞']);
  const { pageTokens } = await import('../../server/fb/pages.js');
  let m = await pageTokens(env);
  assert.equal(m.get('111').token, 'PB111', '同粉專以使用中那組優先');
  assert.equal(m.get('444').token, 'PM444', '方案 A：其他組補上');
  // 切換到我的
  r = await api(env, adm, 'POST', '/admin/fb/profiles/' + mine + '/activate');
  assert.equal(r.status, 200, r.txt);
  assert.deepEqual(await names(), ['新聞', '評 Photography']);
  m = await pageTokens(env);
  assert.equal(m.get('111').token, 'PM111'); assert.equal(m.get('222').token, 'PB222', '舊排程的粉專仍找得到');
  assert.equal((await api(env, adm, 'GET', '/admin/fb/status')).j.data.stored.pages, 2);
  // 使用中不能刪；切回後可刪我的
  r = await api(env, adm, 'DELETE', '/admin/fb/profiles/' + mine);
  assert.equal(r.status, 400); assert.match(r.j.error, /使用中/);
  await api(env, adm, 'POST', '/admin/fb/profiles/p1/activate');
  r = await api(env, adm, 'DELETE', '/admin/fb/profiles/' + mine);
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.data.list.map((x) => x.id), ['p1']);
  const left = (await env.DB.prepare('SELECT k FROM fb_settings').all()).results.map((x) => x.k);
  assert.ok(!left.some((k) => k.includes('@' + mine)), '刪除組別連同權杖與密鑰');
  m = await pageTokens(env);
  assert.ok(!m.has('444'));
});

test('舊資料（沒有 profiles 列）＝p1 沿用原本的 key；Secret FB_USER_TOKEN 只給 p1', async (t) => {
  const f = fb(); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'BOSS_L' });
  const adm = await auth(env, 'admin');
  let r = await api(env, adm, 'GET', '/admin/fb/profiles');
  assert.equal(r.j.data.list[0].hasToken, true); assert.equal(r.j.data.list[0].source, 'secret');
  const mine = (await api(env, adm, 'POST', '/admin/fb/profiles', { name: '我的' })).j.data.created;
  r = await api(env, adm, 'GET', '/admin/fb/profiles');
  assert.equal(r.j.data.list.find((x) => x.id === mine).hasToken, false, 'Secret 不會套到其他組');
  assert.equal((await api(env, adm, 'GET', '/admin/fb/status?p=' + mine)).j.data.configured, false);
});

test('使用中那組沒權杖但其他組有：發文用的 pageTokens 仍可用；都沒有才丟 fb_off', async (t) => {
  const f = fb(); t.after(f.restore);
  const env = mkEnv({});
  const { pageTokens } = await import('../../server/fb/pages.js');
  await assert.rejects(pageTokens(env), (e) => e.code === 'fb_off');
  const adm = await auth(env, 'admin');
  const mine = (await api(env, adm, 'POST', '/admin/fb/profiles', { name: '我的' })).j.data.created;
  await api(env, adm, 'POST', '/admin/fb/app?p=' + mine, { appId: '888', secret: 'M'.repeat(32) });
  assert.equal((await api(env, adm, 'POST', '/admin/fb/token?p=' + mine, { token: 'MINE' })).status, 200);
  const m = await pageTokens(env);
  assert.equal(m.get('444').token, 'PM444');
});

test('Webhook：任一組的 App 密鑰驗得過簽章就收', async (t) => {
  const f = fb(); t.after(f.restore);
  const env = mkEnv({});
  const adm = await auth(env, 'admin');
  const mine = (await api(env, adm, 'POST', '/admin/fb/profiles', { name: '我的' })).j.data.created;
  await api(env, adm, 'POST', '/admin/fb/app', { appId: '999', secret: 'S'.repeat(32) });
  await api(env, adm, 'POST', '/admin/fb/app?p=' + mine, { appId: '888', secret: 'M'.repeat(32) });
  const body = JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'feed' }] }] });
  const send = (secret) => call(env, '/fbhook', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex'), 'content-type': 'application/json' }, body });
  assert.equal((await send('S'.repeat(32))).status, 200);
  assert.equal((await send('M'.repeat(32))).status, 200);
  assert.equal((await send('X'.repeat(32))).status, 403);
  assert.equal((await api(env, adm, 'GET', '/admin/fb/webhook')).j.data.signReady, true);
});
