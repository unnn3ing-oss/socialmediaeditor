// 臉書 Webhook 回呼網址（最小版）：/fbhook，不需登入（臉書直接打）
//   GET：臉書驗證——hub.mode=subscribe 且 hub.verify_token 相符才回 hub.challenge（純文字）
//   POST：用「App 密鑰」驗 X-Hub-Signature-256；只記最後收到的時間與事件種類（D1 fb_settings k='webhook_last'），不存內容
//   驗證權杖由 SESSION_SECRET 衍生，不另存
import { readBody } from '../core/http.js';
import { allAppCreds } from './tokenstore.js';
import { guardEvent } from './guard.js';
import { ensureSettings, cached } from '../core/once.js';

export const HOOK_PATH = '/fbhook';
const LAST_KEY = 'webhook_last';
const MAX_BODY = 1024 * 1024;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, typeof data === 'string' ? enc.encode(data) : data));
}
// 長度相同才逐字比對（不提早結束）
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifyToken(env) {
  if (typeof env.SESSION_SECRET !== 'string' || !env.SESSION_SECRET) return null;
  return (await hmacHex(env.SESSION_SECRET, 'fb-webhook-verify')).slice(0, 32);
}

const text = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
const CHALLENGE_RE = /^[A-Za-z0-9_-]{1,200}$/;

// 每個執行個體每 60 秒最多寫一次（原本每則推送寫一次，D1 寫入量太大）；管理頁「最後收到」最多慢 1 分鐘
export const LAST_EVERY_MS = 60 * 1000;
export const CREDS_CACHE_MS = 60 * 1000;
const lastSaved = new WeakMap();   // D1 綁定 → 上次寫入時間
async function saveLast(env, rec) {
  if (!env.DB) return;
  const prev = lastSaved.get(env.DB);
  if (prev && rec.at - prev < LAST_EVERY_MS) return;
  lastSaved.set(env.DB, rec.at);
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(LAST_KEY, JSON.stringify(rec), Date.now()).run();
}
async function readLast(env) {
  try {
    const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(LAST_KEY).first();
    const o = r ? JSON.parse(r.v) : null;
    return o && Number.isFinite(o.at) ? { at: o.at, object: String(o.object || ''), fields: Array.isArray(o.fields) ? o.fields.map(String) : [] } : null;
  } catch { return null; }
}

// 只取事件種類：object（例 page）與 entry[].changes[].field（最多 5 種，各 ≤40 字）
function kinds(body) {
  const object = typeof body.object === 'string' ? body.object.slice(0, 40) : '';
  const set = new Set();
  for (const e of Array.isArray(body.entry) ? body.entry : []) {
    for (const c of Array.isArray(e && e.changes) ? e.changes : []) if (c && typeof c.field === 'string') set.add(c.field.slice(0, 40));
    if (e && Array.isArray(e.messaging) && e.messaging.length) set.add('messaging');
  }
  return { object, fields: [...set].slice(0, 5) };
}

export async function handleFbHook(request, env, path, ctx) {
  if (path !== HOOK_PATH) return null;
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    const want = await verifyToken(env);
    const challenge = q.get('hub.challenge') || '';
    if (want && q.get('hub.mode') === 'subscribe' && sameText(q.get('hub.verify_token') || '', want) && CHALLENGE_RE.test(challenge)) return text(challenge);
    return text('forbidden', 403);
  }
  if (request.method === 'POST') {
    const buf = await readBody(request, MAX_BODY);
    if (!buf) return text('too large', 413);
    // 權杖組別各自的 App 密鑰：任一組驗得過就算（不同 App 各自訂閱 Webhook）
    const creds = await cached(env.DB, 'appCreds', CREDS_CACHE_MS, () => allAppCreds(env));
    const sig = request.headers.get('x-hub-signature-256') || '';
    let okSig = false;
    if (sig.startsWith('sha256=')) for (const c of creds) if (sameText(sig.slice(7).toLowerCase(), await hmacHex(c.secret, buf))) { okSig = true; break; }
    if (!okSig) return text('forbidden', 403);
    let body;
    try { body = JSON.parse(new TextDecoder().decode(buf)); } catch { return text('bad request', 400); }
    if (!body || typeof body !== 'object') return text('bad request', 400);
    try { await saveLast(env, { at: Date.now(), ...kinds(body) }); } catch { /* 記不了也回 200，免得臉書一直重送 */ }
    // 留言守門：先回 200，背景處理（guard.js）
    const work = guardEvent(env, body).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work); else await work;
    return text('EVENT_RECEIVED');
  }
  return text('method not allowed', 405);
}

// 管理頁用：回呼網址、驗證權杖、能不能驗簽章、最後收到
export async function webhookState(request, env) {
  return {
    url: new URL(request.url).origin + HOOK_PATH,
    verifyToken: await verifyToken(env),
    signReady: (await allAppCreds(env)).length > 0,
    last: await readLast(env)
  };
}
