// 排程發布的存取權限。測試期間只給前端用管理密碼登入的人（公司憑證帶 adm）；正式開放改成 'company'。
import { bearer } from '../core/auth.js';
import { fail } from '../core/http.js';

export const FB_ACCESS = 'admin-front';   // 'admin-front' | 'company'

export async function fbAccess(request, env) {
  const t = await bearer(request, env, 'company');
  if (!t) return fail(request, env, 'unauthorized');
  if (FB_ACCESS === 'admin-front' && !t.adm) return fail(request, env, 'fb_forbidden');
  return null;
}
