// 臉書 Graph API 呼叫（集中一處）。版本以 Meta 官方文件最新版為準。
import { isPageToken, markBroken } from './tokenstore.js';
import { noteUsage, noteThrottle } from './usage.js';
import { zhError } from './errzh.js';
export const GRAPH = 'https://graph.facebook.com/v27.0';
export const GRAPH_VIDEO = 'https://graph-video.facebook.com/v27.0';   // 影片分段上傳（start／transfer／finish）

export class GraphError extends Error {
  // uncertain：連不上臉書或讀不到回應，臉書可能已經處理（發文類請求要當「待確認」，不能直接重送）
  // raw：臉書回傳的英文原文（message 已轉中文，見 errzh.js）
  constructor(code, message, status, subcode, uncertain = false, raw = '') {
    super(message || '臉書回應錯誤');
    this.code = code; this.status = status; this.subcode = subcode; this.uncertain = uncertain; this.raw = raw;
  }
}

// 限流：4 應用程式、17 使用者、32 粉專、613 呼叫太頻繁、80001 粉專流量
export const isRateLimit = (e) => !!e && [4, 17, 32, 613, 80001].includes(e.code);
// token 失效：190 無效／過期、102 工作階段
export const isTokenError = (e) => !!e && [190, 102].includes(e.code);

// method：GET／POST／DELETE；params：物件或 FormData；GET／DELETE 的參數放 query
export async function graph(env, method, path, params, token, base = GRAPH, { forceUsage = false } = {}) {
  const url = new URL(base + path);
  const init = { method };
  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    if (token) url.searchParams.set('access_token', token);
  } else if (params instanceof FormData) {
    if (token) params.set('access_token', token);
    init.body = params;
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    if (token) body.set('access_token', token);
    init.body = body;
  }
  let res, data;
  try {
    res = await fetch(url.toString(), init);
    data = await res.json().catch(() => null);
  } catch (e) {
    throw new GraphError(-1, '連不上臉書', 0, undefined, true);
  }
  try { await noteUsage(env, res.headers, { force: forceUsage }); } catch { /* 用量記錄失敗不影響呼叫 */ }
  if (res.ok && data == null) throw new GraphError(-1, '讀不到臉書的回應', res.status, undefined, true);
  if (!res.ok || !data || data.error) {
    const err = (data && data.error) || {};
    const code = Number(err.code) || -1;
    // 5xx／讀不到內容／臉書的「未知錯誤」(1)、「暫時無法服務」(2)：請求可能已被處理，發文要當待確認
    const uncertain = !res.ok && (res.status >= 500 || data == null || code === 1 || code === 2);
    if (isTokenError({ code }) && isPageToken(env, token)) await markBroken(env, token);   // 粉專權杖失效：管理頁與工具顯示提醒
    const raw = String(err.message || '');
    const msg = raw || code > 0 ? zhError(code, err.error_subcode, raw) : '臉書回應錯誤（HTTP ' + res.status + '）';
    if (isRateLimit({ code })) { try { await noteThrottle(env, code, msg); } catch { /* 記不了就算了 */ } }   // 管理頁「速率限制」顯示最近一次
    throw new GraphError(code, msg, res.status, err.error_subcode, uncertain, raw);
  }
  return data;
}

// 影片上傳主機（graph-video）；params 有 Blob 時請自己包成 FormData
export const graphVideo = (env, method, path, params, token) => graph(env, method, path, params, token, GRAPH_VIDEO);

// 短效使用者權杖 → 長效（約 60 天）：cred＝appCred() 的結果（App 密鑰只在後端，不經前端）；臉書拒絕丟 GraphError
export async function exchangeToken(env, ut, cred) {
  const d = await graph(env, 'GET', '/oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: cred.appId, client_secret: cred.secret, fb_exchange_token: ut
  }, null);
  if (!d || typeof d.access_token !== 'string' || !d.access_token) throw new GraphError(-1, '臉書沒有回傳長效權杖', 200);
  return d.access_token;
}

// 驗證 App ID＋App Secret 是一對（client_credentials 換得到 App 權杖）；不對丟 GraphError
export async function checkAppCred(env, appId, secret) {
  const d = await graph(env, 'GET', '/oauth/access_token', { grant_type: 'client_credentials', client_id: appId, client_secret: secret }, null);
  if (!d || typeof d.access_token !== 'string' || !d.access_token) throw new GraphError(-1, '臉書沒有回傳 App 權杖', 200);
  return true;
}
