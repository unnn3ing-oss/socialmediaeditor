// 回覆格式與 CORS
export const DEFAULT_ORIGIN = 'https://unnn3ing-oss.github.io';

export const MESSAGES = {
  bad_password: '密碼不正確。',
  unauthorized: '需要登入。',
  not_found: '找不到。',
  too_large: '內容太大。',
  bad_request: '請求內容不正確。',
  misconfigured: '後端設定不完整，請檢查 Secrets。'
};
export const STATUS = { bad_password: 200, unauthorized: 401, not_found: 404, too_large: 413, bad_request: 400, misconfigured: 500 };

export function originAllowed(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)) return origin;
  if (env.ALLOW_LOCALHOST === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

export function corsHeaders(request, env) {
  const origin = originAllowed(request, env);
  const h = { Vary: 'Origin' };
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Tier';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

export function preflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export function json(request, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(request, env), ...extra }
  });
}
export const ok = (request, env, data, extra) => json(request, env, { ok: true, data }, 200, extra);
export function fail(request, env, code, message) {
  return json(request, env, { ok: false, code, error: message || MESSAGES[code] || code }, STATUS[code] || 400);
}

export const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// 讀請求本文位元組，超過上限回 null（先看 content-length，再實際計數）
export async function readBody(request, max) {
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) return null;
  const buf = new Uint8Array(await request.arrayBuffer());
  return buf.length > max ? null : buf;
}
