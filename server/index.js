// 小編工具箱後端（Cloudflare Worker）。路由表見 docs/superpowers/specs/2026-11-05-toolbox-design.md 第 6 節
import { toolRoutes } from './routes.gen.js';
import { json, fail, preflight } from './core/http.js';
import { handleAuth } from './core/auth.js';
import { handleAssets } from './core/assets.js';
import { handleAdmin, adminExtras } from './core/admin.js';
import { handleLogs, adminLogs, cleanup } from './core/logs.js';
import { handleFetch } from './core/fetch.js';
import { handleFb, adminFb, adminPageMap, adminCommentPresets } from './core/fb.js';
import { handleRundown, adminRundown } from './core/rundown.js';
import { syncScheduled, cleanupComments } from './core/fbqueue.js';

export { CommentHub } from './core/fbqueue.js';

adminExtras.push(adminLogs, adminFb, adminPageMap, adminCommentPresets, adminRundown);

const TOOL_PREFIX = /^\/t\/([a-z][a-z0-9-]{1,30})(\/.*)?$/;

// 依序嘗試各模組；模組不處理就回 null
const modules = [
  (req, env, ctx, path) => handleAuth(req, env, path),
  (req, env, ctx, path) => handleAssets(req, env, path),
  (req, env, ctx, path) => handleLogs(req, env, path),
  (req, env, ctx, path) => handleFetch(req, env, path),
  (req, env, ctx, path) => handleFb(req, env, path),
  (req, env, ctx, path) => handleRundown(req, env, path),
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
    // 每天 03:17（UTC 19:17）清理；其他排程（每分鐘）做留言對時
    if (event && event.cron === '17 19 * * *') {
      ctx.waitUntil(Promise.all([cleanup(env, Date.now()), cleanupComments(env, Date.now()).catch(() => {})]));
    } else if (event && event.cron) {
      ctx.waitUntil(syncScheduled(env, Date.now()));
    } else {
      ctx.waitUntil(cleanup(env, Date.now()));
    }
  }
};
