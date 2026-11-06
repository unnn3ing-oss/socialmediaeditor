// 臉書「發文時留言」佇列＋總管。
// D1 `fb_comments` 是唯一資料來源；Durable Object `CommentHub` 只負責準時叫醒（鬧鐘）；
// 每分鐘 cron（syncScheduled）負責對時，也是沒有 DO 設定時的備援。
// token 一律走 fb.js 的 tokenFor／graph.js，不寫進 D1／KV／日誌；錯誤訊息一律先 scrub。
import { all, first, run } from './db.js';
import { graphGet, graphPost, GraphError, scrub } from './graph.js';
import { tokenFor } from './fb.js';

// 排程時間之後第幾秒檢查（最後一個＝上限，3 分鐘）
export const OFFSETS = [1, 3, 5, 7, 10, 15, 30, 60, 90, 120, 150, 180];
const DEADLINE_MS = OFFSETS[OFFSETS.length - 1] * 1000;
const DAY = 86400000;
export const COMMENT_KEEP_DAYS = 30;
const NOT_PUBLISHED = '3 分鐘內沒偵測到貼文發布';
const STATE_FIELDS = 'id,is_published,scheduled_publish_time';

// ---- 資料表（每個 isolate 只建一次） ----
const DDL = [
  'CREATE TABLE IF NOT EXISTS fb_page_map (page_id TEXT PRIMARY KEY, code TEXT, label TEXT, utm TEXT, sort INTEGER, updated INTEGER)',
  `CREATE TABLE IF NOT EXISTS fb_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL, post_id TEXT, photo_id TEXT, message TEXT NOT NULL,
    due INTEGER NOT NULL, next_check INTEGER NOT NULL, step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', error TEXT, comment_id TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS fb_comments_check ON fb_comments(status, next_check)',
  'CREATE INDEX IF NOT EXISTS fb_comments_post ON fb_comments(post_id)'
];
const ensured = new WeakSet();
export async function ensureTables(env) {
  if (!env.DB || ensured.has(env.DB)) return;
  for (const sql of DDL) await env.DB.prepare(sql).run();
  ensured.add(env.DB);
}

const errText = (env, e) => scrub(env, (e && e.message) || '未知錯誤');
const isMissing = (e) => e instanceof GraphError && e.fbCode === 100;
const timeOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// ---- 佇列操作 ----
// 新增一筆待留言；post 與 photo 至少一個。due＝預定發布秒；nextCheck＝毫秒
export async function enqueueComment(env, { page, post, photo, message, due, nextCheck, nowMs = Date.now() }) {
  await ensureTables(env);
  const r = await run(env,
    `INSERT INTO fb_comments (page_id, post_id, photo_id, message, due, next_check, step, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)`,
    page, post || null, photo || null, message, due, nextCheck, nowMs, nowMs);
  return r && r.meta ? r.meta.last_row_id : null;
}

// 貼文被取消／刪除：該貼文還在等的留言一併取消
export async function cancelForPost(env, post, reason = '貼文已取消', nowMs = Date.now()) {
  await ensureTables(env);
  await run(env, `UPDATE fb_comments SET status='canceled', error=?, updated=? WHERE post_id=? AND status='pending'`, reason, nowMs, post);
}

// 改排程時間：同貼文待留言項目的 due 改成新時間，檢查節奏重來
export async function rescheduleComments(env, post, time, nowMs = Date.now()) {
  await ensureTables(env);
  await run(env, `UPDATE fb_comments SET due=?, step=0, next_check=?, error=NULL, updated=? WHERE post_id=? AND status='pending'`,
    time, (time + OFFSETS[0]) * 1000, nowMs, post);
}

// 每篇貼文最新一筆留言狀態：Map(post_id → { id, status, error, message })
export async function commentsForPosts(env, posts) {
  const out = new Map();
  if (!posts.length) return out;
  await ensureTables(env);
  const rows = await all(env, `SELECT id, post_id, status, error, message FROM fb_comments WHERE post_id IN (${posts.map(() => '?').join(',')}) ORDER BY id ASC`, ...posts);
  for (const r of rows) out.set(r.post_id, { id: r.id, status: r.status, error: r.error || '', message: r.message });
  return out;
}

export async function listComments(env, { status = 'all', page = '', nowMs = Date.now() } = {}) {
  await ensureTables(env);
  const where = ['updated >= ?'], args = [nowMs - 7 * DAY];
  if (status === 'failed' || status === 'pending') { where.push('status = ?'); args.push(status); }
  if (page) { where.push('page_id = ?'); args.push(page); }
  const rows = await all(env, `SELECT id, page_id, post_id, photo_id, message, status, error, due, updated, dismissed FROM fb_comments WHERE ${where.join(' AND ')} ORDER BY updated DESC, id DESC LIMIT 100`, ...args);
  return rows.map((r) => ({ id: r.id, page: r.page_id, post: r.post_id || null, message: r.message, status: r.status, error: r.error || '', due: r.due, updated: r.updated, dismissed: !!r.dismissed }));
}

// 失敗的留言重試：回 true／false（不是 failed 就不處理）
export async function retryComment(env, id, nowMs = Date.now()) {
  await ensureTables(env);
  const row = await first(env, 'SELECT id, due, status FROM fb_comments WHERE id = ?', id);
  if (!row || row.status !== 'failed') return false;
  const nowSec = Math.floor(nowMs / 1000);
  const due = nowSec - row.due > 60 ? nowSec - 1 : row.due;   // 預定時間過太久：3 分鐘上限從現在重算
  await run(env, `UPDATE fb_comments SET status='pending', step=0, due=?, next_check=?, error=NULL, dismissed=0, updated=? WHERE id=? AND status='failed'`, due, nowMs, nowMs, id);
  return true;
}

export async function dismissComment(env, id, nowMs = Date.now()) {
  await ensureTables(env);
  const r = await run(env, 'UPDATE fb_comments SET dismissed=1, updated=? WHERE id=?', nowMs, id);
  return !!(r && r.meta && r.meta.changes);
}

// 每日清理：只清已結束的（排程最多 30 天後，待留言不能刪）
export async function cleanupComments(env, nowMs) {
  if (!env.DB) return;
  await ensureTables(env);
  await run(env, `DELETE FROM fb_comments WHERE status != 'pending' AND updated < ?`, nowMs - COMMENT_KEEP_DAYS * DAY);
}

// ---- 單筆狀態更新（都加 status='pending' 條件，避免蓋掉剛被取消的） ----
const finish = (env, row, status, error, nowMs, commentId = null) =>
  run(env, `UPDATE fb_comments SET status=?, error=?, comment_id=?, updated=? WHERE id=? AND status='pending'`, status, error, commentId, nowMs, row.id);

// 這次沒完成：排下一個檢查點；超過 3 分鐘（或已是最後一個）就標失敗
async function advance(env, row, nowMs, interim, failMsg) {
  const deadline = row.due * 1000 + DEADLINE_MS;
  let step = row.step + 1;
  if (nowMs >= deadline || step >= OFFSETS.length) return finish(env, row, 'failed', failMsg, nowMs);
  while (step < OFFSETS.length - 1 && row.due * 1000 + OFFSETS[step] * 1000 <= nowMs) step++;   // 鬧鐘晚了就跳到下一個還沒到的
  return run(env, `UPDATE fb_comments SET step=?, next_check=?, error=?, updated=? WHERE id=? AND status='pending'`,
    step, row.due * 1000 + OFFSETS[step] * 1000, interim || null, nowMs, row.id);
}

const retime = (env, row, time, nowMs) =>
  run(env, `UPDATE fb_comments SET due=?, step=0, next_check=?, error=NULL, updated=? WHERE id=? AND status='pending'`, time, (time + OFFSETS[0]) * 1000, nowMs, row.id);

// 一次問多個貼文的狀態：Map(id → {kind:'ok', published, time} | {kind:'missing'} | {kind:'error', msg})
async function fetchStates(env, token, ids) {
  const out = new Map();
  const one = async (id) => {
    try { out.set(id, view(await graphGet(env, token, `/${id}`, { fields: STATE_FIELDS }))); }
    catch (e) { out.set(id, isMissing(e) ? { kind: 'missing' } : { kind: 'error', msg: errText(env, e) }); }
  };
  const view = (r) => (r && r.id ? { kind: 'ok', published: r.is_published === true, time: timeOf(r.scheduled_publish_time) } : { kind: 'missing' });
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const r = await graphGet(env, token, '/', { ids: chunk.join(','), fields: STATE_FIELDS });
      for (const id of chunk) out.set(id, view(r && r[id]));
    } catch (e) {
      if (isMissing(e)) { for (const id of chunk) await one(id); }   // 其中有貼文不存在：整批會失敗，改逐篇問
      else for (const id of chunk) out.set(id, { kind: 'error', msg: errText(env, e) });
    }
  }
  return out;
}

// 照片 ID → 貼文 ID（page_story_id）。需使用者實測確認：排程中的照片是否查得到。
async function photoToPost(env, token, photo) {
  try {
    const r = await graphGet(env, token, `/${photo}`, { fields: 'page_story_id' });
    return r && typeof r.page_story_id === 'string' && /^\d+_\d+$/.test(r.page_story_id) ? r.page_story_id : null;
  } catch (e) { return null; }
}
export { photoToPost };

// 處理一批到期項目（next_check <= nowMs）。匯出給單元測試與總管、cron 共用。
export async function processDue(env, nowMs) {
  if (!env.DB) return { handled: 0 };
  await ensureTables(env);
  const rows = await all(env, `SELECT * FROM fb_comments WHERE status='pending' AND next_check <= ? ORDER BY next_check LIMIT 200`, nowMs);
  const byPage = new Map();
  for (const r of rows) { if (!byPage.has(r.page_id)) byPage.set(r.page_id, []); byPage.get(r.page_id).push(r); }
  for (const [page, items] of byPage) {
    try { await processPage(env, page, items, nowMs); }
    catch (e) { for (const row of items) { try { const m = errText(env, e); await advance(env, row, nowMs, m, `留言失敗：${m}`); } catch (e2) { /* 下次再來 */ } } }
  }
  return { handled: rows.length };
}

async function processPage(env, page, items, nowMs) {
  let token = null, tokErr = '';
  try { token = await tokenFor(env, page); } catch (e) { tokErr = errText(env, e); }
  if (!token) {
    const m = tokErr || '這個粉專不在後端設定的 token 裡';
    for (const row of items) await advance(env, row, nowMs, m, `留言失敗：${m}`);
    return;
  }
  // 只有照片 ID 的先換貼文 ID
  for (const row of items) {
    if (!row.post_id && row.photo_id) {
      const post = await photoToPost(env, token, row.photo_id);
      if (post) { row.post_id = post; await run(env, 'UPDATE fb_comments SET post_id=? WHERE id=?', post, row.id); }
    }
  }
  for (const row of items.filter((r) => !r.post_id)) await advance(env, row, nowMs, null, '取不到貼文編號，無法留言');
  const ready = items.filter((r) => r.post_id);
  const states = await fetchStates(env, token, [...new Set(ready.map((r) => r.post_id))]);
  for (const row of ready) {
    const st = states.get(row.post_id) || { kind: 'missing' };
    if (st.kind === 'missing') { await finish(env, row, 'canceled', '貼文已刪除', nowMs); continue; }
    if (st.kind === 'error') { await advance(env, row, nowMs, st.msg, `留言失敗：${st.msg}`); continue; }
    if (!st.published) {
      if (st.time && st.time !== row.due) await retime(env, row, st.time, nowMs);   // 後台改了時間（晚或早）：重設，不算失敗
      else await advance(env, row, nowMs, null, NOT_PUBLISHED);
      continue;
    }
    try {
      const r = await graphPost(env, token, `/${row.post_id}/comments`, { message: row.message });
      await finish(env, row, 'done', null, nowMs, r && r.id ? String(r.id) : null);
    } catch (e) {
      const m = errText(env, e);
      await advance(env, row, nowMs, m, `留言失敗：${m}`);
    }
  }
}

// 每分鐘對時（cron）：只對有待留言的粉專抓 scheduled_posts；順便跑到期項目（沒有 DO 時的備援）
export async function syncScheduled(env, nowMs) {
  if (!env.DB) return;
  try {
    await ensureTables(env);
    const pending = await all(env, `SELECT * FROM fb_comments WHERE status='pending' ORDER BY id LIMIT 500`);
    const byPage = new Map();
    for (const r of pending) { if (!byPage.has(r.page_id)) byPage.set(r.page_id, []); byPage.get(r.page_id).push(r); }
    for (const [page, items] of byPage) {
      try { await syncPage(env, page, items, nowMs); } catch (e) { /* 這個粉專對時失敗，下一分鐘再來 */ }
    }
    await processDue(env, nowMs);
  } catch (e) { /* cron 不丟錯 */ }
  await kickHub(env);
}

async function syncPage(env, page, items, nowMs) {
  const token = await tokenFor(env, page);
  if (!token) return;
  for (const row of items) {
    if (!row.post_id && row.photo_id) {
      const post = await photoToPost(env, token, row.photo_id);
      if (post) { row.post_id = post; await run(env, 'UPDATE fb_comments SET post_id=? WHERE id=?', post, row.id); }
    }
  }
  const list = await graphGet(env, token, `/${page}/scheduled_posts`, { fields: 'id,scheduled_publish_time', limit: 100 });
  const times = new Map((list.data || []).map((p) => [p.id, timeOf(p.scheduled_publish_time)]));
  const gone = [];
  for (const row of items) {
    if (!row.post_id) continue;
    if (times.has(row.post_id)) {
      const t = times.get(row.post_id);
      if (t && t !== row.due) await retime(env, row, t, nowMs);
    } else if (row.due * 1000 > nowMs) gone.push(row);   // 清單裡沒有、還沒到時間：可能被後台立刻發布或刪除
  }
  if (!gone.length) return;
  const states = await fetchStates(env, token, [...new Set(gone.map((r) => r.post_id))]);
  for (const row of gone) {
    const st = states.get(row.post_id);
    if (!st) continue;
    if (st.kind === 'missing') await finish(env, row, 'canceled', '貼文已刪除', nowMs);
    else if (st.kind === 'ok' && st.published) await run(env, `UPDATE fb_comments SET next_check=?, updated=? WHERE id=? AND status='pending'`, nowMs, nowMs, row.id);
  }
}

// ---- Durable Object：準時叫醒 ----
export async function kickHub(env) {
  if (!env || !env.COMMENT_HUB) return;
  try { await env.COMMENT_HUB.get(env.COMMENT_HUB.idFromName('hub')).fetch('https://hub/kick'); } catch (e) { /* 沒有總管就靠每分鐘 cron */ }
}

export class CommentHub {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch() { await this.arm(); return new Response('ok'); }
  async alarm() {
    try { await processDue(this.env, Date.now()); } catch (e) { /* 下次鬧鐘或 cron 補上 */ }
    await this.arm();
  }
  // 鬧鐘設在最早的待檢查時間；沒有待檢查項目就取消鬧鐘
  async arm() {
    let next = null;
    try {
      await ensureTables(this.env);
      const r = await first(this.env, `SELECT MIN(next_check) AS m FROM fb_comments WHERE status='pending'`);
      next = r && r.m != null ? Number(r.m) : null;
    } catch (e) { return; }
    if (next == null) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(Math.max(next, Date.now() + 250));
  }
}
