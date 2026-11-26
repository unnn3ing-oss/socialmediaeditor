// 第一則留言：「看更多新聞內容」＋文章網址＋該粉專 UTM
import { graph } from './graph.js';
import { ensureSettings, cached, forget } from '../core/once.js';

// UTM 去掉開頭的 ?／&；網址沒有 ? → 接 ?&utm…（照小編慣用格式）；已有 ? → 用 & 接；# 錨點留在最後
export function commentLink(url, utm) {
  url = String(url || '').trim();
  const u = String(utm || '').trim().replace(/^[?&]+/, '');
  if (!url || !u) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  if (!base.includes('?')) return base + '?&' + u + hash;
  return base + (/[?&]$/.test(base) ? '' : '&') + u + hash;
}

export const DEFAULT_LEAD = '看更多新聞內容';
export const MAX_LEAD = 200;
// lead 沒給（undefined）用預設；給了空白就只放連結
export function commentText(url, utm, lead = DEFAULT_LEAD) {
  const head = String(lead == null ? DEFAULT_LEAD : lead).trim();
  const link = commentLink(url, utm);
  return head ? head + '\n' + link : link;
}

export async function postComment(env, token, postId, message) {
  const d = await graph(env, 'POST', '/' + postId + '/comments', { message }, token);
  return String(d.id || '');
}

// ---- 實驗功能：第一則留言「發出後再編輯一次」（臉書 API 沒有關連結預覽的參數，試看看用相同內容編輯一次預覽會不會消失）----
// 設定存 D1 fb_settings k='comment_opts'：{ edit, who:'all'|'some', staff:[員工編號] }；預設關；舊版 { edit:true }＝全部人
// 管理頁「進階設定 → 實驗功能」（敏感卡片 labs）；快取 60 秒（同執行個體存檔立即清）
const OPTS_KEY = 'comment_opts';
export const MAX_LAB_STAFF = 500;
export const STAFF_RE = /^[A-Za-z0-9_-]{1,20}$/;
export function normOpts(v) {
  const edit = !!(v && v.edit === true);
  const who = v && v.who === 'some' ? 'some' : 'all';
  const staff = who === 'some' && v && Array.isArray(v.staff) ? [...new Set(v.staff.filter((x) => typeof x === 'string' && STAFF_RE.test(x.trim())).map((x) => x.trim().toUpperCase()))].slice(0, MAX_LAB_STAFF) : [];
  return { edit, who, staff };
}
// 管理頁送來的：格式不對回 null
export function validOpts(b) {
  if (!b || typeof b.edit !== 'boolean' || !['all', 'some'].includes(b.who === undefined ? 'all' : b.who)) return null;
  if (b.who === 'some' && (!Array.isArray(b.staff) || b.staff.length > MAX_LAB_STAFF || !b.staff.every((x) => typeof x === 'string' && STAFF_RE.test(x.trim())))) return null;
  return normOpts(b);
}
async function readOpts(env) {
  await ensureSettings(env);
  const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(OPTS_KEY).first();
  let v = null;
  try { v = r ? JSON.parse(r.v) : null; } catch { v = null; }
  return normOpts(v);
}
export async function commentOpts(env) {
  if (!env || !env.DB) return normOpts(null);
  try { return await cached(env.DB, OPTS_KEY, 60000, () => readOpts(env)); } catch { return normOpts(null); }
}
export async function saveCommentOpts(env, opts) {
  await ensureSettings(env);
  const v = JSON.stringify(normOpts(opts));
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated').bind(OPTS_KEY, v, Date.now()).run();
  forget(env.DB, OPTS_KEY);
  return readOpts(env);
}
// 這個發文者（員工編號）適不適用：開關打開，且對象是全部人或名單裡有他（沒有發文者＝指定員工時不適用）
export const editApplies = (opts, by) => !!opts.edit && (opts.who === 'all' || (!!by && opts.staff.includes(String(by).toUpperCase())));

// 適用、內容有網址、拿得到留言 ID 才編輯；編輯失敗不影響留言結果（留言已經成功），也不重試
export async function editAfterPost(env, token, commentId, message, by) {
  if (!commentId || !/https?:\/\//i.test(String(message || ''))) return 'skip';
  if (!editApplies(await commentOpts(env), by)) return 'skip';
  try { await graph(env, 'POST', '/' + commentId, { message }, token); return 'edited'; }
  catch (e) { console.warn('comment edit failed', commentId, String((e && e.message) || e).slice(0, 200)); return 'failed'; }
}

// ---- 實驗功能：第一則留言發出後隱藏（2026-11-26）----
// 設定存 D1 fb_settings k='hide_opts'：{ hide, who:'all'|'some', staff:[員工編號] }；預設關；對象看「發文的人」
// 開啟且適用時，排程發布「留言內容」旁出現勾選，只對那一次送出有效（表單 hideFirst=1）
// 隱藏＝POST /{comment-id} is_hidden=true；臉書是否允許粉專隱藏自己的留言未證實，失敗不影響留言、不重試
const HIDE_KEY = 'hide_opts';
export function normHideOpts(v) {
  const o = normOpts(v ? { edit: v.hide, who: v.who, staff: v.staff } : null);
  return { hide: o.edit, who: o.who, staff: o.staff };
}
export function validHideOpts(b) {
  if (!b || typeof b.hide !== 'boolean') return null;
  const o = validOpts({ edit: b.hide, who: b.who, staff: b.staff });
  return o ? { hide: o.edit, who: o.who, staff: o.staff } : null;
}
async function readHideOpts(env) {
  await ensureSettings(env);
  const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(HIDE_KEY).first();
  let v = null;
  try { v = r ? JSON.parse(r.v) : null; } catch { v = null; }
  return normHideOpts(v);
}
export async function hideOpts(env) {
  if (!env || !env.DB) return normHideOpts(null);
  try { return await cached(env.DB, HIDE_KEY, 60000, () => readHideOpts(env)); } catch { return normHideOpts(null); }
}
export async function saveHideOpts(env, opts) {
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(HIDE_KEY, JSON.stringify(normHideOpts(opts)), Date.now()).run();
  forget(env.DB, HIDE_KEY);
  return readHideOpts(env);
}
export const hideApplies = (opts, by) => editApplies({ edit: opts.hide, who: opts.who, staff: opts.staff }, by);

// 回 { hidden: 'hidden' } 或 { hidden: 'failed', hideError }
export async function hideComment(env, token, commentId) {
  if (!commentId) return { hidden: 'failed', hideError: '沒有留言 ID' };
  try {
    const d = await graph(env, 'POST', '/' + commentId, { is_hidden: 'true' }, token);
    if (d && d.success === false) return { hidden: 'failed', hideError: '臉書沒有隱藏' };
    return { hidden: 'hidden' };
  } catch (e) { return { hidden: 'failed', hideError: String((e && e.message) || e).slice(0, 200) }; }
}
