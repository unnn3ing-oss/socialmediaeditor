// 防 AI 解析（2026-11-26）：自報身分的 AI 爬蟲打後端一律 403；一般瀏覽器、臉書 Webhook 照常
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const load = async () => (await import('../../server/index.js')).default;
const call = async (path, ua) => {
  const w = await load();
  return w.fetch(new Request('https://api.test' + path, { headers: ua ? { 'user-agent': ua } : {} }), mkEnv(), { waitUntil() {} });
};

test('isAiBot：認得主流 AI 爬蟲，不誤擋一般瀏覽器與搜尋引擎', async () => {
  const { isAiBot } = await import('../../server/core/aibots.js');
  for (const ua of ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'Claude-User/1.0', 'ChatGPT-User/1.0',
    'PerplexityBot/1.0', 'CCBot/2.0 (https://commoncrawl.org/faq/)', 'Bytespider', 'meta-externalagent/1.1']) assert.ok(isAiBot(ua), ua);
  for (const ua of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Line/14.0',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'facebookexternalua', '', undefined]) assert.equal(isAiBot(ua), false, String(ua));
});

test('AI 爬蟲打任何路由＝403、不回內容；一般瀏覽器照常', async () => {
  const r = await call('/fb/open', 'Mozilla/5.0 (compatible; GPTBot/1.2)');
  assert.equal(r.status, 403);
  assert.equal(await r.text(), 'Forbidden');
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await call('/site/vis', 'ClaudeBot/1.0')).status, 403);
  assert.notEqual((await call('/site/vis', 'Mozilla/5.0 Chrome/130.0')).status, 403);
});

test('臉書 Webhook（/fbhook）不受影響', async () => {
  const q = '/fbhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1';
  const a = await call(q, 'meta-externalagent/1.1'), b = await call(q, 'facebookplatform/1.0');
  assert.equal(a.status, b.status, '和一般請求結果相同（交給 Webhook 自己驗證）');
  assert.equal(await a.text(), await b.text());
});
