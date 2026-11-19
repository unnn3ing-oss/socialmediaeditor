import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApiEnv, inExtension, API_ENV, API_BASE, PROD_API_BASE, API_ENV_KEY } from '../shell/config.js';
import { companyKey, COMPANY_KEY } from '../sdk/api.js';

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const site = { pathname: '/socialmediaeditor/', ancestorOrigins: [] };

test('沒切換過（或在 Node）＝正式後端', () => {
  assert.equal(API_ENV, 'prod');
  assert.equal(API_BASE, PROD_API_BASE);
  assert.equal(COMPANY_KEY, 'tbx.company');
  assert.equal(readApiEnv(store(), site), 'prod');
  assert.equal(readApiEnv(null, site), 'prod');
});

test('tbx.api=dev 才切測試；其他值都算正式', () => {
  assert.equal(API_ENV_KEY, 'tbx.api');
  assert.equal(readApiEnv(store({ 'tbx.api': 'dev' }), site), 'dev');
  assert.equal(readApiEnv(store({ 'tbx.api': 'https://evil.example' }), site), 'prod');
  assert.equal(readApiEnv(store({ 'tbx.api': 'DEV' }), site), 'prod');
});

test('storage 讀取丟錯＝正式', () => {
  assert.equal(readApiEnv({ getItem() { throw new Error('blocked'); } }, site), 'prod');
});

test('外掛側邊欄一律正式', () => {
  const dev = store({ 'tbx.api': 'dev' });
  assert.equal(inExtension({ pathname: '/socialmediaeditor/panel.html', ancestorOrigins: [] }), true);
  assert.equal(readApiEnv(dev, { pathname: '/socialmediaeditor/panel.html', ancestorOrigins: [] }), 'prod');
  assert.equal(readApiEnv(dev, { pathname: '/socialmediaeditor/tools/ytdl/index.html', ancestorOrigins: ['https://unnn3ing-oss.github.io', 'chrome-extension://abc'] }), 'prod');
  assert.equal(readApiEnv(dev, { pathname: '/socialmediaeditor/tools/ytdl/index.html', ancestorOrigins: ['https://unnn3ing-oss.github.io'] }), 'dev');
});

test('憑證 key 正式與測試分開', () => {
  assert.equal(companyKey('prod'), 'tbx.company');
  assert.equal(companyKey('dev'), 'tbx.company.dev');
});
