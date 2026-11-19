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

// api.statusCode 控制 /auth/status 的回應；api.authOk 控制密碼對不對
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  const api = { statusCode: 200, authOk: true, authDown: false, bodies: [], hosts: [] };
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.route(/^https:\/\/toolbox-api(-dev)?\.19jpz-3\.workers\.dev\//, async (r) => {
    const req = r.request();
    api.hosts.push(new URL(req.url()).host);
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    if (p === '/auth') {
      if (api.authDown) return r.abort();
      const body = JSON.parse(req.postData());
      api.bodies.push(body);
      if (body.staffId !== undefined) {
        if (body.staffId !== 'A123') return r.fulfill({ status: 401, headers: CORS, json: { ok: false, code: 'bad_staff', error: '查不到這個員工編號，或已停用。' } });
        return r.fulfill({ headers: CORS, json: { ok: true, data: { token: 'stf', exp, staff: { id: 'A123', name: '王小明', group: '小編組' } } } });
      }
      if (!api.authOk) return r.fulfill({ status: 401, headers: CORS, json: { ok: false, code: 'bad_password', error: 'x' } });
      if (JSON.parse(req.postData()).password === 'admin-pw') return r.fulfill({ headers: CORS, json: { ok: true, data: { token: 'adm', exp: Math.floor(Date.now() / 1000) + 12 * 3600, admin: true } } });
      return r.fulfill({ headers: CORS, json: { ok: true, data: { token: 'tok', exp } } });
    }
    if (p === '/auth/status') {
      if (api.statusCode === 401) return r.fulfill({ status: 401, headers: CORS, json: { ok: false, code: 'unauthorized', error: 'x' } });
      if (/stf/.test(req.headers().authorization || '')) return r.fulfill({ headers: CORS, json: { ok: true, data: { company: true, exp, staff: { id: 'A123', name: '王小明', group: '小編組' } } } });
      if (/adm/.test(req.headers().authorization || '')) return r.fulfill({ headers: CORS, json: { ok: true, data: { company: true, exp: Math.floor(Date.now() / 1000) + 12 * 3600, admin: true } } });
      return r.fulfill({ headers: CORS, json: { ok: true, data: { company: true, exp } } });
    }
    return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
  });
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#showcase .card');
  return { page, api };
}

async function unlock(page, pw = 'good') {
  await page.click('#company-btn');
  await page.click('#company-dialog [data-tab=password]');
  await page.fill('#company-dialog input[name=password]', pw);
  await page.click('#company-dialog button[type=submit]');
}

test('company tool hidden by default', async () => {
  const { page } = await open();
  assert.equal(await page.locator('#showcase .card[data-tool=secret]').count(), 0);
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 0);
  assert.equal(await page.locator('#showcase .card[data-tool=alpha]').count(), 1);
});

test('unlock shows company tool', async () => {
  const { page } = await open();
  await unlock(page);
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 1);
  assert.match(await page.textContent('#status [data-status=company]'), /公司素材已解鎖，剩 30 天/);
  assert.equal(await page.isVisible('#company-dialog'), false);
});

test('wrong password message', async () => {
  const { page, api } = await open();
  api.authOk = false;
  await unlock(page, 'bad');
  await page.waitForFunction(() => document.querySelector('#company-dialog [role=alert]').textContent.includes('密碼不對，請再試一次'));
  assert.equal(await page.isVisible('#company-dialog'), true);
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
  assert.equal(await page.textContent('#company-dialog h2'), '公司密碼已過期');
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 0);
  assert.equal(await page.locator('.pane[data-tool=secret]:not([hidden])').count(), 1);
  assert.equal(await page.locator('.pane[data-tool=secret] .pane-lock').count(), 1);

  api.statusCode = 200;
  await page.fill('#company-dialog input[name=password]', 'good');
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

test('logout hides company tool', async () => {
  const { page } = await open();
  await unlock(page);
  await page.waitForSelector('#toolbar button[data-tool=secret]', { state: 'attached' });
  await page.click('#status [data-status=company]');
  await page.click('#company-logout-dialog .btn-primary');
  await page.waitForFunction(() => !document.querySelector('#toolbar button[data-tool=secret]'));
  assert.equal(await page.locator('#status [data-status=company]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.company')), null);
});

test('管理密碼登入：解鎖公司工具，膠囊顯示（管理員）剩 12 小時，重新整理後仍是管理員', async () => {
  const { page } = await open();
  await unlock(page, 'admin-pw');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.match(await page.textContent('#status [data-status=company]'), /公司素材已解鎖（管理員），剩 12 小時/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('tbx.company')).admin), true);
  await page.reload();
  await page.waitForFunction(() => /（管理員），剩 1[12] 小時/.test(document.querySelector('#status [data-status=company]')?.textContent || ''));
});

test('員工編號分頁：預設、送 staffId、成功顯示姓名、tb.company.staff 讀得到', async () => {
  const { page, api } = await open();
  await page.click('#company-btn');
  assert.equal(await page.locator('#company-dialog [data-tab=staff]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.isVisible('#company-dialog input[name=staffId]'), true);
  assert.equal(await page.isVisible('#company-dialog input[name=password]'), false);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/login-staff.png' });
  await page.fill('#company-dialog input[name=staffId]', 'A123');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.deepEqual(api.bodies, [{ staffId: 'A123' }]);
  assert.match(await page.textContent('#status [data-status=company]'), /王小明 已登入，剩 30 天/);
  assert.deepEqual(await page.evaluate(() => window.tbxShell.company().staff), { id: 'A123', name: '王小明', group: '小編組' });
  await page.reload();
  await page.waitForFunction(() => /王小明 已登入/.test(document.querySelector('#status [data-status=company]')?.textContent || ''));
});

test('員工編號查無：顯示 bad_staff 錯誤；切到公司密碼分頁仍送 password，重新整理記得分頁', async () => {
  const { page, api } = await open();
  await page.click('#company-btn');
  await page.fill('#company-dialog input[name=staffId]', 'ZZZ');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#company-dialog [role=alert]').textContent.includes('查不到這個員工編號，或已停用'));
  await page.click('#company-dialog [data-tab=password]');
  assert.equal(await page.isVisible('#company-dialog input[name=staffId]'), false);
  await page.fill('#company-dialog input[name=password]', 'good');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.deepEqual(api.bodies, [{ staffId: 'ZZZ' }, { password: 'good' }]);
  await page.evaluate(() => localStorage.removeItem('tbx.company'));
  await page.reload();
  await page.waitForSelector('#showcase .card');
  await page.click('#company-btn');
  assert.equal(await page.locator('#company-dialog [data-tab=password]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.isVisible('#company-dialog input[name=password]'), true);
});

test('測試後端：一般公司密碼看不到切換入口', async () => {
  const { page } = await open();
  await unlock(page);
  await page.waitForSelector('#status [data-status=company]');
  await page.click('#status [data-status=company]');
  assert.equal(await page.isVisible('#to-dev-backend'), false);
  assert.equal(await page.locator('#status [data-status=apienv]').count(), 0);
});

test('測試後端：管理員切過去 → 測試膠囊、憑證分開、打 dev 網址 → 切回正式', async () => {
  const { page, api } = await open();
  await unlock(page, 'admin-pw');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  await page.click('#status [data-status=company]');
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
  await unlock(page, 'admin-pw');
  await page.waitForSelector('#showcase .card[data-tool=secret]');
  assert.ok(api.hosts.length > 0 && api.hosts.every((h) => h === 'toolbox-api-dev.19jpz-3.workers.dev'));
  assert.ok(await page.evaluate(() => localStorage.getItem('tbx.company.dev')));
  // 測試後端裡不再出現「切到測試後端」
  await page.click('#status [data-status=company]');
  assert.equal(await page.isVisible('#to-dev-backend'), false);
  await page.click('#company-logout-dialog .btn-secondary:not(#to-dev-backend)');
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/dev-pill.png' });
  await page.click('#status [data-status=apienv]');
  await Promise.all([page.waitForEvent('load'), page.click('#apienv-dialog .btn-primary')]);
  await page.waitForSelector('#status [data-status=company]');
  assert.equal(await page.locator('#status [data-status=apienv]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.api')), null);
  assert.match(await page.textContent('#status [data-status=company]'), /（管理員）/);
});
