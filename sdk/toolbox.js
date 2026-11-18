// 工具唯一的入口：工具只能用這裡匯出的 tb。
import * as files from './files.js';
import { download, stampName } from './download.js';
import { createLog } from './log.js';
import { createExt } from './bridge.js';
import { createApi } from './api.js';
import { createAssets } from './assets.js';
import { createStatus } from './status.js';

const api = createApi();

// tool.json 只抓一次：同時要好幾個素材時共用同一個請求。
let toolSpec = null;
async function getSpec(key) {
  if (!toolSpec) {
    toolSpec = fetch(new URL('tool.json', location.href)).then((r) => r.json()).then((j) => j.assets || {}).catch(() => ({}));
  }
  return (await toolSpec)[key] || null;
}
function isCompany() {
  try { return Boolean(window.parent !== window && window.parent.tbxShell?.company().unlocked); } catch { return false; }
}
// 網站用管理密碼登入（公司憑證帶 adm:1）：素材公司版與通用版都列出來
function isAdmin() {
  try { const c = window.parent !== window && window.parent.tbxShell?.company(); return Boolean(c && c.unlocked && c.admin); } catch { return false; }
}

// 員工編號登入的資料 { id, name, group }；公司密碼／管理密碼／沒登入回 null
function staffInfo() {
  try { const c = window.parent !== window && window.parent.tbxShell?.company(); const s = c && c.unlocked && c.staff; return s ? { id: s.id, name: s.name, group: s.group } : null; } catch { return null; }
}
// 請外殼跳出登入視窗（單獨開啟工具頁時無效，靜默）
function login() {
  try { window.parent.dispatchEvent(new window.parent.CustomEvent('tbx:company-login', { detail: { fresh: true } })); } catch { /* 靜默 */ }
}

export const tb = {
  toolId: null,
  init(toolId) {
    tb.toolId = toolId;
    tb.log = createLog(toolId);
    return tb;
  },
  files,
  download,
  stampName,
  log: createLog('unknown'),
  ext: createExt(),
  api,
  assets: createAssets({ api, getSpec, isCompany, isAdmin }),
  status: createStatus(),
  company: { staff: staffInfo, login },
};

globalThis.tb = tb;
