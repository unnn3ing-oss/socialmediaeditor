// 排程貼文發布後補第一則留言的計時器（Durable Object，每則貼文一個實例，以貼文 ID 命名）
async function callTimer(env, postId, action, body) {
  if (!env.FB_TIMER) throw new Error('FB_TIMER 未綁定');
  const stub = env.FB_TIMER.get(env.FB_TIMER.idFromName(String(postId)));
  const r = await stub.fetch('https://timer/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
export const armTimer = (env, rec) => callTimer(env, rec.postId, 'arm', rec);
export const retimeTimer = (env, postId, at) => callTimer(env, postId, 'retime', { at });
export const cancelTimer = (env, postId) => callTimer(env, postId, 'cancel');
export const timerStatus = (env, postId) => callTimer(env, postId, 'status');
