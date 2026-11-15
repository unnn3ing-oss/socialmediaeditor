const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const CATALOG = { tools: [] };
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function open(ctxOpts, init) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.goto(srv.url + 'index.html');
  return page;
}

test('extension pill settles', async () => {
  const page = await open({ viewport: { width: 1280, height: 820 } });
  await page.waitForSelector('#status .sk');
  await page.waitForSelector('#status .pill-warn', { timeout: 3500 });
  assert.equal(await page.textContent('#status .pill-warn'), '未安裝外掛');
  assert.equal(await page.locator('#status .sk').count(), 0);
});

test('install auto-opens on desktop', async () => {
  const page = await open({ viewport: { width: 1280, height: 820 } });
  await page.waitForSelector('#deployOverlay:not([hidden])', { timeout: 5000 });
  assert.equal(await page.locator('#deployOverlay .ds-pane:not([hidden])').count(), 1);
  assert.match(await page.textContent('#deployInstallName'), /toolbox-install/);
  // 同一分頁只自動開一次：關掉後重新整理不再自動開
  await page.click('#deployCloseBtn');
  await page.reload();
  await page.waitForSelector('#status .pill-warn', { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#deployOverlay').count(), 0);
  // 按下狀態膠囊可再打開
  await page.click('#status .pill-warn');
  await page.waitForSelector('#deployOverlay:not([hidden])');
});

test('no auto-open on phone', async () => {
  const page = await open({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  await page.waitForSelector('#status .pill-warn', { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#deployOverlay').count(), 0);
});

test('pill ok with fake extension', async () => {
  const page = await open({ viewport: { width: 1280, height: 820 } }, () => {
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (d && d.source === 'tbx-web' && d.op === 'ping') {
        window.postMessage({ source: 'tbx-ext', nonce: d.nonce, ok: true, data: { version: '1.00' } }, '*');
      }
    });
  });
  await page.waitForSelector('#status .pill-ok');
  assert.equal(await page.textContent('#status .pill-ok'), '外掛已連線');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#deployOverlay').count(), 0);
});
