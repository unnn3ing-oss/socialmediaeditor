// 臉書「發文時留言」佇列。
// D1 `fb_comments` 是唯一資料來源。等待期間完全不打臉書：每分鐘 cron（tickDue）只查 D1，
// 到了「貼文發布時間＋各自延遲」才去問臉書一次；貼文還沒發而臉書上的時間變了，就以新時間重設。
// 嘗試次數可在管理頁設定（預設 2 次、每次間隔 30 秒），仍失敗就標 failed 顯示給使用者，不再自動重試；限流不重試。
// Durable Object `CommentHub` 是選用的準時鬧鐘（沒綁定也能跑，靠 cron）。
// token 一律走 fb.js 的 tokenFor／graph.js，不寫進 D1／KV／日誌；錯誤訊息一律先 scrub。
import { all, first, run } from './db.js';
import { graphGet, graphPost, GraphError, scrub } from './graph.js';
import { tokenFor } from './fb.js';

export const FIRST_OFFSET = 1;          // 預定時間後第幾秒做第 1 次嘗試
export const DEFAULT_ATTEMPTS = 2;      // 每次排程最多嘗試幾次（預設；後台可設 ATTEMPTS_MIN～ATTEMPTS_MAX）
export const ATTEMPTS_MIN = 1, ATTEMPTS_MAX = 5;
export const RETRY_GAP_MS = 30000;      // 失敗後多久再試（固定 30 秒；實際會落在下一個每分鐘 cron）
export const MAX_RETIMES = 5;           // 單筆留言最多跟著臉書改時間重設幾次（防迴圈）
const DAY = 86400000;
const LEASE_MS = 60000;
export const COMMENT_KEEP_DAYS = 30;
const NOT_PUBLISHED = '沒偵測到貼文發布';
const STATE_FIELDS = 'id,is_published,scheduled_publish_time';

// ---- 資料表（每個 isolate 只建一次） ----
const DDL = [
  'CREATE TABLE IF NOT EXISTS fb_page_map (page_id TEXT PRIMARY KEY, code TEXT, label TEXT, utm TEXT, sort INTEGER, updated INTEGER)',
  `CREATE TABLE IF NOT EXISTS fb_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL, post_id TEXT, photo_id TEXT, message TEXT NOT NULL,
    due INTEGER NOT NULL, next_check INTEGER NOT NULL, step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', error TEXT, comment_id TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 1, delay INTEGER NOT NULL DEFAULT 0, retimes INTEGER NOT NULL DEFAULT 0)`,
  'CREATE TABLE IF NOT EXISTS fb_comment_presets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS fb_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS fb_comments_check ON fb_comments(status, next_check)',
  'CREATE INDEX IF NOT EXISTS fb_comments_post ON fb_comments(post_id)'
];
// 舊資料表補欄位：seq＝第幾則留言（1＝第一則）、delay＝發布後幾秒才留（due＝發布時間＋delay）、retimes＝跟著臉書改時間重設過幾次
const ADD_COLUMNS = [['seq', 'INTEGER NOT NULL DEFAULT 1'], ['delay', 'INTEGER NOT NULL DEFAULT 0'], ['retimes', 'INTEGER NOT NULL DEFAULT 0']];
const ensured = new WeakSet();
export async function ensureTables(env) {
  if (!env.DB || ensured.has(env.DB)) return;
  for (const sql of DDL) await env.DB.prepare(sql).run();
  const info = await env.DB.prepare('PRAGMA table_info(fb_comments)').all();
  const have = new Set(((info && info.results) || []).map((c) => c.name));
  for (const [col, def] of ADD_COLUMNS) {
    if (have.has(col)) continue;
    // 多個 Worker 同時啟動時別人可能剛補好：duplicate column 視為已完成，不讓這次請求失敗
    try { await env.DB.prepare(`ALTER TABLE fb_comments ADD COLUMN ${col} ${def}`).run(); }
    catch (e) { if (!/duplicate column/i.test((e && e.message) || '')) throw e; }
  }
  ensured.add(env.DB);
}

// 第 N 則留言的規格（前端 tools/fbpost/comments.js 用同一組數字，test 會比對）
export const MAX_COMMENTS = 3;            // 含第一則；之後要擴充只改這裡與前端常數
export const EXTRA_DELAY_MIN = 5;         // 分鐘
export const EXTRA_DELAY_MAX = 1440;

const errText = (env, e) => scrub(env, (e && e.message) || '未知錯誤');
const isMissing = (e) => e instanceof GraphError && e.fbCode === 100;
const timeOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// ---- 後台設定：留言嘗試次數（D1 fb_settings；讀不到或值不合法一律退回預設，不讓留言停擺）----
const validAttempts = (n) => Number.isInteger(n) && n >= ATTEMPTS_MIN && n <= ATTEMPTS_MAX;
export async function getMaxAttempts(env) {
  if (!env.DB) return DEFAULT_ATTEMPTS;
  try {
    await ensureTables(env);
    const r = await first(env, `SELECT value FROM fb_settings WHERE key='max_attempts'`);
    const n = r ? Number(r.value) : NaN;
    return validAttempts(n) ? n : DEFAULT_ATTEMPTS;
  } catch (e) { return DEFAULT_ATTEMPTS; }
}
// 呼叫前已驗證；回寫入的值
export async function setMaxAttempts(env, n, nowMs = Date.now()) {
  if (!validAttempts(n)) throw new Error('bad attempts');
  await ensureTables(env);
  await run(env, `INSERT INTO fb_settings (key, value, updated) VALUES ('max_attempts', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated`, String(n), nowMs);
  return n;
}

// ---- 後台設定：暫時停用排程發布（D1 fb_settings 一列 key='pause'，value＝JSON {reason, at}；沒有這列＝使用中）----
// 讀不到或資料壞掉一律當作「使用中」，不讓 D1 問題把工具擋死。只擋 /fb/* 與 /rundown，留言佇列照常送。
export const PAUSE_REASON_MAX = 100;
const NOT_PAUSED = Object.freeze({ paused: false, reason: '', at: null });
export function cleanReason(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export async function getPause(env) {
  if (!env.DB) return { ...NOT_PAUSED };
  try {
    await ensureTables(env);
    const r = await first(env, `SELECT value FROM fb_settings WHERE key='pause'`);
    if (!r) return { ...NOT_PAUSED };
    const v = JSON.parse(r.value);
    if (!v || typeof v !== 'object') return { ...NOT_PAUSED };
    return { paused: true, reason: cleanReason(v.reason).slice(0, PAUSE_REASON_MAX), at: timeOf(v.at) };
  } catch (e) { return { ...NOT_PAUSED }; }
}
// paused=true：寫入（已停用時保留原本的停用時間，只更新原因）；false：刪除這列
export async function setPause(env, paused, reason = '', nowMs = Date.now()) {
  await ensureTables(env);
  if (!paused) { await run(env, `DELETE FROM fb_settings WHERE key='pause'`); return { ...NOT_PAUSED }; }
  const cur = await getPause(env);
  const v = { reason: cleanReason(reason).slice(0, PAUSE_REASON_MAX), at: cur.paused && cur.at ? cur.at : nowMs };
  await run(env, `INSERT INTO fb_settings (key, value, updated) VALUES ('pause', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated`, JSON.stringify(v), nowMs);
  return { paused: true, reason: v.reason, at: v.at };
}

// ---- 第 N 則留言的預設文字（後台設定，發文工具下拉選用）----
export const MAX_PRESETS = 20;
export const PRESET_NAME_MAX = 20;
export async function listPresets(env) {
  if (!env.DB) return [];
  await ensureTables(env);
  const rows = await all(env, 'SELECT name, text FROM fb_comment_presets ORDER BY sort ASC, id ASC');
  return rows.map((r) => ({ name: r.name, text: r.text }));
}
// 整份取代（順序＝排序）；呼叫前已驗證
export async function savePresets(env, items, nowMs = Date.now()) {
  await ensureTables(env);
  // 刪除＋全部寫入放同一個 batch（D1 的 batch 是同一個交易，中途失敗會整批還原），不會把舊資料清掉卻沒寫入新的
  const stmts = [env.DB.prepare('DELETE FROM fb_comment_presets')];
  items.forEach((it, i) => stmts.push(env.DB.prepare('INSERT INTO fb_comment_presets (name, text, sort, updated) VALUES (?, ?, ?, ?)').bind(it.name, it.text, i, nowMs)));
  await env.DB.batch(stmts);
}

// ---- 佇列操作 ----
// 新增一筆待留言；post 與 photo 至少一個。due＝預定留言秒（發布時間＋delay）；nextCheck＝毫秒；seq＝第幾則；delay＝發布後幾秒
export async function enqueueComment(env, { page, post, photo, message, due, nextCheck, seq = 1, delay = 0, nowMs = Date.now() }) {
  await ensureTables(env);
  const r = await run(env,
    `INSERT INTO fb_comments (page_id, post_id, photo_id, message, due, next_check, step, status, created, updated, seq, delay) VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?)`,
    page, post || null, photo || null, message, due, nextCheck, nowMs, nowMs, seq, delay);
  return r && r.meta ? r.meta.last_row_id : null;
}

// 貼文被取消／刪除：該貼文還在等的留言一併取消
export async function cancelForPost(env, post, reason = '貼文已取消', nowMs = Date.now()) {
  await ensureTables(env);
  await run(env, `UPDATE fb_comments SET status='canceled', error=?, updated=? WHERE post_id=? AND status='pending'`, reason, nowMs, post);
}

// 改排程時間：同貼文待留言項目的 due 改成「新發布時間＋各自的 delay」，檢查節奏重來
export async function rescheduleComments(env, post, time, nowMs = Date.now()) {
  await ensureTables(env);
  await run(env, `UPDATE fb_comments SET due=? + delay, step=0, retimes=0, next_check=(? + delay + ?) * 1000, error=NULL, updated=? WHERE post_id=? AND status='pending'`,
    time, time, FIRST_OFFSET, nowMs, post);
}

// 每篇貼文「第一則」最新一筆留言狀態：Map(post_id → { id, status, error, message })
export async function commentsForPosts(env, posts) {
  const out = new Map();
  if (!posts.length) return out;
  await ensureTables(env);
  const rows = await all(env, `SELECT id, post_id, status, error, message FROM fb_comments WHERE seq = 1 AND post_id IN (${posts.map(() => '?').join(',')}) ORDER BY id ASC`, ...posts);
  for (const r of rows) out.set(r.post_id, { id: r.id, status: r.status, error: r.error || '', message: r.message });
  return out;
}

// 每篇貼文「第 2 則以後」的留言：Map(post_id → [{ id, seq, delay(分鐘), status, error, message }])，依 seq 排序
export async function extraCommentsForPosts(env, posts) {
  const out = new Map();
  if (!posts.length) return out;
  await ensureTables(env);
  const rows = await all(env, `SELECT id, post_id, seq, delay, status, error, message FROM fb_comments WHERE seq > 1 AND post_id IN (${posts.map(() => '?').join(',')}) ORDER BY seq ASC, id ASC`, ...posts);
  for (const r of rows) {
    if (!out.has(r.post_id)) out.set(r.post_id, []);
    out.get(r.post_id).push({ id: r.id, seq: r.seq, delay: Math.round(r.delay / 60), status: r.status, error: r.error || '', message: r.message });
  }
  return out;
}

export async function listComments(env, { status = 'all', page = '', nowMs = Date.now() } = {}) {
  await ensureTables(env);
  const where = ['updated >= ?'], args = [nowMs - 7 * DAY];
  if (status === 'failed' || status === 'pending') { where.push('status = ?'); args.push(status); }
  if (page) { where.push('page_id = ?'); args.push(page); }
  const rows = await all(env, `SELECT id, page_id, post_id, photo_id, message, status, error, due, updated, dismissed, seq, delay FROM fb_comments WHERE ${where.join(' AND ')} ORDER BY updated DESC, id DESC LIMIT 100`, ...args);
  return rows.map((r) => ({ id: r.id, page: r.page_id, post: r.post_id || null, message: r.message, status: r.status, error: r.error || '', due: r.due, updated: r.updated, dismissed: !!r.dismissed, seq: r.seq || 1, delay: Math.round((r.delay || 0) / 60) }));
}

// 失敗的留言重試：回 true／false（不是 failed 就不處理）
export async function retryComment(env, id, nowMs = Date.now()) {
  await ensureTables(env);
  const row = await first(env, 'SELECT id, status FROM fb_comments WHERE id = ?', id);
  if (!row || row.status !== 'failed') return false;
  // 重試＝重新給 2 次嘗試機會，馬上開始（預定時間不動）
  await run(env, `UPDATE fb_comments SET status='pending', step=0, retimes=0, next_check=?, error=NULL, dismissed=0, updated=? WHERE id=? AND status='failed'`, nowMs, nowMs, id);
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

// 這次嘗試沒成功：還沒到設定的次數 → 30 秒後再試；到了（或 stop＝限流）→ 標 failed 顯示，不再自動重試
async function advance(env, row, nowMs, interim, failMsg, stop = false) {
  const attempt = row.step + 1;
  if (stop || attempt >= (row.maxAttempts || DEFAULT_ATTEMPTS)) return finish(env, row, 'failed', stop ? `${failMsg}（不重試）` : `${failMsg}（已試 ${attempt} 次）`, nowMs);
  return run(env, `UPDATE fb_comments SET step=?, next_check=?, error=?, updated=? WHERE id=? AND status='pending'`,
    attempt, nowMs + RETRY_GAP_MS, interim || null, nowMs, row.id);
}

// time＝臉書上貼文現在的發布時間；這筆留言的預定時間＝發布時間＋它自己的 delay。嘗試次數歸零，不算失敗；改太多次才停
const retime = (env, row, time, nowMs) => {
  if ((row.retimes || 0) >= MAX_RETIMES) return finish(env, row, 'failed', '貼文排程時間被改太多次，已停止自動留言', nowMs);
  const due = time + (row.delay || 0);
  return run(env, `UPDATE fb_comments SET due=?, step=0, retimes=retimes+1, next_check=?, error=NULL, updated=? WHERE id=? AND status='pending'`, due, (due + FIRST_OFFSET) * 1000, nowMs, row.id);
};

const limited = (e) => e instanceof GraphError && e.code === 'fb_rate_limited';

// 一次問多個貼文的狀態：Map(id → {kind:'ok', published, time} | {kind:'missing'} | {kind:'error', msg})
async function fetchStates(env, token, ids) {
  const out = new Map();
  const one = async (id) => {
    try { out.set(id, view(await graphGet(env, token, `/${id}`, { fields: STATE_FIELDS }))); }
    catch (e) { out.set(id, isMissing(e) ? { kind: 'missing' } : { kind: 'error', msg: errText(env, e), stop: limited(e) }); }
  };
  const view = (r) => (r && r.id ? { kind: 'ok', published: r.is_published === true, time: timeOf(r.scheduled_publish_time) } : { kind: 'missing' });
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const r = await graphGet(env, token, '/', { ids: chunk.join(','), fields: STATE_FIELDS });
      for (const id of chunk) out.set(id, view(r && r[id]));
    } catch (e) {
      if (isMissing(e)) { for (const id of chunk) await one(id); }   // 其中有貼文不存在：整批會失敗，改逐篇問
      else for (const id of chunk) out.set(id, { kind: 'error', msg: errText(env, e), stop: limited(e) });
    }
  }
  return out;
}

// 照片 ID → 貼文 ID（page_story_id）。需使用者實測確認：排程中的照片是否查得到。
async function resolvePhoto(env, token, photo) {
  try {
    const r = await graphGet(env, token, `/${photo}`, { fields: 'page_story_id' });
    const post = r && typeof r.page_story_id === 'string' && /^\d+_\d+$/.test(r.page_story_id) ? r.page_story_id : null;
    return post ? { kind: 'ok', post } : { kind: 'none' };
  } catch (e) {
    // 只有訊息明確說「物件不存在」才當貼文已取消（錯誤碼 100 也包含欄位／參數錯誤，那種要照失敗處理讓使用者看到）
    if (isMissing(e) && /does not exist|Unsupported get request/i.test(e.message || '')) return { kind: 'missing' };
    return { kind: 'none', stop: limited(e) };
  }
}
async function photoToPost(env, token, photo) {
  const r = await resolvePhoto(env, token, photo);
  return r.kind === 'ok' ? r.post : null;
}
export { photoToPost };

// 處理一批到期項目（next_check <= nowMs）。匯出給單元測試與總管、cron 共用。
export async function processDue(env, nowMs) {
  if (!env.DB) return { handled: 0 };
  await ensureTables(env);
  const due = await all(env, `SELECT * FROM fb_comments WHERE status='pending' AND next_check <= ? ORDER BY next_check LIMIT 200`, nowMs);
  // 防重複留言：DO 鬧鐘與 cron 可能同時撿到同一筆，先用條件 UPDATE 搶租約（next_check 推到 60 秒後），搶到才處理
  const rows = [];
  for (const r of due) {
    const c = await run(env, `UPDATE fb_comments SET next_check=? WHERE id=? AND status='pending' AND next_check=?`, nowMs + LEASE_MS, r.id, r.next_check);
    if (c && c.meta && c.meta.changes === 1) rows.push(r);
  }
  const maxAttempts = rows.length ? await getMaxAttempts(env) : DEFAULT_ATTEMPTS;
  for (const r of rows) r.maxAttempts = maxAttempts;
  const byPage = new Map();
  for (const r of rows) { if (!byPage.has(r.page_id)) byPage.set(r.page_id, []); byPage.get(r.page_id).push(r); }
  for (const [page, items] of byPage) {
    try { await processPage(env, page, items, nowMs); }
    catch (e) { for (const row of items) { try { const m = errText(env, e); await advance(env, row, nowMs, m, `留言失敗：${m}`, limited(e)); } catch (e2) { /* 下次再來 */ } } }
  }
  return { handled: rows.length };
}

async function processPage(env, page, items, nowMs) {
  let token = null, tokErr = '', tokStop = false;
  try { token = await tokenFor(env, page); } catch (e) { tokErr = errText(env, e); tokStop = limited(e); }
  if (!token) {
    const m = tokErr || '這個粉專不在後端設定的 token 裡';
    for (const row of items) await advance(env, row, nowMs, m, `留言失敗：${m}`, tokStop);
    return;
  }
  // 只有照片 ID 的先換貼文 ID（照片已不存在＝貼文被取消，不算失敗）
  const gone = new Set();
  let photoStop = false;
  for (const row of items) {
    if (!row.post_id && row.photo_id) {
      const r = await resolvePhoto(env, token, row.photo_id);
      if (r.kind === 'ok') { row.post_id = r.post; await run(env, 'UPDATE fb_comments SET post_id=? WHERE id=?', r.post, row.id); }
      else if (r.kind === 'missing') { gone.add(row.id); await finish(env, row, 'canceled', '貼文已刪除', nowMs); }
      else if (r.stop) photoStop = true;
    }
  }
  for (const row of items.filter((r) => !r.post_id && !gone.has(r.id))) await advance(env, row, nowMs, null, '取不到貼文編號，無法留言', photoStop);
  const ready = items.filter((r) => r.post_id);
  const states = await fetchStates(env, token, [...new Set(ready.map((r) => r.post_id))]);
  for (const row of ready) {
    const st = states.get(row.post_id) || { kind: 'missing' };
    if (st.kind === 'missing') { await finish(env, row, 'canceled', '貼文已刪除', nowMs); continue; }
    if (st.kind === 'error') { await advance(env, row, nowMs, st.msg, `留言失敗：${st.msg}`, st.stop); continue; }
    if (!st.published) {
      if (st.time && st.time + (row.delay || 0) !== row.due) await retime(env, row, st.time, nowMs);   // 後台改了時間（晚或早）：重設，不算失敗
      else await advance(env, row, nowMs, null, NOT_PUBLISHED);
      continue;
    }
    try {
      const r = await graphPost(env, token, `/${row.post_id}/comments`, { message: row.message });
      await finish(env, row, 'done', null, nowMs, r && r.id ? String(r.id) : null);
    } catch (e) {
      const m = errText(env, e);
      await advance(env, row, nowMs, m, `留言失敗：${m}`, limited(e));
    }
  }
}

// 每分鐘 cron：只查 D1，找出「到了預定時間」的留言來處理；沒有到期的就完全不打臉書。
export async function tickDue(env, nowMs) {
  if (!env.DB) return;
  try { await processDue(env, nowMs); } catch (e) { /* cron 不丟錯，下一分鐘再來 */ }
  await kickHub(env);
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
