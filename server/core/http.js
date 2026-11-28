// 回覆格式與 CORS
export const DEFAULT_ORIGIN = 'https://unnn3ing-oss.github.io';

export const MESSAGES = {
  bad_password: '密碼不正確。',
  unauthorized: '需要登入。',
  forbidden: '沒有這個功能的權限。',
  not_found: '找不到。',
  too_large: '內容太大。',
  bad_request: '請求內容不正確。',
  misconfigured: '後端設定不完整，請檢查 Secrets。',
  fb_off: '後端尚未設定 FB_USER_TOKEN。',
  fb_token: '臉書 token 無效或過期。',
  fb_forbidden: '排程發布目前關閉。',
  bad_staff: '查不到這個員工編號，或已停用。',
  fb_need_staff: '排程發布需要用員工編號登入。',
  locked: '連續輸入錯誤太多次，請稍後再試。',
  need_setup: '這個帳號還沒設定密碼，請用設定碼設定。',
  setup_expired: '設定碼已過期或還沒發，請找管理者重置密碼拿新的設定碼。',
  fb_no_perm: '你的權限組不能使用這個功能。',
  fb_no_pages: '臉書 token 沒有可管理的粉專：授權時要勾選粉專，並有 pages_manage_posts 權限。',
  fb_error: '臉書回應錯誤。',
  fb_bad_time: '排程時間必須在 10 分鐘到 30 天之間。',
  rundown_off: '後端尚未設定 RUNDOWN_URL／RUNDOWN_TOKEN。',
  rundown_failed: '連不上 Rundown 的 Apps Script。',
  report_scope: '粉專、權杖組別或權限已變更，請重新查詢。',
  fb_retry: '這段影片沒有完整傳到臉書，會自動重送。',
  reg_closed: '目前沒有開放註冊，請找管理者幫你加入授權名單。',
  reg_taken: '無法用這個員工編號註冊。如果你已經在名單內，請直接登入；忘記密碼請找管理者重置。',
  reg_limit: '註冊次數太多，請一小時後再試。',
  reg_full: '目前待審核的註冊太多，請找管理者幫你加入授權名單。',
  fb_self_pending: '帳號尚未指派權限組，請聯絡管理者。'
};
export const STATUS = { bad_password: 200, unauthorized: 401, forbidden: 403, not_found: 404, too_large: 413, bad_request: 400, misconfigured: 500,
  fb_off: 503, fb_token: 502, fb_forbidden: 403, bad_staff: 200, locked: 429, need_setup: 200, setup_expired: 200, fb_need_staff: 403, fb_no_perm: 403, fb_no_pages: 503, fb_error: 502, fb_bad_time: 400, rundown_off: 503, rundown_failed: 502, report_scope: 409, warning_conflict: 409, fb_retry: 503, reg_closed: 403, reg_taken: 200, reg_limit: 429, reg_full: 503, fb_self_pending: 403 };

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
// detail：給前端顯示用的附加資料（例：停用原因），選填
export function fail(request, env, code, message, detail) {
  const body = { ok: false, code, error: message || MESSAGES[code] || code };
  if (detail !== undefined) body.detail = detail;
  return json(request, env, body, STATUS[code] || 400);
}

export const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// 讀請求本文位元組，超過上限回 null（先看 content-length，再實際計數）
export async function readBody(request, max) {
  const len = Number(request.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) return null;
  const buf = new Uint8Array(await request.arrayBuffer());
  return buf.length > max ? null : buf;
}
