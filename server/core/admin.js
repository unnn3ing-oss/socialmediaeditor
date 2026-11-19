import { ok, fail } from './http.js';
import { loginWith } from './auth.js';
import { adminList, adminPut, adminDelete } from './assets.js';
import { adminWho, gate, meInfo, adminLevels } from './adminperm.js';

export const ADMIN_TTL = 12 * 3600;
// 管理頁只留網站版；後端 /admin 轉過去
export const ADMIN_URL = 'https://unnn3ing-oss.github.io/socialmediaeditor/admin/';

// 其他模組可在這裡掛上自己的管理路由：(request, env, path, who) => Response | null，已通過 adminWho 與卡片權限（adminperm.js）
export const adminExtras = [];

export async function handleAdmin(request, env, path) {
  if (path !== '/admin' && !path.startsWith('/admin/')) return null;

  if (path === '/admin' && request.method === 'GET') {
    return new Response(null, { status: 302, headers: { location: ADMIN_URL, 'cache-control': 'no-store' } });
  }
  if (path === '/admin/login' && request.method === 'POST') {
    return loginWith(request, env, 'admin', 'ADMIN_PASSWORD', ADMIN_TTL);
  }

  const who = await adminWho(request, env);
  if (!who) return fail(request, env, 'unauthorized');

  if (path === '/admin/me' && request.method === 'GET') {
    if (who.role !== 'sys' && !who.cards.size) return fail(request, env, 'forbidden');
    return ok(request, env, meInfo(who));
  }

  const denied = gate(request, env, who, path);
  if (denied) return denied;

  const lv = await adminLevels(request, env, path);
  if (lv) return lv;
  if (path === '/admin/assets' && request.method === 'GET') return adminList(request, env);
  const m = /^\/admin\/assets\/([^/]+)$/.exec(path);
  if (m) {
    if (request.method === 'PUT') return adminPut(request, env, m[1]);
    if (request.method === 'DELETE') return adminDelete(request, env, m[1]);
  }
  for (const extra of adminExtras) {
    const res = await extra(request, env, path, who);
    if (res) return res;
  }
  return fail(request, env, 'not_found');
}
