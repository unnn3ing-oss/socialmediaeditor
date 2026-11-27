// 發文：依序對每個粉專立即或排程；有圖排程照 Meta 官方範例（暫存照片 → /feed attached_media）
import { graph, GraphError } from './graph.js';
import { pageTokens, pageUtm } from './pages.js';
import { commentText, postComment, editAfterPost, npMethodFor, postFirstNoPreview, MAX_LEAD as MAX_COMMENT_LEAD } from './comment.js';
import { armTimer } from './timer.js';
import { claimSend, finishSend } from './sends.js';
import { BG_MAX_CHARS } from './bgpresets.js';

export { commentLink, commentText } from './comment.js';

export const MIN_LEAD = 600;            // 排程至少晚 10 分鐘
export const MAX_LEAD = 30 * 86400;     // 最多 30 天
export const MAX_IMAGE = 8 * 1024 * 1024;
export const MAX_IMAGES = 10;                 // 多圖（照片框）最多 10 張
export const MAX_IMAGES_TOTAL = 40 * 1024 * 1024;
const MAX_MESSAGE = 63206;

export const timeOk = (at, now = Math.floor(Date.now() / 1000)) => Number.isInteger(at) && at >= now + MIN_LEAD && at <= now + MAX_LEAD;

// 驗證表單；不合法回 null
// 第 2、3 則留言：[{ message, delay（距上一則幾分鐘，5 的倍數，5～1440） }] → [{ message, offset（距發布幾分鐘） }]；不合法回 null
export const MAX_EXTRAS = 2;
// 第 2、3 則留言帶上「第幾則」（通知與列表顯示用）
const numbered = (extras) => extras.map((x, i) => ({ ...x, n: i + 2 }));
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

// 警語留言（2026-11-26）：獨立一則，與第 1 則同時（排在第 1 則之後、offset 0），不佔第 2、3 則名額
export const MAX_WARN = 2000;
export function parseWarn(raw) {
  if (raw === null || raw === undefined) return '';
  const w = String(raw).replace(/\r\n/g, '\n').trim();
  return [...w].length > MAX_WARN ? null : w;
}

export const KINDS = ['template', 'textimg', 'text', 'photo'];   // photo＝原圖（不套版）
// 通知用的貼文摘要（≤40 字）：有整行【標題】用標題，沒有用第一行有字的
export const TITLE_MAX = 40;
export function summaryOf(message) {
  const lines = String(message || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  const t = lines.map((l) => /^【(.+)】$/.exec(l)).find(Boolean);
  const s = t ? t[1].trim() : (lines.find(Boolean) || '');
  const a = [...s];
  return a.length > TITLE_MAX ? a.slice(0, TITLE_MAX).join('') + '…' : s;
}
export function parsePostForm(fd) {
  const message = String(fd.get('message') || '');
  const link = String(fd.get('link') || '').trim();
  const images = fd.getAll('image').filter((x) => x && typeof x === 'object' && x.size > 0);
  const lead = fd.has('commentLead') ? String(fd.get('commentLead')) : undefined;   // 沒給＝預設「看更多新聞內容」
  if (message.length > MAX_MESSAGE) return null;
  if (lead !== undefined && ([...lead.trim()].length > MAX_COMMENT_LEAD || /[\r\n]/.test(lead.trim()))) return null;
  if (!link || !/^https?:\/\/[^\s]+$/i.test(link)) return null;   // 文章網址必填（第 1 則留言、RD 都要用）
  // 圖片：1 張＝一般有圖貼文；2～10 張＝多圖貼文（照片框）
  if (images.length > MAX_IMAGES) return null;
  let total = 0;
  for (const im of images) {
    if (!['image/jpeg', 'image/png'].includes(im.type) || im.size > MAX_IMAGE) return null;
    total += im.size;
  }
  if (total > MAX_IMAGES_TOTAL) return null;
  const files = images;
  const file = files[0] || null;
  if (!message.trim() && !file) return null;
  // 文字背景（只限純文字、≤130 字）；代號是否在清單由路由查 findBackground
  const bg = fd.has('bg') ? String(fd.get('bg')) : '';
  if (bg && (!/^\d{6,20}$/.test(bg) || file || [...message.replace(/\r\n/g, '\n')].length > BG_MAX_CHARS)) return null;
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
  const warn = parseWarn(fd.get('warn'));
  if (warn === null) return null;
  // sendId：前端每則發文一組（防重複發文）；沒帶＝不記錄（舊頁面）
  const sendId = fd.has('sendId') ? String(fd.get('sendId')) : '';
  if (sendId && !/^[A-Za-z0-9-]{8,64}$/.test(sendId)) return null;
  // retry：使用者確認過要重送的「待確認」粉專
  let retry = [];
  if (fd.has('retry')) {
    try { retry = JSON.parse(String(fd.get('retry'))); } catch { return null; }
    if (!Array.isArray(retry) || !retry.every((id) => seen.has(id))) return null;
  }
  // kind：發文類型（只用在操作紀錄）；沒帶或不認得＝不記
  const kind = KINDS.includes(String(fd.get('kind') || '')) ? String(fd.get('kind')) : '';
  // noPreview：這次送出要不要試著移除第 1 則留言的連結預覽（實驗功能，後端再查發文者適不適用）
  const noPreview = String(fd.get('noPreview') || '') === '1';
  return { message, link, lead, file, files, bg, extras, warn, sendId, retry, kind, noPreview, targets: targets.map((t) => ({ page: t.page, at: t.at })) };
}

// 多圖：每張先上傳成未發布照片（排程另加 temporary），再用 /feed 的 attached_media 合成一則貼文
//   照片上傳失敗＝還沒有貼文，可安全重送（不算結果不明）
async function publishMulti(env, page, token, { message, files, at }) {
  const ids = [];
  for (const f of files) {
    const fd = new FormData();
    fd.set('source', f, f.name || 'image.jpg');
    fd.set('published', 'false');
    if (at !== null) fd.set('temporary', 'true');
    try { ids.push(String((await graph(env, 'POST', '/' + page + '/photos', fd, token)).id)); }
    catch (e) { if (e instanceof GraphError) e.uncertain = false; throw e; }
  }
  const params = { message };
  ids.forEach((id, i) => { params[`attached_media[${i}]`] = { media_fbid: id }; });
  if (at !== null) Object.assign(params, { published: 'false', scheduled_publish_time: at, unpublished_content_type: 'SCHEDULED' });
  const d = await graph(env, 'POST', '/' + page + '/feed', params, token);
  return String(d.id);
}
async function publishOne(env, page, token, { message, file, files, bg, at }) {
  if (files && files.length > 1) return publishMulti(env, page, token, { message, files, at });
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
    let photo;
    // 暫存照片不會發布：這步結果不明也能安全重送，當一般失敗
    try { photo = await graph(env, 'POST', '/' + page + '/photos', fd, token); } catch (e) { if (e instanceof GraphError) e.uncertain = false; throw e; }
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
  if (bg) params.text_format_preset_id = bg;
  const d = await graph(env, 'POST', '/' + page + '/feed', params, token);
  return String(d.id);
}

// who：送出的人（{ uid }），記給留言計時器，留言失敗通知只給他（和看全部的人）
export async function createPosts(env, form, who = null) {
  const by = who && who.uid ? String(who.uid).slice(0, 20) : '';
  const title = summaryOf(form.message);
  const np = form.link ? await npMethodFor(env, !!form.noPreview, by) : null;   // 第 1 則移除連結預覽（實驗功能）：'a'|'b'|null
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
    const sid = form.sendId;
    if (sid) {
      let c;
      try { c = await claimSend(env, sid, t.page, { retry: (form.retry || []).includes(t.page), scheduled, at: scheduled ? t.at : null }); }
      catch { r.error = '無法記錄送出狀態，這個粉專未送出'; continue; }
      if (!c.claimed) {
        if (c.status === 'ok') {   // 這則先前已成功：不重送、不留言
          Object.assign(r, { ok: true, dup: true, postId: c.postId, scheduled: c.scheduled, comment: 'none' });
          if (c.scheduled && c.at) r.at = c.at; else delete r.at;
        } else { r.unknown = true; r.error = c.status === 'pending' ? '上一次送出還沒有結果' : '上一次送出結果不明'; }
        continue;
      }
    }
    try {
      r.postId = await publishOne(env, t.page, p.token, { message: form.message, file: form.file, files: form.files, bg: form.bg, at: t.at });
      r.ok = true;
      if (sid) await finishSend(env, sid, t.page, 'ok', r.postId);
    } catch (e) {
      if (!(e instanceof GraphError)) throw e;
      r.error = String(e.message).slice(0, 200);
      if (e.uncertain) r.unknown = true;   // 臉書可能已發出：待確認，不能直接重送
      if (sid) await finishSend(env, sid, t.page, e.uncertain ? 'unknown' : 'failed');
      continue;
    }
    const extras = form.extras || [];
    const warnItem = form.warn ? [{ message: form.warn, offset: 0, warn: true }] : [];
    const first = form.link ? commentText(form.link, await pageUtm(env, t.page, !form.file), form.lead) : null;
    const errText = (e) => String((e && e.message) || e).slice(0, 200);
    if (scheduled) {
      // 排程：第 1 則（有網址才有）與第 2、3 則一起交給計時器，發布後依序留
      const items = [...(first ? [{ message: first, offset: 0, n: 1, ...(np ? { np } : {}) }] : []), ...numbered([...warnItem, ...extras])];
      if (!items.length) continue;
      try {
        await armTimer(env, { pageId: t.page, postId: r.postId, at: t.at, items, by, title, ptype: form.kind || undefined, pageName: p.name });
        if (first) r.comment = 'armed';
        if (warnItem.length) r.warn = 'armed';
        if (extras.length) r.extra = extras.length;
      } catch (e) {
        if (first) { r.comment = 'failed'; r.commentError = errText(e); }
        if (warnItem.length) { r.warn = 'failed'; r.warnError = errText(e); }
        if (extras.length) r.extraError = errText(e);
      }
      continue;
    }
    // 立即：第 1 則最重要，先馬上留；失敗就連同第 2、3 則交給計時器，由計時器先重試第 1 則，成功後才留後面的
    let firstOk = false, firstUnsure = false;
    if (first) {
      try {
        let cid;
        if (np) { const x = await postFirstNoPreview(env, p.token, r.postId, first, np); cid = x.id; r.preview = x.preview; if (x.previewError) r.previewError = x.previewError; }
        else cid = await postComment(env, p.token, r.postId, first);
        r.comment = 'done'; firstOk = true;
        if (!np) await editAfterPost(env, p.token, cid, first, by);
      }
      catch (e) { r.comment = 'failed'; r.commentError = errText(e); firstUnsure = !(e instanceof GraphError) || !!e.uncertain; }
    }
    // 警語：第 1 則成功（或沒有第 1 則）就馬上留；失敗交給計時器（沒收到回應＝先查再留）
    let warnLeft = warnItem;
    if (warnItem.length && (firstOk || !first)) {
      try { await postComment(env, p.token, r.postId, form.warn); r.warn = 'done'; warnLeft = []; }
      catch (e) { warnLeft = [{ ...warnItem[0], ...(!(e instanceof GraphError) || e.uncertain ? { recheck: true } : {}) }]; }
    }
    // 第 1 則：臉書明確回錯誤＝確定沒留，計時器直接重留；沒收到回應＝可能已留，計時器先查再留（recheck）
    // 已留成功的警語仍佔編號（第 2 則），後面的照原編號
    const rest = numbered([...warnItem, ...extras]).filter((x) => !x.warn || warnLeft.length).map((x) => (x.warn && warnLeft[0].recheck ? { ...x, recheck: true } : x));
    const items = [...(first && !firstOk ? [{ message: first, offset: 0, n: 1, ...(firstUnsure ? { recheck: true } : {}), ...(np ? { np } : {}) }] : []), ...rest];
    if (items.length) {
      try {
        // published：貼文剛剛由臉書回應成功發出，計時器不用再問「發布了沒」（那一步需要讀取權限，可能被擋）
        await armTimer(env, { pageId: t.page, postId: r.postId, at: Math.floor(Date.now() / 1000), published: true, items, by, title, ptype: form.kind || undefined, pageName: p.name });
        if (first && !firstOk) r.comment = 'retry';
        if (warnLeft.length) r.warn = 'retry';
        if (extras.length) r.extra = extras.length;
      } catch (e) {
        if (warnLeft.length) { r.warn = 'failed'; r.warnError = errText(e); }
        if (extras.length) r.extraError = errText(e);
      }
    }
  }
  return results;
}
