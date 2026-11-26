// 小編工具箱後端（Cloudflare Worker）。路由表見 docs/superpowers/specs/2026-11-05-toolbox-design.md 第 6 節
import { toolRoutes } from './routes.gen.js';
import { json, fail, preflight } from './core/http.js';
import { handleAuth } from './core/auth.js';
import { handleAssets } from './core/assets.js';
import { handleAdmin, adminExtras } from './core/admin.js';
import { handleLogs, adminLogs, cleanup } from './core/logs.js';
import { handleFetch } from './core/fetch.js';
import { handleFb, adminFb } from './fb/index.js';
import { handleFbHook } from './fb/webhook.js';
import { adminGuard, cleanupGuard } from './fb/guard.js';
import { cleanupSends } from './fb/sends.js';
import { cleanupNotices } from './fb/notices.js';
import { adminStaff, cleanupAudit } from './core/staff.js';
import { adminMsgs, cleanupMsgs } from './core/msgs.js';
import { handleSiteVis, adminSiteVis } from './core/sitevis.js';
import { adminSelfReg } from './core/selfreg.js';

adminExtras.push(adminLogs, adminGuard, adminFb, adminStaff, adminMsgs, adminSiteVis, adminSelfReg);

const TOOL_PREFIX = /^\/t\/([a-z][a-z0-9-]{1,30})(\/.*)?$/;

// 依序嘗試各模組；模組不處理就回 null
const modules = [
  (req, env, ctx, path) => handleAuth(req, env, path),
  (req, env, ctx, path) => handleSiteVis(req, env, path),
  (req, env, ctx, path) => handleAssets(req, env, path),
  (req, env, ctx, path) => handleLogs(req, env, path),
  (req, env, ctx, path) => handleFetch(req, env, path),
  (req, env, ctx, path) => handleFbHook(req, env, path, ctx),
  (req, env, ctx, path) => handleFb(req, env, ctx, path),
  (req, env, ctx, path) => handleAdmin(req, env, path)
];

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'OPTIONS') return preflight(request, env);
      const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

      const tm = TOOL_PREFIX.exec(path);
      if (tm) {
        const mod = Object.prototype.hasOwnProperty.call(toolRoutes, tm[1]) ? toolRoutes[tm[1]] : null;
        if (!mod || typeof mod.handle !== 'function') return fail(request, env, 'not_found');
        return await mod.handle(request, env, ctx, tm[2] || '/');
      }

      for (const m of modules) {
        const res = await m(request, env, ctx, path);
        if (res) return res;
      }
      return fail(request, env, 'not_found');
    } catch (e) {
      return json(request, env, { ok: false, code: 'misconfigured', error: '後端發生未預期的錯誤。' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // 每天 03:17（UTC 19:17）清理日誌與排程發布操作紀錄（90 天）、防重複發文紀錄（7 天）、留言守門紀錄（30 天）
    ctx.waitUntil(Promise.all([cleanup(env, Date.now()), cleanupAudit(env, Date.now()), cleanupSends(env, Date.now()), cleanupGuard(env, Date.now()), cleanupNotices(env, Date.now()).catch(() => {}), cleanupMsgs(env, Date.now())]));
  }
};
export { FbCommentTimer } from './fb/timer.js';
