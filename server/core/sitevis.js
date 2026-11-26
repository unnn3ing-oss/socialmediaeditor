// 未登入時隱藏的工具（2026-11-26）：系統管理者在管理頁「進階設定」切換（敏感卡片 toolvis）
//   設定存 D1 fb_settings k='tool_vis'，v＝{"on":bool,"hide":["fbpost",...]}；沒存過＝關閉、預設清單 DEFAULT_HIDE
//   GET /site/vis：不用登入，給首頁用；只回 { hide }（關閉時空陣列）。只影響顯示，工具權限仍由各自的後端路由檢查
//   GET／POST /admin/site/vis：管理頁讀寫（gate 卡片 toolvis）
import { ok, fail, readBody } from './http.js';
import { ensureSettings, cached, forget } from './once.js';

const KEY = 'tool_vis';
const CACHE_MS = 60 * 1000;
const MAX = 50;
export const DEFAULT_HIDE = ['fbpost', 'fbvideo', 'fbreports'];
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

// 只留合法、不重複的工具 id（最多 MAX 個）
export function cleanIds(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    if (typeof x !== 'string' || !ID_RE.test(x)) return null;
    if (!out.includes(x)) out.push(x);
  }
  return out.length > MAX ? null : out;
}

async function load(env) {
  try {
    await ensureSettings(env);
    const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first();
    if (!r) return { on: false, hide: DEFAULT_HIDE.slice() };
    const o = JSON.parse(r.v);
    const hide = cleanIds(o && o.hide);
    return { on: !!(o && o.on === true), hide: hide || [] };
  } catch {
    return { on: false, hide: [] };   // 讀不到或壞掉＝不隱藏（照舊全部顯示）
  }
}
export const readToolVis = (env) => cached(env.DB, KEY, CACHE_MS, () => load(env));

async function save(env, v) {
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(KEY, JSON.stringify(v), Date.now()).run();
  forget(env.DB, KEY);
}

// 公開：GET /site/vis
export async function handleSiteVis(request, env, path) {
  if (path !== '/site/vis') return null;
  if (request.method !== 'GET') return fail(request, env, 'not_found');
  const v = await readToolVis(env);
  return ok(request, env, { hide: v.on ? v.hide : [] }, { 'cache-control': 'public, max-age=60' });
}

// 管理頁：GET／POST /admin/site/vis（已通過 gate）
export async function adminSiteVis(request, env, path) {
  if (path !== '/admin/site/vis') return null;
  if (request.method === 'GET') return ok(request, env, await load(env));
  if (request.method !== 'POST') return null;
  const buf = await readBody(request, 4096);
  let b = null;
  try { b = buf ? JSON.parse(new TextDecoder().decode(buf)) : null; } catch { b = null; }
  const hide = b && typeof b.on === 'boolean' ? cleanIds(b.hide) : null;
  if (!hide) return fail(request, env, 'bad_request');
  const v = { on: b.on, hide };
  await save(env, v);
  return ok(request, env, v);
}
