// 自行註冊：查不到編號才可註冊、兩次編號、10 分鐘一次性密碼、設密碼登入、素材依勾選工具、指派權限組後全開、管理頁設定
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, init = {}) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const sys = async (env) => { const { signToken } = await tok(); return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)) }; };
const post = (env, path, body, h = {}) => call(env, path, { method: 'POST', headers: h, body: JSON.stringify(body) });
const auth = (env, body, ip = '1.1.1.1') => post(env, '/auth', body, { 'cf-connecting-ip': ip });
const reg = (env, id, name = '王小明', id2 = id, ip) => auth(env, { register: true, staffId: id, staffId2: id2, name }, ip);
const PW = 'password-123';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function putAsset(env, h, key) {
  const r = await call(env, '/admin/assets/' + key, { method: 'PUT', headers: { ...h, 'x-tier': 'company' }, body: PNG });
  assert.equal(r.status, 200, key);
}
async function registerAndLogin(env, id) {
  const r = await reg(env, id);
  assert.equal(r.status, 200); assert.ok(r.body.ok, JSON.stringify(r.body));
  const done = await auth(env, { staffId: id, code: r.body.data.code, newPassword: PW });
  assert.ok(done.body.ok, JSON.stringify(done.body));
  return { authorization: 'Bearer ' + done.body.data.token };
}

test('查不到編號：bad_staff 帶 register（預設開放）；註冊後 10 分鐘一次性密碼設密碼並登入', async () => {
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  const q = await auth(env, { staffId: 'n001' });
  assert.equal(q.body.code, 'bad_staff');
  assert.deepEqual(q.body.detail, { register: true });
  const r = await reg(env, ' n001 ', '  王小明 ', 'N001');
  assert.equal(r.body.data.staffId, 'N001');
  assert.match(r.body.data.code, /^\d{6}$/);
  const left = r.body.data.exp - Date.now();
  assert.ok(left > 9 * 60000 && left <= 10 * 60000, '10 分鐘');
  assert.equal((await auth(env, { staffId: 'N001' })).body.data.next, 'setup', '註冊後下一步＝設定密碼');
  const done = await auth(env, { staffId: 'N001', code: r.body.data.code, newPassword: PW });
  assert.equal(done.body.data.staff.name, '王小明');
  assert.equal(done.body.data.manage, false, '註冊帳號沒有管理頁');
  assert.equal((await auth(env, { staffId: 'N001', code: r.body.data.code, newPassword: PW })).body.code, 'bad_request', '一次性密碼用掉就不能再用');
  assert.ok((await auth(env, { staffId: 'N001', password: PW })).body.ok, '之後用自己的密碼登入');
});

test('註冊檢查：兩次編號不同、姓名、已存在／停用／系統管理者一律 reg_taken、註冊關閉、IP 每小時 5 次', async () => {
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  const adm = await sys(env);
  assert.match((await reg(env, 'A1', '甲', 'A2')).body.error, /不一樣/);
  assert.equal((await reg(env, 'A1', '')).status, 400);
  assert.equal((await reg(env, 'A1', '字'.repeat(21))).status, 400);
  assert.equal((await reg(env, 'a 1')).status, 400);
  assert.ok((await reg(env, 'A1', '甲', 'A1', '2.2.2.2')).body.ok);
  assert.equal((await reg(env, 'A1', '乙', 'A1', '2.2.2.2')).body.code, 'reg_taken', '已存在');
  assert.equal((await reg(env, 'SYS1', '乙', 'SYS1', '2.2.2.2')).body.code, 'reg_taken', '系統管理者');
  await post(env, '/admin/staff/A1', { enabled: false }, adm);
  assert.equal((await reg(env, 'A1', '乙', 'A1', '2.2.2.2')).body.code, 'reg_taken', '停用');
  assert.ok((await reg(env, 'B0', '丙', 'B0', '2.2.2.2')).body.ok, '第 5 次（已存在的嘗試也算次數）');
  assert.equal((await reg(env, 'B9', '丙', 'B9', '2.2.2.2')).body.code, 'reg_limit', '同 IP 第 6 次');
  assert.ok((await reg(env, 'B9', '丙', 'B9', '3.3.3.3')).body.ok, '別的 IP 照常');
  const off = await post(env, '/admin/selfreg', { on: false, tools: [] }, adm);
  assert.deepEqual(off.body.data.on, false);
  assert.equal((await reg(env, 'C1', '丁', 'C1', '4.4.4.4')).body.code, 'reg_closed');
  assert.deepEqual((await auth(env, { staffId: 'C1' })).body.detail, { register: false });
});

test('待指派的註冊帳號超過上限：reg_full', async () => {
  const env = mkEnv();
  const { MAX_PENDING } = await import('../../server/core/staff.js');
  for (let i = 0; i < MAX_PENDING; i++) assert.ok((await reg(env, 'P' + i, '甲', 'P' + i, '9.9.' + i + '.1')).body.ok);
  const r = await reg(env, 'PX', '甲', 'PX', '9.9.9.9');
  assert.equal(r.body.code, 'reg_full'); assert.equal(r.status, 503);
});

test('一次性密碼 10 分鐘過期：setup_expired，要管理者重置', async (t) => {
  const env = mkEnv();
  const r = await reg(env, 'E1');
  const real = Date.now;
  t.after(() => { Date.now = real; });
  Date.now = () => real() + 10 * 60000 + 1000;
  assert.equal((await auth(env, { staffId: 'E1', code: r.body.data.code, newPassword: PW })).body.code, 'setup_expired');
});

test('註冊帳號：公司素材只放行勾選工具用到的；臉書路由沒權限；指派權限組後全開', async () => {
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  const adm = await sys(env);
  for (const k of ['tvbs-news-logo', 'line-header', 'tbao-smile', 'not-in-any-tool']) await putAsset(env, adm, k);
  const me = await registerAndLogin(env, 'R1');
  const get = async (k) => (await call(env, '/assets/' + k, { headers: me })).status;
  const manifest = async () => (await call(env, '/assets/manifest', { headers: me })).body.data.map((x) => x.key);
  assert.equal(await get('tvbs-news-logo'), 200, '預設全部可選工具都勾');
  assert.equal(await get('not-in-any-tool'), 403, '沒有工具用到的素材不放行');
  assert.deepEqual(await manifest(), ['line-header', 'tbao-smile', 'tvbs-news-logo']);
  const cfg = await post(env, '/admin/selfreg', { on: true, tools: ['watermark', 'fbpost', 'nope'] }, adm);
  assert.deepEqual(cfg.body.data.tools, ['watermark'], '臉書工具與未知 id 剔除');
  assert.ok(!cfg.body.data.options.some((o) => ['fbpost', 'fbvideo', 'fbreports'].includes(o.id)), '選項不列臉書工具');
  assert.equal(await get('line-header'), 403);
  assert.equal(await get('tbao-smile'), 403, '只有 fbpost 等未勾工具用到的貼圖');
  assert.equal(await get('tvbs-news-logo'), 200);
  assert.deepEqual(await manifest(), ['tvbs-news-logo']);
  assert.notEqual((await call(env, '/fb/pages', { headers: me })).status, 200, '臉書路由沒權限');
  // 臉書工具開放時，沒有權限組的註冊帳號連 need=null 的唯讀路由也不能讀
  assert.ok((await post(env, '/admin/fb/access', { mode: 'company' }, adm)).body.ok);
  for (const p of ['/fb/pages', '/fb/presets', '/fb/backgrounds', '/fb/me', '/fb/access']) { const r = await call(env, p, { headers: me }); assert.equal(r.status, 403, p); assert.equal(r.body.code, 'fb_self_pending', p); }
  // 名單：self 標記；指派權限組後全開
  const list = (await call(env, '/admin/staff', { headers: adm })).body.data;
  const row = list.staff.find((s) => s.id === 'R1');
  assert.equal(row.self, true); assert.equal(row.group, 0);
  const g = list.groups.find((x) => x.name === '檢視').id;
  assert.ok((await post(env, '/admin/staff/R1', { group: g }, adm)).body.ok);
  assert.equal(await get('line-header'), 200, '指派後全開');
  assert.equal((await call(env, '/admin/staff', { headers: adm })).body.data.staff.find((s) => s.id === 'R1').self, false);
});

test('管理頁 /admin/selfreg：只有已解鎖系統管理者；輸入檢查；儀表板顯示待指派人數', async () => {
  const env = mkEnv({ SYS_STAFF_ID: 'SYS1' });
  const adm = await sys(env);
  assert.equal((await call(env, '/admin/selfreg')).status, 401);
  const g = (await call(env, '/admin/selfreg', { headers: adm })).body.data;
  assert.equal(g.on, true, '沒存過＝開放');
  assert.deepEqual(g.tools, g.options.map((o) => o.id));
  for (const bad of [{ on: 'y', tools: [] }, { on: true, tools: 'x' }, { on: true, tools: [1] }]) assert.equal((await post(env, '/admin/selfreg', bad, adm)).status, 400);
  await reg(env, 'D1');
  const d = (await call(env, '/admin/dash?fresh=1', { headers: adm })).body.data.items.find((x) => x.key === 'selfreg');
  assert.equal(d.level, 'warn'); assert.match(d.text, /1 位/);
});
