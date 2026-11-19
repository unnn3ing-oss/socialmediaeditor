// 自動更新與側邊欄（chrome.*、fetch 一律 stub）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./helpers/browser.js');

const ROOT = path.join(__dirname, '..');
const url = (rel) => 'file://' + path.join(ROOT, rel) + '?t=' + Math.random();
const SITE = 'https://unnn3ing-oss.github.io/socialmediaeditor/';
const setGlobal = (n, v) => Object.defineProperty(globalThis, n, { value: v, configurable: true, writable: true });

async function loadUpdater() {
  setGlobal('self', globalThis);
  delete globalThis.Updater;
  await import(url('extension/core/updater.js'));
  return globalThis.Updater;
}

// 假的 GitHub：main 上的 extension/ 有 manifest.json（新版 1.01）、changelog.json、core/a.js
function makeWorld({ localManifestVersion = '1.00', remoteVersion = '1.01', sameSha = false } = {}) {
  const enc = (s) => new TextEncoder().encode(s);
  const remoteFiles = {
    'manifest.json': JSON.stringify({ name: '小編工具箱', version: remoteVersion, permissions: ['storage'] }),
    'changelog.json': JSON.stringify({ [remoteVersion]: { summary: '新功能', items: ['a', 'b'] } }),
    'core/a.js': 'console.log(1);\n',
  };
  const localFiles = { ...remoteFiles, 'manifest.json': JSON.stringify({ name: '小編工具箱', version: localManifestVersion, permissions: ['storage'] }) };
  if (sameSha) localFiles['manifest.json'] = remoteFiles['manifest.json'];
  const store = {};
  const calls = [];
  return { remoteFiles, localFiles, store, calls, enc };
}

async function installStubs(world, U) {
  const { remoteFiles, localFiles, store, calls, enc } = world;
  const shas = {};
  for (const [p, c] of Object.entries(remoteFiles)) shas[p] = await U.gitBlobSha(enc(c));
  const manifestVersion = JSON.parse(localFiles['manifest.json']).version;
  setGlobal('chrome', {
    runtime: { getURL: (p) => 'local://' + p, getManifest: () => ({ version: manifestVersion, name: '小編工具箱' }), reload: () => calls.push('reload') },
    storage: { local: {
      get: async (k) => (typeof k === 'string' ? (k in store ? { [k]: store[k] } : {}) : { ...store }),
      set: async (o) => { Object.assign(store, o); },
    } },
    action: { setBadgeText: async (o) => { calls.push(['badge', o.text]); }, setBadgeBackgroundColor: async () => {} },
    alarms: { get: (n, cb) => cb(undefined), create: () => {}, onAlarm: { addListener: () => {} } },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
  });
  // runtime 需要 onMessage 等給 background 用
  Object.assign(chrome.runtime, { id: 'self', onMessage: { addListener() {} }, onConnect: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } });
  const base = 'https://api.github.com/repos/unnn3ing-oss/socialmediaeditor';
  const raw = 'https://raw.githubusercontent.com/unnn3ing-oss/socialmediaeditor/';
  const body = (b, init) => new Response(b, init);
  setGlobal('fetch', async (u) => {
    u = String(u);
    calls.push(['fetch', u]);
    if (u.startsWith('local://')) {
      const f = localFiles[u.slice(8)];
      return f === undefined ? body('', { status: 404 }) : body(enc(f));
    }
    if (u === `${base}/commits/main`) {
      return body(JSON.stringify({ sha: 'c1', commit: { committer: { date: '2026-11-05T00:00:00Z' }, message: 'feat: x\n\ny', tree: { sha: 't1' } } }),
        { headers: { etag: 'W/"e1"' } });
    }
    if (u.startsWith(`${base}/git/trees/t1`)) {
      return body(JSON.stringify({ truncated: false, tree: [
        ...Object.keys(remoteFiles).map((p) => ({ type: 'blob', path: 'extension/' + p, sha: shas[p], size: 1 })),
        { type: 'blob', path: 'web/other.js', sha: 'zzz', size: 1 },
      ] }));
    }
    if (u.startsWith(raw + 'c1/extension/')) {
      const p = decodeURIComponent(u.slice((raw + 'c1/extension/').length));
      return remoteFiles[p] === undefined ? body('', { status: 404 }) : body(enc(remoteFiles[p]));
    }
    return body('', { status: 404 });
  });
}

test('updater：REPO 與同步範圍指向 socialmediaeditor 的 extension/', async () => {
  const U = await loadUpdater();
  assert.deepEqual(U.REPO, { owner: 'unnn3ing-oss', repo: 'socialmediaeditor', branch: 'main' });
  const src = fs.readFileSync(path.join(ROOT, 'extension/core/updater.js'), 'utf8');
  assert.match(src, /PREFIX = 'extension\/'/);
  assert.ok(!/schedulenewnet|snn-/.test(src), '不應殘留舊專案名稱');
});

test('updater：gitBlobSha 與 git 一致；isSafePath 擋掉危險路徑', async () => {
  const U = await loadUpdater();
  assert.equal(await U.gitBlobSha(new TextEncoder().encode('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  for (const ok of ['a.js', 'core/a.js']) assert.equal(U.isSafePath(ok), true, ok);
  for (const bad of ['', '/a', '../a', 'a/../b', 'a//b', 'a\\b', 'C:/a', './a']) assert.equal(U.isSafePath(bad), false, bad);
});

test('updater：checkLatest 只比對 extension/ 內有差異的檔案，並帶出版本與說明', async () => {
  const U = await loadUpdater();
  const w = makeWorld();
  await installStubs(w, U);
  const info = await U.checkLatest();
  assert.equal(info.hasUpdate, true);
  assert.equal(info.version, '1.01');
  assert.equal(info.localVersion, '1.00');
  assert.deepEqual(info.changed.map((f) => f.path), ['manifest.json']);
  assert.equal(info.notes[0].summary, '新功能');
  assert.deepEqual(info.notes[0].items, ['a', 'b']);
  assert.ok(!info.changed.some((f) => f.path.startsWith('web/')));
});

test('updater：內容相同時沒有更新；本機版本較新不算有更新', async () => {
  const U = await loadUpdater();
  const w = makeWorld({ sameSha: true, localManifestVersion: '1.01' });
  await installStubs(w, U);
  assert.equal((await U.checkLatest()).hasUpdate, false);
  const w2 = makeWorld({ localManifestVersion: '1.05', remoteVersion: '1.01' });
  await installStubs(w2, U);
  const r = await U.checkLatest();
  assert.equal(r.hasUpdate, false);
  assert.equal(r.localNewer, true);
});

test('updater：diffManifest 找出新增的權限與敏感設定', async () => {
  const U = await loadUpdater();
  const d = U.diffManifest({ permissions: ['storage'] }, { permissions: ['storage', 'tabs'], host_permissions: ['https://x/*'] });
  assert.deepEqual(d, ['新增權限：tabs', '新增可存取的網站：https://x/*']);
  assert.deepEqual(U.diffManifest({ permissions: ['a'] }, { permissions: ['a'] }), []);
});

test('updater：notesBetween 與 zhError', async () => {
  const U = await loadUpdater();
  const cl = { '1.01': { summary: 'a', items: [] }, '1.02': { summary: 'b', items: [] } };
  assert.deepEqual(U.notesBetween(cl, '1.00', '1.02').map((n) => n.version), ['1.02']);
  assert.match(U.zhError(new Error('Failed to fetch')), /網路連線失敗/);
  assert.equal(U.zhError('已取消更新'), '已取消更新');
});

test('background：有新版時圖示 badge 顯示「新」，沒有時清空', async () => {
  const U = await loadUpdater();
  const w = makeWorld();
  await installStubs(w, U);
  const bg = await import(url('extension/core/background.js'));
  w.calls.length = 0;
  await bg.checkNow({ force: true });
  assert.deepEqual(w.calls.filter((c) => c[0] === 'badge'), [['badge', '新']]);

  const w2 = makeWorld({ sameSha: true, localManifestVersion: '1.01' });
  await installStubs(w2, U);
  const bg2 = await import(url('extension/core/background.js'));
  w2.calls.length = 0;
  await bg2.checkNow({ force: true });
  assert.deepEqual(w2.calls.filter((c) => c[0] === 'badge'), [['badge', '']]);
});

test('background：距離上次檢查不到 5 分鐘就不再查', async () => {
  const U = await loadUpdater();
  const w = makeWorld();
  await installStubs(w, U);
  const bg = await import(url('extension/core/background.js'));
  w.calls.length = 0;
  await bg.checkNow();
  const first = w.calls.filter((c) => c[0] === 'fetch').length;
  assert.ok(first > 0);
  await bg.checkNow();
  assert.equal(w.calls.filter((c) => c[0] === 'fetch').length, first);
});

test('sidepanel opens site：按主按鈕用 chrome.tabs.create 開網站', async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__tabs = [];
      window.chrome = {
        runtime: { id: 'self', getManifest: () => ({ version: '1.00', name: '小編工具箱' }), getURL: (p) => 'local://' + p, reload() {} },
        tabs: { create: (o) => { window.__tabs.push(o); } },
        action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
        storage: { local: { get: async () => ({}), set: async () => {} } },
      };
      window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    });
    await page.goto('file://' + path.join(ROOT, 'extension/core/sidepanel.html'));
    await page.click('#openSite');
    assert.deepEqual(await page.evaluate(() => window.__tabs), [{ url: SITE }]);
    assert.equal(await page.textContent('#extVer'), 'v1.00');
    await page.waitForFunction(() => document.getElementById('updateCard').getAttribute('aria-busy') === 'false');
    assert.match(await page.textContent('#upStatus'), /網路連線失敗|連不上/);
    const h = await page.evaluate(() => getComputedStyle(document.getElementById('openSite')).height);
    assert.equal(h, '44px');
  } finally { await browser.close(); }
});

test('verOf：有 version_name 用它，否則用 version', async () => {
  const U = await loadUpdater();
  assert.equal(U.verOf({ version: '1.1', version_name: '1.01' }), '1.01');
  assert.equal(U.verOf({ version: '1.53' }), '1.53');
});

test('ensurePermission：已有權限直接 granted；Chrome 詢問不回應時 10 秒後回 timeout（不會一直卡住）；拒絕回 denied', async () => {
  const U = await loadUpdater();
  const dir = (query, request) => ({ queryPermission: async () => query, requestPermission: request });
  let prompted = 0;
  const onPrompt = () => { prompted++; };
  assert.equal(await U.ensurePermission(dir('granted', () => assert.fail('不該再問')), { onPrompt }), 'granted');
  assert.equal(prompted, 0);
  const t0 = Date.now();
  assert.equal(await U.ensurePermission(dir('prompt', () => new Promise(() => {})), { timeoutMs: 50, onPrompt }), 'timeout');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(prompted, 1);
  assert.equal(await U.ensurePermission(dir('prompt', async () => 'granted'), { onPrompt }), 'granted');
  assert.equal(await U.ensurePermission(dir('prompt', async () => 'denied'), { onPrompt }), 'denied');
  assert.equal(await U.ensurePermission(dir('prompt', async () => { throw new Error('x'); }), { onPrompt }), 'denied');
  assert.equal(prompted, 4);
});

test('sidepanel 更新：等 Chrome 給資料夾權限時顯示等待彈窗；拿不到就改請使用者重選資料夾，按鈕不會卡在灰色', async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.chrome = {
        runtime: { id: 'self', getManifest: () => ({ version: '1.00', name: '小編工具箱' }), getURL: (p) => 'local://' + p, reload() {} },
        tabs: { create: () => {} },
        action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
        storage: { local: { get: async () => ({}), set: async () => {} } },
      };
      window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      try { localStorage.setItem('tbx-sp-offered', 'abc'); } catch (e) { /* file:// */ }
    });
    await page.goto('file://' + path.join(ROOT, 'extension/core/sidepanel.html'));
    await page.waitForFunction(() => document.getElementById('updateCard').getAttribute('aria-busy') === 'false');
    await page.evaluate(() => {
      window.__titles = [];
      const dlg = document.getElementById('upDlgTitle');
      new MutationObserver(() => window.__titles.push(dlg.textContent)).observe(dlg, { childList: true, characterData: true, subtree: true });
      Updater.checkLatest = async () => ({ hasUpdate: true, sha: 'abc', date: '2026-11-19T00:00:00Z', message: 'm', version: '1.01', localVersion: '1.00', changed: [{ path: 'a.js', sha: 'x' }], notes: [] });
      Updater.hasSavedFolder = async () => true;
      // 模擬 Chrome 的詢問一直沒回應：要問之前呼叫 onPrompt，逾時後 getFolder 回 null
      Updater.getFolder = async (opts) => { opts.onPrompt(); await new Promise((r) => setTimeout(r, 100)); return null; };
    });
    await page.click('#tabInfo');
    await page.click('#upCheckBtn');
    await page.waitForSelector('#upApplyBtn:not([hidden])');
    await page.click('#upApplyBtn');
    await page.waitForFunction(() => document.getElementById('upDlgTitle').textContent === '重新選擇外掛資料夾');
    const titles = await page.evaluate(() => window.__titles);
    assert.ok(titles.includes('等待 Chrome 允許存取資料夾…'), JSON.stringify(titles));
    assert.ok(await page.isVisible('#upDlg'));
    // 取消 → 按鈕恢復可以按
    await page.click('#upDlgBtns button:has-text("取消")');
    await page.waitForFunction(() => !document.getElementById('upApplyBtn').disabled && !document.getElementById('upCheckBtn').disabled);
    assert.match(await page.textContent('#upStatus'), /已取消/);
  } finally { await browser.close(); }
});
