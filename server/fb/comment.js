// 第一則留言：「看更多新聞內容」＋文章網址＋該粉專 UTM
import { graph } from './graph.js';

// UTM 去掉開頭的 ?／&；網址沒有 ? → 接 ?&utm…（照小編慣用格式）；已有 ? → 用 & 接；# 錨點留在最後
export function commentLink(url, utm) {
  url = String(url || '').trim();
  const u = String(utm || '').trim().replace(/^[?&]+/, '');
  if (!url || !u) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  if (!base.includes('?')) return base + '?&' + u + hash;
  return base + (/[?&]$/.test(base) ? '' : '&') + u + hash;
}

export const DEFAULT_LEAD = '看更多新聞內容';
export const MAX_LEAD = 200;
// lead 沒給（undefined）用預設；給了空白就只放連結
export function commentText(url, utm, lead = DEFAULT_LEAD) {
  const head = String(lead == null ? DEFAULT_LEAD : lead).trim();
  const link = commentLink(url, utm);
  return head ? head + '\n' + link : link;
}

export async function postComment(env, token, postId, message) {
  const d = await graph(env, 'POST', '/' + postId + '/comments', { message }, token);
  return String(d.id || '');
}
