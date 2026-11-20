// 粉專清單：
//   管理頁「驗證並儲存」時已換好、存進 D1 的粉專權杖（不會過期）優先；
//   沒有時（例：只設 Secret FB_USER_TOKEN）用使用者權杖 → /me/accounts（不足時用精細範圍逐一查）取各粉專 token（KV 快取 1 小時）
//   ＋ D1 fb_pages 的顯示設定
//   權杖組別（tokenstore.js）：粉專清單只列「使用中」那組；pageTokens 另外補上其他組存好的粉專（方案 A：切換後已排程的留言、封面、改時間仍可用）
import { graph, isTokenError, exchangeToken } from './graph.js';
import { userToken, storedPageTokens, savePageTokens, notePageTokens, brokenAt, appCred, profileId, otherPageTokens, DEFAULT_PROFILE } from './tokenstore.js';

const CACHE_KEY = 'fb:accounts';
const CACHE_TTL = 3600;
const NONE_KEY = 'fb:accounts:none';
const NONE_TTL = 60;
export const RD_CODES = ['', 'news', 'ent', 'shaokang', 'intl'];
export const NEEDED_PERMS = ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement', 'pages_read_user_content'];

export class FbSetupError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// 精細範圍（授權時勾選的粉專）裡有發文權限的粉專 ID；讀不到回 []
const MAX_GRANULAR = 50;
async function granularPageIds(env, ut) {
  const d = await graph(env, 'GET', '/debug_token', { input_token: ut }, ut);
  const scopes = (d && d.data && Array.isArray(d.data.granular_scopes)) ? d.data.granular_scopes : [];
  const pick = (name) => { const g = scopes.find((x) => x && x.scope === name); return g && Array.isArray(g.target_ids) ? g.target_ids.map(String) : []; };
  const ids = pick('pages_manage_posts');
  return [...new Set(ids.length ? ids : pick('pages_show_list'))].filter((id) => /^\d{1,30}$/.test(id)).slice(0, MAX_GRANULAR);
}

// 取各粉專 { id, name, token }；沒設 token → fb_off；token 壞了 → fb_token
// 先走 /me/accounts，再查一次 debug_token；精細範圍裡 /me/accounts 沒列到的（例：從企業管理平台指派的粉專，/me/accounts 回空），
// 改用精細範圍的粉專 ID 逐一查 /{id}?fields=name,access_token 換粉專 token
const cacheKeys = (pid) => (pid === DEFAULT_PROFILE ? [CACHE_KEY, NONE_KEY] : [CACHE_KEY + '@' + pid, NONE_KEY + '@' + pid]);

// 使用中（或 forProfile 指定）那一組的粉專：粉專清單、管理頁狀態用
export async function activePageTokens(env) {
  const pid = await profileId(env);
  const [cKey, nKey] = cacheKeys(pid);
  const st = await storedPageTokens(env);
  if (st) { notePageTokens(env, st.pages, pid); return new Map(st.pages.map((p) => [p.id, p])); }
  let list = null;
  try { list = env.CACHE ? await env.CACHE.get(cKey, 'json') : null; } catch { list = null; }
  if (Array.isArray(list)) { notePageTokens(env, list, pid); return new Map(list.map((p) => [p.id, p])); }
  const { token: ut } = await userToken(env);
  if (!ut) throw new FbSetupError('fb_off');
  let none = null;
  try { none = env.CACHE ? await env.CACHE.get(nKey) : null; } catch { none = null; }
  if (none) throw new FbSetupError('fb_no_pages');   // 剛查過是空的：60 秒內不再逐頁查，避免限流
  list = await fetchPages(env, ut);
  if (!list.length) {   // 空的只記 60 秒（補權限後很快生效；「重新讀取粉專」會清掉）
    if (env.CACHE) { try { await env.CACHE.put(nKey, '1', { expirationTtl: NONE_TTL }); } catch { /* 記不了就算了 */ } }
    throw new FbSetupError('fb_no_pages');
  }
  if (env.CACHE) await env.CACHE.put(cKey, JSON.stringify(list), { expirationTtl: CACHE_TTL });
  notePageTokens(env, list, pid);
  return new Map(list.map((p) => [p.id, p]));
}

// 發文／留言／改時間／刪除／影片用：使用中那組優先，沒有的粉專再從其他組補（方案 A）
//   使用中那組讀不到（沒權杖、沒粉專、權杖壞）但其他組有存好的粉專時，就只用其他組；都沒有才丟原本的錯
export async function pageTokens(env) {
  let map = null, err = null;
  try { map = await activePageTokens(env); } catch (e) { if (!(e instanceof FbSetupError)) throw e; err = e; }
  const others = await otherPageTokens(env).catch(() => []);
  if (!map && !others.length) throw err;
  const out = map ? new Map(map) : new Map();
  for (const o of others) {
    notePageTokens(env, o.pages, o.pid);
    for (const p of o.pages) if (!out.has(p.id)) out.set(p.id, p);
  }
  if (!out.size && err) throw err;
  return out;
}

// 用指定的使用者權杖換出各粉專 token：[{ id, name, token }]；權杖壞了丟 fb_token
export async function fetchPages(env, ut) {
  const list = [];
  let after;
  try {
    for (let i = 0; i < 10; i++) {
      const d = await graph(env, 'GET', '/me/accounts', { fields: 'id,name,access_token', limit: 100, after }, ut);
      for (const p of d.data || []) if (p && p.id && p.access_token) list.push({ id: String(p.id), name: String(p.name || p.id), token: p.access_token });
      after = d.paging && d.paging.next && d.paging.cursors && d.paging.cursors.after;
      if (!after) break;
    }
  } catch (e) {
    if (isTokenError(e)) throw new FbSetupError('fb_token', e.message);
    throw e;
  }
  let ids = [];
  try { ids = await granularPageIds(env, ut); } catch (e) { if (isTokenError(e)) throw new FbSetupError('fb_token', e.message); ids = []; }
  const have = new Set(list.map((p) => p.id));
  for (const id of ids) {
    if (have.has(id)) continue;
    try {
      const p = await graph(env, 'GET', '/' + id, { fields: 'id,name,access_token' }, ut);
      if (p && p.access_token) { list.push({ id, name: String(p.name || id), token: p.access_token }); have.add(id); }
    } catch (e) { if (isTokenError(e)) throw new FbSetupError('fb_token', e.message); }   // 單一粉專拿不到就略過
  }
  return list;
}

export async function clearPageCache(env) {
  if (!env.CACHE) return;
  for (const k of cacheKeys(await profileId(env))) await env.CACHE.delete(k);
}

// 舊資料表沒有 utm_text（純文字貼文用的 UTM）→ 補欄位；每個執行個體只檢查一次
const colsOk = new WeakSet();   // 依 D1 綁定記錄
async function ensureCols(env) {
  if (colsOk.has(env.DB)) return;
  try { await env.DB.prepare("ALTER TABLE fb_pages ADD COLUMN utm_text TEXT NOT NULL DEFAULT ''").run(); }
  catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }
  colsOk.add(env.DB);
}

async function settings(env) {
  await ensureCols(env);
  const { results } = await env.DB.prepare('SELECT id, short, utm, utm_text, rd, ord, show FROM fb_pages').all();
  return new Map((results || []).map((r) => [r.id, r]));
}

// 合併臉書粉專與設定；all=false 只回「顯示」的；withToken＝後端內部用（數據報表），每列多帶 token，不可直接回給前端
export async function listPages(env, { all = false, withToken = false } = {}) {
  const [tokens, conf] = await Promise.all([activePageTokens(env), settings(env)]);
  const out = [];
  for (const p of tokens.values()) {
    const c = conf.get(p.id);
    const row = { id: p.id, name: p.name, short: c ? c.short : p.name, utm: c ? c.utm : '', utmText: c ? (c.utm_text || '') : '', rd: c ? c.rd : '', order: c ? c.ord : 999, show: c ? !!c.show : true };
    if (withToken) row.token = p.token;
    if (all || row.show) out.push(row);
  }
  out.sort((a, b) => a.order - b.order);   // 穩定排序：同順序（未設定）維持臉書回傳順序
  return out;
}

export async function pageSetting(env, pageId) {
  await ensureCols(env);
  const r = await env.DB.prepare('SELECT utm, utm_text, rd FROM fb_pages WHERE id = ?').bind(pageId).first();
  return { utm: r ? r.utm : '', utmText: r ? (r.utm_text || '') : '', rd: r ? r.rd : '' };
}
// text＝純文字貼文（沒附圖）用「文字」UTM，空白就不加；其他用「圖文」UTM
export const pageUtm = async (env, pageId, text = false) => { const s = await pageSetting(env, pageId); return text ? s.utmText : s.utm; };
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
    const utmText = typeof p.utmText === 'string' ? p.utmText.trim() : '';
    const n = [...short].length;
    if (n < 1 || n > 20 || utm.length > 200 || !UTM_RE.test(utm)) return null;
    if (utmText.length > 200 || !UTM_RE.test(utmText)) return null;
    if (!RD_CODES.includes(p.rd)) return null;
    if (!Number.isInteger(p.order) || p.order < 0 || p.order > 999) return null;
    seen.add(p.id);
    out.push({ id: p.id, short, utm, utmText, rd: p.rd, order: p.order, show: p.show ? 1 : 0 });
  }
  return out;
}

export async function savePages(env, pages) {
  await ensureCols(env);
  const now = Date.now();
  const stmts = pages.map((p) => env.DB.prepare(
    'INSERT INTO fb_pages (id, short, utm, utm_text, rd, ord, show, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET short = excluded.short, utm = excluded.utm, utm_text = excluded.utm_text, rd = excluded.rd, ord = excluded.ord, show = excluded.show, updated = excluded.updated'
  ).bind(p.id, p.short, p.utm, p.utmText || '', p.rd, p.order, p.show, now));
  if (stmts.length) await env.DB.batch(stmts);
}

// 權杖本身的資訊（debug_token）：{ type, valid, expires(0＝永不), dataExpires(資料存取期限，0／null＝沒有), app, appId, scopes }
// input＝要查的權杖，access＝拿來呼叫的權杖（預設同一個）
const secOrNull = (raw) => { const n = Number(raw); return raw === undefined || raw === null || !Number.isFinite(n) ? null : n; };
async function tokenInfo(env, input, access = input) {
  const d = await graph(env, 'GET', '/debug_token', { input_token: input }, access);
  const x = (d && d.data) || {};
  return {
    type: String(x.type || ''), valid: !!x.is_valid, app: String(x.application || ''), appId: x.app_id ? String(x.app_id) : '',
    expires: secOrNull(x.expires_at), dataExpires: secOrNull(x.data_access_expires_at),
    scopes: Array.isArray(x.scopes) ? x.scopes.map(String) : []
  };
}
const errText = (e) => String((e && e.message) || e).slice(0, 120);

// 用（已延長的）使用者權杖換粉專權杖，並確認粉專權杖不會過期：通過回 { ok:true, pages, dataExpires }，否則 { ok:false, error }
async function derivePages(env, ut, extended) {
  let pages;
  try { pages = await fetchPages(env, ut); } catch (e) { return { ok: false, error: e.code === 'fb_token' ? '權杖無效或已過期。' : '讀取粉專失敗：' + errText(e) }; }
  if (!pages.length) return { ok: false, error: '這個權杖換不到任何粉專：授權時要勾選粉專。' };
  let pinfo;
  try { pinfo = await tokenInfo(env, pages[0].token, ut); } catch (e) { return { ok: false, error: '讀不到粉專權杖的期限：' + errText(e) }; }
  if (pinfo.expires !== 0) {
    return { ok: false, error: extended
      ? '延長後換到的粉專權杖仍會過期，請重新產生權杖再試。'
      : '這是短效權杖，換到的粉專權杖約 1 小時就會失效。還沒設定「App 密鑰」，無法自動延長：請先到「存取權杖偵錯工具」按 Extend 再貼，或請 App 管理員在下方輸入 App 密鑰。' };
  }
  return { ok: true, pages, dataExpires: pinfo.dataExpires };
}

// 管理頁「驗證並儲存」：驗證 → 自動延長（有 App 密鑰時）→ 換粉專權杖並確認不過期 → 存使用者權杖與粉專權杖
// 通過回 { ok:true, ut(長效), extended, pages }，不通過回 { ok:false, error }（什麼都不存）
export async function connectToken(env, raw, save) {
  let info;
  try { info = await tokenInfo(env, raw); } catch (e) { return { ok: false, error: isTokenError(e) ? '權杖無效或已過期。' : '臉書驗證失敗：' + errText(e) }; }
  if (!info.valid) return { ok: false, error: '權杖無效或已過期。' };
  if (info.type && info.type !== 'USER') return { ok: false, error: `這是 ${info.type} 權杖，請貼「使用者權杖」（User）。` };
  if (info.scopes.length && !info.scopes.includes('pages_manage_posts')) return { ok: false, error: '權杖缺少 pages_manage_posts 權限。' };
  let ut = raw, extended = false;
  const cred = await appCred(env);
  if (cred) {
    if (info.appId && info.appId !== cred.appId) {
      return { ok: false, error: `這個權杖屬於另一個 App（${info.app || info.appId}），請在 Graph API Explorer 選 App ID ${cred.appId} 的 App 再產生。` };
    }
    try { ut = await exchangeToken(env, raw, cred); extended = true; } catch (e) {
      return { ok: false, error: '自動延長失敗：' + errText(e) + '。請確認「App 密鑰」和權杖是同一個 App（App Secret 換過要重新輸入）。' };
    }
  }
  const d = await derivePages(env, ut, extended);
  if (!d.ok) return d;
  let userExpires = info.expires;
  if (extended) { try { userExpires = (await tokenInfo(env, ut)).expires; } catch { userExpires = null; } }
  await save(ut, { pages: d.pages, expires: 0, dataExpires: d.dataExpires, userExpires, app: info.app || '' });
  return { ok: true, ut, extended, pages: d.pages.length };
}

// 管理頁「重新整理粉專」：有存好的粉專權杖時，使用者權杖還有效就重新換（新粉專會加進來）；過期就保留舊的
export async function refreshPages(env) {
  await clearPageCache(env);
  const st = await storedPageTokens(env);
  if (!st) return { cleared: true, renewed: false };
  const { token: ut } = await userToken(env);
  if (!ut) return { cleared: true, renewed: false, reason: 'no_user' };
  let d;
  try { d = await derivePages(env, ut, false); } catch (e) { if (isTokenError(e)) return { cleared: true, renewed: false, reason: 'user_expired' }; throw e; }
  if (!d.ok) return { cleared: true, renewed: false, reason: /無效或已過期/.test(d.error) ? 'user_expired' : 'failed', error: d.error };
  await savePageTokens(env, { pages: d.pages, expires: 0, dataExpires: d.dataExpires, userExpires: st.userExpires, app: st.app || '' });
  return { cleared: true, renewed: true, pages: d.pages.length };
}

// 到期／失效提醒（14 天內）：{ level:'warn'|'bad', days?, text } 或 null
//   有存粉專權杖：看資料存取期限（粉專權杖本身不過期）；沒有：看使用者權杖到期日
export const WARN_DAYS = 14;
export function tokenWarn({ stored, userExpires, valid = true, broken = null, now = Date.now() }) {
  if (!valid) return { level: 'bad', text: '臉書權杖已失效，請主管重新產生權杖，再到管理頁「臉書連線」換新。' };
  if (broken) return { level: 'bad', text: '發文時遇到臉書權杖失效，請到管理頁「臉書連線」檢查並換新權杖。' };
  const deadline = stored ? (stored.dataExpires || 0) : (userExpires || 0);
  if (!deadline) return null;
  const days = Math.ceil((deadline * 1000 - now) / 86400000);
  if (days > WARN_DAYS) return null;
  if (days <= 0) return { level: 'bad', days, text: '臉書權杖已到期，請主管重新產生權杖，再到管理頁「臉書連線」換新。' };
  return { level: 'warn', days, text: `臉書權杖 ${days} 天後到期，請主管重新產生權杖，再到管理頁「臉書連線」換新。` };
}

// 工具頁（管理員）用的提醒：不呼叫臉書，只看存好的期限與失效旗標
export async function quickWarn(env) {
  const [stored, broken] = await Promise.all([storedPageTokens(env), brokenAt(env)]);
  return tokenWarn({ stored, userExpires: null, broken });
}

// 管理頁「臉書連線」
//   valid＝能不能發文（有存粉專權杖時看粉專權杖，否則看使用者權杖）；userValid＝使用者權杖本身
//   stored＝存好的粉專權杖 { pages, expires, dataExpires, savedAt }（不含權杖）；autoExtend＝後端有沒有 App 密鑰
export async function tokenStatus(env) {
  const { token: ut, source } = await userToken(env);
  const autoExtend = !!(await appCred(env));
  if (!ut) return { configured: false, valid: false, userValid: false, expires: null, missing: NEEDED_PERMS.slice(), pages: 0, source: null, app: '', autoExtend, stored: null, broken: null, warn: null };
  const st = await storedPageTokens(env);
  let userValid = true, missing = NEEDED_PERMS.slice(), expires = null, pages = 0, app = '';
  try {
    const d = await graph(env, 'GET', '/me/permissions', {}, ut);
    const granted = new Set((d.data || []).filter((x) => x.status === 'granted').map((x) => x.permission));
    missing = NEEDED_PERMS.filter((p) => !granted.has(p));
  } catch (e) { if (isTokenError(e)) userValid = false; }
  if (userValid) { try { const i = await tokenInfo(env, ut); expires = i.expires; app = i.app; } catch { expires = null; } }
  let valid = userValid;
  if (st) {
    pages = st.pages.length;
    if (!userValid) missing = [];   // 使用者權杖過期查不到權限，不代表粉專權杖缺權限
    notePageTokens(env, st.pages, await profileId(env));
    try { const pi = await tokenInfo(env, st.pages[0].token); valid = pi.valid; if (!app) app = pi.app; } catch (e) { if (isTokenError(e)) valid = false; }
  } else if (userValid) {
    try { pages = (await activePageTokens(env)).size; } catch (e) { if (e.code === 'fb_token') valid = false; else if (e.code !== 'fb_no_pages') throw e; }
  }
  const broken = await brokenAt(env);
  const stored = st ? { pages: st.pages.length, expires: st.expires, dataExpires: st.dataExpires, savedAt: st.savedAt } : null;
  return { configured: true, valid, userValid, expires, missing, pages, source, app, autoExtend, stored, broken, warn: tokenWarn({ stored, userExpires: expires, valid, broken }) };
}
