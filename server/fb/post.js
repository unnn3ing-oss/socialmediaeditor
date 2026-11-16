// 發文：依序對每個粉專立即或排程；有圖排程照 Meta 官方範例（暫存照片 → /feed attached_media）
import { graph, GraphError } from './graph.js';
import { pageTokens, pageUtm } from './pages.js';
import { commentText, postComment, MAX_LEAD as MAX_COMMENT_LEAD } from './comment.js';
import { armTimer } from './timer.js';

export { commentLink, commentText } from './comment.js';

export const MIN_LEAD = 600;            // 排程至少晚 10 分鐘
export const MAX_LEAD = 30 * 86400;     // 最多 30 天
export const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_MESSAGE = 63206;

export const timeOk = (at, now = Math.floor(Date.now() / 1000)) => Number.isInteger(at) && at >= now + MIN_LEAD && at <= now + MAX_LEAD;

// 驗證表單；不合法回 null
// 第 2、3 則留言：[{ message, delay（距上一則幾分鐘，5 的倍數，5～1440） }] → [{ message, offset（距發布幾分鐘） }]；不合法回 null
export const MAX_EXTRAS = 2;
export function parseExtras(raw) {
  if (raw === null || raw === undefined || raw === '') return [];
  let list;
  try { list = JSON.parse(String(raw)); } catch { return null; }
  if (!Array.isArray(list) || list.length > MAX_EXTRAS) return null;
  let offset = 0;
  const out = [];
  for (const c of list) {
    const message = c && typeof c.message === 'string' ? c.message.trim() : '';
    const delay = c && c.delay;
    if (!message || [...message].length > 8000) return null;
    if (!Number.isInteger(delay) || delay < 5 || delay > 1440 || delay % 5) return null;
    offset += delay;
    out.push({ message, offset });
  }
  return out;
}

export function parsePostForm(fd) {
  const message = String(fd.get('message') || '');
  const link = String(fd.get('link') || '').trim();
  const image = fd.get('image');
  const lead = fd.has('commentLead') ? String(fd.get('commentLead')) : undefined;   // 沒給＝預設「看更多新聞內容」
  if (message.length > MAX_MESSAGE) return null;
  if (lead !== undefined && ([...lead.trim()].length > MAX_COMMENT_LEAD || /[\r\n]/.test(lead.trim()))) return null;
  if (!link || !/^https?:\/\/[^\s]+$/i.test(link)) return null;   // 文章網址必填（第 1 則留言、RD 都要用）
  let file = null;
  if (image && typeof image === 'object' && image.size > 0) {
    if (!['image/jpeg', 'image/png'].includes(image.type) || image.size > MAX_IMAGE) return null;
    file = image;
  }
  if (!message.trim() && !file) return null;
  let targets;
  try { targets = JSON.parse(String(fd.get('targets') || '')); } catch { return null; }
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 20) return null;
  const seen = new Set();
  for (const t of targets) {
    if (!t || typeof t.page !== 'string' || !/^\d{1,30}$/.test(t.page) || seen.has(t.page)) return null;
    if (t.at !== null && !Number.isInteger(t.at)) return null;
    seen.add(t.page);
  }
  const extras = parseExtras(fd.get('comments'));
  if (!extras) return null;
  return { message, link, lead, file, extras, targets: targets.map((t) => ({ page: t.page, at: t.at })) };
}

async function publishOne(env, page, token, { message, file, at }) {
  if (file) {
    if (at === null) {
      const fd = new FormData();
      fd.set('source', file, file.name || 'image.jpg');
      fd.set('caption', message);
      fd.set('published', 'true');
      const d = await graph(env, 'POST', '/' + page + '/photos', fd, token);
      return String(d.post_id || d.id);
    }
    const fd = new FormData();
    fd.set('source', file, file.name || 'image.jpg');
    fd.set('published', 'false');
    fd.set('temporary', 'true');
    const photo = await graph(env, 'POST', '/' + page + '/photos', fd, token);
    const d = await graph(env, 'POST', '/' + page + '/feed', {
      message,
      'attached_media[0]': { media_fbid: String(photo.id) },
      published: 'false',
      scheduled_publish_time: at,
      unpublished_content_type: 'SCHEDULED'
    }, token);
    return String(d.id);
  }
  const params = at === null ? { message } : { message, published: 'false', scheduled_publish_time: at };
  const d = await graph(env, 'POST', '/' + page + '/feed', params, token);
  return String(d.id);
}

export async function createPosts(env, form) {
  const tokens = await pageTokens(env);
  const now = Math.floor(Date.now() / 1000);
  const results = [];
  for (const t of form.targets) {   // 依序，不並行（避免臉書限流）
    const scheduled = t.at !== null;
    const r = { page: t.page, ok: false, scheduled, ...(scheduled ? { at: t.at } : {}), comment: 'none' };
    results.push(r);
    const p = tokens.get(t.page);
    if (!p) { r.error = '找不到這個粉專（token 沒有管理權限）'; continue; }
    if (scheduled && !timeOk(t.at, now)) { r.error = 'fb_bad_time'; continue; }
    try {
      r.postId = await publishOne(env, t.page, p.token, { message: form.message, file: form.file, at: t.at });
      r.ok = true;
    } catch (e) {
      if (!(e instanceof GraphError)) throw e;
      r.error = String(e.message).slice(0, 200);
      continue;
    }
    const extras = form.extras || [];
    const first = form.link ? commentText(form.link, await pageUtm(env, t.page, !form.file), form.lead) : null;
    const errText = (e) => String((e && e.message) || e).slice(0, 200);
    if (scheduled) {
      // 排程：第 1 則（有網址才有）與第 2、3 則一起交給計時器，發布後依序留
      const items = [...(first ? [{ message: first, offset: 0 }] : []), ...extras];
      if (!items.length) continue;
      try {
        await armTimer(env, { pageId: t.page, postId: r.postId, at: t.at, items });
        if (first) r.comment = 'armed';
        if (extras.length) r.extra = extras.length;
      } catch (e) {
        if (first) { r.comment = 'failed'; r.commentError = errText(e); }
        if (extras.length) r.extraError = errText(e);
      }
      continue;
    }
    // 立即：第 1 則最重要，先馬上留；失敗就連同第 2、3 則交給計時器，由計時器先重試第 1 則，成功後才留後面的
    let firstOk = false;
    if (first) {
      try { await postComment(env, p.token, r.postId, first); r.comment = 'done'; firstOk = true; }
      catch (e) { r.comment = 'failed'; r.commentError = errText(e); }
    }
    const items = [...(first && !firstOk ? [{ message: first, offset: 0, recheck: true }] : []), ...extras];
    if (items.length) {
      try {
        await armTimer(env, { pageId: t.page, postId: r.postId, at: Math.floor(Date.now() / 1000), items });
        if (first && !firstOk) r.comment = 'retry';
        if (extras.length) r.extra = extras.length;
      } catch (e) {
        if (extras.length) r.extraError = errText(e);
      }
    }
  }
  return results;
}
