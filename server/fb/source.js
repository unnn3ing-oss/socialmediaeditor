// 幫直出：讀一則已發佈貼文的文字、圖片、文章連結，給排程發布帶進「新增發文」
//   GET /fb/posts/:id/source?page=（權限 post）；只有使用者按「幫直出」才呼叫
//   圖片：attachments 的大圖（沒有就 full_picture），只收 *.fbcdn.net、JPG／PNG／WebP／GIF、≤ 8MB，後端讀完回 base64
//   連結：① 留言計時器紀錄裡的留言（不打臉書）② 這則貼文裡粉專自己的留言 ③ 連結分享的 unshimmed_url；拿掉 utm_* 參數
import { graph } from './graph.js';
import { timerStatus } from './timer.js';
import { validImgUrl } from './bgstore.js';

export const MAX_SOURCE_IMG = 8 * 1024 * 1024;
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const URL_RE = /https?:\/\/[^\s<>"'，。、）】]+/i;

// 拿掉 utm_* 參數；不是 http(s) 回 ''
export function stripUtm(s) {
  let u;
  try { u = new URL(String(s || '')); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol)) return '';
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  return u.toString().replace(/\?(#|$)/, '$1');
}
// 文字裡第一個網址（拿掉 utm）
export function linkIn(text) {
  const m = URL_RE.exec(String(text || ''));
  return m ? stripUtm(m[0]) : '';
}
// 大圖網址：照片貼文的 attachments.media.image.src → 相簿第一張 → full_picture
export function pickImage(d) {
  const a = d && d.attachments && Array.isArray(d.attachments.data) ? d.attachments.data[0] : null;
  const sub = a && a.subattachments && Array.isArray(a.subattachments.data) ? a.subattachments.data[0] : null;
  for (const src of [a && a.media && a.media.image && a.media.image.src, sub && sub.media && sub.media.image && sub.media.image.src, d && d.full_picture]) {
    if (validImgUrl(src)) return src;
  }
  return null;
}

async function readImage(url, fetchImpl) {
  let res;
  try { res = await fetchImpl(url, { redirect: 'manual' }); } catch { return null; }
  if (res.status !== 200) return null;
  const ct = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!IMG_TYPES.includes(ct) || Number(res.headers.get('content-length') || 0) > MAX_SOURCE_IMG) return null;
  let buf;
  try { buf = new Uint8Array(await res.arrayBuffer()); } catch { return null; }
  if (!buf.byteLength || buf.byteLength > MAX_SOURCE_IMG) return null;
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { type: ct, data: btoa(bin) };
}

async function linkFromTimer(env, id) {
  if (!env.FB_TIMER) return '';
  try {
    const d = await timerStatus(env, id);
    for (const it of (d && Array.isArray(d.items) ? d.items : [])) { const l = linkIn(it && it.message); if (l) return l; }
  } catch { /* 沒有紀錄 */ }
  return '';
}
async function linkFromComments(env, id, page, token) {
  try {
    const d = await graph(env, 'GET', '/' + id + '/comments', { fields: 'from{id},message', filter: 'toplevel', order: 'chronological', limit: 25 }, token);
    for (const c of (d && d.data) || []) if (c.from && String(c.from.id) === page) { const l = linkIn(c.message); if (l) return l; }
  } catch { /* 沒權限或讀不到：連結留空 */ }
  return '';
}

// 回 { message, link, image: {type,data}|null, imageFailed }
export async function postSource(env, page, token, id, fetchImpl = fetch) {
  const d = await graph(env, 'GET', '/' + id, { fields: 'message,full_picture,attachments{type,unshimmed_url,media{image{src}},subattachments.limit(1){media{image{src}}}}' }, token);
  const src = pickImage(d);
  const image = src ? await readImage(src, fetchImpl) : null;
  let link = await linkFromTimer(env, id);
  if (!link) link = await linkFromComments(env, id, page, token);
  if (!link) {
    const a = d && d.attachments && Array.isArray(d.attachments.data) ? d.attachments.data[0] : null;
    if (a && a.unshimmed_url) link = stripUtm(a.unshimmed_url);
  }
  return { message: String((d && d.message) || ''), link, image, imageFailed: !!src && !image };
}
