// 排程發布後端：/fb/*（測試期間只給管理員，見 access.js）與管理路由 /admin/fb/*、/admin/rundown*
import { ok, fail, readBody } from '../core/http.js';
import { fbAccess } from './access.js';
import { listPages, validPages, savePages, clearPageCache, tokenStatus, FbSetupError } from './pages.js';
import { GraphError } from './graph.js';
import { parsePostForm, createPosts, MAX_IMAGE } from './post.js';
import { rundownAdd, adminRundown } from './rundown.js';
import { pageToken, listScheduled, listPublished, reschedule, removePost, timeOk } from './manage.js';

// 把例外轉成回應：設定錯誤（fb_off／fb_token）、臉書錯誤（fb_error 附原因）
export function fbFail(request, env, e) {
  if (e instanceof FbSetupError) return fail(request, env, e.code);
  if (e instanceof GraphError) return fail(request, env, 'fb_error', '臉書：' + String(e.message).slice(0, 200));
  throw e;
}

export async function readJsonBody(request, max = 65536) {
  const buf = await readBody(request, max);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}

const routes = [];   // [method, RegExp, handler(request, env, ctx, match)]
export function route(method, re, handler) { routes.push([method, re, handler]); }

route('GET', /^\/fb\/pages$/, async (request, env) => {
  const pages = await listPages(env);
  return ok(request, env, pages.map((p) => ({ id: p.id, short: p.short, order: p.order, rd: p.rd })));
});

route('POST', /^\/fb\/post$/, async (request, env) => {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) return fail(request, env, 'bad_request');
  const buf = await readBody(request, MAX_IMAGE + 512 * 1024);
  if (!buf) return fail(request, env, 'too_large');
  let fd;
  try { fd = await new Response(buf, { headers: { 'content-type': ct } }).formData(); } catch { return fail(request, env, 'bad_request'); }
  const form = parsePostForm(fd);
  if (!form) return fail(request, env, 'bad_request');
  return ok(request, env, { results: await createPosts(env, form) });
});

route('GET', /^\/fb\/scheduled$/, async (request, env) => {
  const page = new URL(request.url).searchParams.get('page') || '';
  const token = await pageToken(env, page);
  if (!token) return fail(request, env, 'bad_request');
  return ok(request, env, await listScheduled(env, page, token));
});
route('GET', /^\/fb\/published$/, async (request, env) => {
  const q = new URL(request.url).searchParams;
  const page = q.get('page') || '';
  const after = q.get('after') || '';
  const token = await pageToken(env, page);
  if (!token || after.length > 500) return fail(request, env, 'bad_request');
  return ok(request, env, await listPublished(env, page, token, after));
});
route('POST', /^\/fb\/posts\/(\d{1,30}(?:_\d{1,30})?)\/(reschedule|cancel|delete)$/, async (request, env, ctx, m) => {
  const body = await readJsonBody(request, 4096);
  if (!body) return fail(request, env, 'bad_request');
  if (m[2] === 'reschedule' && !timeOk(body.at)) return fail(request, env, 'fb_bad_time');   // 先檢查時間，不碰臉書
  const token = await pageToken(env, body.page);
  if (!token) return fail(request, env, 'bad_request');
  if (m[2] === 'reschedule') {
    await reschedule(env, m[1], token, body.at);
  } else {
    await removePost(env, m[1], token);
  }
  return ok(request, env, { ok: true });
});

route('POST', /^\/rundown$/, async (request, env) => rundownAdd(request, env, await readJsonBody(request, 16384)));

export async function handleFb(request, env, ctx, path) {
  if (!path.startsWith('/fb/') && path !== '/rundown') return null;
  for (const [method, re, handler] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    if (request.method !== method) continue;
    const denied = await fbAccess(request, env);
    if (denied) return denied;
    try { return await handler(request, env, ctx, m); } catch (e) { return fbFail(request, env, e); }
  }
  return fail(request, env, 'not_found');
}

const adminRoutes = [];
export function adminRoute(method, re, handler) { adminRoutes.push([method, re, handler]); }

adminRoute('GET', /^\/admin\/fb\/status$/, async (request, env) => ok(request, env, await tokenStatus(env)));
adminRoute('GET', /^\/admin\/fb\/pages$/, async (request, env) => ok(request, env, await listPages(env, { all: true })));
adminRoute('POST', /^\/admin\/fb\/pages$/, async (request, env) => {
  const pages = validPages(await readJsonBody(request));
  if (!pages) return fail(request, env, 'bad_request');
  await savePages(env, pages);
  return ok(request, env, await listPages(env, { all: true }));
});
adminRoute('POST', /^\/admin\/fb\/refresh$/, async (request, env) => { await clearPageCache(env); return ok(request, env, { cleared: true }); });

// 掛在 core/admin.js 的 adminExtras（已通過管理憑證）
export async function adminFb(request, env, path) {
  const rd = await adminRundown(request, env, path);
  if (rd) return rd;
  for (const [method, re, handler] of adminRoutes) {
    const m = re.exec(path);
    if (!m || request.method !== method) continue;
    try { return await handler(request, env, m); } catch (e) { return fbFail(request, env, e); }
  }
  return null;
}
