// 自行註冊、還沒指派權限組：三個臉書工具顯示「尚未開通〇〇」專屬頁面（不是「功能停用」）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { API_BASE } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOT = process.env.SHOT_DIR;
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

for (const [id, name] of [['fbpost', '排程發布'], ['fbvideo', '影片發布'], ['fbreports', '數據報表']]) {
  test(`${name}：自行註冊帳號看到「尚未開通${name}」，按重新檢查會重新載入`, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    const errors = []; let statusCalls = 0;
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(API_BASE + '/**', async (r) => {
      const req = r.request(), p = new URL(req.url()).pathname;
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      if (p === '/auth/status') { statusCalls++; return r.fulfill({ headers: CORS, json: { ok: true, data: { company: true, exp: Math.floor(Date.now() / 1000) + 3600 } } }); }
      if (p.startsWith('/fb/')) return r.fulfill({ status: 403, headers: CORS, json: { ok: false, code: 'fb_self_pending', error: 'x' } });
      return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
    });
    await page.goto(srv.url + `tools/${id}/index.html`);
    await page.waitForSelector('#selfPend:not([hidden])');
    assert.equal(await page.textContent('#selfPendTitle'), '尚未開通' + name);
    assert.match(await page.textContent('#selfPend'), /你的帳號是自行註冊，還沒有指派權限組，暫時不能使用這個工具。/);
    assert.match(await page.textContent('#selfPend'), /開通後重新整理這頁就能使用。/);
    assert.equal(await page.isVisible('#offTitle'), false, '不顯示功能停用');
    if (SHOT && id === 'fbpost') await page.screenshot({ path: path.join(SHOT, 'selfpend-fbpost.png') });
    const before = statusCalls;
    await Promise.all([page.waitForEvent('load'), page.click('#selfPendBtn')]);
    await page.waitForSelector('#selfPend:not([hidden])');
    assert.ok(statusCalls > before, '重新檢查＝重新載入、再問一次後端');
    assert.deepEqual(errors, []);
    await page.close();
  });
}
