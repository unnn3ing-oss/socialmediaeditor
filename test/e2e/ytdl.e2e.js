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

test('YT 下載：沒有下載助手 → 設定步驟；登錄後啟動 → 加入、下載完成', async () => {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(SITE + 'tools/ytdl/index.html');
  await page.waitForFunction(() => document.getElementById('conn-pill').textContent !== '尚未連線', null, { timeout: 15000 });

  // 1. 還沒登錄下載助手：按啟動 → not_installed，設定步驟展開、不顯示已連線
  await page.click('#start');
  const st = await call(page, 'ytdl.get_status');
  assert.equal(st.ok, true);
  await page.waitForTimeout(1500);
  const notInstalled = (await call(page, 'ytdl.get_status')).data.state;
  assert.ok(['not_installed', 'forbidden', 'stopped'].includes(notInstalled), notInstalled);
  assert.notEqual(await page.textContent('#conn-pill'), '已連線');
  assert.equal(await page.isVisible('#setup-card'), true);
  assert.equal(await page.getAttribute('#download-win', 'href'), 'installers/ytdl-install-windows.cmd');
  for (const f of ['ytdl-install-windows.cmd', 'ytdl-install-mac.zip', 'ytdl-install-mac.sh']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'tools/ytdl/installers', f)), f);
  }
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, 'ytdl-setup.png'), fullPage: true });

  // 2. 登錄下載助手後按啟動 → 已連線
  registerHost();
  await page.click('#start');
  // 測試環境沒有 ffmpeg／Deno：狀態是 running，膠囊顯示「需要處理」（真電腦由安裝檔裝好就是「已連線」）
  const until = Date.now() + 20000;
  while ((await call(page, 'ytdl.get_status')).data.state !== 'running') {
    assert.ok(Date.now() < until, '下載助手沒連上');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => ['已連線', '需要處理'].includes(document.getElementById('conn-pill').textContent), null, { timeout: 10000 });

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
