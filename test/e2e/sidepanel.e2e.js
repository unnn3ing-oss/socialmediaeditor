// 外掛側邊欄（真的載入外掛）：分頁、嵌入發文頁（panel.html?tool=fbpost）、側邊欄內解鎖、公司模式狀態、一鍵檢測。
// 網站與後端一律用 route 假的：網站檔案從 repo 讀，後端只回測試資料，不連 GitHub、不打臉書。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { API_BASE, fakeAsset } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'extension');
const SITE = 'https://unnn3ing-oss.github.io/socialmediaeditor/';
const EXT_ID = 'odajlpffjjeiliinefhimmbpdeeggckg';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PAGES = [{ id: '111', name: 'TVBS新聞', code: 'news', label: '新聞', utm: 'utm_source=facebook', sort: 1, link: '', picture: '', followers: 1 }];

let ctx, dir;
const api = { authOk: true, passwords: [] };

async function launchExt() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbx-sp-'));
  const opts = { headless: false, args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] };
  try { return await chromium.launchPersistentContext(dir, opts); }
  catch { return chromium.launchPersistentContext(dir, { ...opts, executablePath: '/opt/pw-browsers/chromium' }); }
}

test.before(async () => {
  ctx = await launchExt();
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await ctx.route('https://api.github.com/**', (r) => r.abort());
  await ctx.route(SITE + '**', (r) => {
    const rel = decodeURIComponent(new URL(r.request().url()).pathname.slice('/socialmediaeditor/'.length)) || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }, body: fs.readFileSync(file) });
  });
  await ctx.route(API_BASE + '/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const u = new URL(req.url());
    const okJ = (data) => r.fulfill({ headers: CORS, json: { ok: true, data } });
    const bad = (code, status) => r.fulfill({ status, headers: CORS, json: { ok: false, code, error: code } });
    const authed = /Bearer good/.test(req.headers().authorization || '');
    const exp = Math.floor(Date.now() / 1000) + 3 * 86400;
    if (u.pathname === '/auth') { api.passwords.push(JSON.parse(req.postData()).password); return api.authOk ? okJ({ token: 'good', exp }) : bad('bad_password', 401); }
    if (u.pathname === '/auth/status') return authed ? okJ({ company: true, exp }) : bad('unauthorized', 401);
    if (!authed) return bad('unauthorized', 401);
    if (/^\/assets\//.test(u.pathname)) return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset([30, 60, 120]) });
    if (u.pathname === '/fb/pages') return okJ(PAGES);
    if (u.pathname === '/fb/scheduled') return okJ({ items: [] });
    if (u.pathname === '/fb/comments') return okJ({ items: [] });
    if (u.pathname === '/fb/posts') return okJ({ items: [], next: null });
    return bad('not_found', 404);
  });
});
test.after(async () => { await ctx.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('側邊欄：版面同網新快速排程，發文頁在側邊欄解鎖後載入排程發布，狀態頁顯示公司模式與一鍵檢測', async () => {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewportSize({ width: 400, height: 760 });
  await p.goto(`chrome-extension://${EXT_ID}/core/sidepanel.html`);

  // 頂列：分頁右邊一顆圓形「網頁版」圖示（游標移上去才顯示文字），沒有網新「舊版」
  assert.equal(await p.locator('.top button:not([role=tab])').count(), 1);
  assert.equal(await p.getAttribute('#openSite', 'data-tip'), '網頁版');
  const tipOpacity = () => p.$eval('#openSite', (b) => getComputedStyle(b, '::after').opacity);
  assert.equal(await tipOpacity(), '0');
  await p.hover('#openSite');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('openSite'), '::after').opacity === '1');
  await p.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'sp-0-tip.png') : path.join(dir, 'z.png'), clip: { x: 0, y: 0, width: 400, height: 120 } });
  await p.mouse.move(200, 400);
  assert.equal(await p.getAttribute('#tabPost', 'aria-selected'), 'true');

  // 發文頁：沒憑證 → 解鎖卡片；輸入密碼後才載入工具
  const panel = p.frameLocator('#app');
  await panel.locator('#panelLock').waitFor();
  assert.equal(await panel.locator('#panelHost iframe').count(), 0);
  await p.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'sp-1-lock.png') : path.join(dir, 'a.png') });
  await panel.locator('#company-btn').click();
  await panel.locator('#company-dialog input[type=password]').fill('pw');
  await panel.locator('#company-dialog button[type=submit]').click();
  const tool = panel.frameLocator('#panelHost iframe');
  await tool.locator('#newPost').waitFor();
  await tool.locator('#pagesState', { hasText: '已連線 1 個粉專' }).waitFor();
  // 第一次進來跳值班粉專視窗（側邊欄寬也能選）
  await tool.locator('#dutyDlg[open]').waitFor();
  await tool.locator('#dutyList .duty-pick').first().click();
  await tool.locator('#dutyOk').click();
  await tool.locator('#dutyBtn', { hasText: '★' }).waitFor();
  assert.deepEqual(api.passwords, ['pw']);
  assert.ok(await panel.locator('#panelLock').isHidden());
  await p.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'sp-2-post.png') : path.join(dir, 'b.png') });

  // 新增發文彈窗在窄版可開（單欄）
  await tool.locator('#newPost').click();
  await tool.locator('#modal[open]').waitFor();
  const cols = await tool.locator('#modal .m-body').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
  assert.equal(cols, 1);
  await p.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'sp-3-modal.png') : path.join(dir, 'c.png') });
  await tool.locator('#modal .x').click();

  // 狀態頁：公司模式已解鎖；切換分頁只隱藏，發文頁不重載
  await p.click('#tabInfo');
  assert.ok(await p.locator('#panePost').isHidden());
  await p.locator('#companyStatus.ok', { hasText: '已解鎖' }).waitFor();
  await p.click('#hcRun');
  await p.locator('#hcSum.ok', { hasText: '全部正常' }).waitFor();
  const rows = await p.$$eval('#hcList .hc-row', (li) => li.map((x) => [x.dataset.id, x.dataset.state]));
  assert.deepEqual(rows, [['api', 'ok'], ['company', 'ok'], ['fb', 'ok'], ['ext', 'ok']]);
  await p.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'sp-4-info.png') : path.join(dir, 'd.png') });
  await p.click('#tabPost');
  assert.equal(await tool.locator('#newPost').count(), 1, '切回發文頁，工具還在');
  assert.deepEqual(errs, []);
  await p.close();
});

test('panel.html：不是外掛側邊欄嵌入時，不回覆檢測訊息', async () => {
  const p = await ctx.newPage();
  await p.goto(SITE + 'panel.html?tool=fbpost');
  await p.waitForFunction(() => document.getElementById('panel').getAttribute('aria-busy') === 'false');
  const got = await p.evaluate(() => new Promise((res) => {
    const f = document.createElement('iframe');
    f.src = location.href;
    f.onload = () => {
      window.addEventListener('message', (e) => { if (e.data && e.data.source === 'tbx-panel') res('replied'); });
      f.contentWindow.postMessage({ source: 'tbx-sidepanel', type: 'check', id: 1 }, '*');
      setTimeout(() => res('silent'), 1500);
    };
    document.body.append(f);
  }));
  assert.equal(got, 'silent');
  await p.close();
});

test('panel.html：找不到工具時顯示說明', async () => {
  const p = await ctx.newPage();
  await p.goto(SITE + 'panel.html?tool=nope');
  await p.locator('#panelErr').waitFor();
  await p.close();
});
