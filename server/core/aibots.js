// 防 AI 解析（2026-11-26）：依 User-Agent 拒絕已知的 AI 爬蟲／AI 代讀工具（403、不回內容）。
// 只擋「自報身分」的 AI；假冒一般瀏覽器的擋不到。臉書 Webhook（/fbhook）不經過這裡的判斷。
// 名單：各家公開的 AI 爬蟲名稱（訓練、搜尋、使用者叫 AI 代讀）。不含一般搜尋引擎（Googlebot、bingbot）。
export const AI_BOTS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'Claude-Web', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User',
  'Google-CloudVertexBot', 'GoogleOther', 'Gemini-Deep-Research',
  'CCBot', 'Bytespider', 'Amazonbot', 'Applebot',
  'meta-externalagent', 'meta-externalfetcher', 'FacebookBot',
  'cohere-ai', 'cohere-training-data-crawler', 'Diffbot', 'YouBot', 'DuckAssistBot',
  'MistralAI-User', 'Timpibot', 'ImagesiftBot', 'omgili', 'omgilibot', 'Kangaroo Bot',
  'PetalBot', 'AI2Bot', 'Ai2Bot-Dolma', 'Scrapy', 'img2dataset', 'Webzio-Extended', 'iaskspider'
];
const RE = new RegExp('(' + AI_BOTS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i');

export const isAiBot = (ua) => typeof ua === 'string' && RE.test(ua);

// 是 AI 爬蟲就回 403，不是回 null
export function blockAiBot(request, path) {
  if (path === '/fbhook') return null;   // 臉書 Webhook 照常（Meta 推播不是 AI 爬蟲，保險起見完全不擋）
  if (!isAiBot(request.headers.get('user-agent'))) return null;
  return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noai' } });
}
