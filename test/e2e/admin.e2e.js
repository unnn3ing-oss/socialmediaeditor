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

let PM_SAVED = null;
let PZ = { paused: false, reason: '', at: null };
const DATA = {
  'GET /admin/assets': [{ key: 'logo.png', tier: 'company', size: 2048, updated: Date.UTC(2026, 10, 1) }],
  'GET /admin/logs': [{ at: Date.UTC(2026, 10, 2), tool: 'fb', code: 'ok', ver: '1' }],
  'GET /admin/fb': { configured: false },
  'GET /admin/fb/pagemap': { items: [
    { id: '1', name: '新聞粉', label: '新聞', code: 'news', codeSet: '', auto: 'news', utm: 'utm_source=fb', sort: 1, saved: true },
    { id: '3', name: 'TVBS 少康戰情室', label: '少康', code: 'shaokang', codeSet: '', auto: 'shaokang', utm: '', sort: 3, saved: true },
    { id: '9', name: '隨便粉專', label: '隨便', code: '', codeSet: '', auto: '', utm: '', sort: 9, saved: false }] },
  'POST /admin/fb/pagemap': (b) => { PM_SAVED = b; return { saved: b.items.length }; },
  'POST /admin/rundown/ping': { title: 'FB RUNDOWN(2026)', sheets: ['2026/11'] },
  'GET /admin/fb/pause': () => ({ ...PZ, reasonMax: 100 }),
  'POST /admin/fb/pause': (b) => { PZ = b.paused ? { paused: true, reason: b.reason.trim(), at: PZ.at || Date.UTC(2026, 10, 15, 6, 2) } : { paused: false, reason: '', at: null }; return { ...PZ, reasonMax: 100 }; },
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
  for (const id of ['#cpLoad', '#atLoad']) assert.equal(await page.locator(id).count(), 0, id);

  await page.click('#pmLoad');
  await page.waitForSelector('#pmWrap:not([hidden])');
  await page.fill('#pzReason', '填到一半');

  // 切到素材再切回來，填到一半的內容還在
  await page.click('#tab-assets');
  assert.equal(await page.isVisible('#panel-fb'), false);
  await page.click('#tab-fb');
  assert.equal(await page.inputValue('#pzReason'), '填到一半');

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
  for (const k of ['GET /admin/fb/pagemap', 'GET /admin/assets', 'GET /admin/logs']) {
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

test('暫停排程發布：先讀取才能操作，停用前確認（先不要不送出），可改原因、恢復', async () => {
  PZ = { paused: false, reason: '', at: null };
  const { page, calls } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  const posts = () => calls.filter((c) => c.key === 'POST /admin/fb/pause').length;
  assert.equal(await page.isDisabled('#pzToggle'), true, '沒讀取前不能停用');
  await page.click('#pzLoad');
  await page.waitForFunction(() => document.getElementById('pzState').textContent === '目前狀態：使用中');
  await page.fill('#pzReason', '權杖更換中');
  await page.click('#pzToggle');
  assert.equal(await page.isVisible('#pzConfirm'), true);
  await page.click('#pzNo');
  assert.equal(await page.isVisible('#pzConfirm'), false);
  assert.equal(posts(), 0, '按先不要不會送出');
  await page.click('#pzToggle');
  await page.click('#pzYes');
  await page.waitForFunction(() => /^目前狀態：已停用（2026-11-15 \d\d:02 起）$/.test(document.getElementById('pzState').textContent));
  assert.equal(await page.textContent('#pzToggle'), '恢復使用');
  assert.equal(await page.isVisible('#pzSaveReason'), true);
  assert.equal(PZ.reason, '權杖更換中');
  await page.fill('#pzReason', '改成 16:00 恢復');
  await page.click('#pzSaveReason');
  await page.waitForFunction(() => document.getElementById('pzMsg').textContent === '已更新停用原因。');
  assert.equal(PZ.reason, '改成 16:00 恢復');
  await page.click('#pzToggle');
  await page.waitForFunction(() => document.getElementById('pzState').textContent === '目前狀態：使用中');
  assert.equal(PZ.paused, false);
  assert.equal(await page.isVisible('#pzSaveReason'), false);
  assert.ok(calls.filter((c) => c.key && c.key.endsWith('/admin/fb/pause')).every((c) => c.auth === 'Bearer T'), '帶管理 token');
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('粉專對應：RD 區段下拉（自動顯示判斷結果、對不到標紅），儲存帶 code', async () => {
  const { page } = await open({ width: 1280, height: 860 });
  await login(page);
  await page.click('#pmLoad');
  await page.waitForSelector('#pmWrap:not([hidden])');
  assert.equal(await page.inputValue('#pmC1'), '');
  assert.match(await page.$eval('#pmC1 option[value=""]', (o) => o.textContent), /自動（少康）/);
  assert.match(await page.$eval('#pmC2 option[value=""]', (o) => o.textContent), /自動（對不到）/);
  assert.match(await page.textContent('#pmRows tr:nth-child(3)'), /不會寫入 RD/);
  assert.doesNotMatch(await page.textContent('#pmRows tr:nth-child(2)'), /不會寫入 RD/);
  await page.selectOption('#pmC2', 'intl');
  assert.doesNotMatch(await page.textContent('#pmRows tr:nth-child(3)'), /不會寫入 RD/);
  await page.selectOption('#pmC1', 'jkk');
  assert.match(await page.textContent('#pmRows tr:nth-child(2)'), /不會寫入 RD/);
  await page.click('#pmSave');
  await page.waitForFunction(() => /已儲存/.test(document.getElementById('pmMsg').textContent));
  assert.deepEqual(PM_SAVED.items.map((i) => [i.id, i.code]), [['1', ''], ['3', 'jkk'], ['9', 'intl']]);
});

test('Rundown 分類：測試連線打 /admin/rundown/ping 並顯示試算表名稱', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#rd');
  await login(page);
  assert.equal(await page.isVisible('#panel-rd'), true);
  await page.click('#rdPing');
  await page.waitForFunction(() => /連線正常：FB RUNDOWN\(2026\)/.test(document.getElementById('rdMsg').textContent));
  assert.ok(calls.some((c) => c.key === 'POST /admin/rundown/ping' && c.auth === 'Bearer T'));
});
