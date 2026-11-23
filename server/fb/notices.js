// 留言失敗通知（排程發布、影片發布共用）
//   by＝發文者員工編號：發文者收自己的；系統管理者與權限組有 notify（接收所有人的通知）收全部；舊紀錄沒有 by 只有後者看得到
//   計時器（timer.js）在某則留言失敗累計 ≥2 次、或判定失敗時寫一筆；重新留言成功／取消就刪。只存 D1，不打臉書。
//   狀態（2026-11-23）：open（未處理）→ handled（發文者按已讀＝how read；按重新留言＝how retry）→ 結案（系統管理者／notify 按已讀＝刪除）
//     發文者只看 open；看全部的人看 open（紅）＋ handled（黃）。系統管理者在發文者處理前按已讀也直接結案（使用者選 1A）。
//     錯誤日誌（logs）有 post_id 的列同步記 st（open／read／retry／closed）、st_by、st_at。保留 7 天（2A：黃框最晚 7 天消失）。
//   最後判定失敗時另寫一筆錯誤日誌（logs，tool＝fbpost／fbvideo，code＝comment_failed[:錯誤碼]，page＝粉專 ID）。
import { ensureOnce } from '../core/once.js';
import { all, run } from '../core/db.js';
const all_ = all;
import { logEvent, setLogState } from '../core/logs.js';

const SQL = 'CREATE TABLE IF NOT EXISTS fb_notices (post_id TEXT PRIMARY KEY, page TEXT NOT NULL, kind TEXT NOT NULL, seq INTEGER NOT NULL, error TEXT NOT NULL, failed INTEGER NOT NULL, at INTEGER NOT NULL)';
export const NOTICE_KEEP_DAYS = 7;
export const MAX_NOTICES = 50;
const DAY = 86400000;
const COLS = ["ALTER TABLE fb_notices ADD COLUMN by TEXT NOT NULL DEFAULT ''", "ALTER TABLE fb_notices ADD COLUMN title TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE fb_notices ADD COLUMN state TEXT NOT NULL DEFAULT 'open'", "ALTER TABLE fb_notices ADD COLUMN how TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE fb_notices ADD COLUMN hby TEXT NOT NULL DEFAULT ''", "ALTER TABLE fb_notices ADD COLUMN hname TEXT NOT NULL DEFAULT ''", "ALTER TABLE fb_notices ADD COLUMN hat INTEGER NOT NULL DEFAULT 0"];
const byCol = new WeakMap();
async function ensure(env) {
  await ensureOnce(env.DB, SQL);
  // by 欄（2026-11-22 第三輪）：舊表自動補；欄位已存在算成功，其他錯誤下次再試
  let p = byCol.get(env.DB);
  if (!p) {
    // by 欄（發文者）、title 欄（貼文摘要，2026-11-23）
    p = Promise.all(COLS.map((sql) => env.DB.prepare(sql).run().catch((e) => { if (!/duplicate column/i.test(String(e && e.message))) byCol.delete(env.DB); }))).then(() => true);
    byCol.set(env.DB, p);
  }
  await p;
}

// a＝{ seq, error, failed }：寫成 open（狀態有變一律回到未處理）
// a＝null：retry＝{ uid, name }（重新留言後解決）→ 有通知就改 handled(retry)；canceled＝整則取消 → 刪除；
//          其他（自動重試成功）→ 只刪 open 的（發文者已讀過的留給看全部的人）
export async function setNotice(env, { postId, pageId, kind, by, title }, a, { retry = null, canceled = false } = {}) {
  if (!env.DB) return;
  await ensure(env);
  const id = String(postId);
  if (!a) {
    if (canceled) { await run(env, 'DELETE FROM fb_notices WHERE post_id = ?', id); return; }
    if (retry) {
      await run(env, "UPDATE fb_notices SET state = 'handled', how = 'retry', hby = ?, hname = ?, hat = ? WHERE post_id = ?", String(retry.uid || ''), String(retry.name || ''), Date.now(), id);
      await setLogState(env, id, 'retry', retry, ['open', 'read']);
      return;
    }
    await run(env, "DELETE FROM fb_notices WHERE post_id = ? AND state = 'open'", id);
    return;
  }
  await run(env, "INSERT INTO fb_notices (post_id, page, kind, seq, error, failed, at, by, title, state, how, hby, hname, hat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', '', '', '', 0) ON CONFLICT(post_id) DO UPDATE SET page = excluded.page, kind = excluded.kind, seq = excluded.seq, error = excluded.error, failed = excluded.failed, at = excluded.at, by = excluded.by, title = excluded.title, state = 'open', how = '', hby = '', hname = '', hat = 0",
    id, String(pageId), kind === 'video' ? 'video' : 'post', a.seq, String(a.error || '').slice(0, 200), a.failed ? 1 : 0, Date.now(), String(by || ''), String(title || '').slice(0, 60));
}

// 已讀：who＝{ uid, name }；all＝看全部的人（系統管理者／notify）→ 結案（刪除）；發文者 → handled(read)
// 回 'closed'／'read'／null（沒有這則或不是自己的）
export async function readNotice(env, postId, who, all) {
  if (!env.DB) return null;
  await ensure(env);
  const id = String(postId);
  const n = (await all_(env, 'SELECT by, state FROM fb_notices WHERE post_id = ?', id))[0];
  if (all) {
    if (n) await run(env, 'DELETE FROM fb_notices WHERE post_id = ?', id);
    const changed = await setLogState(env, id, 'closed', who, ['open', 'read', 'retry']);
    return n || changed ? 'closed' : null;
  }
  if (!n || n.by !== String(who.uid) || n.state !== 'open') return null;
  await run(env, "UPDATE fb_notices SET state = 'handled', how = 'read', hby = ?, hname = ?, hat = ? WHERE post_id = ?", String(who.uid), String(who.name || ''), Date.now(), id);
  await setLogState(env, id, 'read', who, ['open']);
  return 'read';
}

// 錯誤碼：臉書錯誤碼（數字）；沒有就只寫 comment_failed
export const failCode = (code) => 'comment_failed' + (Number.isInteger(code) && code > 0 ? ':' + code : '');
// raw：臉書英文原文（錯誤日誌 detail 欄）；rec 的貼文資訊一起記（貼文 ID、摘要、類型、發布時間、粉專完整名稱）
export async function logCommentFail(env, { pageId, postId, kind, title, ptype, at, pageName }, code, raw = '') {
  if (!env.DB) return;
  await logEvent(env, kind === 'video' ? 'fbvideo' : 'fbpost', failCode(code), String(pageId), raw,
    { post: postId, title, ptype, pubAt: at, pageName, st: 'open' });
}

// uid：只看這個人發的；null＝看全部
export async function listNotices(env, uid = null) {
  if (!env.DB) return [];
  await ensure(env);
  const since = Date.now() - NOTICE_KEEP_DAYS * DAY;
  const rows = uid === null
    ? await all(env, 'SELECT post_id, page, kind, seq, error, failed, at, by, title, state, how, hby, hname, hat FROM fb_notices WHERE at >= ? ORDER BY at DESC LIMIT ?', since, MAX_NOTICES)
    : await all(env, "SELECT post_id, page, kind, seq, error, failed, at, by, title, state, how, hby, hname, hat FROM fb_notices WHERE at >= ? AND by = ? AND state = 'open' ORDER BY at DESC LIMIT ?", since, String(uid), MAX_NOTICES);
  let names = new Map();
  try { names = new Map((await all(env, 'SELECT id, short FROM fb_pages')).map((r) => [String(r.id), r.short])); } catch { /* 沒有粉專表就顯示 ID */ }
  return rows.map((r) => ({ postId: r.post_id, page: r.page, pageName: names.get(String(r.page)) || r.page, kind: r.kind, seq: r.seq, error: r.error, failed: !!r.failed, at: r.at, by: r.by || '', title: r.title || '',
    state: r.state === 'handled' ? 'handled' : 'open', ...(r.state === 'handled' ? { how: r.how, hby: r.hby, hname: r.hname, hat: r.hat } : {}) }));
}

export async function cleanupNotices(env, nowMs) {
  if (!env.DB) return;
  await ensure(env);
  await run(env, 'DELETE FROM fb_notices WHERE at < ?', nowMs - NOTICE_KEEP_DAYS * DAY);
}
