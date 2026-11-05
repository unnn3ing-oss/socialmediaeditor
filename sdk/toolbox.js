// 工具唯一的入口：工具只能用這裡匯出的 tb。
import * as files from './files.js';
import { download, stampName } from './download.js';
import { createLog } from './log.js';
import { createExt } from './bridge.js';
import { createApi } from './api.js';
import { createAssets } from './assets.js';
import { createStatus } from './status.js';

const api = createApi();

let toolSpec = null;
async function getSpec(key) {
  if (!toolSpec) {
    try { toolSpec = (await (await fetch(new URL('tool.json', location.href))).json()).assets || {}; } catch { toolSpec = {}; }
  }
  return toolSpec[key] || null;
}
function isCompany() {
  try { return Boolean(window.parent !== window && window.parent.tbxShell?.company().unlocked); } catch { return false; }
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
  assets: createAssets({ api, getSpec, isCompany }),
  status: createStatus(),
};

globalThis.tb = tb;
