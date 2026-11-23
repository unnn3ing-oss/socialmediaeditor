const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const tool = (id, name, tier) => ({
  id, name, group: '做圖', desc: `${name}說明`, tier, requires: [],
  icon: 'tools/sample/icon.svg', thumb: 'tools/sample/thumb.svg', entry: `test/fixtures/tools/${id}/index.html`,
});
const CATALOG = { tools: [tool('alpha', '公開工具', 'public'), tool('secret', '公司工具', 'company')] };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// 假後端：A123 已設密碼（pw-12345）、N9 第一次登入（設定碼 123456）、S1 系統管理者（已設密碼）
//   api.statusCode 控制 /auth/status；api.authDown 讓 /auth 連不上
const STAFF = { A123: { name: '王小明', group: '小編組', level: 'staff', pw: 'pw-12345' }, N9: { name: '新同事', group: '小編組', level: 'staff', pw: null }, S1: { name: '莊鈞評', group: '管理', level: 'sys', pw: 'pw-sys-1' } };
async function open(vp = { width: 1280, height: 820 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  const api = { statusCode: 200, authDown: false, bodies: [], hosts: [], pwBodies: [], notices: null, retries: [] };
  const staff = JSON.parse(JSON.stringify(STAFF));
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.route(/^https:\/\/toolbox-api(-dev)?\.19jpz-3\.workers\.dev\//, async (r) => {
    const req = r.request();
    api.hosts.push(new URL(req.url()).host);
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    const fail = (code, error, status = 200, detail) => r.fulfill({ status, headers: CORS, json: { ok: false, code, error, ...(detail ? { detail } : {}) } });
    const okRes = (id) => r.fulfill({ headers: CORS, json: { ok: true, data: { token: 'stf-' + id, exp, staff: { id, name: staff[id].name, group: staff[id].group, level: staff[id].level }, manage: staff[id].level === 'sys' } } });
    const who = () => { const m = /stf-(\w+)/.exec(req.headers().authorization || ''); return m && staff[m[1]] ? m[1] : null; };
    if (p === '/auth') {
      if (api.authDown) return r.abort();
      const body = JSON.parse(req.postData());
      api.bodies.push(body);
      const s = staff[body.staffId];
      if (!s) return fail('bad_staff', '查不到這個員工編號，或已停用。');
      if (body.newPassword !== undefined) {
        if (body.code !== '123456') return fail('bad_password', '設定碼不對，還可以再試 4 次。', 200, { left: 4 });
        s.pw = body.newPassword; return okRes(body.staffId);
      }
      if (body.password !== undefined) {
        if (!s.pw) return fail('need_setup', 'x');
        if (body.password !== s.pw) return fail('bad_password', '密碼不對，還可以再試 4 次。', 200, { left: 4 });
        return okRes(body.staffId);
      }
      return r.fulfill({ headers: CORS, json: { ok: true, data: { next: s.pw ? 'password' : 'setup' } } });
    }
    if (p === '/auth/status') {
      const id = who();
      if (api.statusCode === 401 || !id) return fail('unauthorized', 'x', 401);
      return r.fulfill({ headers: CORS, json: { ok: true, data: { company: true, exp, staff: { id, name: staff[id].name, group: staff[id].group, level: staff[id].level }, manage: staff[id].level === 'sys' } } });
    }
    if (p === '/staff/me') { const id = who(); return id ? r.fulfill({ headers: CORS, json: { ok: true, data: { id, name: staff[id].name, group: staff[id].group, contact: '#12345' } } }) : fail('unauthorized', 'x', 401); }
    if (p === '/staff/me/notices' && api.notices) return who() ? r.fulfill({ headers: CORS, json: { ok: true, data: api.notices } }) : fail('unauthorized', 'x', 401);
    if (p === '/fb/comment/retry') { api.retries.push(JSON.parse(req.postData())); return r.fulfill({ headers: CORS, json: { ok: true, data: { ok: true } } }); }
    if (p === '/staff/me/password') {
      const id = who(); const body = JSON.parse(req.postData()); api.pwBodies.push(body);
      if (!id) return fail('unauthorized', 'x', 401);
      if (body.password !== staff[id].pw) return fail('bad_password', '目前密碼不對，還可以再試 4 次。', 200, { left: 4 });
      staff[id].pw = body.newPassword; return okRes(id);
    }
    return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
  });
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#showcase .card');
  return { page, api };
}

// 從登入按鈕走完整流程：員工編號 →（下一步）→ 密碼
async function unlock(page, id = 'A123', pw = STAFF[id] && STAFF[id].pw) {
  await page.click('#company-btn');
  await page.waitForSelector('#company-dialog[open]');
  if (await page.isVisible('#company-dialog input[name=staffId]')) {
    await page.fill('#company-dialog input[name=staffId]', id);
    await page.click('#company-dialog button[type=submit]');
    await page.waitForSelector('#company-dialog input[name=password]', { state: 'visible' });
  }
  await page.fill('#company-dialog input[name=password]', pw);
  await page.click('#company-dialog button[type=submit]');
}
const acctText = (page) => page.textContent('#company-btn');

test('company tool hidden by default', async () => {
  const { page } = await open();
  assert.equal(await page.locator('#showcase .card[data-tool=secret]').count(), 0);
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 0);
  assert.equal(await page.locator('#showcase .card[data-tool=alpha]').count(), 1);
});

test('登入：員工編號 → 下一步 → 密碼；右上角「公司模式 名字」；記住員工編號，下次直接到密碼', async () => {
  const { page, api } = await open();
  await page.click('#company-btn');
  assert.equal(await page.isVisible('#company-dialog input[name=staffId]'), true);
  assert.equal(await page.isVisible('#company-dialog input[name=password]'), false);
  assert.equal(await page.textContent('#company-dialog button[type=submit]'), '下一步');
  await page.fill('#company-dialog input[name=staffId]', 'a123');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForSelector('#company-dialog input[name=password]', { state: 'visible' });
  assert.match(await page.textContent('#company-dialog .login-who'), /員工編號 A123/);
  assert.equal(await page.textContent('#company-dialog button[type=submit]'), '登入');
  await page.fill('#company-dialog input[name=password]', 'pw-12345');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.deepEqual(api.bodies, [{ staffId: 'A123' }, { staffId: 'A123', password: 'pw-12345' }]);
  assert.equal((await acctText(page)).replace(/\s/g, ''), '公司模式王小明');
  assert.equal(await page.isVisible('#company-dialog'), false);
  assert.deepEqual(await page.evaluate(() => window.tbxShell.company().staff), { id: 'A123', name: '王小明', group: '小編組', level: 'staff' });
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.staffId')), 'A123');
  await page.reload();
  await page.waitForFunction(() => /王小明/.test(document.getElementById('company-btn').textContent));
  // 登出後再登入：直接到密碼步驟，可「換一個」
  await page.click('#company-btn');
  await page.click('#company-logout');
  await page.waitForFunction(() => document.getElementById('company-btn').textContent === '登入');
  await page.click('#company-btn');
  assert.equal(await page.isVisible('#company-dialog input[name=password]'), true);
  assert.equal(await page.isVisible('#company-dialog input[name=staffId]'), false);
  await page.click('#company-dialog .login-link');
  assert.equal(await page.isVisible('#company-dialog input[name=staffId]'), true);
  assert.equal(await page.inputValue('#company-dialog input[name=staffId]'), 'A123');
});

test('第一次登入：自動判斷要設定密碼；設定碼＋新密碼（兩次要一樣、至少 8 字）', async () => {
  const { page, api } = await open();
  await page.click('#company-btn');
  await page.fill('#company-dialog input[name=staffId]', 'N9');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForSelector('#company-dialog input[name=code]', { state: 'visible' });
  assert.equal(await page.textContent('#company-dialog h2'), '第一次登入，請設定密碼');
  assert.equal(await page.isVisible('#company-dialog input[name=password]'), false);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/login-setup.png' });
  await page.fill('#company-dialog input[name=code]', '123456');
  await page.fill('#company-dialog input[name=newPassword]', 'short');
  await page.fill('#company-dialog input[name=newPassword2]', 'short');
  await page.click('#company-dialog button[type=submit]');
  assert.match(await page.textContent('#company-dialog [role=alert]'), /至少 8 個字/);
  await page.fill('#company-dialog input[name=newPassword]', 'new-pass-1');
  await page.fill('#company-dialog input[name=newPassword2]', 'new-pass-2');
  await page.click('#company-dialog button[type=submit]');
  assert.match(await page.textContent('#company-dialog [role=alert]'), /不一樣/);
  await page.fill('#company-dialog input[name=code]', '000000');
  await page.fill('#company-dialog input[name=newPassword2]', 'new-pass-1');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#company-dialog [role=alert]').textContent.includes('設定碼不對，還可以再試 4 次'));
  await page.fill('#company-dialog input[name=code]', '123456');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.deepEqual(api.bodies.at(-1), { staffId: 'N9', code: '123456', newPassword: 'new-pass-1' });
  assert.equal((await acctText(page)).replace(/\s/g, ''), '公司模式新同事');
});

test('記住的員工編號還沒設密碼：送密碼回 need_setup 就換到設定密碼步驟', async () => {
  const { page } = await open();
  await page.evaluate(() => localStorage.setItem('tbx.staffId', 'N9'));
  await page.click('#company-btn');
  await page.fill('#company-dialog input[name=password]', 'whatever-1');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForSelector('#company-dialog input[name=code]', { state: 'visible' });
});

test('密碼錯誤顯示剩餘次數；查不到員工編號；連不上伺服器', async () => {
  const { page, api } = await open();
  await unlock(page, 'A123', 'bad-pass');
  await page.waitForFunction(() => document.querySelector('#company-dialog [role=alert]').textContent.includes('密碼不對，還可以再試 4 次'));
  assert.equal(await page.isVisible('#company-dialog'), true);
  await page.click('#company-dialog .login-link');
  await page.fill('#company-dialog input[name=staffId]', 'ZZZ');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#company-dialog [role=alert]').textContent.includes('查不到這個員工編號，或已停用'));
  api.authDown = true;
  await page.click('#company-dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#company-dialog [role=alert]').textContent.includes('連不上伺服器，請稍後再試'));
});

test('expiry pops login and keeps pane', async () => {
  const { page, api } = await open();
  await unlock(page);
  await page.waitForSelector('#toolbar button[data-tool=secret]', { state: 'attached' });
  await page.click('.nav-group:has(button[data-tool=secret]) .nav-trigger');
  await page.click('#toolbar button[data-tool=secret]');
  await page.frameLocator('.pane[data-tool=secret] iframe').locator('#t').fill('機密內容');
  const created = await page.getAttribute('.pane[data-tool=secret] iframe', 'data-created');

  api.statusCode = 401;
  await page.evaluate(() => window.tbxShell.__checkCompany());
  await page.waitForSelector('#company-dialog[open]');
  assert.equal(await page.textContent('#company-dialog h2'), '登入已過期，請重新登入');
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 0);
  assert.equal(await page.locator('.pane[data-tool=secret]:not([hidden])').count(), 1);
  assert.equal(await page.locator('.pane[data-tool=secret] .pane-lock').count(), 1);

  api.statusCode = 200;
  await page.fill('#company-dialog input[name=password]', 'pw-12345');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.pane-lock'));
  assert.equal(await page.frameLocator('.pane[data-tool=secret] iframe').locator('#t').inputValue(), '機密內容');
  assert.equal(await page.getAttribute('.pane[data-tool=secret] iframe', 'data-created'), created);
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 1);
});

test('cancel keeps locked', async () => {
  const { page, api } = await open();
  await unlock(page);
  await page.waitForSelector('#toolbar button[data-tool=secret]', { state: 'attached' });
  await page.click('.nav-group:has(button[data-tool=secret]) .nav-trigger');
  await page.click('#toolbar button[data-tool=secret]');
  api.statusCode = 401;
  await page.evaluate(() => window.tbxShell.__checkCompany());
  await page.waitForSelector('#company-dialog[open]');
  await page.click('#company-dialog .actions button[type=button]'); // 取消
  assert.equal(await page.isVisible('#company-dialog'), false);
  assert.equal(await page.locator('.pane[data-tool=secret] .pane-lock').count(), 1);
  await page.click('.pane[data-tool=secret] .pane-lock button');
  await page.waitForSelector('#company-dialog[open]');
});

test('帳號彈窗：姓名、權限組、員工編號、分機、解鎖有效、通知；一般員工沒有管理頁與切到測試後端；Esc 關閉焦點回按鈕；登出', async () => {
  const { page } = await open();
  await unlock(page);
  await page.waitForSelector('#toolbar button[data-tool=secret]', { state: 'attached' });
  await page.click('#company-btn');
  await page.waitForSelector('#acct-pop:not([hidden])');
  assert.equal(await page.getAttribute('#company-btn', 'aria-expanded'), 'true');
  assert.equal(await page.textContent('#acct-pop .acct-name'), '王小明');
  assert.equal(await page.textContent('#acct-pop .acct-lv'), '小編組');
  assert.equal(await page.textContent('#acct-pop dd[data-k=id]'), 'A123');
  await page.waitForFunction(() => document.querySelector('#acct-pop dd[data-k=contact]').textContent === '#12345');
  assert.match(await page.textContent('#acct-pop dd[data-k=exp]'), /剩 30 天/);
  assert.match(await page.textContent('#acct-pop .acct-sec'), /目前沒有通知/);
  assert.equal(await page.isVisible('#acct-pop .acct-manage'), false);
  assert.equal(await page.isVisible('#to-dev-backend'), false);
  assert.equal(await page.locator('#status [data-status=company]').count(), 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#acct-pop', { state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'company-btn');
  await page.click('#company-btn');
  await page.click('#company-logout');
  await page.waitForFunction(() => !document.querySelector('#toolbar button[data-tool=secret]'));
  assert.equal(await page.textContent('#company-btn'), '登入');
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.company')), null);
});

test('變更密碼：目前密碼錯顯示原因；成功換新憑證並提示', async () => {
  const { page, api } = await open();
  await unlock(page);
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  await page.click('#company-btn');
  await page.click('#acct-pop button:has-text("變更密碼")');
  await page.waitForSelector('#company-password-dialog[open]');
  await page.fill('#company-password-dialog input[name=password]', 'wrong-old');
  await page.fill('#company-password-dialog input[name=newPassword]', 'pw-new-123');
  await page.fill('#company-password-dialog input[name=newPassword2]', 'pw-new-123');
  await page.click('#company-password-dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#company-password-dialog [role=alert]').textContent.includes('目前密碼不對'));
  await page.fill('#company-password-dialog input[name=password]', 'pw-12345');
  await page.click('#company-password-dialog button[type=submit]');
  await page.waitForSelector('#company-password-dialog', { state: 'hidden' });
  await page.waitForSelector('.acct-toast');
  assert.deepEqual(api.pwBodies.at(-1), { password: 'pw-12345', newPassword: 'pw-new-123' });
});

test('系統管理者：彈窗有「管理頁」（前往 admin/）與「切到測試後端」', async () => {
  const { page } = await open();
  await unlock(page, 'S1');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  await page.click('#company-btn');
  assert.equal(await page.textContent('#acct-pop .acct-lv'), '系統管理者');
  assert.equal(await page.isVisible('#acct-pop .acct-manage'), true);
  assert.equal(await page.isVisible('#to-dev-backend'), true);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/acct-pop.png' });
  await page.route('**/admin/', (r) => r.fulfill({ contentType: 'text/html', body: '<p>admin</p>' }));
  await Promise.all([page.waitForURL(/\/admin\/$/), page.click('#acct-pop .acct-manage')]);
});


test('測試後端：系統管理者切過去 → 測試膠囊、憑證分開、打 dev 網址 → 切回正式', async () => {
  const { page, api } = await open();
  await unlock(page, 'S1');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  await page.click('#company-btn');
  assert.equal(await page.isVisible('#to-dev-backend'), true);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/to-dev.png' });
  await Promise.all([page.waitForEvent('load'), page.click('#to-dev-backend')]);
  await page.waitForSelector('#status [data-status=apienv]');
  assert.equal(await page.textContent('#status [data-status=apienv]'), '測試後端');
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.api')), 'dev');
  // 正式憑證保留，但測試後端還沒登入：公司工具鎖住、出現登入按鈕
  assert.ok(await page.evaluate(() => localStorage.getItem('tbx.company')));
  assert.equal(await page.isVisible('#company-btn'), true);
  api.hosts.length = 0;
  await unlock(page, 'S1');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.ok(api.hosts.length > 0 && api.hosts.every((h) => h === 'toolbox-api-dev.19jpz-3.workers.dev'));
  assert.ok(await page.evaluate(() => localStorage.getItem('tbx.company.dev')));
  // 測試後端裡不再出現「切到測試後端」
  await page.click('#company-btn');
  assert.equal(await page.isVisible('#to-dev-backend'), false);
  await page.keyboard.press('Escape');
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/dev-pill.png' });
  await page.click('#status [data-status=apienv]');
  await Promise.all([page.waitForEvent('load'), page.click('#apienv-dialog .btn-primary')]);
  await page.waitForFunction(() => /莊鈞評/.test(document.getElementById('company-btn').textContent));
  assert.equal(await page.locator('#status [data-status=apienv]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.api')), null);
});

test('留言失敗通知：帳號框紅色光暈閃爍；彈窗列出粉專／第幾則／原因；重新留言後移除；開排程發布切網址', async () => {
  const { page, api } = await open();
  const at = Date.now() - 60000;
  api.notices = { enabled: true, all: true, items: [
    { postId: '111_5', page: '111', pageName: '新聞', kind: 'post', seq: 1, error: '(#32) page rate limit', failed: true, at, canRetry: true, title: '颱風最新：海上警報發布' },
    { postId: '222_9', page: '222', pageName: '娛樂', kind: 'video', seq: 2, error: 'temporary', failed: false, at, canRetry: false }
  ] };
  await unlock(page, 'S1');
  await page.waitForSelector('#company-btn.acct-alert');
  assert.match(await acctText(page), /有 2 則未處理通知/);
  await page.click('#company-btn');
  await page.waitForSelector('#acct-pop .acct-note');
  const notes = page.locator('#acct-pop .acct-note');
  assert.equal(await notes.count(), 2);
  assert.match(await notes.nth(0).textContent(), /新聞｜第 1 則留言失敗.*\(#32\) page rate limit/);
  assert.match(await notes.nth(1).textContent(), /娛樂｜第 2 則留言重試中/);
  assert.equal(await notes.nth(0).locator('.acct-note-title').textContent(), '颱風最新：海上警報發布');
  assert.equal(await notes.nth(1).locator('.acct-note-title').count(), 0, '舊通知沒有摘要不顯示');
  assert.equal(await notes.nth(0).locator('a', { hasText: '看貼文' }).getAttribute('href'), 'https://www.facebook.com/111_5');
  assert.equal(await notes.nth(0).locator('a', { hasText: '看貼文' }).getAttribute('target'), '_blank');
  // 按鈕一列：重留言／看貼文／看列表／完成
  assert.deepEqual(await notes.nth(0).locator('.acct-note-act > *').allTextContents(), ['重留言', '看貼文', '看列表', '完成']);
  const tops = await notes.nth(0).locator('.acct-note-act > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, '按鈕要在同一列：' + tops);
  assert.equal(await notes.nth(1).locator('button', { hasText: '重留言' }).count(), 0, '沒有權限不顯示重新留言');
  assert.equal(await page.isVisible('#acct-pop .acct-empty'), false);
  assert.match(await page.textContent('#acct-pop .acct-scope'), /全部人/);
  // 看全部的人：重新留言後重讀，這則變「已補留言」（黃）
  api.notices = { enabled: true, all: true, items: [{ ...api.notices.items[0], state: 'handled', how: 'retry', hby: 'S1', hname: '莊鈞評', hat: at }, api.notices.items[1]] };
  await notes.nth(0).locator('button', { hasText: '重留言' }).click();
  await page.waitForSelector('#acct-pop .acct-note.is-handled');
  assert.deepEqual(api.retries, [{ postId: '111_5', page: '111' }]);
  assert.match(await page.textContent('#acct-pop .acct-note.is-handled'), /莊鈞評 已補留言/);
  assert.match(await acctText(page), /有 1 則未處理通知/);
  await page.locator('#acct-pop').getByRole('button', { name: '看列表（影片發布）' }).click();
  await page.waitForSelector('#acct-pop', { state: 'hidden' });
  assert.equal(await page.evaluate(() => location.hash), '#fbvideo');
});

test('留言失敗通知：權限組沒開 notify（enabled false）不閃紅光，彈窗維持目前沒有通知', async () => {
  const { page, api } = await open();
  api.notices = { enabled: false, items: [] };
  await unlock(page);
  await page.click('#company-btn');
  await page.waitForSelector('#acct-pop:not([hidden])');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('#acct-pop .acct-sec'), /目前沒有通知/);
  assert.equal(await page.locator('#company-btn.acct-alert').count(), 0);
});

test('留言失敗通知：一般員工只看自己發的，標題註明', async () => {
  const { page, api } = await open();
  api.notices = { enabled: true, all: false, items: [{ postId: '111_5', page: '111', pageName: '新聞', kind: 'post', seq: 1, error: 'x', failed: true, at: Date.now(), canRetry: true }] };
  await unlock(page);
  await page.waitForSelector('#company-btn.acct-alert');
  await page.click('#company-btn');
  await page.waitForSelector('#acct-pop .acct-note');
  assert.match(await page.textContent('#acct-pop .acct-scope'), /你發的貼文/);
});
