// 工具唯一的入口：工具只能用這裡匯出的 tb。
import * as files from './files.js';
import { download, stampName } from './download.js';
import { createLog } from './log.js';

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
};

globalThis.tb = tb;
