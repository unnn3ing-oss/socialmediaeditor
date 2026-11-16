// 管理後台（admin/index.html）：登入、分類切換（隱藏切換、內容保留）、各按鈕打到正確的後端 API。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const API = 'https://toolbox-api.19jpz-3.workers.dev';
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const DATA = {
  'GET /admin/assets': [{ key: 'logo.png', tier: 'company', size: 2048, updated: Date.UTC(2026, 10, 1) }],
  'GET /admin/logs': [{ at: Date.UTC(2026, 10, 2), tool: 'pattern', code: 'ok', ver: '1' }],
};

async function open(viewport, hash = '') {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const calls = [];
  page.on('pageerror', (e) => calls.push('ERR ' + e.message));
  await page.route(API + '/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const key = req.method() + ' ' + u.pathname;
    calls.push({ key, auth: req.headers().authorization || '' });
    if (key === 'POST /admin/login') {
      const ok = JSON.parse(req.postData()).password === 'pw-123';
      return r.fulfill({ json: ok ? { ok: true, data: { token: 'T' } } : { ok: false, code: 'bad_password' } });
    }
    if (typeof DATA[key] === 'function') return r.fulfill({ json: { ok: true, data: DATA[key](req.postData() ? JSON.parse(req.postData()) : null) } });
    if (key in DATA) return r.fulfill({ json: { ok: true, data: DATA[key] } });
    return r.fulfill({ json: { ok: false, code: 'not_found', error: '找不到' } });
  });
  await page.goto(srv.url + 'admin/' + hash);
  return { page, calls };
}

async function login(page) {
  await page.fill('#pw', 'pw-123');
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not([hidden])');
}

test('登入後依分類切換，按鈕打到後端 API 並帶 token', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 });
  assert.equal(await page.isVisible('#app'), false);
  assert.equal(await page.isVisible('#logout'), false);
  await page.fill('#pw', 'nope');
  await page.click('#loginBtn');
  await page.waitForFunction(() => document.getElementById('loginMsg').textContent === '密碼不正確。');
  await login(page);

  // 預設在素材；排程發布相關分類已移除
  assert.equal(await page.getAttribute('#tab-assets', 'aria-selected'), 'true');
  assert.ok(page.url().endsWith('#assets'));
  assert.equal(await page.isVisible('#logout'), true);
  assert.deepEqual(await page.$$eval('nav.side [role=tab]', (els) => els.map((e) => e.textContent)), ['素材', '錯誤日誌']);
  for (const id of ['#panel-fb', '#panel-rd', '#pzLoad', '#pmLoad', '#rdPing', '#fbBtn']) assert.equal(await page.locator(id).count(), 0, id);
  await page.waitForSelector('#tableWrap:not([hidden])');
  assert.match(await page.textContent('#rows'), /logo\.png/);

  // 切到錯誤日誌再切回來，填到一半的內容還在
  await page.fill('#key', '填到一半');
  await page.click('#tab-logs');
  assert.equal(await page.isVisible('#panel-assets'), false);
  await page.click('#tab-assets');
  assert.equal(await page.inputValue('#key'), '填到一半');

  // 方向鍵切換分類（素材 → 錯誤日誌）
  await page.focus('#tab-assets');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#tab-logs', 'aria-selected'), 'true');
  await page.click('#logBtn');
  await page.waitForFunction(() => /共 1 筆/.test(document.getElementById('logMsg').textContent));

  const api = calls.filter((c) => typeof c === 'object' && c.key !== 'POST /admin/login');
  assert.ok(api.length >= 2);
  for (const c of api) assert.equal(c.auth, 'Bearer T', c.key);
  for (const k of ['GET /admin/assets', 'GET /admin/logs']) {
    assert.ok(api.some((c) => c.key === k), k);
  }
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤：' + calls.filter((c) => typeof c === 'string'));

  // 登出回登入畫面
  await page.click('#logout');
  assert.equal(await page.isVisible('#login'), true);
  assert.equal(await page.isVisible('#app'), false);
});

test('網址帶分類時登入後直接打開；手機版分類不超出畫面', async () => {
  const { page } = await open({ width: 390, height: 800 }, '#logs');
  await login(page);
  assert.equal(await page.getAttribute('#tab-logs', 'aria-selected'), 'true');
  assert.equal(await page.isVisible('#panel-logs'), true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, '頁面不能橫向捲動：' + overflow);
});

test('頁面不用 emoji 或箭頭', async () => {
  const { page } = await open({ width: 1280, height: 800 });
  const html = await page.content();
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}]/u);
  assert.match(html, /<meta name="robots" content="noindex">/);
});
