const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const GAS = 'https://script.google.com/macros/s/AKfy_test-123/exec';
let mod, tokenMod, rd;
const load = async () => (mod = mod || (await import('../../server/index.js')).default);
const loadToken = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const loadRd = async () => (rd = rd || (await import('../../server/core/rundown.js')));
const nowSec = () => Math.floor(Date.now() / 1000);
const env = (extra = {}) => mkEnv({ RUNDOWN_URL: GAS, RUNDOWN_TOKEN: 'rundown-token-123', ...extra });
async function companyToken(e) { const { signToken } = await loadToken(); return signToken(e.SESSION_SECRET, 'company', nowSec() + 600); }
async function call(body, e, auth = true) {
  const worker = await load();
  const headers = { origin: ORIGIN, 'content-type': 'text/plain' };
  if (auth) headers.authorization = 'Bearer ' + (await companyToken(e));
  return worker.fetch(new Request('https://api.test/rundown', { method: 'POST', headers, body: JSON.stringify(body) }), e, { waitUntil() {} });
}
// 替換 fetch，記下送去 Apps Script 的內容
function mockFetch(reply) {
  const orig = globalThis.fetch, sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return typeof reply === 'function' ? reply() : new Response(JSON.stringify(reply)); };
  return { sent, restore: () => { globalThis.fetch = orig; } };
}
const entry = (o = {}) => ({ page: 'news', date: '2026-11-07', time: '21:30', text: '4041548/圖文/颱風假', ...o });

test('rundownBody：只收 ping／add 與格式正確的 entries', async () => {
  const { rundownBody } = await loadRd();
  assert.deepEqual(rundownBody({ action: 'ping', x: 1 }), { action: 'ping' });
  assert.deepEqual(rundownBody({ action: 'add', entries: [entry(), entry({ page: 'intl', text: '/文字/新' })] }).entries.length, 2);
  for (const bad of [null, {}, { action: 'del' }, { action: 'add', entries: [] }, { action: 'add', entries: Array(11).fill(entry()) },
    { action: 'add', entries: [entry({ page: 'jkk' })] }, { action: 'add', entries: [entry({ date: '2026/11/07' })] },
    { action: 'add', entries: [entry({ time: '2130' })] }, { action: 'add', entries: [entry({ text: 'a\nb/圖文/c' })] },
    { action: 'add', entries: [entry({ text: '沒有類型' })] }, { action: 'add', entries: [entry({ text: '1/圖文/' + 'x'.repeat(100) })] }]) {
    assert.equal(rundownBody(bad), null, JSON.stringify(bad));
  }
});

test('沒有公司憑證 → 401', async () => {
  const res = await call({ action: 'ping' }, env(), false);
  assert.equal(res.status, 401);
});

test('沒設 RUNDOWN_URL／TOKEN → rundown_off', async () => {
  for (const e of [env({ RUNDOWN_URL: undefined }), env({ RUNDOWN_TOKEN: 'short' }), env({ RUNDOWN_URL: 'https://evil.test/exec' })]) {
    const body = await (await call({ action: 'ping' }, e)).json();
    assert.equal(body.code, 'rundown_off');
  }
});

test('格式不對 → bad_request，不會轉送', async () => {
  const m = mockFetch({ ok: true });
  try {
    const body = await (await call({ action: 'add', entries: [entry({ page: 'weather' })] }, env())).json();
    assert.equal(body.code, 'bad_request');
    assert.equal(m.sent.length, 0);
  } finally { m.restore(); }
});

test('add：補上金鑰轉給 Apps Script，回傳 results', async () => {
  const results = [{ ok: true, page: 'news', cell: '2026/11!AE255', time: '21:30', status: 'insert' }];
  const m = mockFetch({ ok: true, results });
  try {
    const body = await (await call({ action: 'add', entries: [entry()] }, env())).json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.results, results);
    assert.equal(m.sent[0].url, GAS);
    assert.deepEqual(m.sent[0].body, { token: 'rundown-token-123', action: 'add', entries: [entry()] });
  } finally { m.restore(); }
});

test('ping：回試算表名稱與分頁', async () => {
  const m = mockFetch({ ok: true, title: 'FB RUNDOWN', sheets: ['2026/11'] });
  try {
    const body = await (await call({ action: 'ping' }, env())).json();
    assert.deepEqual(body.data, { title: 'FB RUNDOWN', sheets: ['2026/11'] });
  } finally { m.restore(); }
});

test('Apps Script 回錯誤或不是 JSON → rundown_failed', async () => {
  let m = mockFetch({ ok: false, error: 'TOKEN 不對' });
  try { const b = await (await call({ action: 'ping' }, env())).json(); assert.equal(b.code, 'rundown_failed'); assert.match(b.error, /TOKEN 不對/); } finally { m.restore(); }
  m = mockFetch(() => new Response('<html>'));
  try { const b = await (await call({ action: 'ping' }, env())).json(); assert.equal(b.code, 'rundown_failed'); assert.match(b.error, /所有人/); } finally { m.restore(); }
});
