const test = require('node:test');
const assert = require('node:assert/strict');

function fakeWindow() {
  const listeners = new Set();
  const posted = [];
  return {
    posted,
    addEventListener: (t, fn) => { if (t === 'message') listeners.add(fn); },
    removeEventListener: (t, fn) => { listeners.delete(fn); },
    postMessage: (m) => { posted.push(m); },
    dispatch: (data) => { for (const fn of [...listeners]) fn({ data }); },
    count: () => listeners.size,
  };
}
function fakeTimers() {
  const t = { pending: [], cleared: 0 };
  t.set = (fn, ms) => { t.pending.push({ fn, ms }); return t.pending.length - 1; };
  t.clear = () => { t.cleared++; };
  return t;
}
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), raw: m };
}
const jsonRes = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });

test('resolveAsset picks company, upload and public', async () => {
  const { resolveAsset } = await import('../sdk/assets.js');
  assert.deepEqual(resolveAsset({ company: 'tvbs-logo', public: 'upload' }, { company: true }), { source: 'company', key: 'tvbs-logo' });
  assert.deepEqual(resolveAsset({ company: 'tvbs-logo', public: 'upload' }, { company: false }), { source: 'upload' });
  assert.deepEqual(resolveAsset({ public: 'frame.svg' }, { company: true }), { source: 'public', path: 'frame.svg' });
  assert.equal(resolveAsset({ public: null }, { company: false }), null);
});

test('makeRequest shape', async () => {
  const { makeRequest } = await import('../sdk/bridge.js');
  assert.deepEqual(makeRequest('ping', { a: 1 }, 'n1'), { source: 'tbx-web', nonce: 'n1', op: 'ping', payload: { a: 1 } });
});

test('ext.call rejects with no_extension', async () => {
  const { createExt } = await import('../sdk/bridge.js');
  const win = fakeWindow();
  const timers = fakeTimers();
  const ext = createExt({ win, timers, nonce: () => 'n1' });
  const p = ext.call('ping', {}, { timeout: 3000 });
  assert.equal(timers.pending[0].ms, 3000);
  timers.pending[0].fn();
  await assert.rejects(p, (e) => e.code === 'no_extension' && e.message === '未偵測到外掛');
  assert.equal(win.count(), 0);
});

test('ext.call resolves matching nonce only', async () => {
  const { createExt } = await import('../sdk/bridge.js');
  const win = fakeWindow();
  const ext = createExt({ win, timers: fakeTimers(), nonce: () => 'n1' });
  const p = ext.call('ping', {});
  assert.equal(win.posted[0].nonce, 'n1');
  win.dispatch({ source: 'tbx-ext', nonce: 'other', ok: true, data: 'wrong' });
  win.dispatch({ source: 'tbx-web', nonce: 'n1', ok: true, data: 'echo' });
  win.dispatch({ source: 'tbx-ext', nonce: 'n1', ok: true, data: 'right' });
  assert.equal(await p, 'right');
});

test('ext.call rejects with code on ok:false', async () => {
  const { createExt } = await import('../sdk/bridge.js');
  const win = fakeWindow();
  const ext = createExt({ win, timers: fakeTimers(), nonce: () => 'n1' });
  const p = ext.call('x', {});
  win.dispatch({ source: 'tbx-ext', nonce: 'n1', ok: false, code: 'denied', error: '不行' });
  await assert.rejects(p, (e) => e.code === 'denied' && e.message === '不行');
});

test('api.call sends Bearer, skips expired token, saves renew', async () => {
  const { createApi } = await import('../sdk/api.js');
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push([url, init]);
    return jsonRes({ ok: true, data: { hello: 1, renew: { token: 'T2', exp: 9999999999 } } });
  };
  const storage = fakeStorage({ 'tbx.company': JSON.stringify({ token: 'T1', exp: 2000000000 }) });
  const api = createApi({ fetchFn, storage, base: 'https://x', now: () => 1_000_000_000_000 });
  const data = await api.call('/auth/status');
  assert.equal(data.hello, 1);
  assert.equal(calls[0][0], 'https://x/auth/status');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer T1');
  assert.deepEqual(JSON.parse(storage.getItem('tbx.company')), { token: 'T2', exp: 9999999999 });

  const expired = fakeStorage({ 'tbx.company': JSON.stringify({ token: 'OLD', exp: 1000 }) });
  const api2 = createApi({ fetchFn, storage: expired, base: 'https://x', now: () => 1_000_000_000_000 });
  await api2.call('/y');
  assert.equal(calls[1][1].headers.Authorization, undefined);
});

test('api.call rejects with code when ok:false', async () => {
  const { createApi } = await import('../sdk/api.js');
  const api = createApi({ fetchFn: async () => jsonRes({ ok: false, code: 'unauthorized', error: '請登入' }, 401), storage: fakeStorage(), base: 'https://x' });
  await assert.rejects(api.call('/z', { method: 'POST', body: { a: 1 } }), (e) => e.code === 'unauthorized');
});

test('assets.get: public url, upload, company with fallback', async () => {
  const { createAssets } = await import('../sdk/assets.js');
  const specs = {
    frame: { public: 'frame.svg' },
    pic: { public: 'upload' },
    logo: { company: 'tvbs-logo', public: 'upload' },
  };
  let company = true;
  let fail = false;
  const api = { call: async (path) => { if (fail) throw new Error('x'); return { blob: async () => 'BLOB:' + path }; } };
  const a = createAssets({ api, getSpec: async (k) => specs[k], isCompany: () => company, base: 'https://s/tools/t/index.html', createObjectURL: (b) => 'blob:' + b });
  assert.deepEqual(await a.get('frame'), { url: 'https://s/tools/t/frame.svg' });
  assert.deepEqual(await a.get('pic'), { upload: true });
  assert.deepEqual(await a.get('logo'), { url: 'blob:BLOB:/assets/tvbs-logo' });
  fail = true;
  assert.deepEqual(await a.get('logo'), { upload: true });
  assert.equal(await a.get('nope'), null);
});

test('status standalone returns warn; with shell delegates', async () => {
  const { createStatus } = await import('../sdk/status.js');
  const alone = createStatus({ getShell: () => null });
  assert.deepEqual(alone.get('extension'), { state: 'warn', text: '請從小編工具箱開啟' });
  assert.equal(typeof alone.on(() => {}), 'function');
  const shell = { getStatus: (id) => ({ state: 'ok', text: id }), onStatus: () => () => 'off' };
  const s = createStatus({ getShell: () => shell });
  assert.deepEqual(s.get('extension'), { state: 'ok', text: 'extension' });
});
