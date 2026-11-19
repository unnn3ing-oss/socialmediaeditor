// 首頁工具卡片的 gate：依後端 /fb/open 顯示「管理員測試」與測試說明
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.env.SHOT_DIR;
const CORS = { 'access-control-allow-origin': '*' };
const tool = (id, name, extra = {}) => ({ id, name, group: '發文與素材', desc: `${name}正式說明`, tier: 'public', requires: [],
  icon: 'tools/sample/icon.svg', thumb: 'tools/sample/thumb.svg', entry: `test/fixtures/tools/${id}/index.html`, ...extra });
const GATE = { check: '/fb/open', badge: '管理員測試', desc: '測試中，僅管理員可用' };
const CATALOG = { tools: [tool('fbpost', '排程發布', { gate: GATE }), tool('fbvideo', '影片發布', { gate: { ...GATE, desc: '影片測試說明' } }), tool('alpha', '公開工具')] };

let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function open(answer) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  let asked = 0;
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.route('https://toolbox-api.19jpz-3.workers.dev/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/fb/open') { asked++; return answer === 'down' ? r.abort() : r.fulfill({ headers: CORS, json: { ok: true, data: { open: answer === 'open' } } }); }
    return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
  });
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#showcase .card[data-tool=fbpost]');
  return { page, ctx, asked: () => asked };
}
const card = (page, id) => page.locator(`#showcase .card[data-tool=${id}]`);

test('開放：拿掉「管理員測試」、換回正式說明；兩張卡只查一次', async () => {
  const { page, ctx, asked } = await open('open');
  await page.waitForFunction(() => !document.querySelector('#showcase .card[data-tool=fbpost] .badges'));
  assert.equal(await card(page, 'fbpost').locator('.desc').textContent(), '排程發布正式說明');
  assert.equal(await card(page, 'fbvideo').locator('.desc').textContent(), '影片發布正式說明');
  assert.equal(await card(page, 'fbvideo').locator('.badges').count(), 0);
  assert.equal(asked(), 1);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'gate-open.png') });
  await ctx.close();
});

test('關閉：顯示「管理員測試」與測試說明；其他工具不受影響', async () => {
  const { page, ctx, asked } = await open('closed');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(asked(), 1);
  assert.equal(await card(page, 'fbpost').locator('.badge').textContent(), '管理員測試');
  assert.equal(await card(page, 'fbpost').locator('.desc').textContent(), '測試中，僅管理員可用');
  assert.equal(await card(page, 'fbvideo').locator('.desc').textContent(), '影片測試說明');
  assert.equal(await card(page, 'alpha').locator('.badges').count(), 0);
  assert.equal(await card(page, 'alpha').locator('.desc').textContent(), '公開工具正式說明');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'gate-closed.png') });
  await ctx.close();
});

test('查不到（後端還沒部署／連不上）：維持關閉的樣子', async () => {
  const { page, ctx } = await open('down');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await card(page, 'fbpost').locator('.badge').textContent(), '管理員測試');
  await ctx.close();
});
