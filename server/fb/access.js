// 排程發布的開放／關閉：管理頁切換，存在 D1 fb_settings 一列（k='access'，v＝JSON {mode, reason}；舊版純字串也接受）
//   'company'＝開放（授權名單內的人依權限組使用）；'admin'＝關閉（只有管理員密碼登入與權限組有 bypass 的人能用，預設）
//   公司密碼登入（沒有員工編號）一律不能用排程發布
//   讀不到或值壞掉＝關閉（保守）；reason＝關閉原因（選填，≤100 字，開放後保留）
import { bearer } from '../core/auth.js';
import { fail } from '../core/http.js';
import { ensureSettings } from '../core/once.js';

const KEY = 'access';
export const ACCESS_MODES = ['admin', 'company'];

async function ensureTable(env) {
  await ensureSettings(env);
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

export const ADMIN_WHO = { uid: 'ADMIN', name: '管理員' };

// 目前登入者：{ who:{uid,name}, admin, staff, perms, mode, reason }；需要 need 權限（null＝名單內即可；陣列＝其中任一個即可）
// 不通過回 { denied: Response }
export async function fbAccess(request, env, need = null) {
  const t = await bearer(request, env, 'company');
  if (!t) return { denied: fail(request, env, 'unauthorized') };
  const st = await accessState(env);
  if (!t.staff) return { denied: fail(request, env, 'fb_need_staff') };
  const perms = t.staff.perms;
  // 系統管理者（SYS_STAFF_ID）：等同舊版首頁管理員，全部權限、關閉時也能用，操作紀錄記本人
  if (t.staff.level === 'sys') return { who: { uid: t.staff.id, name: t.staff.name }, admin: true, staff: t.staff, perms, mode: st.mode, reason: st.reason };
  if (st.mode !== 'company' && !perms.includes('bypass')) return { denied: fail(request, env, 'fb_forbidden', undefined, { reason: st.reason }) };
  if (need && !(Array.isArray(need) ? need : [need]).some((p) => perms.includes(p))) return { denied: fail(request, env, 'fb_no_perm') };
  return { who: { uid: t.staff.id, name: t.staff.name }, admin: false, staff: t.staff, perms, mode: st.mode, reason: st.reason };
}
