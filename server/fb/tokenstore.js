// 管理頁存的臉書權杖：D1 fb_settings，用 SESSION_SECRET 衍生的 AES-GCM 金鑰加密後才存。權杖本身永遠不回傳給前端。
//   k='user_token'：使用者權杖（讀取順序：管理頁存的 → Secret FB_USER_TOKEN）
//   k='page_tokens'：「驗證並儲存」當下換好的粉專權杖 JSON { pages:[{id,name,token}], expires, dataExpires, userExpires, savedAt }
//     長效使用者權杖換到的粉專權杖不會過期（expires 0），發文優先用它；使用者權杖過期也不影響
//   k='token_broken'：發文時遇到權杖失效（190／102）的時間（毫秒），換新權杖時清掉
const KEY = 'user_token';
const PAGES_KEY = 'page_tokens';
const BROKEN_KEY = 'token_broken';
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

async function readRow(env, k) {
  if (!env.DB) return null;
  try { const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(k).first(); return r ? r.v : null; } catch { return null; }
}
async function writeRow(env, k, v) {
  await ensureTable(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(k, v, Date.now()).run();
}
async function deleteRow(env, k) {
  await ensureTable(env);
  await env.DB.prepare('DELETE FROM fb_settings WHERE k = ?').bind(k).run();
}

// 管理頁存的權杖；沒有、表不存在或解不開都回 null
export async function storedToken(env) {
  const v = await readRow(env, KEY);
  return v ? await decryptToken(env, v) : null;
}

// 實際使用的權杖與來源：{ token, source: 'admin'|'secret'|null }
export async function userToken(env) {
  const t = await storedToken(env);
  if (t) return { token: t, source: 'admin' };
  if (env.FB_USER_TOKEN) return { token: env.FB_USER_TOKEN, source: 'secret' };
  return { token: null, source: null };
}

export async function saveToken(env, token) { await writeRow(env, KEY, await encryptToken(env, token)); }
// 改回 Secret：使用者權杖、粉專權杖、失效旗標一起刪
export async function clearToken(env) {
  await deleteRow(env, KEY);
  await deleteRow(env, PAGES_KEY);
  await deleteRow(env, BROKEN_KEY);
}

// 存好的粉專權杖；沒有、解不開或格式不對回 null
export async function storedPageTokens(env) {
  const v = await readRow(env, PAGES_KEY);
  if (!v) return null;
  const plain = await decryptToken(env, v);
  if (!plain) return null;
  try {
    const o = JSON.parse(plain);
    if (!o || !Array.isArray(o.pages) || !o.pages.length) return null;
    const pages = o.pages.filter((p) => p && typeof p.id === 'string' && typeof p.token === 'string' && p.token)
      .map((p) => ({ id: p.id, name: String(p.name || p.id), token: p.token }));
    if (!pages.length) return null;
    const num = (x) => (Number.isFinite(Number(x)) && x !== null && x !== undefined ? Number(x) : null);
    return { pages, expires: num(o.expires), dataExpires: num(o.dataExpires), userExpires: num(o.userExpires), savedAt: num(o.savedAt) };
  } catch { return null; }
}
export async function savePageTokens(env, rec) {
  await writeRow(env, PAGES_KEY, await encryptToken(env, JSON.stringify({ ...rec, savedAt: Date.now() })));
  await deleteRow(env, BROKEN_KEY);
}

// 發文遇到權杖失效：記時間（只記第一次）；讀不到回 null
export async function markBroken(env) {
  if (!env.DB) return;
  try { if (!(await readRow(env, BROKEN_KEY))) await writeRow(env, BROKEN_KEY, String(Date.now())); } catch { /* 記不了就算了 */ }
}
export async function brokenAt(env) {
  const v = Number(await readRow(env, BROKEN_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}
export async function clearBroken(env) { try { await deleteRow(env, BROKEN_KEY); } catch { /* 沒表就算了 */ } }

// 這個執行個體發出去過的粉專權杖（graph.js 遇到權杖失效時，只有粉專權杖才記失效旗標；使用者權杖驗證失敗不算）
const handed = new WeakMap();
export function notePageTokens(env, list) {
  if (!env || typeof env !== 'object') return;
  let s = handed.get(env);
  if (!s) handed.set(env, (s = new Set()));
  for (const p of list) if (p && p.token) s.add(p.token);
}
export const isPageToken = (env, t) => !!(env && typeof env === 'object' && handed.has(env) && handed.get(env).has(t));
