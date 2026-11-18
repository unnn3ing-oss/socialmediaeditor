// 臉書 Graph API 呼叫（集中一處）。版本以 Meta 官方文件最新版為準。
export const GRAPH = 'https://graph.facebook.com/v27.0';

export class GraphError extends Error {
  // uncertain：連不上臉書或讀不到回應，臉書可能已經處理（發文類請求要當「待確認」，不能直接重送）
  constructor(code, message, status, subcode, uncertain = false) {
    super(message || '臉書回應錯誤');
    this.code = code; this.status = status; this.subcode = subcode; this.uncertain = uncertain;
  }
}

// 限流：4 應用程式、17 使用者、32 粉專、613 呼叫太頻繁、80001 粉專流量
export const isRateLimit = (e) => !!e && [4, 17, 32, 613, 80001].includes(e.code);
// token 失效：190 無效／過期、102 工作階段
export const isTokenError = (e) => !!e && [190, 102].includes(e.code);

// method：GET／POST／DELETE；params：物件或 FormData；GET／DELETE 的參數放 query
export async function graph(env, method, path, params, token) {
  const url = new URL(GRAPH + path);
  const init = { method };
  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    url.searchParams.set('access_token', token);
  } else if (params instanceof FormData) {
    params.set('access_token', token);
    init.body = params;
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    body.set('access_token', token);
    init.body = body;
  }
  let res, data;
  try {
    res = await fetch(url.toString(), init);
    data = await res.json().catch(() => null);
  } catch (e) {
    throw new GraphError(-1, '連不上臉書', 0, undefined, true);
  }
  if (res.ok && data == null) throw new GraphError(-1, '讀不到臉書的回應', res.status, undefined, true);
  if (!res.ok || !data || data.error) {
    const err = (data && data.error) || {};
    const code = Number(err.code) || -1;
    // 5xx／讀不到內容／臉書的「未知錯誤」(1)、「暫時無法服務」(2)：請求可能已被處理，發文要當待確認
    const uncertain = !res.ok && (res.status >= 500 || data == null || code === 1 || code === 2);
    throw new GraphError(code, err.message || '臉書回應錯誤（HTTP ' + res.status + '）', res.status, err.error_subcode, uncertain);
  }
  return data;
}
