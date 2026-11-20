const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
const SECRET = 'abcdef0123456789ABCDEF0123456789';
let worker, G;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const guard = async () => (G = G || (await import('../../server/fb/guard.js')));
async function call(env, path, init = {}, ctx = { waitUntil() {} }) {
  return (await load()).fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } }), env, ctx);
}
async function adminH(env) {
  const { signToken } = await import('../../server/core/token.js');
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)), 'content-type': 'application/json' };
}
const ACCOUNTS = { data: [{ id: '111', name: 'TVBS 新聞', access_token: 'PT111' }] };
const fbEnv = () => mkEnv({ FB_USER_TOKEN: 'USERTOKEN', FB_APP_ID: '555', FB_APP_SECRET: SECRET });
const ev = (value, page = '111') => ({ object: 'page', entry: [{ id: page, time: 1, changes: [{ field: 'feed', value: { item: 'comment', post_id: page + '_9', ...value } }] }] });
const SPAM = { id: '9_1', message: '幸好一直看 雙寶爸的財經新報 超讚！', from: { id: '777', name: 'Eliza' }, is_hidden: false, permalink_url: 'https://www.facebook.com/x', message_tags: [{ id: '888', name: '雙寶爸的財經新報', type: 'user' }] };
async function setup(env, mode = 'observe', extra = {}) {
  const g = await guard();
  await g.saveGuard(env, { mode, profile: 'p1', pages: ['111'], rules: structuredClone(g.DEFAULT_RULES), ...extra });
}
const logRows = async (env) => (await env.DB.prepare('SELECT * FROM fb_guard_log').all()).results;

test('規則：預設、預篩（全半形／空白）、r1／r2、白名單、粉專自己', async () => {
  const g = await guard();
  const R = g.DEFAULT_RULES;
  assert.ok(g.prefilter('幸 好 一 直 看 雙寶爸', R));
  assert.ok(g.prefilter('進群跟老師學', R));
  assert.ok(!g.prefilter('持續追蹤這則新聞', R), '只有 1 個引導詞不讀');
  assert.ok(!g.prefilter('老師老師老師', R), '同一個引導詞重複不算 2 個');
  assert.ok(!g.prefilter('新聞報導很清楚', R));
  assert.equal(g.judge(SPAM, R, '111').rule, 'r1');
  assert.equal(g.judge({ ...SPAM, message_tags: [{ id: '5', name: '三寳爸飆股日記' }] }, R, '111').rule, 'r1', '異體字寳');
  assert.equal(g.judge({ message: '進群跟老師學 獲利', message_tags: [{ id: '5', name: '王小明' }], from: { id: '1' } }, R, '111').rule, 'r2');
  assert.equal(g.judge({ message: '老師好', message_tags: [{ id: '5', name: '王小明' }], from: { id: '1' } }, R, '111').hit, false, '只有 1 個引導詞');
  assert.equal(g.judge({ ...SPAM, message_tags: [] }, R, '111').hit, false, '沒標註');
  assert.equal(g.judge(SPAM, { ...R, allow: ['777'] }, '111').hit, false, '白名單');
  assert.equal(g.judge({ ...SPAM, from: { id: '111' } }, R, '111').hit, false, '粉專自己');
  assert.equal(g.cleanRules({ names: ['x'.repeat(21)], leads: [], allow: [] }), null);
  assert.equal(g.cleanRules({ names: [], leads: [], allow: ['abc'] }), null);
  assert.deepEqual(g.cleanRules({ names: [' a ', 'a'], leads: [], allow: [] }).names, ['a']);
});

test('觀察模式：只記錄，不呼叫隱藏；先留無害字再編輯也抓得到；同一則只有一列', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, 'GET /9_1': () => SPAM, 'POST /9_1': () => ({ success: true }) }); t.after(f.restore);
  const env = fbEnv(); const g = await guard();
  await setup(env, 'observe');
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_1', message: '哇哦哦哦哦', from: { id: '777' } }));
  assert.equal(f.calls.filter((c) => c.path === '/9_1').length, 0, '預篩沒中不打 API');
  await g.guardEvent(env, ev({ verb: 'edited', comment_id: '9_1', message: SPAM.message, from: { id: '777' } }));
  await g.guardEvent(env, ev({ verb: 'edited', comment_id: '9_1', message: SPAM.message, from: { id: '777' } }));
  assert.equal(f.calls.filter((c) => c.method === 'POST' && c.path === '/9_1').length, 0, '觀察不隱藏');
  const rows = await logRows(env);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'observe'); assert.equal(rows[0].rule, 'r1'); assert.equal(rows[0].edited, 1);
  assert.equal((await g.readStats(env)).observe, 2);
});

test('自動隱藏：r1 隱藏；r2 預設只觀察；粉專自己與沒開的粉專不打 API；沒文字只計數', async (t) => {
  const R2 = { id: '9_2', message: '進群跟老師學 獲利', from: { id: '1' }, message_tags: [{ id: '5', name: '王小明' }], is_hidden: false };
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, 'GET /9_1': () => SPAM, 'POST /9_1': () => ({ success: true }), 'GET /9_2': () => R2 }); t.after(f.restore);
  const env = fbEnv(); const g = await guard();
  await setup(env, 'hide');
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_1', message: SPAM.message, from: { id: '777' } }));
  const hideCall = f.calls.find((c) => c.method === 'POST' && c.path === '/9_1');
  assert.equal(hideCall.body.is_hidden, 'true');
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_2', message: R2.message, from: { id: '1' } }));
  assert.ok(!f.calls.some((c) => c.method === 'POST' && c.path === '/9_2'));
  const rows = Object.fromEntries((await logRows(env)).map((r) => [r.cid, r.action]));
  assert.deepEqual(rows, { '9_1': 'hidden', '9_2': 'observe' });
  const n = f.calls.length;
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_3', message: '雙寶爸', from: { id: '111' } }));
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_4', message: '雙寶爸', from: { id: '1' } }, '222'));
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_5', from: { id: '1' } }));
  assert.equal(f.calls.length, n);
  assert.equal((await g.readStats(env)).noText, 1);
});

test('模式關閉不處理；用量 ≥90% 先略過；隱藏失敗記 failed', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, 'GET /9_1': () => SPAM, 'POST /9_1': () => gErr(200, 403) }); t.after(f.restore);
  const env = fbEnv(); const g = await guard();
  await setup(env, 'off');
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_1', message: SPAM.message }));
  assert.equal(f.calls.length, 0);
  await setup(env, 'hide');
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?)').bind('rate_usage', JSON.stringify({ app: { callCount: 95, totalTime: 0, totalCputime: 0, at: Date.now() }, pages: {} }), 1).run();
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_1', message: SPAM.message }));
  assert.equal(f.calls.length, 0);
  assert.equal((await g.readStats(env)).skipped, 1);
  await env.DB.prepare('DELETE FROM fb_settings WHERE k = ?').bind('rate_usage').run();
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_1', message: SPAM.message }));
  assert.equal((await logRows(env))[0].action, 'failed');
});

test('管理路由：設定存讀、粉專開關訂閱、紀錄列表、取消隱藏＝豁免（之後編輯不再處理）、30 天清除', async (t) => {
  const f = installFetch({
    'GET /me/accounts': () => ACCOUNTS, 'GET /debug_token': () => ({ data: { scopes: ['pages_manage_metadata'] } }),
    'POST /111/subscribed_apps': () => ({ success: true }), 'GET /111/subscribed_apps': () => ({ data: [{ id: '555', subscribed_fields: ['feed'] }] }),
    'GET /9_1': () => SPAM, 'POST /9_1': () => ({ success: true })
  }); t.after(f.restore);
  const env = fbEnv(); const h = await adminH(env); const g = await guard();
  let d = (await (await call(env, '/admin/fb/guard', { headers: h })).json()).data;
  assert.equal(d.mode, 'off'); assert.equal(d.suggest, 'p1'); assert.equal(d.profiles[0].meta, null);
  assert.ok(!f.calls.some((c) => c.path === '/debug_token'), '打開卡片不查權限');
  d = (await (await call(env, '/admin/fb/guard?check=1', { headers: h })).json()).data;
  assert.equal(d.profiles[0].meta, true);
  const bad = await call(env, '/admin/fb/guard', { method: 'POST', headers: h, body: JSON.stringify({ mode: 'hide', profile: 'p1', rules: { names: [], leads: [], allow: ['x'] } }) });
  assert.equal(bad.status, 400);
  const r = await call(env, '/admin/fb/guard', { method: 'POST', headers: h, body: JSON.stringify({ mode: 'hide', profile: 'p1', rules: d.rules }) });
  assert.equal(r.status, 200);
  assert.equal((await call(env, '/admin/fb/guard/pages/111', { method: 'POST', headers: h, body: JSON.stringify({ on: true }) })).status, 200);
  assert.equal(f.calls.find((c) => c.path === '/111/subscribed_apps').body.subscribed_fields, 'feed');
  d = (await (await call(env, '/admin/fb/guard/pages?check=1', { headers: h })).json()).data;
  assert.deepEqual(d.pages, [{ id: '111', name: 'TVBS 新聞', on: true, sub: true }]);
  // 經 /fbhook 進來（含簽章、ctx.waitUntil）
  const body = JSON.stringify(ev({ verb: 'add', comment_id: '9_1', message: SPAM.message, from: { id: '777' } }));
  const waits = [];
  const res = await call(env, '/fbhook', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex') }, body }, { waitUntil: (p) => waits.push(p) });
  assert.equal(res.status, 200); await Promise.all(waits);
  d = (await (await call(env, '/admin/fb/guard/log', { headers: h })).json()).data;
  assert.equal(d.items.length, 1); assert.equal(d.items[0].action, 'hidden'); assert.deepEqual(d.items[0].tags, ['雙寶爸的財經新報']);
  const un = await call(env, '/admin/fb/guard/log/9_1/unhide', { method: 'POST', headers: h });
  assert.equal((await un.json()).data.exempt, true);
  const before = f.calls.length;
  await g.guardEvent(env, ev({ verb: 'edited', comment_id: '9_1', message: SPAM.message, from: { id: '777' } }));
  assert.equal(f.calls.length, before, '豁免後不再打 API');
  const audits = (await env.DB.prepare('SELECT action FROM fb_audit').all()).results.map((x) => x.action);
  assert.ok(audits.includes('guard_mode') && audits.includes('guard_unhide'));
  await g.cleanupGuard(env, Date.now() + 31 * 86400000);
  assert.equal((await logRows(env)).length, 0);
  assert.equal((await call(env, '/admin/fb/guard', { headers: { origin: ORIGIN } })).status, 401);
});

test('已隱藏的留言再被編輯：不再讀、不再隱藏，只標編輯過', async (t) => {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, 'GET /9_1': () => SPAM, 'POST /9_1': () => ({ success: true }) }); t.after(f.restore);
  const env = fbEnv(); const g = await guard();
  await setup(env, 'hide');
  await g.guardEvent(env, ev({ verb: 'add', comment_id: '9_1', message: SPAM.message, from: { id: '777' } }));
  const n = f.calls.length;
  await g.guardEvent(env, ev({ verb: 'edited', comment_id: '9_1', message: SPAM.message + '!!', from: { id: '777' } }));
  assert.equal(f.calls.length, n, '不打 API');
  const r = (await logRows(env))[0];
  assert.equal(r.action, 'hidden'); assert.equal(r.edited, 1);
});
