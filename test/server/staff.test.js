// 授權名單：管理 API、員工編號登入、立即撤銷、權限組、開放／關閉、操作紀錄
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, staffMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const sm = async () => (staffMod = staffMod || (await import('../../server/core/staff.js')));
const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }] };

async function call(env, path, init = {}) {
  const w = await load();
  const r = await w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } }), env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
async function adminH(env) {
  const { signToken } = await tok();
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'admin', nowSec() + 600)) };
}
const post = (env, h, path, body) => call(env, path, { method: 'POST', headers: h, body: JSON.stringify(body) });
const bearer = (t) => ({ authorization: 'Bearer ' + t });
// 員工登入：已設密碼就用 PW；還沒設就由管理頁重置拿設定碼，再設 PW 並登入
const PW = 'password-123';
async function login(env, staffId) {
  const q = await call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId }) });
  if (!q.body.ok) return q;
  if (q.body.data.next === 'password') return call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId, password: PW }) });
  const r = await call(env, '/admin/staff/' + encodeURIComponent(staffId) + '/reset', { method: 'POST', headers: await adminH(env) });
  return call(env, '/auth', { method: 'POST', body: JSON.stringify({ staffId, code: r.body.data.setup.code, newPassword: PW }) });
}
async function setup(t) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'U' });
  return { f, env, adm: await adminH(env) };
}
const groupId = (d, name) => d.groups.find((g) => g.name === name).id;

test('管理 API：要管理憑證；預設 3 組權限組；新增驗證、編號轉大寫、不能重複', async (t) => {
  const { env, adm } = await setup(t);
  const { PERMS } = await sm();
  assert.equal((await call(env, '/admin/staff')).status, 401);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  assert.deepEqual(body.data.groups.map((g) => [g.name, g.perms]), [['管理', PERMS.filter((p) => p !== 'notify')], ['發文', ['view', 'post', 'edit', 'delete', 'vview', 'vpost', 'report']], ['檢視', ['view', 'vview', 'report']]]);
  assert.equal(body.data.perms.length, PERMS.length);
  assert.deepEqual(body.data.sections.flatMap((x) => x.keys), PERMS, '分區涵蓋全部權限、順序一致');
  assert.ok(PERMS.includes('card:pages') && !PERMS.includes('card:groups') && !PERMS.includes('card:levels'), '管理頁卡片：只有非敏感卡片可勾');
  const g = groupId(body.data, '發文');
  assert.equal((await post(env, adm, '/admin/staff', { id: 'a 1', name: '甲', group: g })).status, 400);
  assert.equal((await post(env, adm, '/admin/staff', { id: 'A1', name: '', group: g })).status, 400);
  assert.equal((await post(env, adm, '/admin/staff', { id: 'A1', name: '字'.repeat(21), group: g })).status, 400);
  assert.equal((await post(env, adm, '/admin/staff', { id: 'A1', name: '甲', group: 999 })).status, 400);
  const ok = await post(env, adm, '/admin/staff', { id: ' t0123 ', name: ' 王小明 ', group: g });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data.staff.map((s) => [s.id, s.name, s.group, s.enabled]), [['T0123', '王小明', g, true]]);
  const dup = await post(env, adm, '/admin/staff', { id: 'T0123', name: '乙', group: g });
  assert.equal(dup.status, 400); assert.match(dup.body.error, /已在名單內/);
});

test('員工編號登入：名單內才發憑證（帶 uid、轉大寫）、記最後登入；查不到或停用回 bad_staff', async (t) => {
  const { env, adm } = await setup(t);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  await post(env, adm, '/admin/staff', { id: 'T1', name: '王小明', group: groupId(body.data, '發文') });
  const bad = await login(env, 'NOPE');
  assert.equal(bad.body.ok, false); assert.equal(bad.body.code, 'bad_staff');
  const r = await login(env, 't1');
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.data.staff, { id: 'T1', name: '王小明', group: '發文', level: 'staff' });
  assert.equal(r.body.data.manage, false);
  const { readToken } = await tok();
  assert.equal((await readToken(env.SESSION_SECRET, r.body.data.token, nowSec())).uid, 'T1');
  const st = await call(env, '/auth/status', { headers: bearer(r.body.data.token) });
  assert.deepEqual(st.body.data.staff, { id: 'T1', name: '王小明', group: '發文', level: 'staff' });
  assert.equal(st.body.data.manage, false, '發文組沒有任何 card: 就沒有管理頁入口');
  assert.ok((await call(env, '/admin/staff', { headers: adm })).body.data.staff[0].lastLogin > 0);
  // 停用後不能登入
  await post(env, adm, '/admin/staff/T1', { enabled: false });
  assert.equal((await login(env, 'T1')).body.code, 'bad_staff');
  // 公司密碼登入已拿掉
  assert.equal((await call(env, '/auth', { method: 'POST', body: JSON.stringify({ password: 'company-pass-123' }) })).status, 400);
});

test('立即撤銷：停用或移除後，原本的憑證連 /auth/status、公司素材、排程發布都失效；重新啟用恢復', async (t) => {
  const { env, adm } = await setup(t);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  await post(env, adm, '/admin/fb/access', { mode: 'company' });
  await post(env, adm, '/admin/staff', { id: 'T1', name: '甲', group: groupId(body.data, '發文') });
  const h = bearer((await login(env, 'T1')).body.data.token);
  assert.equal((await call(env, '/fb/pages', { headers: h })).status, 200);
  await post(env, adm, '/admin/staff/T1', { enabled: false });
  assert.equal((await call(env, '/auth/status', { headers: h })).status, 401);
  assert.equal((await call(env, '/fb/pages', { headers: h })).status, 401);
  await post(env, adm, '/admin/staff/T1', { enabled: true });
  assert.equal((await call(env, '/fb/pages', { headers: h })).status, 200);
  assert.equal((await call(env, '/admin/staff/T1', { method: 'DELETE', headers: adm })).status, 200);
  assert.equal((await call(env, '/auth/status', { headers: h })).status, 401);
  assert.equal((await call(env, '/admin/staff/T1', { method: 'DELETE', headers: adm })).status, 404);
});

test('續期保留員工編號', async (t) => {
  const { env, adm } = await setup(t);
  const { body } = await call(env, '/admin/staff', { headers: adm });
  await post(env, adm, '/admin/staff', { id: 'T1', name: '甲', group: groupId(body.data, '檢視') });
  const { signToken, readToken } = await tok();
  const old = await signToken(env.SESSION_SECRET, 'company', nowSec() + 60, false, 'T1', 1);   // 剩不到一半效期
  const st = await call(env, '/auth/status', { headers: bearer(old) });
  assert.ok(st.body.data.renew);
  assert.equal((await readToken(env.SESSION_SECRET, st.body.data.renew.token, nowSec())).uid, 'T1');
});

test('權限組：檢視組不能發文／改時間／刪除；/fb/me 回權限；改權限組立即生效', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/fb/access', { mode: 'company' });
  await post(env, adm, '/admin/staff', { id: 'V1', name: '看', group: groupId(d, '檢視') });
  const h = bearer((await login(env, 'V1')).body.data.token);
  const me = await call(env, '/fb/me', { headers: h });
  assert.deepEqual(me.body.data, { admin: false, id: 'V1', name: '看', group: '檢視', perms: ['view', 'vview', 'report'], mode: 'company', tokenWarn: null });
  const fd = new FormData(); fd.set('message', 'x');
  const w = await load();
  const rp = await w.fetch(new Request('https://api.test/fb/post', { method: 'POST', headers: { origin: ORIGIN, ...h }, body: fd }), env, { waitUntil() {} });
  assert.equal(rp.status, 403); assert.equal((await rp.json()).code, 'fb_no_perm');
  assert.equal((await post(env, h, '/rundown', { items: [] })).body.code, 'fb_no_perm');
  assert.equal((await post(env, h, '/fb/posts/111_1/reschedule', { page: '111', at: nowSec() + 3600 })).body.code, 'fb_no_perm');
  assert.equal((await post(env, h, '/fb/posts/111_1/delete', { page: '111' })).body.code, 'fb_no_perm');
  // 改成可以改時間（自訂權限組）
  const g = await post(env, adm, '/admin/staff-groups', { name: '改時間', perms: ['view', 'edit', 'nope'] });
  assert.deepEqual(g.body.data.groups.find((x) => x.name === '改時間').perms, ['view', 'edit']);
  await post(env, adm, '/admin/staff/V1', { group: groupId(g.body.data, '改時間') });
  assert.deepEqual((await call(env, '/fb/me', { headers: h })).body.data.perms, ['view', 'edit']);
  assert.notEqual((await post(env, h, '/fb/posts/111_1/reschedule', { page: '111', at: 1 })).body.code, 'fb_no_perm');
  assert.equal((await post(env, h, '/fb/posts/111_1/delete', { page: '111' })).body.code, 'fb_no_perm');
});

test('關閉時：管理組（bypass）可用、發文組被擋並看到原因；管理員密碼一直可用', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/fb/access', { mode: 'admin', reason: '維護中' });
  await post(env, adm, '/admin/staff', { id: 'M1', name: '主管', group: groupId(d, '管理') });
  await post(env, adm, '/admin/staff', { id: 'P1', name: '小編', group: groupId(d, '發文') });
  const m = bearer((await login(env, 'M1')).body.data.token);
  const p = bearer((await login(env, 'P1')).body.data.token);
  assert.equal((await call(env, '/fb/pages', { headers: m })).status, 200);
  const r = await call(env, '/fb/pages', { headers: p });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'fb_forbidden'); assert.deepEqual(r.body.detail, { reason: '維護中' });
  const { signToken } = await tok();
  env.SYS_STAFF_ID = 'SYS1';
  const a = bearer(await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, 'SYS1', 1));
  const me = await call(env, '/fb/me', { headers: a });
  assert.equal(me.body.data.admin, true); assert.equal(me.body.data.name, '系統管理者');
});

test('權限組管理：名稱不能重複、使用中不能刪、沒人用可刪', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  assert.match((await post(env, adm, '/admin/staff-groups', { name: '管理', perms: [] })).body.error, /已經有/);
  const view = groupId(d, '檢視');
  assert.match((await post(env, adm, '/admin/staff-groups', { id: view, name: '發文', perms: [] })).body.error, /已經有/);
  assert.equal((await post(env, adm, '/admin/staff-groups', { id: view, name: '只看', perms: ['view'] })).status, 200);
  await post(env, adm, '/admin/staff', { id: 'V1', name: '看', group: view });
  const del = await call(env, '/admin/staff-groups/' + view, { method: 'DELETE', headers: adm });
  assert.equal(del.status, 400); assert.match(del.body.error, /還有 1 人/);
  await call(env, '/admin/staff/V1', { method: 'DELETE', headers: adm });
  const ok = await call(env, '/admin/staff-groups/' + view, { method: 'DELETE', headers: adm });
  assert.equal(ok.status, 200); assert.ok(!ok.body.data.groups.some((g) => g.id === view));
});

test('操作紀錄：寫入、依編號篩選、管理憑證才能看、90 天清除', async (t) => {
  const { env, adm } = await setup(t);
  const { audit, cleanupAudit } = await sm();
  await audit(env, { uid: 'T1', name: '甲' }, 'publish', '111', '111_9');
  await audit(env, { uid: 'ADMIN', name: '管理員' }, 'delete', '111', '111_8');
  env.DB.raw.prepare("INSERT INTO fb_audit (at, uid, name, action) VALUES (?, 'T1', '甲', 'old')").run(Date.now() - 91 * 86400000);
  assert.equal((await call(env, '/admin/audit')).status, 401);
  const all = await call(env, '/admin/audit?days=90', { headers: adm });
  assert.deepEqual(all.body.data.map((r) => r.action), ['delete', 'publish']);
  assert.deepEqual((await call(env, '/admin/audit?uid=t1', { headers: adm })).body.data.map((r) => [r.uid, r.page, r.post]), [['T1', '111', '111_9']]);
  await cleanupAudit(env, Date.now());
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM fb_audit').get().n, 2);
});

test('操作紀錄：?q= 用員工編號或姓名查（紀錄姓名、目前名單姓名都算；% _ 不當萬用字元）', async (t) => {
  const { env, adm } = await setup(t);
  const { audit } = await sm();
  const g = groupId((await call(env, '/admin/staff', { headers: adm })).body.data, '檢視');
  await post(env, adm, '/admin/staff', { id: 'N1', name: '王大明', group: g });
  await audit(env, { uid: 'N1', name: '王小明' }, 'publish', '111', '111_1');   // 改名前的紀錄
  await audit(env, { uid: 'N2', name: '李100%' }, 'delete', '111', '111_2');
  await audit(env, { uid: 'N3', name: '李1000' }, 'delete', '111', '111_3');
  const q = async (v) => (await call(env, '/admin/audit?days=1&q=' + encodeURIComponent(v), { headers: adm })).body.data.map((r) => r.post).sort();
  assert.deepEqual(await q('小明'), ['111_1'], '紀錄當時姓名');
  assert.deepEqual(await q('大明'), ['111_1'], '目前名單姓名（改名後）');
  assert.deepEqual(await q('n1'), ['111_1'], '員工編號');
  assert.deepEqual(await q('100%'), ['111_2'], '% 不是萬用字元');
  assert.deepEqual(await q('李_'), [], '_ 不是萬用字元');
  assert.deepEqual(await q('李'), ['111_2', '111_3']);
});

test('分機：自己讀寫 /staff/me、格式驗證、只能改自己；公司密碼憑證不行；管理頁可改與新增時帶入', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  const g = groupId(d, '檢視');
  assert.equal((await post(env, adm, '/admin/staff', { id: 'C1', name: '甲', group: g, contact: 'abc' })).status, 400);
  const add = await post(env, adm, '/admin/staff', { id: 'C1', name: '甲', group: g, contact: ' 0912-345-678 ' });
  assert.equal(add.body.data.staff[0].contact, '0912-345-678');
  await post(env, adm, '/admin/staff', { id: 'C2', name: '乙', group: g });
  assert.equal((await call(env, '/staff/me')).status, 401);
  const { signToken } = await tok();
  assert.equal((await call(env, '/staff/me', { headers: bearer(await signToken(env.SESSION_SECRET, 'company', nowSec() + 600)) })).status, 401, '沒有員工編號的舊公司憑證無效');
  const h = bearer((await login(env, 'C2')).body.data.token);
  assert.deepEqual((await call(env, '/staff/me', { headers: h })).body.data, { id: 'C2', name: '乙', group: '檢視', contact: '', level: 'staff' });
  assert.equal((await post(env, h, '/staff/me', { contact: '1'.repeat(31) })).status, 400);
  assert.equal((await post(env, h, '/staff/me', { contact: '<b>' })).status, 400);
  const saved = await post(env, h, '/staff/me', { contact: '#12345', id: 'C1', name: '改名' });
  assert.deepEqual(saved.body.data, { id: 'C2', name: '乙', group: '檢視', contact: '#12345', level: 'staff' }, '只改自己的分機，不能改姓名或別人');
  const list = (await call(env, '/admin/staff', { headers: adm })).body.data.staff;
  assert.deepEqual(list.map((s) => [s.id, s.contact]), [['C1', '0912-345-678'], ['C2', '#12345']]);
  assert.equal((await post(env, adm, '/admin/staff/C2', { contact: '' })).body.data.staff[1].contact, '');
  assert.equal((await post(env, adm, '/admin/staff/C2', { contact: 'x' })).status, 400);
});

test('舊的 staff 表沒有 contact 欄：自動補上', async (t) => {
  const { env, adm } = await setup(t);
  env.DB.raw.exec('DROP TABLE staff; CREATE TABLE staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, grp INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, updated INTEGER NOT NULL, last_login INTEGER)');
  env.DB.raw.prepare("INSERT INTO staff (id, name, grp, enabled, created, updated) VALUES ('OLD', '舊', 1, 1, 1, 1)").run();
  const r = await call(env, '/admin/staff', { headers: adm });
  assert.equal(r.status, 200); assert.equal(r.body.data.staff[0].contact, '');
});

test('影片發布／數據報表／Rundown 的權限：vview／vpost／report 各自獨立；Rundown 任一 post 或 vpost 即可；系統管理者全有', async (t) => {
  const { env, adm } = await setup(t);
  const { PERMS, CARD_PERMS, findStaff } = await sm();
  const { GRANTABLE } = await import('../../server/core/levels.js');
  assert.deepEqual([...CARD_PERMS].sort(), GRANTABLE.map((k) => 'card:' + k).sort(), '每張可勾卡片都有權限 key');
  await post(env, adm, '/admin/fb/access', { mode: 'company' });
  const mk = async (id, perms) => {
    const g = await post(env, adm, '/admin/staff-groups', { name: 'g' + id, perms });
    const gid = g.body.data.groups.find((x) => x.name === 'g' + id).id;
    assert.equal((await post(env, adm, '/admin/staff', { id, name: id, group: gid })).status, 200);
    return bearer((await login(env, id)).body.data.token);
  };
  const code = async (h, path, method = 'GET', body = null) => (await call(env, path, { method, headers: h, ...(body ? { body: JSON.stringify(body) } : {}) })).body.code;
  const rpt = '/fb/reports/posts?page=111&from=2026-11-01&to=2026-11-02';
  const onlyView = await mk('O1', ['view']);   // 舊版只有排程發布檢視：影片、報表都不行
  assert.equal(await code(onlyView, '/fb/video/settings'), 'fb_no_perm');
  assert.equal(await code(onlyView, '/fb/video/jobs'), 'fb_no_perm');
  assert.equal(await code(onlyView, rpt), 'fb_no_perm');
  const vv = await mk('O2', ['vview']);
  assert.notEqual(await code(vv, '/fb/video/settings'), 'fb_no_perm');
  assert.equal(await code(vv, '/fb/video/start', 'POST', {}), 'fb_no_perm', '只有檢視不能上傳');
  assert.equal(await code(vv, '/rundown', 'POST', { items: [] }), 'fb_no_perm');
  const vp = await mk('O3', ['vpost']);
  assert.notEqual(await code(vp, '/fb/video/start', 'POST', {}), 'fb_no_perm');
  assert.equal(await code(vp, '/fb/video/settings'), 'fb_no_perm', 'vpost 不含 vview（要另外勾）');
  assert.notEqual(await code(vp, '/rundown', 'POST', { items: [] }), 'fb_no_perm', 'Rundown：vpost 即可');
  const po = await mk('O4', ['post']);
  assert.notEqual(await code(po, '/rundown', 'POST', { items: [] }), 'fb_no_perm', 'Rundown：post 即可');
  assert.equal(await code(po, '/fb/video/start', 'POST', {}), 'fb_no_perm', 'post 不能上傳影片');
  const rp = await mk('O5', ['report']);
  assert.notEqual(await code(rp, rpt), 'fb_no_perm');
  assert.equal(await code(rp, '/fb/scheduled?page=111'), 'fb_no_perm', 'report 不含排程發布檢視');
  env.SYS_STAFF_ID = 'SYS9';
  assert.deepEqual((await findStaff(env, 'SYS9')).perms, PERMS, '系統管理者 perms＝全部');
});

test('留言失敗通知：發文者只收自己的；權限組有 notify 收全部；舊紀錄（沒有發文者）只有看全部的人收到', async (t) => {
  const { env, adm } = await setup(t);
  const { setNotice } = await import('../../server/fb/notices.js');
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/staff', { id: 'P1', name: '小編甲', group: groupId(d, '發文') });
  await post(env, adm, '/admin/staff', { id: 'P2', name: '小編乙', group: groupId(d, '發文') });
  await setNotice(env, { postId: '111_1', pageId: '111', kind: 'post', by: 'P1' }, { seq: 1, error: 'x', failed: true });
  await setNotice(env, { postId: '111_2', pageId: '111', kind: 'post', by: 'P2' }, { seq: 1, error: 'y', failed: false });
  await setNotice(env, { postId: '111_3', pageId: '111', kind: 'post' }, { seq: 2, error: 'z', failed: true });
  const ids = async (id) => { const tk = (await login(env, id)).body.data.token; const r = (await call(env, '/staff/me/notices', { headers: bearer(tk) })).body.data; return [r.all, r.items.map((x) => x.postId).sort()]; };
  assert.deepEqual(await ids('P1'), [false, ['111_1']]);
  assert.deepEqual(await ids('P2'), [false, ['111_2']]);
  const g = d.groups.find((x) => x.name === '發文');
  assert.equal((await post(env, adm, '/admin/staff-groups', { id: g.id, name: g.name, perms: [...g.perms, 'notify'] })).status, 200);
  assert.deepEqual(await ids('P1'), [true, ['111_1', '111_2', '111_3']]);
  assert.equal((await call(env, '/staff/me/notices')).status, 401);
});

test('重新留言 API：影片的留言要 vpost，只有 post 不行', async (t) => {
  const { env, adm } = await setup(t);
  const { FbCommentTimer } = await import('../../server/fb/timer.js');
  const { fakeNamespace } = require('../helpers/fake-fb.js');
  env.FB_TIMER = fakeNamespace(FbCommentTimer, () => env);
  await post(env, adm, '/admin/fb/access', { mode: 'company' });
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  const g = (await post(env, adm, '/admin/staff-groups', { name: '只發文', perms: ['view', 'post'] })).body.data;
  const gid = (g && g.id) || (await call(env, '/admin/staff', { headers: adm })).body.data.groups.find((x) => x.name === '只發文').id;
  await post(env, adm, '/admin/staff', { id: 'Q1', name: '小編', group: gid });
  const tk = (await login(env, 'Q1')).body.data.token;
  const { armTimer } = await import('../../server/fb/timer.js');
  await armTimer(env, { pageId: '111', postId: '555', message: 'c', at: nowSec() + 3600, kind: 'video' });
  const r = await call(env, '/fb/comment/retry', { method: 'POST', headers: { ...bearer(tk), 'content-type': 'application/json' }, body: JSON.stringify({ postId: '555', page: '111' }) });
  assert.equal(r.body.code, 'fb_no_perm');
  assert.ok(d);
});

test('操作紀錄：粉專 ID 換成粉專設定的簡稱；對不到只給 ID；沒有粉專不帶 pageName', async (t) => {
  const { env, adm } = await setup(t);
  env.DB.raw.prepare("INSERT INTO fb_pages (id, short, updated) VALUES ('111', '新聞', 0)").run();
  const { audit } = await import('../../server/core/staff.js');
  await audit(env, { uid: 'T1', name: '甲' }, 'publish', '111', '111_1');
  await audit(env, { uid: 'T1', name: '甲' }, 'publish', '999', '999_1');
  await audit(env, { uid: 'T1', name: '甲' }, 'staff_rename', '', 'T2', '乙→丙');
  const rows = (await call(env, '/admin/audit', { headers: adm })).body.data;
  const by = (p) => rows.find((r) => r.page === p);
  assert.equal(by('111').pageName, '新聞');
  assert.equal(by('999').pageName, undefined);
  assert.equal(by('').pageName, undefined);
});

test('通知已讀：發文者已讀＝handled（自己看不到、看全部的人看到黃）；看全部的人已讀＝結案；錯誤紀錄同步狀態', async (t) => {
  const { env, adm } = await setup(t);
  const { setNotice, logCommentFail } = await import('../../server/fb/notices.js');
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/staff', { id: 'P1', name: '小編甲', group: groupId(d, '發文') });
  await post(env, adm, '/admin/staff', { id: 'P2', name: '小編乙', group: groupId(d, '發文') });
  const rec = { postId: '111_1', pageId: '111', kind: 'post', by: 'P1', title: '颱風', ptype: 'template', at: nowSec() - 60, pageName: 'TVBS 新聞' };
  await setNotice(env, rec, { seq: 1, error: 'x', failed: true });
  await logCommentFail(env, rec, 32, 'page rate limit');
  const lg = env.DB.raw.prepare('SELECT post, title, ptype, pub_at, page_name, st, detail FROM logs').get();
  assert.deepEqual({ ...lg }, { post: '111_1', title: '颱風', ptype: 'template', pub_at: rec.at, page_name: 'TVBS 新聞', st: 'open', detail: 'page rate limit' });
  const tk = async (id) => bearer((await login(env, id)).body.data.token);
  const p1 = await tk('P1'), p2 = await tk('P2');
  const read = (h, postId) => call(env, '/staff/me/notices/read', { method: 'POST', headers: h, body: JSON.stringify({ postId }) });
  assert.equal((await read(p2, '111_1')).status, 404, '不是自己的不能已讀');
  assert.equal((await read(p1, 'x')).status, 400);
  assert.equal((await read(p1, '111_1')).body.data.state, 'read');
  assert.equal((await call(env, '/staff/me/notices', { headers: p1 })).body.data.items.length, 0, '發文者處理完就看不到');
  assert.equal(env.DB.raw.prepare('SELECT st FROM logs').get().st, 'read');
  // 自動重試成功：只刪未處理的；發文者已讀的留著
  await setNotice(env, { ...rec, postId: '111_3' }, { seq: 1, error: 'z', failed: false });
  await setNotice(env, { ...rec, postId: '111_4' }, { seq: 1, error: 'z', failed: false });
  await read(p1, '111_4');
  await setNotice(env, { ...rec, postId: '111_3' }, null);
  await setNotice(env, { ...rec, postId: '111_4' }, null);
  assert.deepEqual(env.DB.raw.prepare("SELECT post_id, state FROM fb_notices WHERE post_id IN ('111_3', '111_4')").all().map((x) => [x.post_id, x.state]), [['111_4', 'handled']]);
  // 錯誤紀錄：自動恢復的未處理列結案（系統），發文者已完成的維持
  const { logCommentFail: lcf } = await import('../../server/fb/notices.js');
  await lcf(env, { ...rec, postId: '111_5' }, 32, 'x');
  await setNotice(env, { ...rec, postId: '111_5' }, { seq: 1, error: 'z', failed: false });
  await setNotice(env, { ...rec, postId: '111_5' }, null);
  assert.deepEqual({ ...env.DB.raw.prepare("SELECT st, st_by FROM logs WHERE post = '111_5'").get() }, { st: 'closed', st_by: 'system' });
  await lcf(env, { ...rec, postId: '111_6' }, 32, 'x');
  await setNotice(env, { ...rec, postId: '111_6' }, null, { canceled: true });
  assert.equal(env.DB.raw.prepare("SELECT st FROM logs WHERE post = '111_6'").get().st, 'closed');
  // 新的失敗：回到未處理
  await setNotice(env, { ...rec, postId: '111_4' }, { seq: 2, error: 'w', failed: true });
  assert.equal(env.DB.raw.prepare("SELECT state FROM fb_notices WHERE post_id = '111_4'").get().state, 'open');
  // 系統管理者（notify 權限）看到黃（handled）
  const g = d.groups.find((x) => x.name === '發文');
  await post(env, adm, '/admin/staff-groups', { id: g.id, name: g.name, perms: [...g.perms, 'notify'] });
  const it = (await call(env, '/staff/me/notices', { headers: p2 })).body.data.items;
  assert.deepEqual(it.filter((x) => x.postId === '111_1').map((x) => [x.state, x.how, x.hby, x.hname]), [['handled', 'read', 'P1', '小編甲']]);
  assert.deepEqual(it.find((x) => x.postId === '111_4').state, 'open');
  assert.equal((await read(p2, '111_1')).body.data.state, 'closed');
  assert.equal((await call(env, '/staff/me/notices', { headers: p2 })).body.data.items.filter((x) => x.postId === '111_1').length, 0);
  assert.deepEqual({ ...env.DB.raw.prepare('SELECT st, st_by, st_name FROM logs').get() }, { st: 'closed', st_by: 'P2', st_name: '小編乙' });
  // 1A：發文者還沒處理，看全部的人已讀也直接結案
  await setNotice(env, { ...rec, postId: '111_2' }, { seq: 1, error: 'y', failed: true });
  assert.equal((await read(p2, '111_2')).body.data.state, 'closed');
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM fb_notices WHERE post_id = '111_2'").get().n, 0);
});

test('錯誤紀錄：分頁 limit／offset、狀態篩選；管理頁已讀＝結案（連同通知）；要錯誤紀錄卡片權限', async (t) => {
  const { env, adm } = await setup(t);
  const { logEvent } = await import('../../server/core/logs.js');
  const { setNotice } = await import('../../server/fb/notices.js');
  for (let i = 0; i < 5; i++) await logEvent(env, 'sample', 'e' + i);
  await setNotice(env, { postId: '111_9', pageId: '111', kind: 'post', by: 'P1' }, { seq: 1, error: 'x', failed: true });
  await logEvent(env, 'fbpost', 'comment_failed:32', '111', 'raw', { post: '111_9', st: 'open' });
  const get = async (q) => (await call(env, '/admin/logs?' + q, { headers: adm })).body.data;
  assert.equal((await get('limit=3&offset=0')).length, 3);
  assert.deepEqual((await get('limit=3&offset=3')).map((r) => r.code), ['e2', 'e1', 'e0']);
  assert.equal((await get('limit=999')).length, 6, 'limit 上限 101');
  assert.deepEqual((await get('st=open')).map((r) => r.code), ['comment_failed:32']);
  const id = (await get('st=open'))[0].id;
  const r = await call(env, '/admin/logs/read', { method: 'POST', headers: adm, body: JSON.stringify({ id }) });
  assert.equal(r.status, 200);
  assert.deepEqual((await get('st=closed')).map((x) => x.code), ['comment_failed:32']);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM fb_notices').get().n, 0, '首頁通知一起結案');
  assert.equal((await call(env, '/admin/logs/read', { method: 'POST', headers: adm, body: JSON.stringify({ id: 99999 }) })).status, 404);
  assert.equal((await call(env, '/admin/logs/read', { method: 'POST', headers: adm, body: '{}' })).status, 400);
  // 一般員工沒有錯誤紀錄卡片 → 403
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/staff', { id: 'P3', name: '丙', group: groupId(d, '發文') });
  const tk = bearer((await login(env, 'P3')).body.data.token);
  assert.equal((await call(env, '/admin/logs/read', { method: 'POST', headers: tk, body: JSON.stringify({ id }) })).status, 403);
});

test('操作紀錄：分頁 limit／offset、類別 src（工具／後台）在後端篩選', async (t) => {
  const { env, adm } = await setup(t);
  const { audit } = await import('../../server/core/staff.js');
  await audit(env, { uid: 'T1', name: '甲' }, 'publish', '111', '111_1');
  await audit(env, { uid: 'T1', name: '甲' }, 'add', '', '', 'X1');
  await audit(env, { uid: 'T1', name: '甲' }, 'schedule', '111', '111_2');
  const get = async (q) => (await call(env, '/admin/audit?' + q, { headers: adm })).body.data.filter((r) => r.uid === 'T1').map((r) => r.action);
  assert.deepEqual(await get('src=tool'), ['schedule', 'publish']);
  assert.deepEqual(await get('src=admin'), ['add']);
  assert.deepEqual(await get('src=tool&limit=1&offset=1'), ['publish']);
});

test('最後使用時間：員工憑證打後端時記 last_seen，5 分鐘內不重寫；名單回 lastSeen', async (t) => {
  const { env, adm } = await setup(t);
  const d = (await call(env, '/admin/staff', { headers: adm })).body.data;
  await post(env, adm, '/admin/staff', { id: 'S1', name: '甲', group: groupId(d, '發文') });
  const tk = bearer((await login(env, 'S1')).body.data.token);
  const seen = () => env.DB.raw.prepare("SELECT last_seen FROM staff WHERE id = 'S1'").get().last_seen;
  await call(env, '/auth/status', { headers: tk });
  const a = seen();
  assert.ok(a > Date.now() - 5000, '有記');
  env.DB.raw.prepare("UPDATE staff SET last_seen = ? WHERE id = 'S1'").run(a - 60000);   // 1 分鐘前
  await call(env, '/auth/status', { headers: tk });
  assert.equal(seen(), a - 60000, '5 分鐘內不重寫');
  env.DB.raw.prepare("UPDATE staff SET last_seen = ? WHERE id = 'S1'").run(a - 6 * 60000);
  await call(env, '/auth/status', { headers: tk });
  assert.ok(seen() > a - 5000, '超過 5 分鐘重寫');
  const row = (await call(env, '/admin/staff', { headers: adm })).body.data.staff.find((x) => x.id === 'S1');
  assert.equal(row.lastSeen, seen());
});
