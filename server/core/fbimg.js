// 模組：排程有圖的暫存圖片網址（測試原因②：給臉書圖片網址，而不是直接上傳檔案）
// 圖片存在 R2（env.FILES，toolbox-files）的 tmp/fbimg/<32 位隨機碼>.<副檔名>，公開讀取 GET /fbimg/<檔名>（不用登入、網址猜不到）。
// 每天 03:17（UTC 19:17）cron 刪掉超過 24 小時的檔案，所以實際保留 1～2 天。不碰 assets/ 底下的公司素材。
// 掛點：fb.js 的 createPost（排程＋圖片檔）、index.js（路由與 cron）。拿掉＝刪本檔＋這幾個掛點。
const PREFIX = 'tmp/fbimg/';
const KEEP_MS = 24 * 3600 * 1000;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));
const NAME_RE = /^\/fbimg\/([0-9a-f]{32})\.(jpg|png|gif|webp)$/;

const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// 存一份暫存圖，回公開網址；沒綁 R2 或類型不支援就回 null（呼叫端改用直接上傳）
export async function putTempImage(env, origin, file) {
  if (!env || !env.FILES || !file) return null;
  const type = String(file.type || '').toLowerCase();
  const ext = EXT[type];
  if (!ext) return null;
  const name = randomHex() + '.' + ext;
  await env.FILES.put(PREFIX + name, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  return origin.replace(/\/+$/, '') + '/fbimg/' + name;
}

export async function handleFbImg(request, env, path) {
  const m = NAME_RE.exec(path);
  if (!m) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not found', { status: 404 });
  const obj = env && env.FILES ? await env.FILES.get(PREFIX + m[1] + '.' + m[2]) : null;
  if (!obj) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const headers = { 'content-type': TYPE[m[2]], 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' };
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}

// cron：刪掉超過 24 小時的暫存圖
export async function cleanupFbImg(env, nowMs) {
  if (!env || !env.FILES) return 0;
  let cursor, n = 0;
  do {
    const page = await env.FILES.list({ prefix: PREFIX, cursor, limit: 1000 });
    const old = (page.objects || []).filter((o) => o.uploaded && nowMs - new Date(o.uploaded).getTime() > KEEP_MS).map((o) => o.key);
    if (old.length) { await env.FILES.delete(old); n += old.length; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}
