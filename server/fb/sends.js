// 防重複發文：同一則發文（前端的 sendId）對同一個粉專只會真正送一次
// D1 fb_sends：pending＝處理中（或 Worker 中斷）、ok＝已成功、failed＝確定失敗（可重送）、unknown＝結果不明（待確認）
const ready = new WeakSet();   // 依 D1 綁定記錄，每個執行個體只建一次表
export const SEND_KEEP_DAYS = 7;
const STALE_MS = 2 * 60 * 1000;   // pending 超過 2 分鐘視為中斷，使用者確認後可重送

async function ensure(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fb_sends (send_id TEXT NOT NULL, page TEXT NOT NULL, status TEXT NOT NULL, post_id TEXT NOT NULL DEFAULT '', scheduled INTEGER NOT NULL DEFAULT 0, at INTEGER, updated INTEGER NOT NULL, PRIMARY KEY (send_id, page))"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fb_sends_updated ON fb_sends(updated)')
  ]);
  ready.add(env.DB);
}

// 搶到這個粉專的發送權回 { claimed:true }；否則回先前的紀錄 { claimed:false, status, postId, scheduled, at }
// retry＝使用者已確認要重送「待確認」的（unknown，或中斷超過 2 分鐘的 pending）
export async function claimSend(env, sendId, page, { retry = false, scheduled = false, at = null } = {}) {
  await ensure(env);
  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO fb_sends (send_id, page, status, post_id, scheduled, at, updated) VALUES (?, ?, 'pending', '', ?, ?, ?) " +
    "ON CONFLICT(send_id, page) DO UPDATE SET status = 'pending', post_id = '', scheduled = excluded.scheduled, at = excluded.at, updated = excluded.updated " +
    "WHERE fb_sends.status = 'failed' OR (? = 1 AND (fb_sends.status = 'unknown' OR (fb_sends.status = 'pending' AND fb_sends.updated < ?)))"
  ).bind(sendId, page, scheduled ? 1 : 0, at, now, retry ? 1 : 0, now - STALE_MS).run();
  if (r && r.meta && r.meta.changes > 0) return { claimed: true };
  const row = await env.DB.prepare('SELECT status, post_id, scheduled, at FROM fb_sends WHERE send_id = ? AND page = ?').bind(sendId, page).first();
  if (!row) return { claimed: true };   // 理論上不會發生
  return { claimed: false, status: row.status, postId: row.post_id, scheduled: !!row.scheduled, at: row.at };
}

// 記下結果；寫不進去不影響這次回應（紀錄停在 pending，之後同一則再送會當待確認）
export async function finishSend(env, sendId, page, status, postId = '') {
  try {
    await env.DB.prepare('UPDATE fb_sends SET status = ?, post_id = ?, updated = ? WHERE send_id = ? AND page = ?').bind(status, postId, Date.now(), sendId, page).run();
  } catch { /* 靜默 */ }
}

export async function cleanupSends(env, nowMs) {
  try { await ensure(env); await env.DB.prepare('DELETE FROM fb_sends WHERE updated < ?').bind(nowMs - SEND_KEEP_DAYS * 86400000).run(); } catch { /* 靜默 */ }
}
