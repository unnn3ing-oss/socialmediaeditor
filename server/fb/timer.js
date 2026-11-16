// 排程貼文發布後補第一則留言的計時器（Durable Object，每則貼文一個實例，以貼文 ID 命名）
import { graph, isRateLimit, GraphError } from './graph.js';
import { pageTokens } from './pages.js';
import { postComment } from './comment.js';
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


const FIRST_DELAY = 60;                    // 排定時間後 60 秒第一次檢查
const RETRY = [30, 60, 120, 240];          // 一般錯誤的重試間隔（秒）；第 5 次失敗就停
const MAX_ATTEMPTS = 5;
const MAX_RETIMES = 20;                    // 到點還沒發布的追蹤次數上限
const nowSec = () => Math.floor(Date.now() / 1000);
const toSec = (v) => (typeof v === 'number' ? v : Number.isFinite(Date.parse(v)) ? Math.floor(Date.parse(v) / 1000) : null);
const reply = (o) => Response.json(o);

export class FbCommentTimer {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    let body = {};
    try { body = await request.json(); } catch { body = {}; }
    const s = this.state.storage;
    const rec = await s.get('rec');
    if (action === 'arm') {
      const at = Number(body.at);
      if (!body.pageId || !body.postId || !body.message || !Number.isInteger(at)) return reply({ ok: false, error: '資料不完整' });
      await s.put('rec', { pageId: String(body.pageId), postId: String(body.postId), message: String(body.message), at, status: 'pending', attempts: 0, retimes: 0 });
      await s.setAlarm((at + FIRST_DELAY) * 1000);
      return reply({ ok: true });
    }
    if (action === 'retime') {
      const at = Number(body.at);
      if (!rec || rec.status !== 'pending' || !Number.isInteger(at)) return reply({ ok: false, error: '沒有等待中的留言' });
      Object.assign(rec, { at, attempts: 0 });
      await s.put('rec', rec);
      await s.setAlarm((at + FIRST_DELAY) * 1000);
      return reply({ ok: true });
    }
    if (action === 'cancel') {
      if (rec && (rec.status === 'pending' || rec.status === 'posting')) { rec.status = 'canceled'; await s.put('rec', rec); }
      await s.deleteAlarm();
      return reply({ ok: true });
    }
    if (action === 'status') return reply(rec ? { ok: true, ...rec } : { ok: true, status: 'none' });
    return reply({ ok: false, error: '不支援的動作' });
  }

  async finish(rec, status, extra = {}) {
    Object.assign(rec, { status }, extra);
    await this.state.storage.put('rec', rec);
    await this.state.storage.deleteAlarm();
  }

  async alarm() {
    const s = this.state.storage;
    const rec = await s.get('rec');
    if (!rec || (rec.status !== 'pending' && rec.status !== 'posting')) return;
    try {
      const page = (await pageTokens(this.env)).get(rec.pageId);
      if (!page) return this.finish(rec, 'failed', { error: '找不到粉專 token' });
      let post;
      try {
        post = await graph(this.env, 'GET', '/' + rec.postId, { fields: 'is_published,scheduled_publish_time' }, page.token);
      } catch (e) {
        if (e instanceof GraphError && (e.code === 100 || e.status === 404) && !isRateLimit(e)) return this.finish(rec, 'canceled');
        throw e;
      }
      if (!post.is_published) {
        rec.retimes = (rec.retimes || 0) + 1;
        if (rec.retimes > MAX_RETIMES) return this.finish(rec, 'failed', { error: '貼文遲遲未發布' });
        const fbAt = toSec(post.scheduled_publish_time);
        if (fbAt && fbAt !== rec.at) rec.at = fbAt;
        await s.put('rec', rec);
        await s.setAlarm(Math.max((rec.at + FIRST_DELAY) * 1000, Date.now() + FIRST_DELAY * 1000));
        return;
      }
      if (rec.status === 'posting') {
        // 上次留言途中中斷：先確認是否已經留過，避免重複
        const d = await graph(this.env, 'GET', '/' + rec.postId + '/comments', { fields: 'from{id},message', limit: 50 }, page.token);
        const mine = (d.data || []).find((c) => c.from && String(c.from.id) === rec.pageId && c.message === rec.message);
        if (mine) return this.finish(rec, 'done', { commentId: String(mine.id) });
      }
      rec.status = 'posting';
      await s.put('rec', rec);
      const id = await postComment(this.env, page.token, rec.postId, rec.message);
      return this.finish(rec, 'done', { commentId: id });
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 200);
      if (isRateLimit(e)) return this.finish(rec, 'failed', { error: msg, attempts: (rec.attempts || 0) + 1 });
      rec.attempts = (rec.attempts || 0) + 1;
      if (rec.attempts >= MAX_ATTEMPTS) return this.finish(rec, 'failed', { error: msg });
      // 留言途中失敗（status 仍是 posting）可能其實已留成功：保持 posting，下次先查再留
      rec.error = msg;
      await s.put('rec', rec);
      await s.setAlarm(Date.now() + RETRY[rec.attempts - 1] * 1000);
    }
  }
}
