// 未登入時隱藏的工具（GET /site/vis）：首頁與選單不顯示、登入後出現、直接開網址照開並跳登入框、讀不到＝全部顯示
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.env.SHOT_DIR;
const CORS = { 'access-control-allow-origin': '*' };
const tool = (id, name) => ({ id, name, group: '發文與素材', desc: name, tier: 'public', requires: [],
  icon: 'tools/sample/icon.svg', thumb: 'tools/sample/thumb.svg', entry: 'test/fixtures/tools/alpha/index.html' });
const CATALOG = { tools: [tool('fbpost', '排程發布'), tool('alpha', '公開工具')] };

let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function open({ vis = ['fbpost'], login = false, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.route('https://toolbox-api.19jpz-3.workers.dev/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/site/vis') return vis === 'down' ? r.abort() : r.fulfill({ headers: CORS, json: { ok: true, data: { hide: vis } } });
    if (p === '/auth/status' && login) return r.fulfill({ headers: CORS, json: { ok: true, data: { company: true, exp: Math.floor(Date.now() / 1000) + 3600, staff: { id: 'A1', name: '小明', level: 'staff' } } } });
    return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
  });
  if (login) await page.addInitScript(() => { try { localStorage.setItem('tbx.company', JSON.stringify({ token: 't', exp: Math.floor(Date.now() / 1000) + 3600 })); } catch {} });
  await page.goto(srv.url + 'index.html' + hash);
  await page.waitForSelector('#showcase .card[data-tool=alpha]', { state: 'attached' });
  await new Promise((r) => setTimeout(r, 300));
  return { page, ctx };
}
const has = (page, sel) => page.locator(sel).count();

test('沒登入：首頁與選單都不顯示被隱藏的工具；其他工具照常', async () => {
  const { page, ctx } = await open();
  assert.equal(await has(page, '#showcase .card[data-tool=fbpost]'), 0);
  assert.equal(await has(page, '#showcase .card[data-tool=alpha]'), 1);
  assert.equal(await has(page, '#toolbar button[data-tool=fbpost]'), 0);
  assert.equal(await has(page, '#toolbar button[data-tool=alpha]'), 1);
  assert.equal(await page.isVisible('#company-dialog'), false, '首頁不跳登入框');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'toolvis-guest.png') });
  await ctx.close();
});

test('已登入：被隱藏的工具照常顯示', async () => {
  const { page, ctx } = await open({ login: true });
  await page.waitForSelector('#showcase .card[data-tool=fbpost]');
  assert.equal(await has(page, '#toolbar button[data-tool=fbpost]'), 1);
  await ctx.close();
});

test('沒登入直接開被隱藏的工具網址：照開該工具並跳登入框', async () => {
  const { page, ctx } = await open({ hash: '#fbpost' });
  await page.waitForSelector('#company-dialog[open]');
  assert.equal(await page.isVisible('#work'), true);
  assert.match(page.url(), /#fbpost$/);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'toolvis-direct.png') });
  await ctx.close();
});

test('沒登入直接開沒被隱藏的工具：不跳登入框', async () => {
  const { page, ctx } = await open({ hash: '#alpha' });
  assert.equal(await page.isVisible('#work'), true);
  assert.equal(await page.isVisible('#company-dialog'), false);
  await ctx.close();
});

test('讀不到設定（後端連不上）：全部顯示', async () => {
  const { page, ctx } = await open({ vis: 'down' });
  assert.equal(await has(page, '#showcase .card[data-tool=fbpost]'), 1);
  await ctx.close();
});
