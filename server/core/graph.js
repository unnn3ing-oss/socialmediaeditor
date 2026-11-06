// 臉書 Graph API 用戶端（只給 core/fb.js 用）。
// token 只從 env.FB_TOKEN 讀，永遠不放進回應；錯誤訊息回傳前會先把 token 抹掉。
export const DEFAULT_GRAPH_VERSION = 'v26.0';
const enc = new TextEncoder();

export function graphBase(env) {
  const v = typeof env.FB_GRAPH_VERSION === 'string' && /^v\d+\.\d+$/.test(env.FB_GRAPH_VERSION) ? env.FB_GRAPH_VERSION : DEFAULT_GRAPH_VERSION;
  return `https://graph.facebook.com/${v}`;
}

// FB_TOKEN 可放一或多組粉專 token（用逗號、空白或換行分隔）
export function pageTokens(env) {
  if (typeof env.FB_TOKEN !== 'string') return [];
  return [...new Set(env.FB_TOKEN.split(/[\s,]+/).filter((t) => /^[A-Za-z0-9_|.-]{20,}$/.test(t)))];
}

// appsecret_proof = HMAC-SHA256(key=app secret, msg=token) 的 hex；沒設 FB_APP_SECRET 就不帶
export async function appsecretProof(env, token) {
  if (typeof env.FB_APP_SECRET !== 'string' || !env.FB_APP_SECRET) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(env.FB_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(token)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 把字串裡出現的任何 token、app secret 抹掉
export function scrub(env, text) {
  let s = String(text == null ? '' : text);
  for (const t of [...pageTokens(env), env.FB_APP_SECRET].filter((x) => typeof x === 'string' && x.length >= 8)) s = s.split(t).join('***');
  return s.replace(/access_token=[^&\s"']+/g, 'access_token=***').slice(0, 300);
}

// Graph 錯誤代碼 → 我們的錯誤代碼
export function classify(err) {
  const c = Number(err && err.code);
  if (c === 190 || c === 102 || c === 463 || c === 467) return 'fb_token_invalid';
  if (c === 10 || (c >= 200 && c <= 299)) return 'fb_permission';
  if (c === 4 || c === 17 || c === 32 || c === 341 || c === 613 || c === 80001) return 'fb_rate_limited';
  if (c === 100) return 'fb_bad_request';
  return 'fb_error';
}

export class GraphError extends Error {
  constructor(code, message, fbCode) { super(message); this.code = code; this.fbCode = fbCode; }
}

async function parse(env, res) {
  let body = null;
  try { body = await res.json(); } catch (e) { /* 非 JSON */ }
  if (res.ok && body && !body.error) return body;
  const err = (body && body.error) || {};
  throw new GraphError(classify(err), scrub(env, err.message || `HTTP ${res.status}`), Number(err.code) || null);
}

// GET：token 放在查詢字串（只在 Worker 對 Graph 的連線裡出現）
export async function graphGet(env, token, path, params = {}) {
  const u = new URL(graphBase(env) + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  u.searchParams.set('access_token', token);
  const proof = await appsecretProof(env, token);
  if (proof) u.searchParams.set('appsecret_proof', proof);
  let res;
  try { res = await fetch(u.toString(), { method: 'GET' }); }
  catch (e) { throw new GraphError('fb_unreachable', '連不到臉書。', null); }
  return parse(env, res);
}

// POST：一律用 multipart，token 放在本文；fields 的值可以是字串或 Blob（附檔名用 [blob, name]）
export async function graphPost(env, token, path, fields = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) fd.append(k, v[0], v[1]);
    else fd.append(k, v instanceof Blob ? v : String(v));
  }
  fd.append('access_token', token);
  const proof = await appsecretProof(env, token);
  if (proof) fd.append('appsecret_proof', proof);
  let res;
  try { res = await fetch(graphBase(env) + path, { method: 'POST', body: fd }); }
  catch (e) { throw new GraphError('fb_unreachable', '連不到臉書。', null); }
  return parse(env, res);
}
