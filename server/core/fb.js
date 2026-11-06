// 臉書粉專模組：/fb/*（需公司憑證）、/admin/fb（需管理憑證）。
// 規格：docs/superpowers/specs/2026-11-05-toolbox-design.md 第 6 節「fb」。
// 原則：token 只在後端；網頁只能呼叫這裡寫好的動作，不能指定任意 Graph 路徑。
import { ok, fail, readBody, MESSAGES } from './http.js';
import { bearer } from './auth.js';
import { run } from './db.js';
import { pageTokens, graphGet, graphPost, GraphError, scrub, graphBase, rememberSecret } from './graph.js';

export const NEEDED_SCOPES = ['pages_show_list', 'pages_read_engagement', 'read_insights', 'pages_manage_posts'];
export const POST_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total'];
export const MAX_IMAGE = 10 * 1024 * 1024;
export const MAX_MESSAGE = 63206;
const MIN_SCHEDULE = 10 * 60, MAX_SCHEDULE = 30 * 86400;
const PAGES_TTL = 600, POSTS_TTL = 60, INSIGHTS_TTL = 600;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const nowSec = () => Math.floor(Date.now() / 1000);
const isId = (s) => typeof s === 'string' && /^\d{1,30}$/.test(s);
const isPostId = (s) => typeof s === 'string' && /^\d{1,30}_\d{1,30}$/.test(s);
const isHttpUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; } };

async function cacheGet(env, key) {
  if (!env.CACHE) return null;
  try { return await env.CACHE.get(key, 'json'); } catch (e) { return null; }
}
async function cachePut(env, key, value, ttl) {
  if (!env.CACHE) return;
  try { await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttl) }); } catch (e) { /* 快取失敗不影響結果 */ }
}
async function cacheDel(env, key) {
  if (!env.CACHE) return;
  try { await env.CACHE.delete(key); } catch (e) { /* 略過 */ }
}

function graphFail(request, env, e) {
  if (e instanceof GraphError) {
    const base = MESSAGES[e.code] || MESSAGES.fb_error;
    return fail(request, env, e.code, e.message && e.message !== base ? `${base}（${e.message}）` : base);
  }
  return fail(request, env, 'fb_error');
}

async function audit(env, code) {
  try { await run(env, 'INSERT INTO logs (at, tool, code, ver, ua) VALUES (?, ?, ?, ?, ?)', Date.now(), 'fb', code.slice(0, 60), null, null); }
  catch (e) { /* 記錄失敗不影響發文 */ }
}

// ---- token → 粉專 ----
// FB_TOKEN 每一組可以是「粉專 token」或「用戶 token」：
//   粉專 token：/me 就是粉專本身。
//   用戶 token：/me 回 code 100（User 沒有粉專欄位），改打 /me/accounts 換出各粉專 token。
// KV 只記粉專資料＋第幾組 token（idx）＋來源（via），不記任何 token；換出的粉專 token 只放記憶體。
const PAGE_FIELDS = 'id,name,link,picture{url},followers_count,fan_count';
const MEM_TTL_MS = 10 * 60 * 1000;
const ACCOUNTS_MAX_PAGES = 5;
const derivedMem = new Map();   // 用戶 token → { at, tokens: Map(粉專ID → 粉專 token) }

export function _resetFbMemory() { derivedMem.clear(); }

async function sha16(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 快取鍵跟著 FB_TOKEN 內容變：換 token 後不會讀到舊的對應
async function pagesKey(env) { return 'fb:pages:' + (await sha16(String(env.FB_TOKEN || ''))); }

const pageInfo = (me) => ({
  id: me.id, name: me.name || '', link: me.link || '',
  picture: (me.picture && me.picture.data && me.picture.data.url) || '',
  followers: Number.isFinite(me.followers_count) ? me.followers_count : (Number.isFinite(me.fan_count) ? me.fan_count : null)
});

// 用 after 游標翻頁（不跟 paging.next：那個網址裡有 token）；回 [{ ...粉專資料, tasks, token }]
async function fetchAccounts(env, userToken) {
  const out = [];
  let after = '';
  for (let n = 0; n < ACCOUNTS_MAX_PAGES; n++) {
    const r = await graphGet(env, userToken, '/me/accounts', { fields: PAGE_FIELDS + ',access_token,tasks', limit: 100, after });
    for (const a of r.data || []) {
      if (!isId(a.id) || typeof a.access_token !== 'string') continue;
      rememberSecret(a.access_token);
      out.push({ ...pageInfo(a), tasks: Array.isArray(a.tasks) ? a.tasks : [], token: a.access_token });
    }
    const cur = r.paging && r.paging.cursors && r.paging.cursors.after;
    if (!(r.paging && r.paging.next) || !cur || typeof cur !== 'string') break;
    after = cur;
  }
  derivedMem.set(userToken, { at: Date.now(), tokens: new Map(out.map((a) => [a.id, a.token])) });
  return out;
}

// 逐組掃描：回 { pages, info }。info[i] = { kind: 'page'|'user'|'invalid'|'error', pageIds, error }
export async function scanTokens(env) {
  const tokens = pageTokens(env);
  const info = tokens.map(() => ({ kind: 'error', pageIds: [], error: '' }));
  const direct = [], viaUser = [];
  let transient = false;
  for (let i = 0; i < tokens.length; i++) {
    try {
      const me = await graphGet(env, tokens[i], '/me', { fields: PAGE_FIELDS });
      if (isId(me.id)) { direct.push({ ...pageInfo(me), idx: i, via: 'page', tasks: null }); info[i] = { kind: 'page', pageIds: [me.id], error: '' }; }
      continue;
    } catch (e) {
      if (!(e instanceof GraphError) || e.code !== 'fb_bad_request') {
        info[i] = { kind: e instanceof GraphError && e.code === 'fb_token_invalid' ? 'invalid' : 'error', pageIds: [], error: e instanceof GraphError ? e.message : '' };
        if (!(e instanceof GraphError) || e.code !== 'fb_token_invalid') transient = true;
        continue;
      }
    }
    // code 100：當作用戶 token
    try {
      const acc = await fetchAccounts(env, tokens[i]);
      info[i] = { kind: 'user', pageIds: acc.map((a) => a.id), error: '' };
      for (const a of acc) viaUser.push({ ...pageInfo(a), idx: i, via: 'user', tasks: a.tasks });
    } catch (e) {
      info[i] = { kind: e instanceof GraphError && e.code === 'fb_token_invalid' ? 'invalid' : 'error', pageIds: [], error: e instanceof GraphError ? e.message : '' };
      if (!(e instanceof GraphError) || e.code !== 'fb_token_invalid') transient = true;
    }
  }
  // 同一個粉專：直接的粉專 token 優先，其次依 FB_TOKEN 順序
  const pages = [];
  for (const p of [...direct, ...viaUser]) if (!pages.some((x) => x.id === p.id)) pages.push(p);
  return { pages, info, transient };
}

export async function loadPages(env, { fresh = false } = {}) {
  const key = await pagesKey(env);
  if (!fresh) {
    const c = await cacheGet(env, key);
    if (c && Array.isArray(c.pages)) return c.pages;
  }
  const { pages, transient } = await scanTokens(env);
  if (!transient) await cachePut(env, key, { pages }, PAGES_TTL); // 暫時性失敗（限流、連不上）不快取
  return pages;
}

async function tokenFor(env, pageId) {
  const pages = await loadPages(env);
  const p = pages.find((x) => x.id === pageId);
  if (!p) return null;
  const t = pageTokens(env)[p.idx];
  if (!t) return null;
  if (p.via !== 'user') return t;
  const mem = derivedMem.get(t);
  if (mem && Date.now() - mem.at < MEM_TTL_MS && mem.tokens.has(pageId)) return mem.tokens.get(pageId);
  const acc = await fetchAccounts(env, t);
  const hit = acc.find((a) => a.id === pageId);
  return hit ? hit.token : null;   // 已不在授權清單 → fb_unknown_page
}

const publicPage = ({ id, name, link, picture, followers }) => ({ id, name, link, picture, followers });

// ---- 讀取 ----
async function listPosts(request, env, q) {
  const page = q.get('page');
  if (!isId(page)) return fail(request, env, 'bad_request', '缺少粉專 ID（page）。');
  const after = q.get('after') || '';
  if (after && !/^[A-Za-z0-9_=-]{1,500}$/.test(after)) return fail(request, env, 'bad_request');
  const n = Number(q.get('limit'));
  const limit = Number.isInteger(n) && n >= 1 && n <= 50 ? n : 20;
  const key = `fb:posts:${page}:${limit}:${after}`;
  const hit = await cacheGet(env, key);
  if (hit) return ok(request, env, hit);
  const token = await tokenFor(env, page);
  if (!token) return fail(request, env, 'fb_unknown_page');
  const r = await graphGet(env, token, `/${page}/published_posts`, {
    fields: 'id,message,created_time,permalink_url,full_picture,status_type,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)',
    limit, after
  });
  const data = {
    items: (r.data || []).map((p) => ({
      id: p.id, message: p.message || '', created: p.created_time || '', url: p.permalink_url || '',
      picture: p.full_picture || '', type: p.status_type || '',
      shares: (p.shares && p.shares.count) || 0,
      comments: (p.comments && p.comments.summary && p.comments.summary.total_count) || 0,
      reactions: (p.reactions && p.reactions.summary && p.reactions.summary.total_count) || 0
    })),
    next: (r.paging && r.paging.next && r.paging.cursors && r.paging.cursors.after) || null
  };
  await cachePut(env, key, data, POSTS_TTL);
  return ok(request, env, data);
}

async function listScheduled(request, env, q) {
  const page = q.get('page');
  if (!isId(page)) return fail(request, env, 'bad_request', '缺少粉專 ID（page）。');
  const token = await tokenFor(env, page);
  if (!token) return fail(request, env, 'fb_unknown_page');
  const r = await graphGet(env, token, `/${page}/scheduled_posts`, { fields: 'id,message,scheduled_publish_time,created_time,full_picture', limit: 50 });
  return ok(request, env, {
    items: (r.data || []).map((p) => ({
      id: p.id, message: p.message || '', created: p.created_time || '', picture: p.full_picture || '',
      at: typeof p.scheduled_publish_time === 'number' ? p.scheduled_publish_time : Number(p.scheduled_publish_time) || null
    }))
  });
}

// 成效：一次問全部指標；有指標被臉書停用（invalid metric）就逐一重問，能拿多少拿多少
async function insights(request, env, q) {
  const post = q.get('post');
  if (!isPostId(post)) return fail(request, env, 'bad_request', '貼文 ID 格式不正確（應為 粉專ID_貼文ID）。');
  const key = `fb:insights:${post}`;
  const hit = await cacheGet(env, key);
  if (hit) return ok(request, env, hit);
  const token = await tokenFor(env, post.split('_')[0]);
  if (!token) return fail(request, env, 'fb_unknown_page');
  const pick = (r) => {
    const out = {};
    for (const m of r.data || []) out[m.name] = m.values && m.values[0] ? m.values[0].value : null;
    return out;
  };
  let metrics = {};
  const missing = [];
  try {
    metrics = pick(await graphGet(env, token, `/${post}/insights`, { metric: POST_METRICS.join(',') }));
  } catch (e) {
    if (!(e instanceof GraphError) || e.code !== 'fb_bad_request') throw e;
    for (const m of POST_METRICS) {
      try { Object.assign(metrics, pick(await graphGet(env, token, `/${post}/insights`, { metric: m }))); }
      catch (e2) { if (e2 instanceof GraphError && e2.code === 'fb_bad_request') missing.push(m); else throw e2; }
    }
  }
  for (const m of POST_METRICS) if (!(m in metrics) && !missing.includes(m)) missing.push(m);
  const data = { post, metrics, missing };
  await cachePut(env, key, data, INSIGHTS_TTL);
  return ok(request, env, data);
}

// ---- 發文／排程 ----
// 本文可以是 JSON（page、message、link、imageUrl、scheduledAt）或 multipart（同欄位，另可附 image 檔）
async function readPostInput(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (ct.startsWith('application/json')) {
    const buf = await readBody(request, 128 * 1024);
    if (!buf) return { error: 'too_large' };
    try { const b = JSON.parse(new TextDecoder().decode(buf)); return { body: b && typeof b === 'object' ? b : {} }; }
    catch (e) { return { error: 'bad_request' }; }
  }
  if (ct.startsWith('multipart/form-data')) {
    const buf = await readBody(request, MAX_IMAGE + 256 * 1024);
    if (!buf) return { error: 'too_large' };
    let fd;
    try { fd = await new Response(buf, { headers: { 'content-type': request.headers.get('content-type') } }).formData(); }
    catch (e) { return { error: 'bad_request' }; }
    const body = {};
    for (const k of ['page', 'message', 'link', 'imageUrl', 'scheduledAt']) { const v = fd.get(k); if (typeof v === 'string') body[k] = v; }
    const img = fd.get('image');
    if (img && typeof img === 'object') body.image = img;
    return { body };
  }
  return { error: 'bad_request' };
}

export function checkPost(b, now = nowSec()) {
  const page = String(b.page || '');
  if (!isId(page)) return '缺少粉專 ID（page）。';
  const message = typeof b.message === 'string' ? b.message : '';
  if (message.length > MAX_MESSAGE) return '內文太長。';
  const link = typeof b.link === 'string' ? b.link.trim() : '';
  const imageUrl = typeof b.imageUrl === 'string' ? b.imageUrl.trim() : '';
  const image = b.image || null;
  if (link && !isHttpUrl(link)) return '連結格式不正確。';
  if (imageUrl && !/^https:\/\//.test(imageUrl)) return '圖片網址必須是 https。';
  if (imageUrl && !isHttpUrl(imageUrl)) return '圖片網址格式不正確。';
  if (image && imageUrl) return '圖片檔和圖片網址只能擇一。';
  if (link && (image || imageUrl)) return '連結和圖片只能擇一（連結可以寫在內文裡）。';
  if (image) {
    if (image.size > MAX_IMAGE) return '圖片超過 10 MB。';
    if (!IMAGE_TYPES.includes(String(image.type).toLowerCase())) return '圖片只支援 JPG、PNG、GIF、WebP。';
  }
  if (!message.trim() && !link && !image && !imageUrl) return '內文、連結、圖片至少要有一項。';
  let at = null;
  if (b.scheduledAt !== undefined && b.scheduledAt !== null && b.scheduledAt !== '') {
    at = Number(b.scheduledAt);
    if (!Number.isInteger(at)) return '排程時間格式不正確（Unix 秒數）。';
    if (at < now + MIN_SCHEDULE || at > now + MAX_SCHEDULE) return '排程時間要在 10 分鐘後到 30 天內。';
  }
  return { page, message, link, imageUrl, image, at };
}

async function createPost(request, env) {
  const { body, error } = await readPostInput(request);
  if (error) return fail(request, env, error);
  const v = checkPost(body);
  if (typeof v === 'string') return fail(request, env, 'bad_request', v);
  const token = await tokenFor(env, v.page);
  if (!token) return fail(request, env, 'fb_unknown_page');
  const sched = v.at ? { published: 'false', scheduled_publish_time: String(v.at) } : {};
  try {
    let r;
    if (v.image || v.imageUrl) {
      r = await graphPost(env, token, `/${v.page}/photos`, {
        caption: v.message, url: v.imageUrl || undefined,
        source: v.image ? [v.image, v.image.name || 'image'] : undefined, ...sched
      });
    } else {
      r = await graphPost(env, token, `/${v.page}/feed`, { message: v.message, link: v.link, ...sched });
    }
    await audit(env, v.at ? 'post-scheduled' : 'post-published');
    return ok(request, env, { id: r.post_id || r.id, scheduled: !!v.at, at: v.at });
  } catch (e) {
    await audit(env, 'post-failed-' + (e && e.fbCode ? e.fbCode : (e && e.code) || 'x'));
    throw e;
  }
}

export async function handleFb(request, env, path) {
  if (path !== '/fb' && !path.startsWith('/fb/')) return null;
  if (!(await bearer(request, env, 'company'))) return fail(request, env, 'unauthorized');
  if (!pageTokens(env).length) return fail(request, env, 'fb_not_configured');
  const q = new URL(request.url).searchParams;
  try {
    if (path === '/fb/pages' && request.method === 'GET') {
      return ok(request, env, (await loadPages(env, { fresh: q.get('refresh') === '1' })).map(publicPage));
    }
    if (path === '/fb/posts' && request.method === 'GET') return await listPosts(request, env, q);
    if (path === '/fb/scheduled' && request.method === 'GET') return await listScheduled(request, env, q);
    if (path === '/fb/insights' && request.method === 'GET') return await insights(request, env, q);
    if (path === '/fb/post' && request.method === 'POST') return await createPost(request, env);
  } catch (e) {
    if (e instanceof GraphError && e.code === 'fb_token_invalid') await cacheDel(env, await pagesKey(env));
    return graphFail(request, env, e);
  }
  return fail(request, env, 'not_found');
}

// ---- 管理頁：每組 token 的狀態（不回傳 token 值） ----
// GET /admin/fb（已通過 admin 驗證）
const pageRow = (p) => ({
  id: p.id, name: p.name,
  canPost: p.tasks === null || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE'),
  canInsights: p.tasks === null || p.tasks.includes('ANALYZE') || p.tasks.includes('MANAGE')
});

export async function adminFb(request, env, path) {
  if (path !== '/admin/fb' || request.method !== 'GET') return null;
  const tokens = pageTokens(env);
  const appToken = env.FB_APP_ID && env.FB_APP_SECRET ? `${env.FB_APP_ID}|${env.FB_APP_SECRET}` : null;
  const { pages, info, transient } = await scanTokens(env);
  if (!transient) await cachePut(env, await pagesKey(env), { pages }, PAGES_TTL);
  // 這組 token 能管的粉專（含被別組優先使用的，管理頁照實列出）
  const items = [];
  for (let i = 0; i < tokens.length; i++) {
    const inf = info[i];
    const mine = inf.pageIds.map((id) => {
      const used = pages.find((x) => x.id === id);
      return used && used.idx === i ? pageRow(used) : { id, name: (used && used.name) || id, canPost: true, canInsights: true, usedBy: used ? used.idx + 1 : null };
    });
    const item = {
      index: i + 1, kind: inf.kind, pages: mine, valid: inf.kind === 'page' || inf.kind === 'user', type: '',
      expiresAt: null, dataAccessExpiresAt: null, scopes: [], missingScopes: [], error: inf.error || ''
    };
    try {
      const r = await graphGet(env, appToken || tokens[i], '/debug_token', { input_token: tokens[i] });
      const d = r.data || {};
      item.valid = !!d.is_valid;
      item.type = d.type || '';
      item.expiresAt = Number.isFinite(d.expires_at) ? d.expires_at : null;            // 0 代表不會過期
      item.dataAccessExpiresAt = Number.isFinite(d.data_access_expires_at) && d.data_access_expires_at > 0 ? d.data_access_expires_at : null;
      item.scopes = Array.isArray(d.scopes) ? d.scopes : [];
      item.missingScopes = NEEDED_SCOPES.filter((s) => !item.scopes.includes(s));
      if (d.error && d.error.message) item.error = scrub(env, d.error.message);
    } catch (e) {
      if (!item.error) item.error = e instanceof GraphError ? e.message : scrub(env, e && e.message);
    }
    items.push(item);
  }
  return ok(request, env, {
    configured: tokens.length > 0, version: graphBase(env).split('/').pop(),
    appSecret: !!env.FB_APP_SECRET, needed: NEEDED_SCOPES, tokens: items
  });
}
