// 錯誤日誌：只送工具 id、錯誤代碼、版本、瀏覽器，不送任何使用者內容。
import { API_BASE } from '../shell/config.js';

export const SDK_VERSION = '1.0';

export function buildLogPayload(toolId, code, ver, ua) {
  const clean = String(code ?? '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 60);
  return { tool: toolId, code: clean, ver, ua };
}

export function createLog(toolId, { fetchFn = globalThis.fetch, ua = globalThis.navigator?.userAgent ?? '' } = {}) {
  return {
    error(code) {
      try {
        const body = JSON.stringify(buildLogPayload(toolId, code, SDK_VERSION, ua));
        const p = fetchFn(`${API_BASE}/logs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
        if (p && p.catch) p.catch(() => {});
      } catch { /* 日誌失敗一律靜默 */ }
    },
  };
}
