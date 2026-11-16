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

let PG_SAVED = null;
const PAGES = [
  { id: '1', name: 'TVBS 新聞', short: '新聞', utm: '', rd: 'news', order: 0, show: 1 },
  { id: '2', name: 'TVBS 娛樂', short: '娛樂', utm: '?&utm_source=facebook', rd: 'ent', order: 1, show: 1 },
  { id: '3', name: 'TVBS 少康戰情室', short: '少康', utm: '', rd: '', order: 2, show: 0 }];
const DATA = {
  'GET /admin/assets': [{ key: 'logo.png', tier: 'company', size: 2048, updated: Date.UTC(2026, 10, 1) }],
  'GET /admin/logs': [{ at: Date.UTC(2026, 10, 2), tool: 'fb', code: 'ok', ver: '1' }],
  'GET /admin/fb/status': { configured: true, valid: true, expires: Math.floor(Date.UTC(2027, 0, 5, 4, 0) / 1000), missing: ['pages_manage_posts'], pages: 3 },
  'GET /admin/fb/pages': PAGES,
  'POST /admin/fb/pages': (b) => { PG_SAVED = b; return b.pages.map((p) => ({ ...PAGES.find((x) => x.id === p.id), ...p })); },
  'POST /admin/fb/refresh': {},
  'GET /admin/rundown': { configured: true },
  'POST /admin/rundown/ping': { title: 'FB RUNDOWN(2026)', sheets: ['2026/11'] },
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

  // 預設在臉書發文
  assert.equal(await page.getAttribute('#tab-fb', 'aria-selected'), 'true');
  assert.ok(page.url().endsWith('#fb'));
  assert.equal(await page.isVisible('#logout'), true);
  assert.ok(!calls.some((c) => c.key === 'GET /admin/assets'), '沒進素材分類前不讀素材');
  // 4 個分類；沒有後端 API 的卡片（預設文字、嘗試次數）不出現
  assert.deepEqual(await page.$$eval('nav.side [role=tab]', (els) => els.map((e) => e.textContent)), ['臉書發文', 'Rundown', '素材', '錯誤日誌']);
  await page.waitForSelector('#pgWrap:not([hidden])');
  await page.fill('.pg-short >> nth=0', '填到一半');

  // 切到素材再切回來，填到一半的內容還在
  await page.click('#tab-assets');
  assert.equal(await page.isVisible('#panel-fb'), false);
  await page.click('#tab-fb');
  assert.equal(await page.inputValue('.pg-short >> nth=0'), '填到一半');

  // 素材：第一次進來才讀
  await page.click('#tab-assets');
  await page.waitForSelector('#tableWrap:not([hidden])');
  assert.match(await page.textContent('#rows'), /logo\.png/);

  // 方向鍵切換分類（Rundown → 素材 → 錯誤日誌）
  await page.focus('#tab-assets');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#tab-logs', 'aria-selected'), 'true');
  await page.click('#logBtn');
  await page.waitForFunction(() => /共 1 筆/.test(document.getElementById('logMsg').textContent));

  const api = calls.filter((c) => typeof c === 'object' && c.key !== 'POST /admin/login');
  assert.ok(api.length >= 3);
  for (const c of api) assert.equal(c.auth, 'Bearer T', c.key);
  for (const k of ['GET /admin/fb/status', 'GET /admin/fb/pages', 'GET /admin/assets', 'GET /admin/logs']) {
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

test('臉書發文：狀態、到期日與缺少權限；粉專表依順序顯示', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  const st = await page.textContent('#fbState');
  assert.match(st, /連線正常/);
  assert.match(st, /到期日 2027-01-05/);
  assert.match(st, /粉專 3 個/);
  assert.match(await page.textContent('#fbMissing'), /缺少權限：pages_manage_posts/);
  assert.equal(await page.locator('#pgRows tr').count(), 3);
  assert.deepEqual(await page.$$eval('#pgRows tr', (rs) => rs.map((r) => r.children[0].textContent + r.children[1].textContent)), ['1TVBS 新聞', '2TVBS 娛樂', '3TVBS 少康戰情室']);
  assert.equal(await page.inputValue('#pgRows tr:nth-child(2) .pg-utm'), '?&utm_source=facebook');
  assert.equal(await page.isChecked('#pgRows tr:nth-child(3) .pg-show'), false);
  assert.ok(calls.filter((c) => c.key === 'GET /admin/fb/status' || c.key === 'GET /admin/fb/pages').every((c) => c.auth === 'Bearer T'));
  // 重新讀取粉專：先清快取再重讀
  await page.click('#fbRefresh');
  await page.waitForFunction(() => document.getElementById('fbMsg').textContent === '已重新讀取。');
  assert.ok(calls.some((c) => c.key === 'POST /admin/fb/refresh'));
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('粉專設定：改簡稱、RD、上移後儲存，body 含新值與正確 order', async () => {
  PG_SAVED = null;
  const { page } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  await page.fill('#pgRows tr:nth-child(1) .pg-short', '主粉');
  await page.selectOption('#pgRows tr:nth-child(3) .pg-rd', 'shaokang');
  await page.check('#pgRows tr:nth-child(3) .pg-show');
  await page.click('#pgRows tr:nth-child(3) .pg-up');   // 少康移到第 2 列
  assert.equal(await page.inputValue('#pgRows tr:nth-child(2) .pg-short'), '少康');
  assert.equal(await page.inputValue('#pgRows tr:nth-child(2) .pg-rd'), 'shaokang', '換順序後輸入值保留');
  assert.equal(await page.inputValue('#pgRows tr:nth-child(1) .pg-short'), '主粉');
  await page.click('#pgSave');
  await page.waitForFunction(() => document.getElementById('pgMsg').textContent === '已儲存');
  assert.deepEqual(PG_SAVED.pages.map((p) => [p.id, p.short, p.rd, p.order, p.show]),
    [['1', '主粉', 'news', 0, 1], ['3', '少康', 'shaokang', 1, 1], ['2', '娛樂', 'ent', 2, 1]]);
  assert.equal(PG_SAVED.pages[2].utm, '?&utm_source=facebook');
});

test('粉專設定：簡稱空白不送出', async () => {
  PG_SAVED = null;
  const { page } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  await page.fill('#pgRows tr:nth-child(1) .pg-short', '');
  await page.click('#pgSave');
  assert.match(await page.textContent('#pgMsg'), /簡稱要 1～20 字/);
  assert.equal(PG_SAVED, null);
});

test('臉書發文與 Rundown：手機 390px 頁面不橫向捲動', async () => {
  const { page } = await open({ width: 390, height: 800 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok((await over()) <= 0, '臉書發文橫向捲動');
  await page.click('#tab-rd');
  assert.ok((await over()) <= 0, 'Rundown 橫向捲動');
});

test('Rundown 分類：測試連線打 /admin/rundown/ping 並顯示試算表名稱', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#rd');
  await login(page);
  assert.equal(await page.isVisible('#panel-rd'), true);
  await page.waitForFunction(() => document.getElementById('rdState').textContent === '狀態：已設定');
  await page.click('#rdPing');
  await page.waitForFunction(() => /連線正常：FB RUNDOWN\(2026\)/.test(document.getElementById('rdMsg').textContent));
  assert.ok(calls.some((c) => c.key === 'POST /admin/rundown/ping' && c.auth === 'Bearer T'));
});
