// 發文：依序對每個粉專立即或排程；有圖排程照 Meta 官方範例（暫存照片 → /feed attached_media）
import { graph, GraphError } from './graph.js';
import { pageTokens, pageUtm } from './pages.js';
import { commentText, postComment } from './comment.js';
import { armTimer } from './timer.js';

export { commentLink, commentText } from './comment.js';

export const MIN_LEAD = 600;            // 排程至少晚 10 分鐘
export const MAX_LEAD = 30 * 86400;     // 最多 30 天
export const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_MESSAGE = 63206;

export const timeOk = (at, now = Math.floor(Date.now() / 1000)) => Number.isInteger(at) && at >= now + MIN_LEAD && at <= now + MAX_LEAD;

// 驗證表單；不合法回 null
export function parsePostForm(fd) {
  const message = String(fd.get('message') || '');
  const link = String(fd.get('link') || '').trim();
  const image = fd.get('image');
  if (message.length > MAX_MESSAGE) return null;
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) return null;
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
  return { message, link, file, targets: targets.map((t) => ({ page: t.page, at: t.at })) };
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
    if (!form.link) continue;
    const text = commentText(form.link, await pageUtm(env, t.page));
    try {
      if (scheduled) { await armTimer(env, { pageId: t.page, postId: r.postId, message: text, at: t.at }); r.comment = 'armed'; }
      else { await postComment(env, p.token, r.postId, text); r.comment = 'done'; }
    } catch (e) {
      r.comment = 'failed';
      r.commentError = String((e && e.message) || e).slice(0, 200);
    }
  }
  return results;
}
