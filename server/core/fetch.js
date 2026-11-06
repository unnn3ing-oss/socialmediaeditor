import { ok, fail, corsHeaders } from './http.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL = 3600;
const DEFAULT_HOSTS = 'tvbs.com.tw';

const hostList = (env) => String(env.FETCH_HOSTS || DEFAULT_HOSTS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// 只允許 https、預設連接埠、沒有帳密，且網域等於或是白名單網域的子網域
export function parseAllowed(raw, env) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  return hostList(env).some((h) => host === h || host.endsWith('.' + h)) ? u : null;
}

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const l = e.toLowerCase();
    if (l[0] === '#') {
      const code = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      try { return String.fromCodePoint(code); } catch (err) { return m; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[l];
  });
}

export function parseMeta(html) {
  const meta = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
    const name = (attrs.property || attrs.name || '').toLowerCase();
    if (name && attrs.content !== undefined && !(name in meta)) meta[name] = decodeEntities(attrs.content).trim();
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return {
    title: meta['og:title'] || (t ? decodeEntities(t[1]).trim() : ''),
    image: meta['og:image'] || '',
    description: meta['og:description'] || meta.description || ''
  };
}

async function readText(res) {
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch (e) { /* 已讀完 */ }
  const buf = new Uint8Array(Math.min(total, MAX_BYTES));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, buf.length - off);
    buf.set(part, off);
    off += part.length;
    if (off >= buf.length) break;
  }
  let charset = 'utf-8';
  const m = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '');
  if (m) charset = m[1];
  try { return new TextDecoder(charset).decode(buf); } catch (e) { return new TextDecoder().decode(buf); }
}

// 手動跟隨轉址，每一跳都重新檢查白名單；回 { res, u } 或 { error }
async function follow(u, env, accept) {
  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await fetch(u.href, { redirect: 'manual', headers: { accept, 'user-agent': 'toolbox-api/1.0' } });
    } catch (e) { return { error: '讀取失敗。' }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop >= MAX_REDIRECTS) return { error: '轉址次數太多。' };
      let next;
      try { next = new URL(res.headers.get('location'), u); } catch (e) { return { error: '轉址網址不正確。' }; }
      u = parseAllowed(next.href, env);
      if (!u) return { error: '轉址到不允許的網址。' };
      continue;
    }
    return { res, u };
  }
}

// GET /fetch/image?url=：白名單網域的圖片代理（讓網頁能把文章主圖畫進 canvas 再匯出）
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
async function readCapped(res, max) {
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch (e) { /* 忽略 */ } return null; }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return buf;
}

async function handleImage(request, env) {
  const raw = new URL(request.url).searchParams.get('url') || '';
  if (raw.length > 1000) return fail(request, env, 'bad_request');
  const start = parseAllowed(raw, env);
  if (!start) return fail(request, env, 'bad_request', '只能讀取白名單內的 https 網址。');
  const r = await follow(start, env, 'image/jpeg,image/png,image/gif,image/webp');
  if (r.error) return fail(request, env, 'bad_request', r.error);
  if (!r.res.ok) return fail(request, env, 'bad_request', '圖片讀取失敗（' + r.res.status + '）。');
  const type = (r.res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) return fail(request, env, 'bad_request', '只支援 JPG、PNG、GIF、WebP 圖片。');
  const len = Number(r.res.headers.get('content-length'));
  if (len > MAX_IMAGE_BYTES) return fail(request, env, 'too_large');
  const buf = await readCapped(r.res, MAX_IMAGE_BYTES);
  if (!buf) return fail(request, env, 'too_large');
  return new Response(buf, { status: 200, headers: { ...corsHeaders(request, env), 'content-type': type, 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' } });
}

// GET /fetch/article?url=：白名單網域的文章 HTML（只收 text/html、≤2 MB；給前端自己解析標題與內文）
async function handleArticle(request, env) {
  const raw = new URL(request.url).searchParams.get('url') || '';
  if (raw.length > 1000) return fail(request, env, 'bad_request');
  const start = parseAllowed(raw, env);
  if (!start) return fail(request, env, 'bad_request', '只能讀取白名單內的 https 網址。');
  const r = await follow(start, env, 'text/html,application/xhtml+xml');
  if (r.error) return fail(request, env, 'bad_request', r.error);
  if (!r.res.ok) return fail(request, env, 'bad_request', '網頁讀取失敗（' + r.res.status + '）。');
  const type = (r.res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'text/html') return fail(request, env, 'bad_request', '只支援 HTML 網頁。');
  if (Number(r.res.headers.get('content-length')) > MAX_BYTES) return fail(request, env, 'too_large');
  const buf = await readCapped(r.res, MAX_BYTES);
  if (!buf) return fail(request, env, 'too_large');
  return ok(request, env, { url: r.u.href, html: new TextDecoder('utf-8').decode(buf) });
}

export async function handleFetch(request, env, path) {
  if (path === '/fetch/article' && request.method === 'GET') return handleArticle(request, env);
  if (path === '/fetch/image' && request.method === 'GET') return handleImage(request, env);
  if (path !== '/fetch' || request.method !== 'GET') return null;
  const raw = new URL(request.url).searchParams.get('url') || '';
  if (raw.length > 500) return fail(request, env, 'bad_request');
  const start = parseAllowed(raw, env);
  if (!start) return fail(request, env, 'bad_request', '只能讀取白名單內的 https 網址。');

  const cacheKey = 'fetch:' + raw;
  if (env.CACHE) {
    const hit = await env.CACHE.get(cacheKey);
    if (hit) { try { return ok(request, env, JSON.parse(hit)); } catch (e) { /* 壞掉的快取，重抓 */ } }
  }

  const r = await follow(start, env, 'text/html,application/xhtml+xml');
  if (r.error) return fail(request, env, 'bad_request', r.error === '讀取失敗。' ? '讀取網頁失敗。' : r.error);
  const { res, u } = r;
  if (!res.ok) return fail(request, env, 'bad_request', '網頁讀取失敗（' + res.status + '）。');

  const meta = parseMeta(await readText(res));
  let image = '';
  if (meta.image) {
    try { const iu = new URL(meta.image, u); if (iu.protocol === 'https:' || iu.protocol === 'http:') image = iu.href; } catch (e) { /* 不是網址 */ }
  }
  const data = { url: raw, title: meta.title, image, description: meta.description };
  if (env.CACHE) await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL });
  return ok(request, env, data);
}
