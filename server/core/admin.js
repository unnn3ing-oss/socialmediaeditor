import { fail } from './http.js';
import { bearer, loginWith } from './auth.js';
import { adminList, adminPut, adminDelete } from './assets.js';

export const ADMIN_TTL = 12 * 3600;
// 管理頁放在網站上（admin/index.html）；舊的 後端網址/admin 轉過去，舊書籤照樣能用
export const ADMIN_PAGE = 'https://unnn3ing-oss.github.io/socialmediaeditor/admin/';

// 其他模組可在這裡掛上自己的管理路由：(request, env, path) => Response | null，已通過 admin 驗證
export const adminExtras = [];

export async function handleAdmin(request, env, path) {
  if (path !== '/admin' && !path.startsWith('/admin/')) return null;

  if (path === '/admin' && request.method === 'GET') {
    return new Response(null, { status: 302, headers: { location: ADMIN_PAGE, 'cache-control': 'no-store' } });
  }
  if (path === '/admin/login' && request.method === 'POST') {
    return loginWith(request, env, 'admin', 'ADMIN_PASSWORD', ADMIN_TTL);
  }

  if (!(await bearer(request, env, 'admin'))) return fail(request, env, 'unauthorized');

  if (path === '/admin/assets' && request.method === 'GET') return adminList(request, env);
  const m = /^\/admin\/assets\/([^/]+)$/.exec(path);
  if (m) {
    if (request.method === 'PUT') return adminPut(request, env, m[1]);
    if (request.method === 'DELETE') return adminDelete(request, env, m[1]);
  }
  for (const extra of adminExtras) {
    const res = await extra(request, env, path);
    if (res) return res;
  }
  return fail(request, env, 'not_found');
}
