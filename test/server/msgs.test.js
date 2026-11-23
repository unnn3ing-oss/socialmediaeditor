// 系統管理者手動通知：權限、四種收件模式、已讀、撤回、員工只看自己的、已讀 1 天後不回、30 天清除
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, init = {}) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const bearer = (t) => ({ authorization: 'Bearer ' + t });
const post = (env, h, path, body) => call(env, path, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });
async function adminH(env) {
  const { signToken } = await tok();
  return bearer(await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600));
}
const PW = 'password-123';
async function login(env, staffId) {
  const q = await call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId }) });
  if (q.body.data.next === 'password') return call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId, password: PW }) });
  const r = await call(env, '/admin/staff/' + encodeURIComponent(staffId) + '/reset', { method: 'POST', headers: await adminH(env) });
  return call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId, code: r.body.data.setup.code, newPassword: PW }) });
}
const tokenOf = async (env, id) => bearer((await login(env, id)).body.data.token);
async function setup(t) {
  const f = installFetch({ 'GET /me/accounts': () => ({ data: [{ id: '111', name: '新聞', access_token: 'PT' }] }) }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'U', SYS_STAFF_ID: 'SYS1' });
  const adm = await adminH(env);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  const g1 = d.groups.find((g) => g.name === '發文').id, g2 = d.groups.find((g) => g.name === '檢視').id;
  for (const [id, name, g] of [['A1', '甲', g1], ['A2', '乙', g1], ['B1', '丙', g2]]) await post(env, adm, '/admin/staff', { id, name, group: g });
  return { env, adm, g1, g2, sys: await tokenOf(env, 'SYS1') };
}

test('權限：只有系統管理者；員工憑證（非系統管理者）與未登入都擋，系統管理者不用解鎖', async (t) => {
  const { env, sys } = await setup(t);
  const a1 = await tokenOf(env, 'A1');
  assert.equal((await call(env, '/admin/msgs')).status, 401);
  assert.equal((await call(env, '/admin/msgs', { headers: a1 })).status, 403);
  assert.equal((await post(env, a1, '/admin/msgs', { mode: 'all', body: 'x' })).status, 403);
  assert.equal((await post(env, a1, '/admin/msgs/1/recall')).status, 403);
  assert.equal((await call(env, '/admin/msgs', { headers: sys })).status, 200, '員工登入的系統管理者（未解鎖）可用');
  assert.equal((await post(env, sys, '/admin/msgs', { mode: 'one', uids: ['A1'], body: '你好' })).status, 200);
  assert.equal((await call(env, '/admin/msgs', { headers: await adminH(env) })).status, 200, '管理員密碼憑證也可用');
});

test('四種收件模式與驗證：單人、多人（只收啟用中、去重）、全部、權限組；內容必填且 ≤200 字', async (t) => {
  const { env, adm, g1, sys } = await setup(t);
  const send = (b) => post(env, sys, '/admin/msgs', b);
  assert.equal((await send({ mode: 'one', uids: ['A1'], body: '' })).status, 400);
  assert.equal((await send({ mode: 'one', uids: ['A1'], body: '字'.repeat(201) })).status, 400);
  assert.equal((await send({ mode: 'one', uids: ['A1'], body: '字'.repeat(200) })).body.data.count, 1);
  assert.equal((await send({ mode: 'one', uids: ['A1', 'A2'], body: 'x' })).status, 400, '單人只能一位');
  assert.equal((await send({ mode: 'one', uids: ['NOPE'], body: 'x' })).status, 400, '不在名單');
  assert.equal((await send({ mode: 'bogus', body: 'x' })).status, 400);
  assert.equal((await send({ mode: 'many', uids: ['a1', 'A1', 'B1', 'ZZ'], body: 'x' })).body.data.count, 2, '去重、略過不在名單的');
  await call(env, '/admin/staff/B1', { method: 'POST', headers: adm, body: JSON.stringify({ enabled: false }) });
  assert.equal((await send({ mode: 'many', uids: ['A1', 'B1'], body: 'x' })).body.data.count, 1, '停用的不收');
  const all = await send({ mode: 'all', body: 'x' });
  assert.equal(all.body.data.count, 3, '全部＝啟用中（A1、A2、SYS1），B1 停用');
  assert.equal((await send({ mode: 'group', group: g1, body: 'x' })).body.data.count, 2);
  assert.equal((await send({ mode: 'group', group: 9999, body: 'x' })).status, 400);
  const aud = (await call(env, '/admin/audit?days=1', { headers: adm })).body.data;
  assert.ok(aud.some((r) => r.action === 'msg_send' && /人：/.test(r.detail)), '寫操作紀錄');
});

test('員工只看自己的；已讀；已讀 1 天後不回；撤回後不再看到；清單含已讀統計與每人狀態', async (t) => {
  const { env, sys } = await setup(t);
  const a1 = await tokenOf(env, 'A1'), a2 = await tokenOf(env, 'A2');
  const sent = (await post(env, sys, '/admin/msgs', { mode: 'many', uids: ['A1', 'A2'], body: '開會' })).body.data;
  await post(env, sys, '/admin/msgs', { mode: 'one', uids: ['A2'], body: '只給乙' });
  const mine = async (h) => (await call(env, '/staff/me/msgs', { headers: h })).body.data.items;
  assert.deepEqual((await mine(a1)).map((x) => x.body), ['開會']);
  assert.equal((await mine(a2)).length, 2);
  assert.equal((await mine(a1))[0].readAt, 0);
  assert.equal((await call(env, '/staff/me/msgs')).status, 401);
  assert.equal((await post(env, a1, '/staff/me/msgs/read', { id: 99999 })).status, 404);
  assert.equal((await post(env, a1, '/staff/me/msgs/read', { id: sent.id })).status, 200);
  assert.ok((await mine(a1))[0].readAt > 0);
  const lst = (await call(env, '/admin/msgs', { headers: sys })).body.data.items;
  const it = lst.find((x) => x.id === sent.id);
  assert.deepEqual([it.count, it.read, it.recalled], [2, 1, false]);
  assert.deepEqual(it.to.map((x) => [x.uid, x.name, !!x.readAt]), [['A1', '甲', true], ['A2', '乙', false]]);
  // 已讀超過 1 天不再回
  await env.DB.prepare('UPDATE staff_msg_to SET read_at = ? WHERE msg_id = ? AND uid = ?').bind(Date.now() - 86400000 - 1000, sent.id, 'A1').run();
  assert.equal((await mine(a1)).length, 0);
  // 撤回
  assert.equal((await post(env, sys, '/admin/msgs/' + sent.id + '/recall')).status, 200);
  assert.deepEqual((await mine(a2)).map((x) => x.body), ['只給乙']);
  assert.equal((await post(env, sys, '/admin/msgs/99999/recall')).status, 404);
  assert.equal((await call(env, '/admin/msgs', { headers: sys })).body.data.items.find((x) => x.id === sent.id).recalled, true);
  const aud = (await call(env, '/admin/audit?days=1', { headers: await adminH(env) })).body.data;
  assert.ok(aud.some((r) => r.action === 'msg_recall'));
});

test('30 天清除：舊訊息與收件紀錄刪掉，新的留著', async (t) => {
  const { env, sys } = await setup(t);
  const a = (await post(env, sys, '/admin/msgs', { mode: 'one', uids: ['A1'], body: '舊' })).body.data;
  const b = (await post(env, sys, '/admin/msgs', { mode: 'one', uids: ['A1'], body: '新' })).body.data;
  await env.DB.prepare('UPDATE staff_msgs SET at = ? WHERE id = ?').bind(Date.now() - 31 * 86400000, a.id).run();
  const { cleanupMsgs } = await import('../../server/core/msgs.js');
  await cleanupMsgs(env, Date.now());
  const ids = (await env.DB.prepare('SELECT id FROM staff_msgs').all()).results.map((r) => r.id);
  assert.deepEqual(ids, [b.id]);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM staff_msg_to WHERE msg_id = ?').bind(a.id).first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM staff_msg_to WHERE msg_id = ?').bind(b.id).first()).n, 1);
});
