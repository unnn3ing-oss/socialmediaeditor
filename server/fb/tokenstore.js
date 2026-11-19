// 管理頁存的臉書權杖：D1 fb_settings，用 SESSION_SECRET 衍生的 AES-GCM 金鑰加密後才存。權杖本身永遠不回傳給前端。
//   k='user_token'：使用者權杖（讀取順序：管理頁存的 → Secret FB_USER_TOKEN）
//   k='page_tokens'：「驗證並儲存」當下換好的粉專權杖 JSON { pages:[{id,name,token}], expires, dataExpires, userExpires, savedAt }
//     長效使用者權杖換到的粉專權杖不會過期（expires 0），發文優先用它；使用者權杖過期也不影響
//   k='token_broken'：發文時遇到權杖失效（190／102）的時間（毫秒），換新權杖時清掉
//   k='profiles'：權杖組別（明文 JSON，不含權杖）{ active, list:[{ id, name, created }] }；沒有＝只有 p1「預設」
//     p1 沿用上面原本的 key（舊資料不用搬）；其他組別的 key 加 '@<id>'（例 user_token@pab12cd34）
//     Secrets FB_USER_TOKEN／FB_APP_ID／FB_APP_SECRET 只當 p1 的後備
const KEY = 'user_token';
const PAGES_KEY = 'page_tokens';
const BROKEN_KEY = 'token_broken';
//   k='app_cred'：App ID＋App Secret（主管在管理頁輸入，用來把短效權杖自動延長）JSON { appId, secret, savedAt }
const APP_KEY = 'app_cred';
export const APP_ID_RE = /^\d{1,20}$/;
export const APP_SECRET_RE = /^[A-Za-z0-9]{32}$/;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const PROFILES_KEY = 'profiles';
export const DEFAULT_PROFILE = 'p1';
export const MAX_PROFILES = 5;
export const MAX_PROFILE_NAME = 20;
export const PROFILE_ID_RE = /^p(1|[0-9a-f]{8})$/;
const kOf = (base, pid) => (pid === DEFAULT_PROFILE ? base : base + '@' + pid);

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

// ---- 權杖組別 ----
const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim();
export async function readProfiles(env) {
  const fallback = { active: DEFAULT_PROFILE, list: [{ id: DEFAULT_PROFILE, name: '預設', created: 0 }] };
  const v = await readRow(env, PROFILES_KEY);
  if (!v) return fallback;
  try {
    const o = JSON.parse(v);
    const list = (Array.isArray(o.list) ? o.list : []).filter((x) => x && PROFILE_ID_RE.test(String(x.id)))
      .map((x) => ({ id: String(x.id), name: cleanName(x.name).slice(0, MAX_PROFILE_NAME) || String(x.id), created: Number(x.created) || 0 }))
      .slice(0, MAX_PROFILES);
    if (!list.length) return fallback;
    const active = list.some((x) => x.id === o.active) ? o.active : list[0].id;
    return { active, list };
  } catch { return fallback; }
}
async function writeProfiles(env, st) { await writeRow(env, PROFILES_KEY, JSON.stringify(st)); }

// 名稱：1～20 字、不能和其他組重複；不合格回錯誤訊息（字串），合格回 null
export function profileNameError(name, list, selfId = null) {
  const n = cleanName(name);
  if (!n) return '請填組別名稱。';
  if ([...n].length > MAX_PROFILE_NAME) return '組別名稱最多 ' + MAX_PROFILE_NAME + ' 字。';
  if (list.some((x) => x.id !== selfId && x.name === n)) return '已經有同名的組別。';
  return null;
}
export async function createProfile(env, name) {
  const st = await readProfiles(env);
  if (st.list.length >= MAX_PROFILES) return { error: '最多 ' + MAX_PROFILES + ' 組。' };
  const err = profileNameError(name, st.list);
  if (err) return { error: err };
  let id;
  do { id = 'p' + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join(''); } while (st.list.some((x) => x.id === id));
  st.list.push({ id, name: cleanName(name), created: Date.now() });
  await writeProfiles(env, st);
  return { id };
}
export async function renameProfile(env, id, name) {
  const st = await readProfiles(env);
  const x = st.list.find((p) => p.id === id);
  if (!x) return { error: '找不到這個組別。' };
  const err = profileNameError(name, st.list, id);
  if (err) return { error: err };
  x.name = cleanName(name);
  await writeProfiles(env, st);
  return {};
}
export async function activateProfile(env, id) {
  const st = await readProfiles(env);
  if (!st.list.some((p) => p.id === id)) return { error: '找不到這個組別。' };
  const pe = forProfile(env, id);
  if (!(await storedPageTokens(pe)) && !(await userToken(pe)).token) return { error: '這個組別還沒有權杖，請先在下方「臉書連線」驗證並儲存。' };
  st.active = id;
  await writeProfiles(env, st);
  return {};
}
export async function deleteProfile(env, id) {
  const st = await readProfiles(env);
  if (!st.list.some((p) => p.id === id)) return { error: '找不到這個組別。' };
  if (st.active === id) return { error: '使用中的組別不能刪除，請先切換到其他組別。' };
  for (const base of [KEY, PAGES_KEY, BROKEN_KEY, APP_KEY]) await deleteRow(env, kOf(base, id));
  st.list = st.list.filter((p) => p.id !== id);
  await writeProfiles(env, st);
  return {};
}

// 指定組別的 env（管理頁設定非使用中的組別用）：讀寫權杖都落在那一組
export function forProfile(env, id) {
  const e = Object.create(env);
  Object.defineProperty(e, '__fbProfile', { value: id, enumerable: false });
  return e;
}
export async function profileId(env) {
  if (env && env.__fbProfile) return env.__fbProfile;
  return (await readProfiles(env)).active;
}

// 管理頁存的權杖；沒有、表不存在或解不開都回 null
export async function storedToken(env) {
  const v = await readRow(env, kOf(KEY, await profileId(env)));
  return v ? await decryptToken(env, v) : null;
}

// 實際使用的權杖與來源：{ token, source: 'admin'|'secret'|null }
export async function userToken(env) {
  const t = await storedToken(env);
  if (t) return { token: t, source: 'admin' };
  if (env.FB_USER_TOKEN && (await profileId(env)) === DEFAULT_PROFILE) return { token: env.FB_USER_TOKEN, source: 'secret' };
  return { token: null, source: null };
}

export async function saveToken(env, token) { await writeRow(env, kOf(KEY, await profileId(env)), await encryptToken(env, token)); }
// 改回 Secret（p1）／清空這一組：使用者權杖、粉專權杖、失效旗標一起刪
export async function clearToken(env) {
  const pid = await profileId(env);
  await deleteRow(env, kOf(KEY, pid));
  await deleteRow(env, kOf(PAGES_KEY, pid));
  await deleteRow(env, kOf(BROKEN_KEY, pid));
}

// 存好的粉專權杖；沒有、解不開或格式不對回 null
export async function storedPageTokens(env) {
  const v = await readRow(env, kOf(PAGES_KEY, await profileId(env)));
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
    return { pages, expires: num(o.expires), dataExpires: num(o.dataExpires), userExpires: num(o.userExpires), savedAt: num(o.savedAt), app: typeof o.app === 'string' ? o.app.slice(0, 100) : '' };
  } catch { return null; }
}
export async function savePageTokens(env, rec) {
  const pid = await profileId(env);
  await writeRow(env, kOf(PAGES_KEY, pid), await encryptToken(env, JSON.stringify({ ...rec, savedAt: Date.now() })));
  await deleteRow(env, kOf(BROKEN_KEY, pid));
}

// 其他組別存好的粉專權杖（方案 A：使用中那組沒有這個粉專時，已排程的留言／封面／改時間改用其他組）
export async function otherPageTokens(env) {
  const st = await readProfiles(env);
  const cur = await profileId(env);
  const out = [];
  for (const p of st.list) {
    if (p.id === cur) continue;
    const s = await storedPageTokens(forProfile(env, p.id));
    if (s) out.push({ pid: p.id, pages: s.pages });
  }
  return out;
}

// 發文遇到權杖失效：記在那個權杖所屬的組別（只記第一次）；讀不到回 null
export async function markBroken(env, token) {
  if (!env.DB) return;
  const pid = (token && tokenProfile(env, token)) || await profileId(env);
  const k = kOf(BROKEN_KEY, pid);
  try { if (!(await readRow(env, k))) await writeRow(env, k, String(Date.now())); } catch { /* 記不了就算了 */ }
}
export async function brokenAt(env) {
  const v = Number(await readRow(env, kOf(BROKEN_KEY, await profileId(env))));
  return Number.isFinite(v) && v > 0 ? v : null;
}
export async function clearBroken(env) { try { await deleteRow(env, kOf(BROKEN_KEY, await profileId(env))); } catch { /* 沒表就算了 */ } }

// 這個執行個體發出去過的粉專權杖（graph.js 遇到權杖失效時，只有粉專權杖才記失效旗標；使用者權杖驗證失敗不算）
//   權杖 → 所屬組別（null＝不確定，記在使用中那組）
const handed = new WeakMap();
const rootEnv = (env) => { let e = env; while (e && Object.prototype.hasOwnProperty.call(e, '__fbProfile')) e = Object.getPrototypeOf(e); return e; };
export function notePageTokens(env, list, pid = null) {
  const r = rootEnv(env);
  if (!r || typeof r !== 'object') return;
  let m = handed.get(r);
  if (!m) handed.set(r, (m = new Map()));
  for (const p of list) if (p && p.token) m.set(p.token, pid || m.get(p.token) || null);
}
export const isPageToken = (env, t) => { const r = rootEnv(env); return !!(r && typeof r === 'object' && handed.has(r) && handed.get(r).has(t)); };
const tokenProfile = (env, t) => { const r = rootEnv(env); return (r && handed.has(r) && handed.get(r).get(t)) || null; };

// App 密鑰：管理頁存的優先，否則 Secrets FB_APP_ID／FB_APP_SECRET；都沒有或格式不對回 null
// 回 { appId, secret, source:'admin'|'secret', savedAt }（secret 只給後端用，不能回傳前端）
export async function appCred(env) {
  const pid = await profileId(env);
  const v = await readRow(env, kOf(APP_KEY, pid));
  if (v) {
    const plain = await decryptToken(env, v);
    try {
      const o = plain ? JSON.parse(plain) : null;
      if (o && APP_ID_RE.test(String(o.appId)) && APP_SECRET_RE.test(String(o.secret))) {
        return { appId: String(o.appId), secret: String(o.secret), source: 'admin', savedAt: Number(o.savedAt) || null };
      }
    } catch { /* 壞掉就退回 Secret */ }
  }
  if (pid !== DEFAULT_PROFILE) return null;
  const id = typeof env.FB_APP_ID === 'string' ? env.FB_APP_ID.trim() : '';
  const sec = typeof env.FB_APP_SECRET === 'string' ? env.FB_APP_SECRET.trim() : '';
  if (id && sec) return { appId: id, secret: sec, source: 'secret', savedAt: null };
  return null;
}
export async function saveAppCred(env, appId, secret) {
  await writeRow(env, kOf(APP_KEY, await profileId(env)), await encryptToken(env, JSON.stringify({ appId, secret, savedAt: Date.now() })));
}
export async function clearAppCred(env) { await deleteRow(env, kOf(APP_KEY, await profileId(env))); }
// 所有組別的 App 密鑰（Webhook 簽章：任一組驗得過就算；使用中那組排第一）
export async function allAppCreds(env) {
  const st = await readProfiles(env);
  const ids = [st.active, ...st.list.map((p) => p.id).filter((id) => id !== st.active)];
  const out = [];
  for (const id of ids) { const c = await appCred(forProfile(env, id)); if (c && !out.some((x) => x.appId === c.appId && x.secret === c.secret)) out.push(c); }
  return out;
}
