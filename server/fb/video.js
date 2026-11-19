// 影片發布（tools/fbvideo）：一支影片 × 一個粉專＝一筆工作（D1 fb_video_jobs）
//   橫式：graph-video /{page}/videos upload_phase=start → transfer（依臉書回的 offset）→ finish（帶 title、description、排程）
//   Reels：/{page}/video_reels upload_phase=start → 傳到 upload_url（rupload）→ finish（video_state PUBLISHED／SCHEDULED）
//   瀏覽器每段只送一次（/fb/video/chunk），這裡轉給「這段剛好是它下一段」的粉專；offset 不同的粉專之後自己追上。
//   「影片傳完」＋「使用者按送出」兩個都成立才 finish（誰後到誰觸發；用 D1 搶 finishing 狀態，不會 finish 兩次）。
//   發布方式：立即／排程／草稿（橫式 unpublished_content_type=DRAFT、Reels video_state=DRAFT；不排留言）／
//   多文發佈（只限橫式、立即：發布後由計時器 allow_crossposting_for_pages → 各目標粉專 crossposted_video_id；目標不排留言）
import { graph, graphVideo, GraphError } from './graph.js';
import { pageTokens } from './pages.js';
import { armTimer, timerStatus } from './timer.js';
import { audit } from '../core/staff.js';

class StartError extends Error {}

export const MAX_CHUNK = 32 * 1024 * 1024;       // 一次轉送最多 32MB（Worker 請求上限 100MB、記憶體 128MB）
export const REEL_CHUNK = 16 * 1024 * 1024;      // Reels 自己決定分段大小
export const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10GB（臉書粉專影片上限）
export const MIN_LEAD = 600;                      // 排程至少 10 分鐘後
export const MAX_LEAD = { video: 180 * 86400, reel: 29 * 86400 };   // 橫式 6 個月內（保守取 180 天）、Reels 29 天內
export const KEEP_DAYS = 7;
export const MAX_COMMENTS = 3;
const MAX_TITLE = 255;
const MAX_DESC = 63206;
export const KINDS = ['video', 'reel'];
// 終止狀態：不再上傳也不會 finish
const DONE = ['processing', 'scheduled', 'published', 'draft', 'failed', 'unknown', 'stopped', 'canceled'];
export const MAX_CROSS = 10;

const ready = new WeakSet();
async function ensure(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS fb_video_jobs (upload_id TEXT NOT NULL, page TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL, state TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT '', video_id TEXT NOT NULL DEFAULT '', upload_url TEXT NOT NULL DEFAULT '', next_start INTEGER NOT NULL DEFAULT 0, next_end INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', at INTEGER, comments TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT '', who TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', cover_tries INTEGER NOT NULL DEFAULT 0, cover_error TEXT NOT NULL DEFAULT '', cover_at INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (upload_id, page))"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fb_video_jobs_updated ON fb_video_jobs(updated)')
  ]);
  // 舊表（沒有封面欄位）補欄位；已有就略過
  // draft：1＝存草稿；xpost：多文目標 [{ page, status, error? }]（status 由計時器回報）
  for (const col of ["cover TEXT NOT NULL DEFAULT ''", 'cover_tries INTEGER NOT NULL DEFAULT 0', "cover_error TEXT NOT NULL DEFAULT ''", 'cover_at INTEGER NOT NULL DEFAULT 0', 'draft INTEGER NOT NULL DEFAULT 0', "xpost TEXT NOT NULL DEFAULT '[]'"]) {
    try { await env.DB.prepare('ALTER TABLE fb_video_jobs ADD COLUMN ' + col).run(); } catch { /* 已有 */ }
  }
  ready.add(env.DB);
}

const nowSec = () => Math.floor(Date.now() / 1000);
const errText = (e) => String((e && e.message) || e || '失敗').slice(0, 200);
export const validUploadId = (u) => typeof u === 'string' && /^[0-9a-f]{32}$/.test(u);
const validPage = (p) => typeof p === 'string' && /^\d{1,30}$/.test(p);
const xpostOf = (r) => { try { const l = JSON.parse(r.xpost || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };

async function rows(env, uploadId) {
  await ensure(env);
  const { results } = await env.DB.prepare('SELECT * FROM fb_video_jobs WHERE upload_id = ? ORDER BY created, page').bind(uploadId).all();
  return results || [];
}
// 只有工作還在 from 狀態才寫入（避免慢回來的請求蓋掉剛按的「停止」等狀態）
async function updateIf(env, r, fields, from) {
  const keys = Object.keys(fields);
  const c = await env.DB.prepare(`UPDATE fb_video_jobs SET ${keys.map((k) => k + ' = ?').join(', ')}, updated = ? WHERE upload_id = ? AND page = ? AND state = ?`)
    .bind(...keys.map((k) => fields[k]), Date.now(), r.upload_id, r.page, from).run();
  if (c && c.meta && c.meta.changes) Object.assign(r, fields);
}
async function update(env, r, fields) {
  const keys = Object.keys(fields);
  Object.assign(r, fields, { updated: Date.now() });
  await env.DB.prepare(`UPDATE fb_video_jobs SET ${keys.map((k) => k + ' = ?').join(', ')}, updated = ? WHERE upload_id = ? AND page = ?`)
    .bind(...keys.map((k) => fields[k]), r.updated, r.upload_id, r.page).run();
}

// 給前端的樣子（不含 session、upload_url、token）
const STALE_MS = 2 * 60 * 1000;   // finishing 超過 2 分鐘＝Worker 中斷，結果不明
export const view = (r) => ({
  uploadId: r.upload_id, page: r.page, kind: r.kind, name: r.name, size: r.size,
  state: r.state === 'finishing' && Date.now() - r.updated > STALE_MS ? 'unknown' : r.state,
  uploaded: r.state === 'uploading' ? r.next_start : r.size, videoId: r.video_id || '', sent: !!r.sent,
  at: r.at ?? null, title: r.title, error: r.error || '', created: r.created,
  cover: r.cover || '', coverError: r.cover_error || '', draft: !!r.draft,
  // 原影片沒有發布（失敗／不明／停止／取消）：還在等的多文顯示失敗，前端不會一直等
  cross: xpostOf(r).map((x) => {
    const wait = !x.status || x.status === 'pending' || x.status === 'posting';
    return wait && ['failed', 'unknown', 'stopped', 'canceled'].includes(r.state)
      ? { page: String(x.page), status: 'failed', error: '原影片沒有發布' }
      : { page: String(x.page), status: String(x.status || 'pending'), error: String(x.error || '') };
  })
});

// 下一段要的範圍：上傳中的粉專裡最小的 start；end＝和它同 start 的粉專要的最大 end（上限 32MB、檔案大小）
export function nextRange(list, size) {
  const up = list.filter((r) => r.state === 'uploading');
  if (!up.length) return null;
  const start = Math.min(...up.map((r) => r.next_start));
  let end = start;
  for (const r of up) {
    if (r.next_start !== start) continue;
    end = Math.max(end, r.kind === 'reel' ? start + REEL_CHUNK : r.next_end);
  }
  end = Math.min(end, start + MAX_CHUNK, size);
  if (end <= start) end = Math.min(start + REEL_CHUNK, size);
  return { start, end };
}

export function parseStart(b) {
  if (!b || !validUploadId(b.uploadId) || !KINDS.includes(b.kind)) return null;
  const name = typeof b.name === 'string' ? b.name.slice(0, 200) : '';
  if (!Number.isInteger(b.size) || b.size < 1 || b.size > MAX_SIZE) return null;
  if (!Array.isArray(b.pages) || b.pages.length < 1 || b.pages.length > 20 || !b.pages.every(validPage) || new Set(b.pages).size !== b.pages.length) return null;
  return { uploadId: b.uploadId, name, size: b.size, kind: b.kind, pages: b.pages };
}

// 開工作階段：還沒開過（或已停止／失敗）的粉專才開；同一個 uploadId 的 kind、size 不能變
export async function startUpload(env, form, who) {
  const list = await rows(env, form.uploadId);
  if (list.some((r) => r.kind !== form.kind || r.size !== form.size)) return { error: 'bad_request' };
  if (list.some((r) => r.sent)) return { error: 'bad_request' };   // 已送出就不能再加粉專
  const tokens = await pageTokens(env);
  const now = Date.now();
  const created = list.length ? Math.min(...list.map((r) => r.created)) : now;   // 同一支影片共用建立時間（列表排序）
  for (const page of form.pages) {
    const old = list.find((r) => r.page === page);
    if (old && !['stopped', 'failed', 'canceled'].includes(old.state)) continue;
    const t = tokens.get(page);
    const row = { upload_id: form.uploadId, page, kind: form.kind, name: form.name, size: form.size, state: 'uploading', session_id: '', video_id: '', upload_url: '', next_start: 0, next_end: 0, sent: 0, title: '', description: '', at: null, comments: '[]', error: '', who: String(who && who.uid || ''), draft: 0, xpost: '[]', created, updated: now };
    try {
      if (!t) throw new StartError('找不到這個粉專（token 沒有管理權限）');
      if (form.kind === 'video') {
        const d = await graphVideo(env, 'POST', '/' + page + '/videos', { upload_phase: 'start', file_size: form.size }, t.token);
        Object.assign(row, { session_id: String(d.upload_session_id || ''), video_id: String(d.video_id || ''), next_start: Number(d.start_offset) || 0, next_end: Number(d.end_offset) || 0 });
        if (!row.session_id) throw new StartError('臉書沒有回傳上傳工作階段');
      } else {
        const d = await graph(env, 'POST', '/' + page + '/video_reels', { upload_phase: 'start' }, t.token);
        Object.assign(row, { video_id: String(d.video_id || ''), upload_url: String(d.upload_url || '') });
        if (!row.video_id || !/^https:\/\/rupload\.facebook\.com\//.test(row.upload_url)) throw new StartError('臉書沒有回傳上傳網址');
      }
    } catch (e) {
      if (!(e instanceof GraphError) && !(e instanceof StartError)) throw e;
      row.state = 'failed'; row.error = errText(e);
    }
    const cols = Object.keys(row);
    await env.DB.prepare(`INSERT INTO fb_video_jobs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(upload_id, page) DO UPDATE SET ${cols.filter((c) => c !== 'upload_id' && c !== 'page').map((c) => c + ' = excluded.' + c).join(', ')}`)
      .bind(...cols.map((c) => row[c])).run();
  }
  return result(env, form.uploadId);
}

async function result(env, uploadId) {
  const list = await rows(env, uploadId);
  const size = list.length ? list[0].size : 0;
  return { next: nextRange(list, size), jobs: list.map(view) };
}

// 傳到 rupload（Reels）：header 帶 offset、file_size
async function ruploadPart(r, token, start, bytes) {
  let res, data;
  try {
    res = await fetch(r.upload_url, { method: 'POST', headers: { Authorization: 'OAuth ' + token, offset: String(start), file_size: String(r.size), 'Content-Type': 'application/octet-stream' }, body: bytes });
    data = await res.json().catch(() => null);
  } catch { throw new GraphError(-1, '連不上臉書', 0, undefined, true); }
  if (!res.ok || !data || data.error || data.success === false) {
    const err = (data && data.error) || {};
    throw new GraphError(Number(err.code) || -1, err.message || err.description || '臉書上傳失敗（HTTP ' + res.status + '）', res.status);
  }
}

// 收到一段 [start, start+bytes.length)：轉給下一段剛好從 start 開始的粉專
export async function receiveChunk(env, uploadId, start, bytes) {
  const list = await rows(env, uploadId);
  if (!list.length) return { error: 'not_found' };
  const end = start + bytes.length;
  const tokens = await pageTokens(env);
  for (const r of list) {
    if (r.state !== 'uploading' || r.next_start !== start) continue;
    const t = tokens.get(r.page);
    if (!t) { await update(env, r, { state: 'failed', error: '找不到這個粉專（token 沒有管理權限）' }); continue; }
    try {
      if (r.kind === 'video') {
        const want = r.next_end > start ? r.next_end : end;
        if (want > end) { await updateIf(env, r, { state: 'failed', error: '臉書要求的分段太大（超過 32MB），無法轉送' }, 'uploading'); continue; }   // 不失敗的話前端會一直收到同一段而無限重傳
        const fd = new FormData();
        fd.set('upload_phase', 'transfer');
        fd.set('upload_session_id', r.session_id);
        fd.set('start_offset', String(start));
        fd.set('video_file_chunk', new Blob([bytes.subarray(0, want - start)]), 'chunk');
        const d = await graphVideo(env, 'POST', '/' + r.page + '/videos', fd, t.token);
        const ns = Number(d.start_offset), ne = Number(d.end_offset);
        if (!Number.isFinite(ns) || !Number.isFinite(ne)) throw new GraphError(-1, '臉書沒有回傳下一段位置', 200);
        if (ns >= r.size || ns === ne) await updateIf(env, r, { state: 'uploaded', next_start: r.size, next_end: r.size }, 'uploading');
        else await updateIf(env, r, { next_start: ns, next_end: ne }, 'uploading');
      } else {
        await ruploadPart(r, t.token, start, bytes);
        if (end >= r.size) await updateIf(env, r, { state: 'uploaded', next_start: r.size, next_end: r.size }, 'uploading');
        else await updateIf(env, r, { next_start: end, next_end: end }, 'uploading');
      }
    } catch (e) {
      if (!(e instanceof GraphError)) throw e;
      await updateIf(env, r, { state: 'failed', error: errText(e) }, 'uploading');
    }
  }
  await finishReady(env, uploadId);
  return result(env, uploadId);
}

// 送出表單：title、description、at（null＝立即）、comments [{ message, delay }]（第 1 則 delay 0～1440，第 2、3 則 5 的倍數 5～1440）
export function parsePublish(b) {
  if (!b || !validUploadId(b.uploadId)) return null;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const description = typeof b.description === 'string' ? b.description : '';
  if (!title || [...title].length > MAX_TITLE || /[\r\n]/.test(title) || description.length > MAX_DESC || !description.trim()) return null;
  // 每個粉專各自的時間：[{ page, at（null＝立即）, draft?: true（存草稿，at 必須 null）, cross?: [目標粉專]（多文，at 必須 null） }]
  if (!Array.isArray(b.pages) || b.pages.length < 1 || b.pages.length > 20) return null;
  const pages = [];
  for (const x of b.pages) {
    if (!x || !validPage(x.page) || pages.some((y) => y.page === x.page) || (x.at !== null && !Number.isInteger(x.at))) return null;
    if (x.draft !== undefined && x.draft !== true) return null;
    if (x.draft && x.at !== null) return null;
    let cross = [];
    if (x.cross !== undefined) {
      if (!Array.isArray(x.cross) || x.cross.length < 1 || x.cross.length > MAX_CROSS || x.at !== null || x.draft) return null;
      if (!x.cross.every(validPage) || new Set(x.cross).size !== x.cross.length || x.cross.includes(x.page)) return null;
      cross = x.cross;
    }
    pages.push({ page: x.page, at: x.at, draft: !!x.draft, cross });
  }
  // 多文目標不能是這支影片自己要上傳的粉專，也不能被兩個來源重複多文
  const own = new Set(pages.map((x) => x.page)), seen = new Set();
  for (const x of pages) for (const c of x.cross) { if (own.has(c) || seen.has(c)) return null; seen.add(c); }
  const list = b.comments === undefined ? [] : b.comments;
  if (!Array.isArray(list) || list.length > MAX_COMMENTS) return null;
  let offset = 0;
  const comments = [];
  for (const [i, c] of list.entries()) {
    const message = c && typeof c.message === 'string' ? c.message.trim() : '';
    const d = c && c.delay;
    if (!message || [...message].length > 8000 || !Number.isInteger(d) || d > 1440) return null;
    if (i === 0 ? d < 0 : (d < 5 || d % 5)) return null;
    offset += d;
    comments.push({ message, offset });
  }
  return { uploadId: b.uploadId, title, description, pages, comments };
}
export const timeOkFor = (kind, at, now = nowSec()) => at === null || (Number.isInteger(at) && at >= now + MIN_LEAD && at <= now + MAX_LEAD[kind]);

export async function publish(env, form, who) {
  const list = await rows(env, form.uploadId);
  if (!list.length) return { error: 'not_found' };
  const by = new Map(form.pages.map((x) => [x.page, x]));
  if (form.pages.some((x) => !timeOkFor(list[0].kind, x.at))) return { error: 'fb_bad_time', message: list[0].kind === 'reel' ? 'Reels 排程時間必須在 10 分鐘到 29 天之間。' : '影片排程時間必須在 10 分鐘到 6 個月之間。' };
  if (list[0].kind === 'reel' && form.pages.some((x) => x.cross.length)) return { error: 'bad_request' };   // Reels 不能用 API 多文
  for (const r of list) {
    const x = by.get(r.page);
    if (r.sent || !x || !['uploading', 'uploaded'].includes(r.state)) continue;
    await update(env, r, {
      sent: 1, title: form.title, description: form.description, at: x.at, draft: x.draft ? 1 : 0,
      comments: JSON.stringify(x.draft ? [] : form.comments),   // 草稿沒有發布時間，不排留言
      xpost: JSON.stringify(x.cross.map((page) => ({ page, status: 'pending' }))),
      who: String(who && who.uid || r.who)
    });
  }
  await finishReady(env, form.uploadId, who);
  return result(env, form.uploadId);
}

// 已傳完且已送出的粉專：搶 finishing 後 finish（同時到達的請求只有一個搶得到）
async function finishReady(env, uploadId, who) {
  const list = await rows(env, uploadId);
  const todo = list.filter((r) => r.state === 'uploaded' && r.sent);
  if (!todo.length) return;
  const tokens = await pageTokens(env);
  for (const r of todo) {
    const c = await env.DB.prepare("UPDATE fb_video_jobs SET state = 'finishing', updated = ? WHERE upload_id = ? AND page = ? AND state = 'uploaded' AND sent = 1").bind(Date.now(), r.upload_id, r.page).run();
    if (!c || !c.meta || !c.meta.changes) continue;
    r.state = 'finishing';
    const t = tokens.get(r.page);
    if (!t) { await update(env, r, { state: 'failed', error: '找不到這個粉專（token 沒有管理權限）' }); continue; }
    const at = r.at ?? null, draft = !!r.draft;
    if (at !== null && !timeOkFor(r.kind, at)) { await update(env, r, { state: 'failed', error: '排程時間已太近或超過範圍，請重新上傳' }); continue; }
    try {
      if (r.kind === 'video') {
        await graphVideo(env, 'POST', '/' + r.page + '/videos', {
          upload_phase: 'finish', upload_session_id: r.session_id, title: r.title, description: r.description,
          ...(draft ? { published: 'false', unpublished_content_type: 'DRAFT' }
            : at !== null ? { published: 'false', scheduled_publish_time: at, unpublished_content_type: 'SCHEDULED' } : {})
        }, t.token);
      } else {
        await graph(env, 'POST', '/' + r.page + '/video_reels', {
          upload_phase: 'finish', video_id: r.video_id, title: r.title, description: r.description,
          video_state: draft ? 'DRAFT' : at !== null ? 'SCHEDULED' : 'PUBLISHED', ...(at !== null ? { scheduled_publish_time: at } : {})
        }, t.token);
      }
    } catch (e) {
      if (!(e instanceof GraphError)) throw e;
      // 結果不明：當待確認，不自動重送（避免重複發布）
      await update(env, r, { state: e.uncertain ? 'unknown' : 'failed', error: errText(e) });
      continue;
    }
    await update(env, r, { state: draft ? 'draft' : at !== null ? 'scheduled' : 'processing', error: '' });
    await applyCover(env, r, t.token);
    let comments = [];
    try { comments = draft ? [] : JSON.parse(r.comments || '[]'); } catch { comments = []; }
    const cross = draft ? [] : xpostOf(r).map((x) => String(x.page));
    if ((comments.length || cross.length) && r.video_id) {
      try { await armTimer(env, { pageId: r.page, postId: r.video_id, at: at ?? nowSec(), items: comments, cross, kind: 'video' }); }
      catch (e) {
        const msg = errText(e);
        await update(env, r, {
          error: (comments.length ? '留言' : '') + (comments.length && cross.length ? '、' : '') + (cross.length ? '多文' : '') + '沒有排上：' + msg,
          ...(cross.length ? { xpost: JSON.stringify(cross.map((page) => ({ page, status: 'failed', error: msg }))) } : {})
        });
      }
    }
    await audit(env, who || { uid: r.who, name: '' }, draft ? 'video_draft' : at !== null ? 'video_schedule' : 'video_publish', r.page, r.video_id,
      at !== null ? 'at=' + at : cross.length ? 'cross=' + cross.join(',') : '');
  }
}

// 查處理進度：processing 的問臉書 status，好了＝published，錯誤＝failed
export function stateFromStatus(s) {
  if (!s || typeof s !== 'object') return null;
  const vs = s.video_status;
  const pp = s.processing_phase || {};
  const pub = s.publishing_phase || {};
  if (['error', 'expired', 'upload_failed'].includes(vs) || pp.status === 'error' || pub.status === 'error' || pub.publish_status === 'error') {
    return { state: 'failed', error: String((pp.error && pp.error.message) || (pub.error && pub.error.message) || '臉書處理失敗').slice(0, 200) };
  }
  if (pub.publish_status === 'published' || (vs === 'ready' && pub.status === 'complete' && pub.publish_status !== 'scheduled')) return { state: 'published' };
  if (pub.publish_status === 'scheduled') return { state: 'scheduled' };
  return null;
}
export async function refreshStatus(env, uploadId) {
  const list = await rows(env, uploadId);
  if (!list.length) return { error: 'not_found' };
  const now = nowSec();
  const busy = list.filter((r) => r.video_id && (r.state === 'processing' || (r.state === 'scheduled' && r.at && r.at <= now)));
  // 多文：還有等待中的目標就問計時器（Durable Object，不呼叫臉書）
  for (const r of list) {
    const xs = xpostOf(r);
    if (!r.video_id || !xs.some((x) => x.status === 'pending' || x.status === 'posting')) continue;
    try {
      const d = await timerStatus(env, r.video_id);
      if (d && Array.isArray(d.cross)) {
        const next = xs.map((x) => { const y = d.cross.find((c) => String(c.page) === String(x.page)); return y ? { page: x.page, status: y.status, ...(y.error ? { error: String(y.error).slice(0, 200) } : {}) } : x; });
        if (JSON.stringify(next) !== JSON.stringify(xs)) await update(env, r, { xpost: JSON.stringify(next) });
      }
    } catch { /* 下次再問 */ }
  }
  const covers = list.filter((r) => r.cover === 'pending' && COVER_OK.includes(r.state) && Date.now() - (r.cover_at || 0) >= COVER_GAP);
  if (covers.length) {
    const tokens = await pageTokens(env);
    for (const r of covers) { const t = tokens.get(r.page); if (t) await applyCover(env, r, t.token); }
  }
  if (busy.length) {
    const tokens = await pageTokens(env);
    for (const r of busy) {
      const t = tokens.get(r.page);
      if (!t) continue;
      try {
        const d = await graph(env, 'GET', '/' + r.video_id, { fields: 'status' }, t.token);
        const s = stateFromStatus(d && d.status);
        if (s && s.state !== r.state) await update(env, r, { state: s.state, error: s.error || '' });
      } catch (e) { if (!(e instanceof GraphError)) throw e; /* 查不到下次再查 */ }
    }
  }
  return result(env, uploadId);
}

// ===== 封面：瀏覽器送 JPG／PNG → KV 暫存 2 天 → 各粉專發布成功後 POST /{video_id}/thumbnails（is_preferred）=====
export const MAX_COVER = 10 * 1024 * 1024;   // Meta：封面最大 10MB
const COVER_TTL = 2 * 86400;
const COVER_TRIES = 5;
const COVER_OK = ['processing', 'scheduled', 'published', 'draft'];
export const COVER_GAP = 60 * 1000;   // 重試間隔至少 60 秒（臉書處理影片中可能還不能換）
const coverKey = (u) => 'fbv:cover:' + u;
export const coverType = (b) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'image/png' : '');

export async function saveCover(env, uploadId, bytes) {
  const type = coverType(bytes);
  if (!type) return { error: 'bad_request' };
  if (!env.CACHE) return { error: 'misconfigured' };
  const list = await rows(env, uploadId);
  if (!list.length) return { error: 'not_found' };
  await env.CACHE.put(coverKey(uploadId), bytes, { expirationTtl: COVER_TTL, metadata: { type } });
  for (const r of list) {
    if (['failed', 'unknown', 'stopped', 'canceled'].includes(r.state)) continue;
    await update(env, r, { cover: 'pending', cover_tries: 0, cover_error: '' });
  }
  // 已發布的（例：封面晚到）馬上換
  const tokens = await pageTokens(env);
  for (const r of list) { if (r.cover === 'pending' && COVER_OK.includes(r.state)) { const t = tokens.get(r.page); if (t) await applyCover(env, r, t.token); } }
  return result(env, uploadId);
}

// 換封面：失敗不影響發布；最多試 5 次（發布後馬上一次，之後查狀態時再試）
async function applyCover(env, r, token) {
  if (r.cover !== 'pending' || !r.video_id) return;
  let got = null;
  try { got = env.CACHE ? await env.CACHE.getWithMetadata(coverKey(r.upload_id), 'arrayBuffer') : null; } catch { got = null; }
  if (!got || !got.value) { await update(env, r, { cover: 'failed', cover_error: '封面暫存已過期' }); return; }
  try {
    const fd = new FormData();
    const type = (got.metadata && got.metadata.type) || 'image/jpeg';
    fd.set('source', new Blob([got.value], { type }), type === 'image/png' ? 'cover.png' : 'cover.jpg');
    fd.set('is_preferred', 'true');
    await graph(env, 'POST', '/' + r.video_id + '/thumbnails', fd, token);
    await update(env, r, { cover: 'done', cover_error: '' });
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    const tries = (r.cover_tries || 0) + 1;
    await update(env, r, { cover: tries >= COVER_TRIES ? 'failed' : 'pending', cover_tries: tries, cover_error: errText(e), cover_at: Date.now() });
  }
}

// 停止上傳：還沒 finish 的全部停（橫式送 cancel，Reels 不 finish 就好）
export async function stopUpload(env, uploadId, page = null) {
  const list = await rows(env, uploadId);
  const tokens = await pageTokens(env).catch(() => new Map());
  for (const r of list) {
    if (page && r.page !== page) continue;
    if (!['uploading', 'uploaded'].includes(r.state)) continue;
    if (page && r.sent) continue;   // 單一粉專取消只在還沒送出時
    const t = tokens.get(r.page);
    if (r.kind === 'video' && r.session_id && t) {
      try { await graphVideo(env, 'POST', '/' + r.page + '/videos', { upload_phase: 'cancel', upload_session_id: r.session_id }, t.token); } catch { /* 取消失敗不影響：沒 finish 就不會發布 */ }
    }
    await update(env, r, { state: page ? 'canceled' : 'stopped' });
  }
  return result(env, uploadId);
}

// 列表：最近 7 天已送出的工作；順便清掉超過 7 天的
export async function listJobs(env) {
  await ensure(env);
  const cut = Date.now() - KEEP_DAYS * 86400000;
  try { await env.DB.prepare('DELETE FROM fb_video_jobs WHERE updated < ?').bind(cut).run(); } catch { /* 靜默 */ }
  const { results } = await env.DB.prepare('SELECT * FROM fb_video_jobs WHERE sent = 1 ORDER BY created DESC, page LIMIT 300').all();
  return (results || []).map(view);
}

export { DONE };
