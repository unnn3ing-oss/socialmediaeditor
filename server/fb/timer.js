// 排程貼文發布後補第一則留言的計時器（Durable Object，每則貼文一個實例，以貼文 ID 命名）
import { graph, isRateLimit, GraphError } from './graph.js';
import { pageTokens } from './pages.js';
import { postComment } from './comment.js';
async function callTimer(env, postId, action, body) {
  if (!env.FB_TIMER) throw new Error('FB_TIMER 未綁定');
  const stub = env.FB_TIMER.get(env.FB_TIMER.idFromName(String(postId)));
  const r = await stub.fetch('https://timer/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json();
  if (action === 'arm' && (!d || !d.ok)) throw new Error((d && d.error) || '計時器沒有接受');   // 沒排上就不能當成排好了
  return d;
}
export const armTimer = (env, rec) => callTimer(env, rec.postId, 'arm', rec);
export const retimeTimer = (env, postId, at) => callTimer(env, postId, 'retime', { at });
export const cancelTimer = (env, postId) => callTimer(env, postId, 'cancel');
export const timerStatus = (env, postId) => callTimer(env, postId, 'status');


const FIRST_DELAY = 60;                    // 排定時間後 60 秒第一次檢查
const RETRY = [30, 60, 120, 240];          // 一般錯誤的重試間隔（秒）；第 5 次失敗就停
const MAX_ATTEMPTS = 5;
const MAX_RETIMES = 20;                    // 到點還沒發布的追蹤次數上限
export const PURGE_AFTER = 14 * 86400 * 1000;   // 留言全部結束（完成／取消／失敗）後 14 天刪除整筆紀錄（隱私權政策）
const nowSec = () => Math.floor(Date.now() / 1000);
const toSec = (v) => (typeof v === 'number' ? v : Number.isFinite(Date.parse(v)) ? Math.floor(Date.parse(v) / 1000) : null);
const reply = (o) => Response.json(o);

export const MAX_ITEMS = 3;                 // 一則貼文最多 3 則留言（第 1 則＋第 2、3 則）

// rec：{ pageId, postId, at（貼文發布時間，秒）, published, retimes,
//        items: [{ message, offset（距發布幾分鐘）, status: pending|posting|done|failed|canceled, attempts, commentId?, error? }] }
// 每則的到點時間＝at＋60 秒＋offset 分鐘；到點的依序留，沒到的排下一個鬧鐘。
const dueOf = (rec, it) => (rec.at + FIRST_DELAY + it.offset * 60) * 1000;
const open = (it) => it.status === 'pending' || it.status === 'posting';

function summary(rec) {
  const st = rec.items.map((x) => x.status);
  if (st.some((x) => x === 'pending' || x === 'posting')) return 'pending';
  if (st.some((x) => x === 'failed')) return 'failed';
  if (st.every((x) => x === 'canceled')) return 'canceled';
  return st.some((x) => x === 'done') ? 'done' : 'canceled';
}

function normItems(body) {
  const list = Array.isArray(body.items) ? body.items : body.message ? [{ message: body.message, offset: 0 }] : null;
  if (!list || !list.length || list.length > MAX_ITEMS) return null;
  let prev = -1;
  const out = [];
  for (const x of list) {
    const off = Number(x && x.offset);
    if (!x || typeof x.message !== 'string' || !x.message || !Number.isInteger(off) || off < 0 || off < prev) return null;
    prev = off;
    // recheck：這則可能其實已經留成功（立即發布時回應錯誤），當成「留言途中」，到點先查再留，避免重複
    out.push({ message: x.message, offset: off, status: x.recheck ? 'posting' : 'pending', attempts: 0 });
  }
  return out;
}

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
      const items = normItems(body);
      if (!body.pageId || !body.postId || !items || !Number.isInteger(at)) return reply({ ok: false, error: '資料不完整' });
      const r = { pageId: String(body.pageId), postId: String(body.postId), at, published: false, retimes: 0, items };
      await s.put('rec', r);
      await this.schedule(r);
      return reply({ ok: true });
    }
    if (action === 'retime') {
      const at = Number(body.at);
      if (!rec || rec.published || !rec.items.some(open) || !Number.isInteger(at)) return reply({ ok: false, error: '沒有等待中的留言' });
      rec.at = at;
      rec.items.forEach((x) => { if (open(x)) x.attempts = 0; });
      await s.put('rec', rec);
      await this.schedule(rec);
      return reply({ ok: true });
    }
    if (action === 'cancel') {
      if (rec) { rec.items.forEach((x) => { if (open(x)) x.status = 'canceled'; }); await s.put('rec', rec); await this.schedule(rec); }
      else await s.deleteAlarm();
      return reply({ ok: true });
    }
    if (action === 'status') {
      if (!rec) return reply({ ok: true, status: 'none' });
      if (!rec.purgeAt && !rec.items.some(open)) await this.schedule(rec);   // 舊紀錄（沒排清除）被查到時補排 14 天清除
      const first = rec.items[0] || {};
      // 頂層欄位沿用第 1 則（列表顯示用），items 是每則的狀態
      return reply({ ok: true, pageId: rec.pageId, postId: rec.postId, at: rec.at, retimes: rec.retimes, status: summary(rec), commentId: first.commentId, attempts: first.attempts, error: first.error, items: rec.items });
    }
    return reply({ ok: false, error: '不支援的動作' });
  }

  // 排下一個鬧鐘：還沒留的裡最早到點的；都結束了就排 14 天後清除整筆紀錄
  async schedule(rec, earliest = 0) {
    const next = rec.items.filter(open).map((x) => dueOf(rec, x));
    if (!next.length) {
      if (!rec.purgeAt) { rec.purgeAt = Date.now() + PURGE_AFTER; await this.state.storage.put('rec', rec); }
      await this.state.storage.setAlarm(rec.purgeAt);
      return;
    }
    if (rec.purgeAt) { delete rec.purgeAt; await this.state.storage.put('rec', rec); }
    await this.state.storage.setAlarm(Math.max(Math.min(...next), earliest));
  }

  async alarm() {
    const s = this.state.storage;
    const rec = await s.get('rec');
    if (!rec) return;
    if (!rec.items.some(open)) {   // 都結束了：到清除時間就刪整筆，還沒到（例：舊紀錄沒有 purgeAt）就排清除
      if (rec.purgeAt && rec.purgeAt <= Date.now()) { await s.deleteAlarm(); await s.deleteAll(); return; }
      return this.schedule(rec);
    }
    let page;
    try { page = (await pageTokens(this.env)).get(rec.pageId); } catch (e) { return this.retry(rec, rec.items.find(open), e); }
    if (!page) { rec.items.forEach((x) => { if (open(x)) { x.status = 'failed'; x.error = '找不到粉專 token'; } }); await s.put('rec', rec); return this.schedule(rec); }

    // 先確認貼文已發布（確認過就不再查）
    if (!rec.published) {
      let post;
      try {
        post = await graph(this.env, 'GET', '/' + rec.postId, { fields: 'is_published,scheduled_publish_time' }, page.token);
      } catch (e) {
        if (e instanceof GraphError && (e.status === 404 || (e.code === 100 && e.subcode === 33))) {
          rec.items.forEach((x) => { if (open(x)) x.status = 'canceled'; });
          await s.put('rec', rec); return this.schedule(rec);
        }
        return this.retry(rec, rec.items.find(open), e);
      }
      if (!post.is_published) {
        rec.retimes = (rec.retimes || 0) + 1;
        if (rec.retimes > MAX_RETIMES) {
          rec.items.forEach((x) => { if (open(x)) { x.status = 'failed'; x.error = '貼文遲遲未發布'; } });
          await s.put('rec', rec); return this.schedule(rec);
        }
        const fbAt = toSec(post.scheduled_publish_time);
        if (fbAt && fbAt !== rec.at) rec.at = fbAt;
        await s.put('rec', rec);
        return this.schedule(rec, Date.now() + FIRST_DELAY * 1000);
      }
      rec.published = true;
      await s.put('rec', rec);
    }

    // 到點的依序留；一則失敗就停在那則（重試），後面的不跳過
    for (const it of rec.items) {
      if (!open(it)) continue;
      if (dueOf(rec, it) > Date.now()) break;
      try {
        if (it.status === 'posting') {
          // 上次留言途中中斷：先確認是否已經留過，避免重複
          const d = await graph(this.env, 'GET', '/' + rec.postId + '/comments', { fields: 'from{id},message', limit: 100 }, page.token);
          // 同樣內容的另一則已經留過的不算（兩則可能一字不差）
          const used = new Set(rec.items.filter((x) => x !== it && x.commentId).map((x) => String(x.commentId)));
          const mine = (d.data || []).find((c) => c.from && String(c.from.id) === rec.pageId && c.message === it.message && !used.has(String(c.id)));
          if (mine) { Object.assign(it, { status: 'done', commentId: String(mine.id) }); await s.put('rec', rec); continue; }
        }
        it.status = 'posting';
        await s.put('rec', rec);
        const id = await postComment(this.env, page.token, rec.postId, it.message);
        Object.assign(it, { status: 'done', commentId: id });
        await s.put('rec', rec);
      } catch (e) {
        return this.retry(rec, it, e);
      }
    }
    return this.schedule(rec);
  }

  // 失敗：限流立刻標失敗；其他重試（30/60/120/240 秒），第 5 次失敗標失敗。posting 狀態保留，下次先查再留
  async retry(rec, it, e) {
    const s = this.state.storage;
    const msg = String((e && e.message) || e).slice(0, 200);
    if (!it) return;
    it.attempts = (it.attempts || 0) + 1;
    it.error = msg;
    if (isRateLimit(e) || it.attempts >= MAX_ATTEMPTS) {
      it.status = 'failed';
      // 留言要依序：前一則失敗，後面還沒留的也不留
      rec.items.slice(rec.items.indexOf(it) + 1).forEach((x) => { if (open(x)) { x.status = 'failed'; x.error = '前一則留言失敗，未留'; } });
      await s.put('rec', rec);
      return this.schedule(rec);
    }
    await s.put('rec', rec);
    await s.setAlarm(Date.now() + RETRY[it.attempts - 1] * 1000);
  }
}
