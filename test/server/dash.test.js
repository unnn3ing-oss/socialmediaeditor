// 管理頁首頁儀表板：等級規則、權限交集（全站開關 ∩ 權限組 dash:*）、暫存 5 分鐘與 fresh 10 秒、回應不含敏感欄位、全站開關只有已解鎖系統管理者
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, dashMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const dm = async () => (dashMod = dashMod || (await import('../../server/core/dash.js')));

async function call(env, path, init = {}) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const sign = async (env, kind, uid = '') => { const { signToken } = await tok(); return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, false, uid, 1)) }; };
const post = (env, h, path, body) => call(env, path, { method: 'POST', headers: h, body: JSON.stringify(body) });

async function setup(t) {
  const f = installFetch({}); t.after(f.restore);
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1', RUNDOWN_URL: '', RUNDOWN_TOKEN: '' });
  const sys = await sign(env, 'admin');
  assert.equal((await post(env, sys, '/admin/staff-groups', { name: '值班', perms: ['view', 'dash:logs', 'dash:rundown', 'dash:fbtoken'] })).status, 200);
  assert.equal((await post(env, sys, '/admin/staff-groups', { name: '只卡片', perms: ['card:logs'] })).status, 200);
  const d = (await call(env, '/admin/staff', { headers: sys })).body.data;
  const gid = (n) => d.groups.find((g) => g.name === n).id;
  for (const [id, grp] of [['D1', '值班'], ['C1', '只卡片'], ['P1', '發文']]) assert.equal((await post(env, sys, '/admin/staff', { id, name: id, group: gid(grp) })).status, 200);
  return { env, sys, adm: await sign(env, 'company', 'SYS1'), d1: await sign(env, 'company', 'D1'), c1: await sign(env, 'company', 'C1'), p1: await sign(env, 'company', 'P1') };
}

test('等級規則', async () => {
  const m = await dm();
  const now = Date.UTC(2026, 10, 23, 6);
  assert.equal(m.accessItem({ mode: 'company', reason: '' }).level, 'ok');
  assert.equal(m.accessItem({ mode: 'admin', reason: '測試中' }).level, 'info');
  assert.equal(m.tokenItem({ warn: { level: 'bad', text: 'x' }, hasStored: true }).level, 'bad');
  assert.deepEqual(m.tokenItem({ warn: { level: 'warn', days: 9 }, hasStored: true }), { level: 'warn', text: '9 天後到期' });
  assert.equal(m.tokenItem({ warn: null, hasStored: true }).level, 'ok');
  assert.equal(m.tokenItem({ warn: null, hasStored: false, hasUser: false }).level, 'warn');
  assert.equal(m.webhookItem({ signReady: false }).level, 'info', '留言管理關閉時不算壞');
  assert.equal(m.webhookItem({ signReady: true, last: { at: now - 3 * 3600000 } }, now).text, '3 小時前收到通知');
  assert.deepEqual(m.logsItem(2), { level: 'bad', text: '2 則未處理' });
  assert.equal(m.logsItem(0).level, 'ok');
  assert.equal(m.rundownItem('ok').level, 'ok');
  assert.equal(m.rundownItem('token').level, 'bad');
  assert.equal(m.usageItem({ app: { callCount: 80, at: now - 1000 }, pages: {} }, now).level, 'warn');
  assert.equal(m.usageItem({ app: { callCount: 95, at: now - 1000 }, pages: {} }, now).level, 'bad');
  assert.equal(m.usageItem({ app: { callCount: 99, at: now - 2 * 3600000 }, pages: {} }, now).level, 'info', '超過 1 小時的舊紀錄不算');
  assert.equal(m.usageItem({ app: null, pages: {}, throttle: { at: now - 60000 } }, now).level, 'bad');
  const s = now / 1000;
  assert.equal(m.bgItem(null, now).level, 'info');
  assert.equal(m.bgItem([s - 10], now).level, 'bad');
  assert.equal(m.bgItem([s + 3600], now).level, 'warn');
  assert.equal(m.bgItem([s + 5 * 86400], now).level, 'ok');
});

test('權限：系統管理者（不論解鎖）看全部；員工只看 dash:*；沒有 dash 擋下；/admin/me 回 dash', async (t) => {
  const { env, sys, adm, d1, c1, p1 } = await setup(t);
  const { DASH_KEYS } = await import('../../server/core/levels.js');
  const all = (await call(env, '/admin/dash', { headers: adm })).body.data;
  assert.deepEqual(all.items.map((x) => x.key), DASH_KEYS, '未解鎖的系統管理者也看得到全部狀態');
  assert.ok(all.at > 0);
  const mine = (await call(env, '/admin/dash', { headers: d1 })).body.data.items;
  assert.deepEqual(mine.map((x) => x.key), ['fbtoken', 'logs', 'rundown']);
  assert.equal(mine.find((x) => x.key === 'rundown').level, 'bad');
  assert.equal((await call(env, '/admin/dash', { headers: c1 })).status, 403, '只有卡片、沒有 dash');
  assert.equal((await call(env, '/admin/me', { headers: p1 })).status, 403);
  assert.deepEqual((await call(env, '/admin/me', { headers: d1 })).body.data.dash, ['fbtoken', 'logs', 'rundown']);
  assert.equal((await call(env, '/admin/me', { headers: d1 })).status, 200, '只有 dash 也能進管理頁');
  assert.deepEqual((await call(env, '/admin/me', { headers: c1 })).body.data.dash, []);
  assert.equal((await call(env, '/auth/status', { headers: d1 })).body.data.manage, true);
  assert.equal((await call(env, '/admin/dash', { headers: { origin: ORIGIN } })).status, 401);
  // 回應只有 key／name／level／text／tab
  for (const x of all.items) assert.deepEqual(Object.keys(x).sort(), ['key', 'level', 'name', 'tab', 'text']);
  void sys;
});

test('全站開關：只有已解鎖系統管理者；關掉的項目任何人都看不到', async (t) => {
  const { env, sys, adm, d1 } = await setup(t);
  assert.equal((await call(env, '/admin/dash/config', { headers: adm })).status, 403, '未解鎖不能改');
  assert.equal((await call(env, '/admin/dash/config', { headers: d1 })).status, 403);
  const g = (await call(env, '/admin/dash/config', { headers: sys })).body.data;
  assert.equal(g.items.length, 11, '沒存過＝全部');
  assert.equal((await post(env, sys, '/admin/dash/config', { items: 'x' })).status, 400);
  const r = await post(env, sys, '/admin/dash/config', { items: ['logs', 'nope', 'access'] });
  assert.deepEqual(r.body.data.items, ['access', 'logs'], '未知 key 剔除、照固定順序');
  assert.deepEqual((await call(env, '/admin/dash', { headers: adm })).body.data.items.map((x) => x.key), ['access', 'logs']);
  assert.deepEqual((await call(env, '/admin/dash', { headers: d1 })).body.data.items.map((x) => x.key), ['logs']);
});

test('暫存：5 分鐘內共用；fresh=1 重讀，同一人 10 秒內再按回上一份', async (t) => {
  const { env } = await setup(t);
  const m = await dm();
  m.forgetDash(env);
  const t0 = Date.now();
  const a = await m.snapshot(env, { now: t0 });
  await env.DB.prepare("INSERT INTO logs (at, tool, code, ua, st) VALUES (?, 'fbpost', 'x', 'server', 'open')").bind(t0).run();
  const b = await m.snapshot(env, { now: t0 + 4 * 60000 });
  assert.equal(b.at, a.at, '5 分鐘內共用');
  const c = await m.snapshot(env, { now: t0 + 6 * 60000 });
  assert.notEqual(c.at, a.at, '超過 5 分鐘重讀');
  assert.equal(c.items.find((x) => x.key === 'logs').text, '1 則未處理');
  const f1 = await m.snapshot(env, { fresh: true, user: 'U', now: t0 + 6 * 60000 + 1000 });
  assert.notEqual(f1.at, c.at, 'fresh 重讀');
  const f2 = await m.snapshot(env, { fresh: true, user: 'U', now: t0 + 6 * 60000 + 5000 });
  assert.equal(f2.at, f1.at, '同一人 10 秒內回上一份');
  const f3 = await m.snapshot(env, { fresh: true, user: 'V', now: t0 + 6 * 60000 + 6000 });
  assert.notEqual(f3.at, f1.at, '別人不受影響');
});
