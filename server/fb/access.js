// 排程發布的存取權限：管理頁切換，存在 D1 fb_settings 一列（k='access'）
//   'admin'＝只開放前端用管理密碼登入的人（公司憑證帶 adm，預設）；'company'＝開放給公司帳號
//   讀不到或值壞掉＝'admin'（保守）
import { bearer } from '../core/auth.js';
import { fail } from '../core/http.js';

const KEY = 'access';
export const ACCESS_MODES = ['admin', 'company'];

async function ensureTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
}

export async function accessMode(env) {
  try {
    const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first();
    return r && ACCESS_MODES.includes(r.v) ? r.v : 'admin';
  } catch { return 'admin'; }
}

export async function setAccessMode(env, mode) {
  await ensureTable(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(KEY, mode, Date.now()).run();
}

export async function fbAccess(request, env) {
  const t = await bearer(request, env, 'company');
  if (!t) return fail(request, env, 'unauthorized');
  if (!t.adm && (await accessMode(env)) !== 'company') return fail(request, env, 'fb_forbidden');
  return null;
}
