// 留言失敗通知（排程發布、影片發布共用）
//   計時器（timer.js）在某則留言失敗累計 ≥2 次、或判定失敗時寫一筆；重新留言成功／取消就刪。只存 D1，不打臉書。
//   員工權限組有 notify（系統管理者一律有）才看得到：GET /staff/me/notices（auth.js）。保留 7 天。
//   最後判定失敗時另寫一筆錯誤日誌（logs，tool＝fbpost／fbvideo，code＝comment_failed[:錯誤碼]，page＝粉專 ID）。
import { ensureOnce } from '../core/once.js';
import { all, run } from '../core/db.js';
import { logEvent } from '../core/logs.js';

const SQL = 'CREATE TABLE IF NOT EXISTS fb_notices (post_id TEXT PRIMARY KEY, page TEXT NOT NULL, kind TEXT NOT NULL, seq INTEGER NOT NULL, error TEXT NOT NULL, failed INTEGER NOT NULL, at INTEGER NOT NULL)';
export const NOTICE_KEEP_DAYS = 7;
export const MAX_NOTICES = 50;
const DAY = 86400000;
const ensure = (env) => ensureOnce(env.DB, SQL);

// a＝{ seq, error, failed }；null＝沒事（刪除）
export async function setNotice(env, { postId, pageId, kind }, a) {
  if (!env.DB) return;
  await ensure(env);
  if (!a) { await run(env, 'DELETE FROM fb_notices WHERE post_id = ?', String(postId)); return; }
  await run(env, 'INSERT INTO fb_notices (post_id, page, kind, seq, error, failed, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(post_id) DO UPDATE SET page = excluded.page, kind = excluded.kind, seq = excluded.seq, error = excluded.error, failed = excluded.failed, at = excluded.at',
    String(postId), String(pageId), kind === 'video' ? 'video' : 'post', a.seq, String(a.error || '').slice(0, 200), a.failed ? 1 : 0, Date.now());
}

// 錯誤碼：臉書錯誤碼（數字）；沒有就只寫 comment_failed
export const failCode = (code) => 'comment_failed' + (Number.isInteger(code) && code > 0 ? ':' + code : '');
export async function logCommentFail(env, { pageId, kind }, code) {
  if (!env.DB) return;
  await logEvent(env, kind === 'video' ? 'fbvideo' : 'fbpost', failCode(code), String(pageId));
}

export async function listNotices(env) {
  if (!env.DB) return [];
  await ensure(env);
  const rows = await all(env, 'SELECT post_id, page, kind, seq, error, failed, at FROM fb_notices WHERE at >= ? ORDER BY at DESC LIMIT ?', Date.now() - NOTICE_KEEP_DAYS * DAY, MAX_NOTICES);
  let names = new Map();
  try { names = new Map((await all(env, 'SELECT id, short FROM fb_pages')).map((r) => [String(r.id), r.short])); } catch { /* 沒有粉專表就顯示 ID */ }
  return rows.map((r) => ({ postId: r.post_id, page: r.page, pageName: names.get(String(r.page)) || r.page, kind: r.kind, seq: r.seq, error: r.error, failed: !!r.failed, at: r.at }));
}

export async function cleanupNotices(env, nowMs) {
  if (!env.DB) return;
  await ensure(env);
  await run(env, 'DELETE FROM fb_notices WHERE at < ?', nowMs - NOTICE_KEEP_DAYS * DAY);
}
