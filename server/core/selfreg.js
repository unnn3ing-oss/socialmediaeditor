// 自行註冊（2026-11-26）：登入時查不到員工編號 → 註冊（員工編號兩次＋姓名）→ 回 10 分鐘一次性密碼 → 馬上設定自己的密碼並登入
//   註冊帳號＝授權名單 grp=0（沒有權限組）：工具權限全無；公司素材只放行進階設定勾選的工具用到的素材
//   管理者在授權名單指派權限組後就是一般員工（素材全開、權限照權限組）
//   設定存 D1 fb_settings k='self_reg'，v＝{"on":bool,"tools":["pattern",...]}；沒存過＝開放、全部可選工具（使用者 2026-11-26 選預設開啟）
//   GET／POST /admin/selfreg：進階設定「自行註冊」卡片（敏感卡片 selfreg）
import { ok, fail, readBody } from './http.js';
import { ensureSettings, cached, forget } from './once.js';
import { assetTools, toolNames } from '../assettools.gen.js';

const KEY = 'self_reg';
const CACHE_MS = 60 * 1000;
// 臉書相關工具一律不開放給註冊帳號（不列出、不能勾）
export const EXCLUDED = ['fbpost', 'fbvideo', 'fbreports'];
export const SELECTABLE = Object.keys(toolNames).filter((id) => !EXCLUDED.includes(id));
export const REG_PER_HOUR = 5;   // 同一個 IP 每小時最多註冊次數

export const cleanTools = (list) => (Array.isArray(list) && list.every((x) => typeof x === 'string') ? SELECTABLE.filter((id) => list.includes(id)) : null);

async function load(env) {
  try {
    await ensureSettings(env);
    const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first();
    if (!r) return { on: true, tools: SELECTABLE.slice() };
    const o = JSON.parse(r.v);
    return { on: !!(o && o.on === true), tools: cleanTools(o && o.tools) || [] };
  } catch {
    return { on: false, tools: [] };   // 讀不到或壞掉＝不開放註冊、註冊帳號不放行素材（保守）
  }
}
export const readSelfReg = (env) => cached(env.DB, KEY, CACHE_MS, () => load(env));

async function save(env, v) {
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(KEY, JSON.stringify(v), Date.now()).run();
  forget(env.DB, KEY);
}

// 註冊帳號（staff.self）能不能讀這個公司素材：素材被任一個勾選的工具用到才行；其他人一律可以
export async function assetAllowed(env, staff, key) {
  if (!staff || !staff.self) return true;
  const tools = assetTools[key] || [];
  if (!tools.length) return false;
  const v = await readSelfReg(env);
  return tools.some((t) => v.tools.includes(t));
}

// 同一個 IP 每小時最多 REG_PER_HOUR 次（KV，不保證原子；只是擋大量濫用）。超過回 false
export async function takeRegSlot(env, request, nowMs = Date.now()) {
  if (!env.CACHE) return true;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const k = 'selfreg:' + ip + ':' + Math.floor(nowMs / 3600000);
  try {
    const n = Number(await env.CACHE.get(k)) || 0;
    if (n >= REG_PER_HOUR) return false;
    await env.CACHE.put(k, String(n + 1), { expirationTtl: 3700 });
  } catch { /* KV 壞掉不擋註冊 */ }
  return true;
}

// 管理頁：GET／POST /admin/selfreg（已通過 gate）
export async function adminSelfReg(request, env, path) {
  if (path !== '/admin/selfreg') return null;
  const options = SELECTABLE.map((id) => ({ id, name: toolNames[id] }));
  if (request.method === 'GET') return ok(request, env, { ...(await load(env)), options });
  if (request.method !== 'POST') return null;
  const buf = await readBody(request, 4096);
  let b = null;
  try { b = buf ? JSON.parse(new TextDecoder().decode(buf)) : null; } catch { b = null; }
  const tools = b && typeof b.on === 'boolean' ? cleanTools(b.tools) : null;
  if (!tools) return fail(request, env, 'bad_request');
  const v = { on: b.on, tools };
  await save(env, v);
  return ok(request, env, { ...v, options });
}
