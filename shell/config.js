// 外殼與 SDK 共用的常數。
export const SITE = 'https://unnn3ing-oss.github.io/socialmediaeditor/';
export const PROD_API_BASE = 'https://toolbox-api.19jpz-3.workers.dev';
// 測試後端（wrangler.toml 的 [env.dev]）。只有正式後端用管理員密碼登入後，才能從登出視窗切過去。
export const DEV_API_BASE = 'https://toolbox-api-dev.19jpz-3.workers.dev';
export const API_ENV_KEY = 'tbx.api';

// 外掛側邊欄（panel.html 或被 chrome-extension:// 嵌入）一律走正式後端。
export function inExtension(loc) {
  if (!loc) return false;
  if (/\/panel\.html$/.test(loc.pathname || '')) return true;
  const anc = loc.ancestorOrigins;
  if (anc) for (let i = 0; i < anc.length; i++) if (String(anc[i]).startsWith('chrome-extension://')) return true;
  return false;
}

// 'dev'＝測試後端；其他（含讀不到 storage、Node 測試環境）＝'prod'
export function readApiEnv(storage, loc) {
  if (inExtension(loc)) return 'prod';
  try { return storage && storage.getItem(API_ENV_KEY) === 'dev' ? 'dev' : 'prod'; } catch { return 'prod'; }
}

const ls = (() => { try { return globalThis.localStorage; } catch { return null; } })();
export const API_ENV = readApiEnv(ls, globalThis.location);
export const API_BASE = API_ENV === 'dev' ? DEV_API_BASE : PROD_API_BASE;
export const EXT_NAME = '小編工具箱';
export const EXT_FOLDER = 'toolbox-ext';
export const REPO = { owner: 'unnn3ing-oss', repo: 'socialmediaeditor', branch: 'main' };
// 外掛固定 ID（manifest 的 key 算出，見 extension/core/id.js）；panel.html 只回覆這個外掛的側邊欄。
export const EXT_ORIGIN = 'chrome-extension://odajlpffjjeiliinefhimmbpdeeggckg';
