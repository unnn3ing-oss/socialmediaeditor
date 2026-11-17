// 排程發布的開放／關閉：管理頁切換，存在 D1 fb_settings 一列（k='access'，v＝JSON {mode, reason}；舊版純字串也接受）
//   'company'＝開放（公司帳號都能用）；'admin'＝關閉（只有前端用管理密碼登入的人能用，公司憑證帶 adm，預設）
//   讀不到或值壞掉＝關閉（保守）；reason＝關閉原因（選填，≤100 字，開放後保留）
import { bearer } from '../core/auth.js';
import { fail } from '../core/http.js';

const KEY = 'access';
export const ACCESS_MODES = ['admin', 'company'];

async function ensureTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
}

export const MAX_REASON = 100;
const cleanReason = (r) => (typeof r === 'string' ? [...r.trim()].slice(0, MAX_REASON).join('') : '');

// 回 { mode, reason }
export async function accessState(env) {
  let v;
  try { v = (await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first() || {}).v; } catch { v = null; }
  if (ACCESS_MODES.includes(v)) return { mode: v, reason: '' };   // 舊版純字串
  try {
    const o = JSON.parse(v);
    if (o && ACCESS_MODES.includes(o.mode)) return { mode: o.mode, reason: cleanReason(o.reason) };
  } catch { /* 壞掉＝關閉 */ }
  return { mode: 'admin', reason: '' };
}
export const accessMode = async (env) => (await accessState(env)).mode;

export async function setAccessState(env, { mode, reason }) {
  await ensureTable(env);
  const v = JSON.stringify({ mode, reason: cleanReason(reason) });
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(KEY, v, Date.now()).run();
}

export async function fbAccess(request, env) {
  const t = await bearer(request, env, 'company');
  if (!t) return fail(request, env, 'unauthorized');
  if (t.adm) return null;
  const st = await accessState(env);
  if (st.mode !== 'company') return fail(request, env, 'fb_forbidden', undefined, { reason: st.reason });
  return null;
}
