// 粉專清單：FB_USER_TOKEN → /me/accounts 取各粉專 token（KV 快取 1 小時）＋ D1 fb_pages 的顯示設定
import { graph, isTokenError } from './graph.js';

const CACHE_KEY = 'fb:accounts';
const CACHE_TTL = 3600;
export const RD_CODES = ['', 'news', 'ent', 'shaokang', 'intl'];
export const NEEDED_PERMS = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement', 'pages_read_user_content'];

export class FbSetupError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// 取各粉專 { id, name, token }；沒設 token → fb_off；token 壞了 → fb_token
export async function pageTokens(env) {
  if (!env.FB_USER_TOKEN) throw new FbSetupError('fb_off');
  let list = null;
  try { list = env.CACHE ? await env.CACHE.get(CACHE_KEY, 'json') : null; } catch { list = null; }
  if (!Array.isArray(list)) {
    list = [];
    let after;
    try {
      for (let i = 0; i < 10; i++) {
        const d = await graph(env, 'GET', '/me/accounts', { fields: 'id,name,access_token', limit: 100, after }, env.FB_USER_TOKEN);
        for (const p of d.data || []) if (p && p.id && p.access_token) list.push({ id: String(p.id), name: String(p.name || p.id), token: p.access_token });
        after = d.paging && d.paging.next && d.paging.cursors && d.paging.cursors.after;
        if (!after) break;
      }
    } catch (e) {
      if (isTokenError(e)) throw new FbSetupError('fb_token', e.message);
      throw e;
    }
    if (env.CACHE) await env.CACHE.put(CACHE_KEY, JSON.stringify(list), { expirationTtl: CACHE_TTL });
  }
  return new Map(list.map((p) => [p.id, p]));
}

export async function clearPageCache(env) { if (env.CACHE) await env.CACHE.delete(CACHE_KEY); }

async function settings(env) {
  const { results } = await env.DB.prepare('SELECT id, short, utm, rd, ord, show FROM fb_pages').all();
  return new Map((results || []).map((r) => [r.id, r]));
}

// 合併臉書粉專與設定；all=false 只回「顯示」的
export async function listPages(env, { all = false } = {}) {
  const [tokens, conf] = await Promise.all([pageTokens(env), settings(env)]);
  const out = [];
  for (const p of tokens.values()) {
    const c = conf.get(p.id);
    const row = { id: p.id, name: p.name, short: c ? c.short : p.name, utm: c ? c.utm : '', rd: c ? c.rd : '', order: c ? c.ord : 999, show: c ? !!c.show : true };
    if (all || row.show) out.push(row);
  }
  out.sort((a, b) => a.order - b.order);   // 穩定排序：同順序（未設定）維持臉書回傳順序
  return out;
}

export async function pageSetting(env, pageId) {
  const r = await env.DB.prepare('SELECT utm, rd FROM fb_pages WHERE id = ?').bind(pageId).first();
  return { utm: r ? r.utm : '', rd: r ? r.rd : '' };
}
export const pageUtm = async (env, pageId) => (await pageSetting(env, pageId)).utm;
export const pageRd = async (env, pageId) => (await pageSetting(env, pageId)).rd;

const UTM_RE = /^[A-Za-z0-9?&=_.~%+\-]*$/;
// 驗證管理頁送來的整份設定；不合法回 null
export function validPages(body) {
  if (!body || !Array.isArray(body.pages) || body.pages.length > 200) return null;
  const out = [];
  const seen = new Set();
  for (const p of body.pages) {
    if (!p || typeof p.id !== 'string' || !/^\d{1,30}$/.test(p.id) || seen.has(p.id)) return null;
    const short = typeof p.short === 'string' ? p.short.trim() : '';
    const utm = typeof p.utm === 'string' ? p.utm.trim() : '';
    const n = [...short].length;
    if (n < 1 || n > 20 || utm.length > 200 || !UTM_RE.test(utm)) return null;
    if (!RD_CODES.includes(p.rd)) return null;
    if (!Number.isInteger(p.order) || p.order < 0 || p.order > 999) return null;
    seen.add(p.id);
    out.push({ id: p.id, short, utm, rd: p.rd, order: p.order, show: p.show ? 1 : 0 });
  }
  return out;
}

export async function savePages(env, pages) {
  const now = Date.now();
  const stmts = pages.map((p) => env.DB.prepare(
    'INSERT INTO fb_pages (id, short, utm, rd, ord, show, updated) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET short = excluded.short, utm = excluded.utm, rd = excluded.rd, ord = excluded.ord, show = excluded.show, updated = excluded.updated'
  ).bind(p.id, p.short, p.utm, p.rd, p.order, p.show, now));
  if (stmts.length) await env.DB.batch(stmts);
}

// 管理頁「臉書連線」
export async function tokenStatus(env) {
  if (!env.FB_USER_TOKEN) return { configured: false, valid: false, expires: null, missing: NEEDED_PERMS.slice(), pages: 0 };
  let valid = true, missing = NEEDED_PERMS.slice(), expires = null, pages = 0;
  try {
    const d = await graph(env, 'GET', '/me/permissions', {}, env.FB_USER_TOKEN);
    const granted = new Set((d.data || []).filter((x) => x.status === 'granted').map((x) => x.permission));
    missing = NEEDED_PERMS.filter((p) => !granted.has(p));
  } catch (e) { if (isTokenError(e)) valid = false; }
  if (valid) {
    try {
      const d = await graph(env, 'GET', '/debug_token', { input_token: env.FB_USER_TOKEN }, env.FB_USER_TOKEN);
      const exp = d && d.data && Number(d.data.expires_at);
      expires = exp > 0 ? exp : null;
    } catch { expires = null; }
    try { pages = (await pageTokens(env)).size; } catch (e) { if (e.code === 'fb_token') valid = false; }
  }
  return { configured: true, valid, expires, missing, pages };
}
