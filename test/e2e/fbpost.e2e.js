// 排程發布：整套已移除待重寫，只留工具卡片與「功能停用」頁（不呼叫後端、不需公司憑證）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { API_BASE } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function newPage(viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [], fbCalls = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(API_BASE + '/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (/^\/(fb|rundown)\b/.test(p)) fbCalls.push(p);
    return r.fulfill({ status: 404, json: { ok: false, code: 'not_found' } });
  });
  return { page, errors, fbCalls };
}

test('工具頁只顯示功能停用，不呼叫後端', async () => {
  const { page, errors, fbCalls } = await newPage({ width: 390, height: 700 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  const box = page.locator('#fbpostOff');
  await box.waitFor();
  assert.match(await box.textContent(), /排程發布 功能停用/);
  assert.equal(await page.locator('button, input, textarea, select').count(), 0, '沒有任何可操作的控制項');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, '手機寬度不能橫向捲動：' + overflow);
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'fbpost-off-mobile.png') });
  assert.deepEqual(fbCalls, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('網站首頁不用登入就看得到排程發布卡片，點進去顯示功能停用', async () => {
  const { page, errors, fbCalls } = await newPage({ width: 1280, height: 800 });
  await page.goto(srv.url + 'index.html');
  const card = page.locator('#showcase .card[data-tool=fbpost]');
  await card.waitFor();
  await card.click();
  await page.frameLocator('.pane[data-tool=fbpost] iframe').locator('#fbpostOff', { hasText: '功能停用' }).waitFor();
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'fbpost-off-site.png') });
  assert.deepEqual(fbCalls, []);
  assert.deepEqual(errors, []);
  await page.close();
});
