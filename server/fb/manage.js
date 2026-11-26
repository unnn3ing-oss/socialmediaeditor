// 已排程／已發佈列表，改時間、取消、刪除（一律以臉書為準，按刷新才查）
import { graph } from './graph.js';
import { pageTokens } from './pages.js';
import { timeOk } from './post.js';
import { retimeTimer, cancelTimer, timerStatus } from './timer.js';

const toSec = (v) => (typeof v === 'number' ? v : Number.isFinite(Date.parse(v)) ? Math.floor(Date.parse(v) / 1000) : null);

// 粉專必須是 token 管得到的；不是回 null
export async function pageToken(env, pageId) {
  if (typeof pageId !== 'string' || !/^\d{1,30}$/.test(pageId)) return null;
  const p = (await pageTokens(env)).get(pageId);
  return p ? p.token : null;
}

async function commentState(env, id) {
  if (!env.FB_TIMER) return 'none';
  try {
    const d = await timerStatus(env, id);
    // 失敗累計 ≥2 次或已失敗：回物件（前端紅字＋「重新留言」）；其他照舊回狀態字串
    if (d && d.alert) return { status: d.status || 'pending', alert: true, seq: d.alert.seq, error: d.alert.error, failed: d.alert.failed };
    // 第 1 則留言移除預覽（實驗功能）結果：tried｜failed
    const h = d && Array.isArray(d.items) ? d.items.find((x) => x && x.np && x.preview) : null;
    if (h) return { status: (d && d.status) || 'none', preview: h.preview };
    return (d && d.status) || 'none';
  } catch { return 'none'; }
}

const nextOf = (d) => (d.paging && d.paging.next && d.paging.cursors ? d.paging.cursors.after || null : null);

// after：翻頁游標；回 { items, next }（路由依 v=2 決定要不要包起來，舊前端收陣列）
export async function listScheduled(env, page, token, after) {
  const d = await graph(env, 'GET', '/' + page + '/scheduled_posts', { fields: 'id,message,scheduled_publish_time,full_picture,created_time', limit: 50, after: after || undefined }, token);
  const out = [];
  for (const p of d.data || []) {
    out.push({ id: String(p.id), message: p.message || '', at: toSec(p.scheduled_publish_time), picture: p.full_picture || null, comment: await commentState(env, String(p.id)) });
  }
  return { items: out, next: nextOf(d) };
}

export async function listPublished(env, page, token, after) {
  const d = await graph(env, 'GET', '/' + page + '/published_posts', { fields: 'id,message,created_time,full_picture,permalink_url', limit: 50, after: after || undefined }, token);
  const items = [];
  for (const p of d.data || []) {
    items.push({ id: String(p.id), message: p.message || '', time: p.created_time || null, picture: p.full_picture || null, url: p.permalink_url || null, comment: await commentState(env, String(p.id)) });
  }
  return { items, next: nextOf(d) };
}

export async function reschedule(env, id, token, at) {
  await graph(env, 'POST', '/' + id, { scheduled_publish_time: at }, token);
  // 臉書已改成功；計時器出錯不影響結果（到點時會依臉書上的時間自行校正）
  if (env.FB_TIMER) { try { await retimeTimer(env, id, at); } catch { /* 忽略 */ } }
}

export async function removePost(env, id, token) {
  await graph(env, 'DELETE', '/' + id, {}, token);
  if (env.FB_TIMER) { try { await cancelTimer(env, id); } catch { /* 到點時查不到貼文會自行取消 */ } }
}

export { timeOk };
