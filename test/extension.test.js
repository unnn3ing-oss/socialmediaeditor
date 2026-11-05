// 外掛核心：固定 ID、橋接、背景路由（chrome.* 一律 stub）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const url = (rel) => 'file://' + path.join(ROOT, rel) + '?t=' + Math.random();
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/core/manifest.base.json'), 'utf8'));
const SITE = 'https://unnn3ing-oss.github.io';

function setGlobal(name, value) { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
function delGlobal(...names) { for (const n of names) delete globalThis[n]; }

test('固定 ID：由 key 算出的 ID 等於 EXT_ID，且為 32 個 a-p 字元', async () => {
  const { extensionIdFromKey, EXT_ID } = await import(url('extension/core/id.js'));
  assert.match(EXT_ID, /^[a-p]{32}$/);
  assert.equal(extensionIdFromKey(base.key), EXT_ID);
  assert.ok(fs.readFileSync(path.join(ROOT, 'docs/extension-id.md'), 'utf8').includes(EXT_ID));
});

test('manifest.base：欄位齊全且不含私鑰', () => {
  assert.equal(base.manifest_version, 3);
  assert.equal(base.name, '小編工具箱');
  assert.equal(base.background.service_worker, 'core/background.js');
  assert.deepEqual(base.content_scripts[0].js, ['core/bridge.js']);
  assert.equal(base.content_scripts[0].all_frames, true);
  assert.equal(base.side_panel.default_path, 'core/sidepanel.html');
  for (const s of [16, 32, 48, 128]) {
    assert.ok(fs.existsSync(path.join(ROOT, 'extension', base.icons[s])), `icon-${s}.png`);
  }
  assert.ok(!JSON.stringify(base).includes('PRIVATE KEY'));
});

test('build() 後 extension/manifest.json 的 key 與 base 相同', async () => {
  const { build } = require('../build.js');
  const r = await build(ROOT, { write: false });
  assert.deepEqual(r.errors, []);
  assert.equal(JSON.parse(r.outputs['extension/manifest.json']).key, base.key);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).key, base.key);
});

// ---- bridge ----
function setupBridge() {
  const listeners = [];
  const posted = [];
  const win = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    postMessage: (data, origin) => posted.push({ data, origin }),
  };
  const sent = [];
  let respond = (msg, cb) => cb({ ok: true, data: { echo: msg.op } });
  setGlobal('window', win);
  setGlobal('location', { origin: SITE });
  setGlobal('chrome', {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '1.00' }),
      sendMessage: (msg, cb) => { sent.push(msg); respond(msg, cb); },
    },
  });
  return { win, listeners, posted, sent, setRespond: (f) => { respond = f; } };
}

test('bridge：只接受 source=tbx-web 且來自同一個 window 的訊息', async () => {
  const h = setupBridge();
  try {
    await import(url('extension/core/bridge.js'));
    assert.equal(h.listeners.length, 1);
    const fire = (ev) => h.listeners[0](ev);
    const good = { source: 'tbx-web', nonce: 'n1', op: 'ping', payload: {} };
    fire({ source: {}, origin: SITE, data: good });                       // 來自其他 window
    fire({ source: h.win, origin: SITE, data: { ...good, source: 'x' } }); // source 錯
    fire({ source: h.win, origin: 'https://evil.example', data: good });   // origin 錯
    fire({ source: h.win, origin: SITE, data: { ...good, nonce: 5 } });    // 沒有 nonce
    assert.equal(h.sent.length, 0);
    fire({ source: h.win, origin: SITE, data: good });
    assert.deepEqual(h.sent, [{ op: 'ping', payload: {} }]);
  } finally { delGlobal('window', 'location', 'chrome'); }
});

test('bridge：回覆帶原 nonce 貼回', async () => {
  const h = setupBridge();
  try {
    await import(url('extension/core/bridge.js'));
    h.listeners[0]({ source: h.win, origin: SITE, data: { source: 'tbx-web', nonce: 'abc', op: 'ping' } });
    const reply = h.posted.find((p) => p.data.nonce === 'abc');
    assert.ok(reply);
    assert.equal(reply.data.source, 'tbx-ext');
    assert.equal(reply.data.ok, true);
    assert.equal(reply.origin, SITE);
  } finally { delGlobal('window', 'location', 'chrome'); }
});

test('bridge：背景出錯時回 ok:false 並帶 nonce', async () => {
  const h = setupBridge();
  try {
    await import(url('extension/core/bridge.js'));
    h.setRespond((msg, cb) => { chrome.runtime.lastError = { message: 'boom' }; cb(undefined); });
    h.listeners[0]({ source: h.win, origin: SITE, data: { source: 'tbx-web', nonce: 'z', op: 'ping' } });
    const reply = h.posted.find((p) => p.data.nonce === 'z');
    assert.equal(reply.data.ok, false);
    assert.equal(reply.data.source, 'tbx-ext');
  } finally { delGlobal('window', 'location', 'chrome'); }
});

// ---- background ----
function setupBackground() {
  const state = { onMessage: null, panelBehavior: null };
  const noop = () => {};
  setGlobal('chrome', {
    runtime: {
      id: 'self',
      getManifest: () => ({ version: '1.00', name: '小編工具箱' }),
      onMessage: { addListener: (fn) => { state.onMessage = fn; } },
      onInstalled: { addListener: noop },
      onStartup: { addListener: noop },
    },
    sidePanel: { setPanelBehavior: (o) => { state.panelBehavior = o; return Promise.resolve(); } },
    alarms: { get: (n, cb) => cb(undefined), create: noop, onAlarm: { addListener: noop } },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  });
  return state;
}

test('background：ping 回版本 1.00；點圖示開側邊欄', async () => {
  const st = setupBackground();
  try {
    const bg = await import(url('extension/core/background.js'));
    assert.deepEqual(await bg.handle({ op: 'ping' }), { ok: true, data: { version: '1.00' } });
    assert.deepEqual(st.panelBehavior, { openPanelOnActionClick: true });
    assert.equal(typeof st.onMessage, 'function');
  } finally { delGlobal('chrome'); }
});

test('background：未知 op 回 unknown_op', async () => {
  setupBackground();
  try {
    const bg = await import(url('extension/core/background.js'));
    const r = await bg.handle({ op: 'nope.nothing' });
    assert.deepEqual(r, { ok: false, code: 'unknown_op', error: '外掛不支援這個動作' });
    assert.equal((await bg.handle({})).code, 'unknown_op');
    assert.equal((await bg.handle({ op: 'toString' })).code, 'unknown_op');
  } finally { delGlobal('chrome'); }
});

test('background：只接受自己的內容腳本；onMessage 回傳非同步結果', async () => {
  const st = setupBackground();
  try {
    await import(url('extension/core/background.js'));
    assert.equal(st.onMessage({ op: 'ping' }, { id: 'other' }, () => {}), false);
    const got = await new Promise((resolve) => {
      const keep = st.onMessage({ op: 'ping' }, { id: 'self' }, resolve);
      assert.equal(keep, true);
    });
    assert.equal(got.ok, true);
  } finally { delGlobal('chrome'); }
});
