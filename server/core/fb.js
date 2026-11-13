// 臉書粉專模組：/fb/*（需公司憑證）、/admin/fb（需管理憑證）。
// 規格：docs/superpowers/specs/2026-11-05-toolbox-design.md 第 6 節「fb」。
// 原則：token 只在後端；網頁只能呼叫這裡寫好的動作，不能指定任意 Graph 路徑。
import { ok, fail, readBody, MESSAGES } from './http.js';
import { bearer } from './auth.js';
import { run, all } from './db.js';
import { MAX_COMMENTS, EXTRA_DELAY_MIN, EXTRA_DELAY_MAX, MAX_PRESETS, PRESET_NAME_MAX, listPresets, savePresets, ensureTables, enqueueComment, cancelForPost, rescheduleComments, commentsForPosts, extraCommentsForPosts, listComments, retryComment, dismissComment, kickHub, photoToPost } from './fbqueue.js';
import { pageTokens, graphGet, graphPost, graphDelete, GraphError, scrub, graphBase, rememberSecret } from './graph.js';

export const NEEDED_SCOPES = ['pages_show_list', 'pages_read_engagement', 'read_insights', 'pages_manage_posts', 'pages_manage_engagement'];
export const POST_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total'];
export const MAX_IMAGE = 10 * 1024 * 1024;
export const MAX_MESSAGE = 63206;
const MAX_COMMENT = 8000;
const MIN_SCHEDULE = 10 * 60, MAX_SCHEDULE = 30 * 86400;
const PAGES_TTL = 600, POSTS_TTL = 60, INSIGHTS_TTL = 600;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const isPreset = (s) => typeof s === 'string' && /^\d{5,20}$/.test(s);

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
  return out;
}

// 整組 token 失敗（不快取、下次重問）：token 失效、限流、連不上、臉書暫時錯誤（code 1／2，或 5xx 沒有錯誤代碼）。
// 其餘（單一粉專沒權限、物件不存在 803 等會一直出現的錯誤）只略過那一項，免得一個粉專拖垮整份清單。
const isFatal = (e) => !(e instanceof GraphError)
  || ['fb_token_invalid', 'fb_rate_limited', 'fb_unreachable'].includes(e.code)
  || (e.code === 'fb_error' && (e.fbCode === 1 || e.fbCode === 2 || e.fbCode === null));

// 用戶 token 授權了哪些粉專（debug_token 的 granular_scopes）。
// 回 { ok, ids, post, insights }：post／insights 是有該權限的粉專 ID Set，null 代表沒限定粉專（全部）。
async function grantedTargets(env, userToken) {
  const appToken = env.FB_APP_ID && env.FB_APP_SECRET ? `${env.FB_APP_ID}|${env.FB_APP_SECRET}` : null;
  let d;
  try { d = ((await graphGet(env, appToken || userToken, '/debug_token', { input_token: userToken })) || {}).data || {}; }
  catch (e) { if (isFatal(e)) throw e; return { ok: false, ids: [], post: null, insights: null }; }
  const gs = Array.isArray(d.granular_scopes) ? d.granular_scopes : [];
  const idsOf = (scope) => {
    const g = gs.find((x) => x && x.scope === scope);
    return g && Array.isArray(g.target_ids) ? g.target_ids.map(String).filter(isId) : null;
  };
  const ids = new Set();
  for (const g of gs) {
    if (!g || !Array.isArray(g.target_ids) || !(String(g.scope).startsWith('pages_') || g.scope === 'read_insights')) continue;
    for (const id of g.target_ids.map(String)) if (isId(id)) ids.add(id);
  }
  const post = idsOf('pages_manage_posts'), insights = idsOf('read_insights');
  return { ok: !!gs.length, ids: [...ids], post: post && new Set(post), insights: insights && new Set(insights) };
}

// 用戶 token → 各粉專資料與粉專 token（/me/accounts ＋ 授權範圍裡的粉專 ID，聯集）。
// 換出的 token 一律先 rememberSecret 再做別的事；只存在記憶體。
// 回 { pages: [{ ...粉專資料, tasks, perm, token }], hint: ''|'debug_failed'|'no_targets', skipped: 換不到 token 的粉專數 }
async function derivePages(env, userToken) {
  const acc = await fetchAccounts(env, userToken);
  const g = await grantedTargets(env, userToken);
  const pages = acc.map((a) => ({ ...a }));
  let skipped = 0;
  for (const id of g.ids) {
    if (pages.some((p) => p.id === id)) continue;
    try {
      const me = await graphGet(env, userToken, `/${id}`, { fields: PAGE_FIELDS + ',access_token' });
      if (typeof me.access_token !== 'string') { skipped++; continue; }
      rememberSecret(me.access_token);
      if (!isId(me.id)) { skipped++; continue; }
      pages.push({ ...pageInfo(me), tasks: null, token: me.access_token });
    } catch (e) { if (isFatal(e)) throw e; skipped++; }
  }
  for (const p of pages) p.perm = { post: g.post ? g.post.has(p.id) : null, insights: g.insights ? g.insights.has(p.id) : null };
  derivedMem.set(userToken, { at: Date.now(), tokens: new Map(pages.map((p) => [p.id, p.token])) });
  const hint = pages.length ? '' : (!g.ok ? 'debug_failed' : 'no_targets');
  return { pages, hint, skipped };
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
      const { pages: acc, hint, skipped } = await derivePages(env, tokens[i]);
      info[i] = { kind: 'user', pageIds: acc.map((a) => a.id), error: '', hint, skipped };
      for (const a of acc) viaUser.push({ ...pageInfo(a), idx: i, via: 'user', tasks: a.tasks, perm: a.perm });
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

export async function tokenFor(env, pageId) {
  const pages = await loadPages(env);
  const p = pages.find((x) => x.id === pageId);
  if (!p) return null;
  const t = pageTokens(env)[p.idx];
  if (!t) return null;
  if (p.via !== 'user') return t;
  const mem = derivedMem.get(t);
  if (mem && Date.now() - mem.at < MEM_TTL_MS && mem.tokens.has(pageId)) return mem.tokens.get(pageId);
  const { pages: acc } = await derivePages(env, t);
  const hit = acc.find((a) => a.id === pageId);
  return hit ? hit.token : null;   // 已不在授權範圍 → fb_unknown_page
}

// ---- 粉專對應表（D1 fb_page_map；沒有列就用預設，依粉專名稱比對） ----
const normName = (s) => String(s || '').replace(/\s+/g, '').replace(/＋/g, '+').toLowerCase();
export const DEFAULT_PAGEMAP = [
  { code: 'news', label: '新聞', name: 'TVBS新聞', utm: 'utm_source=facebook&utm_medium=fbarticlepic' },
  { code: 'ent', label: '娛樂', name: 'TVBS娛樂', utm: 'utm_source=facebook&utm_medium=tvbsteatimenewspic' },
  { code: 'shaokang', label: '少康', name: '少康戰情室', utm: 'utm_source=facebook&utm_medium=2100roompic' },
  { code: 'jkk', label: '擠看看', name: '擠看看', utm: 'utm_source=facebook&utm_medium=gkkcomments' },
  { code: 'intl', label: '國際＋', name: 'TVBS國際+', utm: 'utm_source=facebook&utm_medium=tvbspluspic' },
  { code: 'weather', label: '氣象', name: 'TVBS氣象', utm: 'utm_source=Facebook&utm_medium=18weather' }
].map((d, i) => ({ ...d, sort: i + 1, key: normName(d.name) }));

function defaultMap(name) {
  const d = DEFAULT_PAGEMAP.find((x) => x.key === normName(name));
  return d ? { code: d.code, label: d.label, utm: d.utm, sort: d.sort } : { code: '', label: name, utm: '', sort: 100 };
}
async function pageMapRows(env) {
  const m = new Map();
  if (!env.DB) return m;
  try {
    await ensureTables(env);
    for (const r of await all(env, 'SELECT page_id, code, label, utm, sort FROM fb_page_map')) m.set(r.page_id, r);
  } catch (e) { /* D1 壞了就用預設，不能讓 /fb/pages 壞掉 */ }
  return m;
}
// 回 { code, label, utm, sort, saved }
const mapFor = (rows, p) => {
  const r = rows.get(p.id);
  return r ? { code: r.code || '', label: r.label || p.name, utm: r.utm || '', sort: Number.isInteger(r.sort) ? r.sort : 100, saved: true } : { ...defaultMap(p.name), saved: false };
};

const publicPage = ({ id, name, link, picture, followers }) => ({ id, name, link, picture, followers });
async function pagesWithMap(env, pages) {
  const rows = await pageMapRows(env);
  return pages.map((p) => { const m = mapFor(rows, p); return { ...publicPage(p), code: m.code, label: m.label, utm: m.utm, sort: m.sort }; })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));
}

// 管理頁：GET /admin/fb/pagemap、POST /admin/fb/pagemap（已通過 admin 驗證）
const UTM_RE = /^\??[A-Za-z0-9_.~=&%+-]*$/;
export async function adminPageMap(request, env, path) {
  if (path !== '/admin/fb/pagemap') return null;
  if (request.method === 'GET') {
    let pages = [];
    try { pages = await loadPages(env); } catch (e) { pages = []; }
    const rows = await pageMapRows(env);
    const items = pages.map((p) => { const m = mapFor(rows, p); return { id: p.id, name: p.name, code: m.code, label: m.label, utm: m.utm, sort: m.sort, saved: m.saved }; })
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));
    return ok(request, env, { items });
  }
  if (request.method !== 'POST') return null;
  const buf = await readBody(request, 64 * 1024);
  if (!buf) return fail(request, env, 'too_large');
  let b;
  try { b = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return fail(request, env, 'bad_request'); }
  const list = b && Array.isArray(b.items) ? b.items : null;
  if (!list || list.length > 100) return fail(request, env, 'bad_request', '資料格式不正確。');
  const clean = [];
  for (const it of list) {
    const id = it && typeof it.id === 'string' ? it.id : '';
    const label = it && typeof it.label === 'string' ? it.label.trim() : '';
    const utm = it && typeof it.utm === 'string' ? it.utm.trim() : '';
    const sort = it ? Number(it.sort) : NaN;
    if (!isId(id)) return fail(request, env, 'bad_request', '粉專 ID 格式不正確。');
    if (label.length < 1 || label.length > 20) return fail(request, env, 'bad_request', '簡稱要 1 到 20 個字。');
    if (utm.length > 300 || !UTM_RE.test(utm)) return fail(request, env, 'bad_request', 'utm 可用 ? 開頭，內容只能用英數字與 _ . ~ = & % + - ，最長 300 字。');
    if (!Number.isInteger(sort) || sort < 0 || sort > 999) return fail(request, env, 'bad_request', '排序要是 0 到 999 的整數。');
    clean.push({ id, label, utm, sort });
  }
  if (!env.DB) return fail(request, env, 'misconfigured');
  await ensureTables(env);
  const now = Date.now();
  const old = await pageMapRows(env);
  let pages = [];
  try { pages = await loadPages(env); } catch (e) { pages = []; }
  for (const c of clean) {
    const name = (pages.find((p) => p.id === c.id) || {}).name || '';
    const code = old.has(c.id) ? old.get(c.id).code || '' : defaultMap(name).code;
    await run(env, `INSERT INTO fb_page_map (page_id, code, label, utm, sort, updated) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET label=excluded.label, utm=excluded.utm, sort=excluded.sort, updated=excluded.updated`, c.id, code, c.label, c.utm, c.sort, now);
  }
  return ok(request, env, { saved: clean.length });
}

// 管理頁：第 N 則留言預設文字。GET／POST /admin/fb/comment-presets（已通過 admin 驗證）；整份取代，順序＝下拉順序
export function checkPresets(list) {
  if (!Array.isArray(list)) return '資料格式不正確。';
  if (list.length > MAX_PRESETS) return `最多 ${MAX_PRESETS} 筆。`;
  const seen = new Set(), clean = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || typeof it.name !== 'string' || typeof it.text !== 'string') return '資料格式不正確。';
    const name = it.name.trim(), text = it.text.trim();
    if (!name && !text) continue;   // 整列空白略過
    if (!name || name.length > PRESET_NAME_MAX) return `名稱要 1 到 ${PRESET_NAME_MAX} 個字。`;
    if (!text) return `「${name}」沒有內容。`;
    if (text.length > MAX_COMMENT) return `「${name}」內容太長（上限 ${MAX_COMMENT} 字）。`;
    if (seen.has(name)) return `名稱「${name}」重複了。`;
    seen.add(name);
    clean.push({ name, text });
  }
  return clean;
}
export async function adminCommentPresets(request, env, path) {
  if (path !== '/admin/fb/comment-presets') return null;
  if (!env.DB) return fail(request, env, 'misconfigured');
  if (request.method === 'GET') return ok(request, env, { items: await listPresets(env), max: MAX_PRESETS, nameMax: PRESET_NAME_MAX, textMax: MAX_COMMENT });
  if (request.method !== 'POST') return null;
  const buf = await readBody(request, 700 * 1024);
  if (!buf) return fail(request, env, 'too_large');
  let b;
  try { b = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return fail(request, env, 'bad_request'); }
  const clean = checkPresets(b && b.items);
  if (typeof clean === 'string') return fail(request, env, 'bad_request', clean);
  await savePresets(env, clean);
  return ok(request, env, { saved: clean.length });
}

// ---- 讀取 ----
async function listPosts(request, env, q) {
  const page = q.get('page');
  if (!isId(page)) return fail(request, env, 'bad_request', '缺少粉專 ID（page）。');
  const after = q.get('after') || '';
  // 臉書的翻頁游標可能很長、含 % 或 .（舊版只收 500 字內英數，第二頁會被擋）
  if (after && !/^[A-Za-z0-9_=%.-]{1,2000}$/.test(after)) return fail(request, env, 'bad_request');
  const n = Number(q.get('limit'));
  const limit = Number.isInteger(n) && n >= 1 && n <= 50 ? n : 20;
  const key = `fb:posts:${page}:${limit}:${after ? await sha16(after) : ''}`; // KV 鍵上限 512 bytes
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
  let cm = new Map();
  let ex = new Map();
  const ids = (r.data || []).map((p) => p.id).filter(isPostId);
  try { cm = env.DB ? await commentsForPosts(env, ids) : cm; } catch (e) { /* 留言狀態讀不到不影響清單 */ }
  try { ex = env.DB ? await extraCommentsForPosts(env, ids) : ex; } catch (e) { /* 同上 */ }
  return ok(request, env, {
    items: (r.data || []).map((p) => {
      const c = cm.get(p.id);
      return {
        id: p.id, message: p.message || '', created: p.created_time || '', picture: p.full_picture || '',
        at: typeof p.scheduled_publish_time === 'number' ? p.scheduled_publish_time : Number(p.scheduled_publish_time) || null,
        comment: c ? { id: c.id, status: c.status, error: c.error, message: c.message } : null,
        extras: ex.get(p.id) || []
      };
    })
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
    for (const k of ['page', 'message', 'link', 'imageUrl', 'scheduledAt', 'textPreset', 'comment', 'extraComments']) { const v = fd.get(k); if (typeof v === 'string') body[k] = v; }
    const img = fd.get('image');
    if (img && typeof img === 'object') body.image = img;
    return { body };
  }
  return { error: 'bad_request' };
}

// 第 2 則以後的留言：[{ message, delay(發布後幾分鐘) }]。純文字、不自動帶連結；空白的略過。回陣列（含 seq、delay 秒）或錯誤字串
export function parseExtras(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch (e) { return '額外留言格式不正確。'; } }
  if (!Array.isArray(list)) return '額外留言格式不正確。';
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || (it.message !== undefined && typeof it.message !== 'string')) return '額外留言格式不正確。';
    const message = String(it.message || '').trim();
    if (!message) continue;
    if (message.length > MAX_COMMENT) return '留言太長（上限 8000 字）。';
    const minutes = Number(it.delay);
    if (!Number.isInteger(minutes) || minutes < EXTRA_DELAY_MIN || minutes > EXTRA_DELAY_MAX) return `第 N 則留言要在發布後 ${EXTRA_DELAY_MIN}～${EXTRA_DELAY_MAX} 分鐘內。`;
    out.push({ message, delay: minutes * 60 });
  }
  if (out.length > MAX_COMMENTS - 1) return `留言最多 ${MAX_COMMENTS} 則（含第一則）。`;
  return out.map((x, i) => ({ ...x, seq: i + 2 }));
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
  // 臉書原生彩色背景（text_format_preset_id，非官方）：只能用在純文字貼文
  const textPreset = b.textPreset === undefined || b.textPreset === null || b.textPreset === '' ? '' : String(b.textPreset).trim();
  if (textPreset) {
    if (!isPreset(textPreset)) return '背景代碼格式不正確（應為數字）。';
    if (link || image || imageUrl) return '彩色背景只能用在純文字貼文。';
    if (!message.trim()) return '彩色背景需要內文。';
  }
  const comment = typeof b.comment === 'string' ? b.comment.trim() : '';
  if (b.comment !== undefined && b.comment !== null && typeof b.comment !== 'string') return '留言格式不正確。';
  if (comment.length > MAX_COMMENT) return '留言太長（上限 8000 字）。';
  const extras = parseExtras(b.extraComments);
  if (typeof extras === 'string') return extras;
  let at = null;
  if (b.scheduledAt !== undefined && b.scheduledAt !== null && b.scheduledAt !== '') {
    at = Number(b.scheduledAt);
    if (!Number.isInteger(at)) return '排程時間格式不正確（Unix 秒數）。';
    if (at < now + MIN_SCHEDULE || at > now + MAX_SCHEDULE) return '排程時間要在 10 分鐘後到 30 天內。';
  }
  return { page, message, link, imageUrl, image, at, textPreset, comment, extras };
}

// 發文時留言（文章連結等）。立即發布：馬上留，失敗就入列交給總管重試；排程：入列等發布。
// 圖片貼文 /photos 回的是照片 ID：沒有 post_id 時用 page_story_id 換貼文 ID，換不到就在佇列記 photo_id 之後再換。
// 需使用者實測確認：照片 ID 換貼文 ID、排程中的照片是否查得到 page_story_id、留言要掛在哪個 ID。
// 第 2 則以後（v.extras）一律入列：due＝發布時間（排程用排程時間、立即用現在）＋各自的 delay。
async function attachComments(env, token, v, r) {
  const isPhoto = !!(v.image || v.imageUrl);
  const photo = isPhoto ? r.id : null;
  let post = r.post_id || (isPhoto ? null : r.id);
  if (!post && photo) post = await photoToPost(env, token, photo);
  const now = Date.now();
  const base = v.at || Math.floor(now / 1000);
  let comment = { status: 'none' };
  if (v.comment) {
    comment = null;
    if (!v.at && post) {
      try {
        const c = await graphPost(env, token, `/${post}/comments`, { message: v.comment });
        comment = { status: 'done', id: c && c.id ? String(c.id) : '' };
      } catch (e) { /* 失敗不影響發文：入列重試 */ }
    }
    if (!comment) {
      try {
        await enqueueComment(env, {
          page: v.page, post, photo, message: v.comment,
          due: base, nextCheck: v.at ? (v.at + 1) * 1000 : now, nowMs: now
        });
        comment = { status: 'queued' };
      } catch (e) { comment = { status: 'failed' }; }
    }
  }
  const extras = [];
  for (const x of v.extras || []) {
    const due = base + x.delay;
    try {
      await enqueueComment(env, { page: v.page, post, photo, message: x.message, due, nextCheck: (due + 1) * 1000, seq: x.seq, delay: x.delay, nowMs: now });
      extras.push({ seq: x.seq, status: 'queued' });
    } catch (e) { extras.push({ seq: x.seq, status: 'failed' }); }
  }
  if (comment.status === 'queued' || extras.some((x) => x.status === 'queued')) await kickHub(env);
  return { comment, extras };
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
      r = await graphPost(env, token, `/${v.page}/feed`, { message: v.message, link: v.link, text_format_preset_id: v.textPreset || undefined, ...sched });
    }
    await audit(env, v.at ? 'post-scheduled' : 'post-published');
    const att = v.comment || v.extras.length ? await attachComments(env, token, v, r) : { comment: { status: 'none' }, extras: [] };
    return ok(request, env, { id: r.post_id || r.id, scheduled: !!v.at, at: v.at, comment: att.comment, ...(att.extras.length ? { extras: att.extras } : {}) });
  } catch (e) {
    await audit(env, 'post-failed-' + (e && e.fbCode ? e.fbCode : (e && e.code) || 'x'));
    throw e;
  }
}

// 取消排程：只刪「還沒發布」的貼文（先問臉書 is_published，已發布就拒絕，避免誤刪）
async function cancelPost(request, env) {
  const buf = await readBody(request, 4 * 1024);
  if (!buf) return fail(request, env, 'too_large');
  let b;
  try { b = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return fail(request, env, 'bad_request'); }
  const post = b && typeof b.post === 'string' ? b.post : '';
  if (!isPostId(post)) return fail(request, env, 'bad_request', '貼文 ID 格式不正確（應為 粉專ID_貼文ID）。');
  const token = await tokenFor(env, post.split('_')[0]);
  if (!token) return fail(request, env, 'fb_unknown_page');
  const info = await graphGet(env, token, `/${post}`, { fields: 'is_published' });
  if (info.is_published !== false) return fail(request, env, 'bad_request', '這篇已經發布，不能在這裡刪除。');
  try {
    await graphDelete(env, token, `/${post}`);
    await audit(env, 'post-canceled');
    try { await cancelForPost(env, post); await kickHub(env); } catch (e) { /* 佇列更新失敗不影響取消 */ }
    return ok(request, env, { post, canceled: true });
  } catch (e) {
    await audit(env, 'cancel-failed-' + (e && e.fbCode ? e.fbCode : (e && e.code) || 'x'));
    throw e;
  }
}

async function readJson(request, max = 4 * 1024) {
  const buf = await readBody(request, max);
  if (!buf) return { error: 'too_large' };
  try { const b = JSON.parse(new TextDecoder().decode(buf)); return { body: b && typeof b === 'object' ? b : {} }; }
  catch (e) { return { error: 'bad_request' }; }
}

// 改排程時間：只改還沒發布的；同時更新佇列裡該貼文待留言項目的時間
async function reschedulePost(request, env) {
  const { body: b, error } = await readJson(request);
  if (error) return fail(request, env, error);
  const post = typeof b.post === 'string' ? b.post : '';
  if (!isPostId(post)) return fail(request, env, 'bad_request', '貼文 ID 格式不正確（應為 粉專ID_貼文ID）。');
  const time = Number(b.time), now = nowSec();
  if (!Number.isInteger(time)) return fail(request, env, 'bad_request', '排程時間格式不正確（Unix 秒數）。');
  if (time < now + MIN_SCHEDULE || time > now + MAX_SCHEDULE) return fail(request, env, 'bad_request', '排程時間要在 10 分鐘後到 30 天內。');
  const token = await tokenFor(env, post.split('_')[0]);
  if (!token) return fail(request, env, 'fb_unknown_page');
  const info = await graphGet(env, token, `/${post}`, { fields: 'is_published' });
  if (info.is_published !== false) return fail(request, env, 'already_published', '這篇已經發布，不能改排程時間。');
  try {
    await graphPost(env, token, `/${post}`, { scheduled_publish_time: String(time) });
    await audit(env, 'post-rescheduled');
  } catch (e) {
    await audit(env, 'reschedule-failed-' + (e && e.fbCode ? e.fbCode : (e && e.code) || 'x'));
    throw e;
  }
  try { await rescheduleComments(env, post, time); await kickHub(env); } catch (e) { /* 佇列更新失敗，下一分鐘 cron 對時會補上 */ }
  return ok(request, env, { post, time });
}

export async function handleFb(request, env, path) {
  if (path !== '/fb' && !path.startsWith('/fb/')) return null;
  if (!(await bearer(request, env, 'company'))) return fail(request, env, 'unauthorized');
  if (!pageTokens(env).length) return fail(request, env, 'fb_not_configured');
  const q = new URL(request.url).searchParams;
  try {
    if (path === '/fb/pages' && request.method === 'GET') {
      return ok(request, env, await pagesWithMap(env, await loadPages(env, { fresh: q.get('refresh') === '1' })));
    }
    if (path === '/fb/comment-presets' && request.method === 'GET') {
      let items = [];
      try { items = await listPresets(env); } catch (e) { /* 讀不到就當沒有，不影響發文 */ }
      return ok(request, env, { items });
    }
    if (path === '/fb/posts' && request.method === 'GET') return await listPosts(request, env, q);
    if (path === '/fb/scheduled' && request.method === 'GET') return await listScheduled(request, env, q);
    if (path === '/fb/insights' && request.method === 'GET') return await insights(request, env, q);
    if (path === '/fb/post' && request.method === 'POST') return await createPost(request, env);
    if (path === '/fb/cancel' && request.method === 'POST') return await cancelPost(request, env);
    if (path === '/fb/reschedule' && request.method === 'POST') return await reschedulePost(request, env);
    if (path === '/fb/comments' && request.method === 'GET') {
      if (!env.DB) return fail(request, env, 'misconfigured');
      const st = q.get('status') || 'all', pg = q.get('page') || '';
      if (!['failed', 'pending', 'all'].includes(st) || (pg && !isId(pg))) return fail(request, env, 'bad_request');
      return ok(request, env, { items: await listComments(env, { status: st, page: pg }) });
    }
    if ((path === '/fb/comment/retry' || path === '/fb/comment/dismiss') && request.method === 'POST') {
      if (!env.DB) return fail(request, env, 'misconfigured');
      const { body: b, error } = await readJson(request);
      if (error) return fail(request, env, error);
      const id = Number(b.id);
      if (!Number.isInteger(id) || id < 1) return fail(request, env, 'bad_request');
      if (path === '/fb/comment/dismiss') return ok(request, env, { id, dismissed: await dismissComment(env, id) });
      if (!(await retryComment(env, id))) return fail(request, env, 'bad_request', '只有失敗的留言可以重試。');
      await kickHub(env);
      return ok(request, env, { status: 'pending' });
    }
  } catch (e) {
    if (e instanceof GraphError && e.code === 'fb_token_invalid') await cacheDel(env, await pagesKey(env));
    return graphFail(request, env, e);
  }
  return fail(request, env, 'not_found');
}

// ---- 管理頁：每組 token 的狀態（不回傳 token 值） ----
// GET /admin/fb（已通過 admin 驗證）
// 有 tasks（/me/accounts）看 tasks；沒有就看授權範圍（perm）；都沒有當作可以
const allowed = (p, task, key) => (Array.isArray(p.tasks) ? p.tasks.includes(task) || p.tasks.includes('MANAGE')
  : !(p.perm && p.perm[key] === false));
const pageRow = (p) => ({ id: p.id, name: p.name, canPost: allowed(p, 'CREATE_CONTENT', 'post'), canInsights: allowed(p, 'ANALYZE', 'insights') });

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
      expiresAt: null, dataAccessExpiresAt: null, scopes: [], missingScopes: [], error: inf.error || '',
      hint: inf.hint || '', skipped: inf.skipped || 0
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
