// YT 批量下載（真的載入外掛＋真的下載助手 tools/ytdl/host/host.py，yt-dlp 用測試替身）：
// 沒有下載助手時顯示設定步驟 → 登錄下載助手後按「啟動」連上 → 貼網址帶出標題 → 下載完成、檔案寫進輸出資料夾。
// 另測工具箱安裝教學的「也要 YT 下載」勾選。網站從 repo 讀，不連 GitHub／YouTube。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const EXT = path.join(ROOT, 'extension');
const SITE = 'https://unnn3ing-oss.github.io/socialmediaeditor/';
const EXT_ID = 'odajlpffjjeiliinefhimmbpdeeggckg';
const HOST_NAME = 'com.tbx.ytdl';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

let ctx, work, userData;

test.before(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'tbx-ytdl-'));
  userData = path.join(work, 'profile');
  const opts = {
    headless: false,
    env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
      '--host-resolver-rules=MAP api.github.com 127.0.0.1:9, MAP raw.githubusercontent.com 127.0.0.1:9, MAP i.ytimg.com 127.0.0.1:9'],
  };
  try { ctx = await chromium.launchPersistentContext(userData, opts); }
  catch { ctx = await chromium.launchPersistentContext(userData, { ...opts, executablePath: '/opt/pw-browsers/chromium' }); }
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await ctx.route(SITE + '**', (r) => {
    const rel = decodeURIComponent(new URL(r.request().url()).pathname.slice('/socialmediaeditor/'.length)) || 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }, body: fs.readFileSync(file) });
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  assert.equal(new URL(sw.url()).hostname, EXT_ID);
});

test.after(async () => { await ctx?.close(); });

function registerHost() {
  const home = path.join(work, 'home');
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  const stub = path.join(home, 'bin', 'yt-dlp');
  fs.copyFileSync(path.join(ROOT, 'tools/ytdl/host/tests/stub_ytdlp.py'), stub);
  fs.chmodSync(stub, 0o755);
  const wrapper = path.join(work, 'host.sh');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexport YTDL_HOME="${home}"\nexport YTDL_STUB_DELAY=1\nexec python3 "${path.join(ROOT, 'tools/ytdl/host/host.py')}"\n`);
  fs.chmodSync(wrapper, 0o755);
  const nm = path.join(userData, 'NativeMessagingHosts');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, `${HOST_NAME}.json`), JSON.stringify({
    name: HOST_NAME, description: 'e2e', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${EXT_ID}/`],
  }));
}

// 從網頁經核心 bridge 呼叫 ytdl op（和 tb.ext.call 同一條路）
const call = (page, op, payload = {}) => page.evaluate(([op, payload]) => new Promise((resolve) => {
  const nonce = Math.random().toString(36).slice(2);
  const on = (e) => { if (e.data && e.data.source === 'tbx-ext' && e.data.nonce === nonce) { removeEventListener('message', on); resolve(e.data); } };
  addEventListener('message', on);
  postMessage({ source: 'tbx-web', nonce, op, payload }, '*');
}), [op, payload]);

// 設定步驟是彈窗精靈：打開（沒開的話）→ 跳到第 3 步 → 按「啟動」
async function clickStart(page) {
  if (!(await page.isVisible('#setup-card'))) await page.click('#open-setup');
  await page.click('.stepper li[data-step="3"] button');
  await page.click('#start');
}

test('YT 下載：沒有下載助手 → 設定步驟；登錄後啟動 → 加入、下載完成', async () => {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(SITE + 'tools/ytdl/index.html');
  await page.waitForFunction(() => document.getElementById('conn-pill').textContent !== '尚未連線', null, { timeout: 15000 });

  // 1. 還沒登錄下載助手：按啟動 → not_installed，設定步驟展開、不顯示已連線
  await clickStart(page);
  const st = await call(page, 'ytdl.get_status');
  assert.equal(st.ok, true);
  await page.waitForTimeout(1500);
  const notInstalled = (await call(page, 'ytdl.get_status')).data.state;
  assert.ok(['not_installed', 'forbidden', 'stopped'].includes(notInstalled), notInstalled);
  assert.notEqual(await page.textContent('#conn-pill'), '已連線');
  assert.equal(await page.isVisible('#setup-card'), true);
  assert.equal(await page.$eval('#setup-card', (d) => d.open && d.matches(':modal')), true, '設定步驟是彈窗');
  // 一次只顯示一步；上一步／下一步切換
  assert.deepEqual(await page.$$eval('#steps .step', (els) => els.map((e) => !e.hidden)), [false, false, true]);
  await page.click('#step-prev');
  assert.deepEqual(await page.$$eval('#steps .step', (els) => els.map((e) => !e.hidden)), [false, true, false]);
  assert.equal(await page.isEnabled('#step-next'), true);
  assert.equal(await page.isEnabled('#step-prev'), true);
  assert.equal(await page.getAttribute('#download-win', 'href'), 'installers/ytdl-install-windows.cmd');
  for (const f of ['ytdl-install-windows.cmd', 'ytdl-install-mac.zip', 'ytdl-install-mac.sh']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'tools/ytdl/installers', f)), f);
  }
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, 'ytdl-setup.png'), fullPage: true });

  // 2. 登錄下載助手後按啟動 → 已連線
  registerHost();
  await clickStart(page);
  // 測試環境沒有 ffmpeg／Deno：狀態是 running，膠囊顯示「需要處理」（真電腦由安裝檔裝好就是「已連線」）
  const until = Date.now() + 20000;
  while ((await call(page, 'ytdl.get_status')).data.state !== 'running') {
    assert.ok(Date.now() < until, '下載助手沒連上');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => ['已連線', '需要處理'].includes(document.getElementById('conn-pill').textContent), null, { timeout: 10000 });
  await page.click('#setup-close'); // 使用者自己打開的，要自己關
  assert.equal(await page.isVisible('#setup-card'), false);

  // 3. 輸出資料夾、貼網址 → 帶出標題
  const out = path.join(work, 'out');
  fs.mkdirSync(out);
  const set = await call(page, 'ytdl.set_output_dir', { path: out });
  assert.equal(set.ok, true, JSON.stringify(set));
  await page.fill('#add-url', 'https://www.youtube.com/watch?v=vA');
  await page.click('#add-btn');
  await page.waitForFunction(() => document.getElementById('queue-list').textContent.includes('影片 vA'), null, { timeout: 20000 });

  // 4. 開始下載 → 完成、檔案寫入
  await page.waitForFunction(() => !document.getElementById('start-all').disabled, null, { timeout: 10000 });
  await page.click('#start-all');
  const deadline = Date.now() + 40000;
  for (;;) {
    const q = (await call(page, 'ytdl.queue_get')).data.state;
    const item = q.items[0];
    if (item.status === 'done') break;
    assert.notEqual(item.status, 'failed', JSON.stringify(item));
    assert.ok(Date.now() < deadline, `等下載完成逾時：${JSON.stringify(item)}`);
    await page.waitForTimeout(300);
  }
  assert.ok(fs.readdirSync(out).some((f) => f.includes('影片 vA')), fs.readdirSync(out).join(','));
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('#queue-list textarea')].some((t) => t.offsetParent)), '網頁版有內文框');
  // 標題列只寫總數（完成、速度、剩餘不寫）
  await page.waitForFunction(() => document.getElementById('queue-stats').textContent === '共 1 支', null, { timeout: 5000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, 'ytdl-done.png'), fullPage: true });

  // 5. 壞網址被擋；未知 op 被核心擋
  assert.equal((await call(page, 'ytdl.queue_add', { url: 'https://evil.example/x' })).ok, false);
  assert.equal((await call(page, 'ytdl.init')).code, 'unknown_op');
  assert.deepEqual(errors, []);
  await page.close();
});

test('安裝教學：「也要 YT 下載」預設不勾，外殼 tbxShell.openInstall 可開教學', async () => {
  const page = await ctx.newPage();
  await page.goto(SITE + 'index.html');
  await page.evaluate(() => window.tbxShell.openInstall());
  await page.waitForSelector('#deployYtCheck', { state: 'attached', timeout: 10000 });
  assert.equal(await page.isChecked('#deployYtCheck'), false);
  await page.close();
});

test('YT 下載（沒裝外掛）：只有一個提示區塊＋安裝外掛按鈕，佇列與設定收起', async () => {
  const { serve } = require('../helpers/serve.js');
  const { launch } = require('../helpers/browser.js');
  const srv = await serve(ROOT);
  const browser = await launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(srv.url + 'tools/ytdl/index.html');
    await page.waitForSelector('#no-extension:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(2000); // 過了舊版 1.5 秒才展開步驟的時間
    assert.equal(await page.isVisible('#conn-pill'), false);
    assert.equal(await page.isVisible('#setup-card'), false);
    assert.equal(await page.isVisible('#connect-status'), false);
    assert.equal(await page.isVisible('#work'), false);
    assert.match(await page.textContent('#no-ext-text'), /安裝小編工具箱外掛/);
    // 不在外殼裡：沒有「安裝外掛」按鈕，改用文字指路
    assert.equal(await page.isVisible('#no-ext-install'), false);
    assert.match(await page.textContent('#no-ext-text'), /頂列的「安裝外掛」/);
    // 已輸入的內容在收起期間不會消失
    await page.evaluate(() => { document.getElementById('add-url').value = 'https://youtu.be/x'; });
    assert.equal(await page.inputValue('#add-url'), 'https://youtu.be/x');
  } finally { await browser.close(); await srv.close(); }
});

test('YT 下載（沒裝外掛）：手機顯示「需在電腦使用」、不引導安裝；320／390 無水平溢位', async () => {
  const { serve } = require('../helpers/serve.js');
  const { launch } = require('../helpers/browser.js');
  const srv = await serve(ROOT);
  const browser = await launch();
  try {
    for (const width of [320, 390]) {
      const page = await (await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 })).newPage();
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      await page.goto(srv.url + 'tools/ytdl/index.html');
      await page.waitForSelector('#no-extension:not([hidden])', { timeout: 10000 });
      assert.match(await page.textContent('#no-ext-text'), /此功能需在已安裝外掛與下載助手的電腦使用/);
      assert.equal(await page.isVisible('#no-ext-install'), false);
      assert.equal(await page.isVisible('#setup-card'), false);
      assert.equal(await page.isVisible('#open-setup'), false);
      assert.equal(await page.isVisible('#conn-pill'), false);
      assert.equal(await page.isVisible('#download-win'), false);
      assert.equal(await page.isVisible('#work'), false);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${width}px 水平溢位 ${over}`);
      // 強制展開工作區（模擬已連線）：版面也不能溢位
      await page.evaluate(() => { document.getElementById('work').hidden = false; });
      const over2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over2 <= 0, `${width}px 工作區水平溢位 ${over2}`);
      await page.close();
    }
  } finally { await browser.close(); await srv.close(); }
});

test('YT 下載：工作區卡片有間距，新增列各元件同高 48px、更新列橫排', async () => {
  const { serve } = require('../helpers/serve.js');
  const { launch } = require('../helpers/browser.js');
  const srv = await serve(ROOT);
  const browser = await launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(srv.url + 'tools/ytdl/index.html');
    await page.waitForSelector('#no-extension:not([hidden])', { timeout: 10000 });
    await page.evaluate(() => { document.getElementById('work').hidden = false; document.getElementById('side').hidden = false; });
    const gap = await page.$eval('#work', (el) => getComputedStyle(el).rowGap);
    assert.equal(gap, '14px');
    const hs = await page.evaluate(() => ['#add-card .in', '#mode', '#quality', '#add-btn'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().height)));
    assert.deepEqual(hs, [48, 48, 48, 48]);
    const ys = await page.evaluate(() => ['#add-card .in', '#mode', '#quality', '#add-btn'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
    assert.equal(new Set(ys).size, 1, '垂直置中對齊 ' + ys);
    const o = await page.evaluate(() => ['#outdir', '#save-outdir'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().height)));
    assert.equal(o[0], o[1]);
    const dir = await page.$eval('#up-check', (el) => getComputedStyle(el.parentElement).flexDirection);
    assert.equal(dir, 'row');
    const w = await page.$eval('#doctor-check', (el) => el.getBoundingClientRect().width);
    assert.ok(w < 300, '檢查環境不全寬 ' + w);
    await page.close();
  } finally { await browser.close(); await srv.close(); }
});

test('YT 下載：抓取影片資訊中的列，封面與標題顯示骨架；抓到後換成標題', async () => {
  const { serve } = require('../helpers/serve.js');
  const { launch } = require('../helpers/browser.js');
  const srv = await serve(ROOT);
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(srv.url + 'tools/ytdl/index.html');
    const r = await page.evaluate(async () => {
      const { renderQueue } = await import('./web/queue-view.js');
      document.getElementById('work').hidden = false;
      const ul = document.getElementById('queue-list'), noop = () => {};
      const h = { cover: noop, copy: noop, retry: noop, remove: noop };
      const item = { uid: 1, status: 'fetching', url: 'https://www.youtube.com/watch?v=abc', title: '' };
      renderQueue(ul, { items: [item], hostConnected: true }, Date.now(), h);
      const row = ul.querySelector('.qrow');
      const out = { fetching: row.classList.contains('is-fetching'), sk: !!row.querySelector('.qtitle .sk'), anim: getComputedStyle(row.querySelector('.qph')).animationName };
      renderQueue(ul, { items: [{ ...item, status: 'waiting', id: 'abc', title: '影片標題' }], hostConnected: true }, Date.now(), h);
      out.after = { fetching: row.classList.contains('is-fetching'), sk: !!row.querySelector('.qtitle .sk'), title: row.querySelector('.qtitle').textContent };
      return out;
    });
    assert.deepEqual(r, { fetching: true, sk: true, anim: 'sk-shimmer', after: { fetching: false, sk: false, title: '影片標題' } });
    await page.close();
  } finally { await browser.close(); await srv.close(); }
});

test('YT 下載版面：網頁左側欄＋右主區；側邊欄（embed=side）單欄、設定與工具收合', async () => {
  const { serve } = require('../helpers/serve.js');
  const { launch } = require('../helpers/browser.js');
  const srv = await serve(ROOT);
  const browser = await launch();
  const reveal = () => { for (const id of ['work', 'side']) document.getElementById(id).hidden = false; };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(srv.url + 'tools/ytdl/index.html');
    await page.waitForSelector('#no-extension:not([hidden])', { timeout: 10000 });
    await page.evaluate(reveal);
    const box = (q) => page.$eval(q, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const side = await box('#side'), main = await box('#add-card');
    assert.ok(side.x + side.w <= main.x, `側欄在左 ${JSON.stringify([side, main])}`);
    assert.equal(Math.round(side.w), 300);
    assert.equal(await page.isVisible('#side-tools > summary'), false, '網頁不顯示收合標題');
    assert.equal(await page.isVisible('#doctor-check'), true);
    assert.equal(await page.isVisible('#tab-card'), false, '網頁沒有目前分頁卡');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, 'ytdl-web-2col.png') });
    // 沒外掛時側欄隱藏、主區單欄滿版
    await page.evaluate(() => { document.getElementById('side').hidden = true; });
    assert.ok((await box('#add-card')).w > 1100);

    const sp = await (await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 })).newPage();
    await sp.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await sp.goto(srv.url + 'tools/ytdl/index.html?embed=side');
    await sp.waitForSelector('#no-extension:not([hidden])', { timeout: 10000 });
    await sp.evaluate(reveal);
    assert.equal(await sp.evaluate(() => document.documentElement.classList.contains('is-side')), true);
    const s2 = await sp.$eval('#side', (el) => el.getBoundingClientRect().top);
    const q2 = await sp.$eval('#queue-card', (el) => el.getBoundingClientRect().bottom);
    assert.ok(s2 >= q2, '設定與工具在清單下面');
    assert.equal(await sp.isVisible('#side-tools > summary'), true);
    assert.equal(await sp.isVisible('#doctor-check'), false, '預設收合');
    await sp.click('#side-tools > summary');
    assert.equal(await sp.isVisible('#doctor-check'), true);
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '400px 無水平溢位');
    const sw = await sp.$eval('#start-all', (el) => el.getBoundingClientRect().width);
    assert.ok(sw > 300, '開始全部下載滿版 ' + sw);
  } finally { await browser.close(); await srv.close(); }
});

test('外掛側邊欄：有「YT 下載」分頁；目前分頁是 YouTube 時顯示目前分頁卡', async () => {
  await ctx.route('https://www.youtube.com/**', (r) => r.fulfill({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><title>測試影片標題 - YouTube</title><p>yt</p>' }));
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 400, height: 800 });
  await sp.goto(`chrome-extension://${EXT_ID}/core/sidepanel.html`);
  await sp.click('#tabYtdl');
  assert.equal(await sp.getAttribute('#tabYtdl', 'aria-selected'), 'true');
  assert.equal(await sp.isVisible('#paneYtdl'), true);
  assert.equal(await sp.isVisible('#panePost'), false);
  assert.match(await sp.getAttribute('#ytdlApp', 'src'), /panel\.html\?tool=ytdl&embed=side$/);
  const panel = sp.frame({ url: /panel\.html\?tool=ytdl/ }) ?? (await (await sp.waitForSelector('#ytdlApp')).contentFrame());
  const toolFrame = async () => {
    for (let i = 0; i < 100; i++) {
      const f = sp.frames().find((fr) => /tools\/ytdl\/index\.html/.test(fr.url()));
      if (f) return f;
      await sp.waitForTimeout(100);
    }
    throw new Error('沒有載入 YT 工具');
  };
  assert.ok(panel);
  const tool = await toolFrame();
  assert.match(tool.url(), /embed=side/);
  await tool.waitForFunction(() => document.documentElement.classList.contains('is-side') && !document.getElementById('work').hidden, null, { timeout: 15000 });

  const yt = await ctx.newPage();
  await yt.goto('https://www.youtube.com/watch?v=vTab');
  await yt.bringToFront();
  await tool.waitForFunction(() => !document.getElementById('tab-card').hidden, null, { timeout: 10000 });
  assert.equal(await tool.textContent('#tab-title'), '測試影片標題');
  assert.equal(await tool.textContent('#tab-kind'), '影片');
  assert.equal(await tool.isVisible('#add-url'), false);
  assert.equal(await tool.isVisible('#add-btn'), false, '在 YouTube 分頁時只有卡片上的「增加」');
  assert.equal(await tool.getAttribute('#tab-add', 'aria-label'), '增加目前分頁：測試影片標題');
  // 切換鈕與「增加」縮小到 40px、同一列；開始全部下載在清單最下面
  const hs = await tool.evaluate(() => ['#mode', '#quality'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().height)));
  assert.deepEqual(hs, [40, 40]);
  assert.equal(await tool.evaluate(() => document.getElementById('start-all').parentElement.id), 'queue-foot');
  // 清單列：複製內文／移除 24px，側邊欄不顯示內文框（網頁版的第一支測試有內文框）
  const acts = await tool.evaluate(() => [...document.querySelectorAll('#queue-list .qacts button:not([hidden])')].map((b) => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]));
  assert.ok(acts.length >= 2 && acts.every(([w, h]) => w === 24 && h === 24), JSON.stringify(acts));
  assert.equal(await tool.evaluate(() => [...document.querySelectorAll('#queue-list textarea')].filter((t) => t.offsetParent).length), 0);
  if (process.env.E2E_SHOTS) await sp.screenshot({ path: path.join(process.env.E2E_SHOTS, 'ytdl-sidepanel.png') });
  await tool.click('#tab-add');
  const until = Date.now() + 15000;
  while (!(await call(tool, 'ytdl.queue_get')).data.state.items.some((it) => String(it.url).includes('vTab'))) {
    assert.ok(Date.now() < until, '按卡片上的增加沒有加入目前分頁');
    await tool.waitForTimeout(300);
  }
  // 回到側邊欄本身那個分頁（不是 YouTube）：卡片收起
  await sp.bringToFront();
  await tool.waitForFunction(() => document.getElementById('tab-card').hidden, null, { timeout: 10000 });
  await yt.close();
  await sp.close();
});
