// 管理頁存的臉書使用者權杖：D1 fb_settings 一列（k='user_token'），用 SESSION_SECRET 衍生的 AES-GCM 金鑰加密後才存。
// 讀取順序：管理頁存的 → Secret FB_USER_TOKEN。權杖本身永遠不回傳給前端。
const KEY = 'user_token';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function ensureTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
}
async function aesKey(env) {
  if (typeof env.SESSION_SECRET !== 'string' || !env.SESSION_SECRET) throw new Error('no secret');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('fb-user-token\u0000' + env.SESSION_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(token)));
  return 'v1.' + b64(iv) + '.' + b64(ct);
}
export async function decryptToken(env, blob) {
  const [v, iv, ct] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !ct) return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct))); } catch { return null; }
}

// 管理頁存的權杖；沒有、表不存在或解不開都回 null
export async function storedToken(env) {
  if (!env.DB) return null;
  try {
    const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first();
    return r ? await decryptToken(env, r.v) : null;
  } catch { return null; }
}

// 實際使用的權杖與來源：{ token, source: 'admin'|'secret'|null }
export async function userToken(env) {
  const t = await storedToken(env);
  if (t) return { token: t, source: 'admin' };
  if (env.FB_USER_TOKEN) return { token: env.FB_USER_TOKEN, source: 'secret' };
  return { token: null, source: null };
}

export async function saveToken(env, token) {
  await ensureTable(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(KEY, await encryptToken(env, token), Date.now()).run();
}
export async function clearToken(env) {
  await ensureTable(env);
  await env.DB.prepare('DELETE FROM fb_settings WHERE k = ?').bind(KEY).run();
}
