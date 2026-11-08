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
  const api = { statusCode: 200, authOk: true, authDown: false };
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.route('https://toolbox-api.19jpz-3.workers.dev/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    if (p === '/auth') {
      if (api.authDown) return r.abort();
      if (!api.authOk) return r.fulfill({ status: 401, headers: CORS, json: { ok: false, code: 'bad_password', error: 'x' } });
      return r.fulfill({ headers: CORS, json: { ok: true, data: { token: 'tok', exp } } });
    }
    if (p === '/auth/status') {
      if (api.statusCode === 401) return r.fulfill({ status: 401, headers: CORS, json: { ok: false, code: 'unauthorized', error: 'x' } });
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
  await page.fill('#company-dialog input', pw);
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
  await page.waitForSelector('#toolbar button[data-tool=secret]');
  await page.click('#toolbar button[data-tool=secret]');
  await page.frameLocator('.pane[data-tool=secret] iframe').locator('#t').fill('機密內容');
  const created = await page.getAttribute('.pane[data-tool=secret] iframe', 'data-created');

  api.statusCode = 401;
  await page.evaluate(() => window.tbxShell.__checkCompany());
  await page.waitForSelector('#company-dialog[open]');
  assert.equal(await page.textContent('#company-dialog h2'), '公司密碼已過期');
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 0);
  assert.equal(await page.locator('.pane[data-tool=secret][data-side]').count(), 1);
  assert.equal(await page.locator('.pane[data-tool=secret] .pane-lock').count(), 1);

  api.statusCode = 200;
  await page.fill('#company-dialog input', 'good');
  await page.click('#company-dialog button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.pane-lock'));
  assert.equal(await page.frameLocator('.pane[data-tool=secret] iframe').locator('#t').inputValue(), '機密內容');
  assert.equal(await page.getAttribute('.pane[data-tool=secret] iframe', 'data-created'), created);
  assert.equal(await page.locator('#toolbar button[data-tool=secret]').count(), 1);
});

test('cancel keeps locked', async () => {
  const { page, api } = await open();
  await unlock(page);
  await page.waitForSelector('#toolbar button[data-tool=secret]');
  await page.click('#toolbar button[data-tool=secret]');
  api.statusCode = 401;
  await page.evaluate(() => window.tbxShell.__checkCompany());
  await page.waitForSelector('#company-dialog[open]');
  await page.click('#company-dialog button[type=button]'); // 取消
  assert.equal(await page.isVisible('#company-dialog'), false);
  assert.equal(await page.locator('.pane[data-tool=secret] .pane-lock').count(), 1);
  await page.click('.pane[data-tool=secret] .pane-lock button');
  await page.waitForSelector('#company-dialog[open]');
});

test('logout hides company tool', async () => {
  const { page } = await open();
  await unlock(page);
  await page.waitForSelector('#toolbar button[data-tool=secret]');
  await page.click('#status [data-status=company]');
  await page.click('#company-logout-dialog .btn-primary');
  await page.waitForFunction(() => !document.querySelector('#toolbar button[data-tool=secret]'));
  assert.equal(await page.locator('#status [data-status=company]').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.company')), null);
});
