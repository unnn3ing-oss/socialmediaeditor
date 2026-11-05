// 後端呼叫：自動帶公司憑證（localStorage['tbx.company'] = { token, exp(秒) }）。
import { API_BASE } from '../shell/config.js';

export const COMPANY_KEY = 'tbx.company';

export function readCompany(storage, nowMs = Date.now()) {
  try {
    const v = JSON.parse(storage.getItem(COMPANY_KEY));
    if (v && typeof v.token === 'string' && typeof v.exp === 'number' && v.exp * 1000 > nowMs) return v;
  } catch { /* 沒有憑證 */ }
  return null;
}

// fetchFn、storage、now 可注入，方便 Node 測試。
export function createApi({ fetchFn = (...a) => globalThis.fetch(...a), storage = globalThis.localStorage, base = API_BASE, now = Date.now } = {}) {
  return {
    async call(path, { method = 'GET', body, raw = false } = {}) {
      const headers = {};
      const cred = readCompany(storage, now());
      if (cred) headers.Authorization = `Bearer ${cred.token}`;
      const init = { method, headers };
      if (body !== undefined) {
        if (raw) init.body = body;
        else { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
      }
      const res = await fetchFn(base + path, init);
      if (raw) {
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `http_${res.status}` });
        return res;
      }
      let j;
      try { j = await res.json(); } catch { throw Object.assign(new Error('伺服器回應格式不對'), { code: 'bad_response' }); }
      if (!j || !j.ok) throw Object.assign(new Error(j?.error || '呼叫失敗'), { code: j?.code || `http_${res.status}` });
      if (j.data && j.data.renew && typeof j.data.renew.token === 'string') {
        try { storage.setItem(COMPANY_KEY, JSON.stringify({ token: j.data.renew.token, exp: j.data.renew.exp })); } catch { /* 靜默 */ }
      }
      return j.data;
    },
  };
}
