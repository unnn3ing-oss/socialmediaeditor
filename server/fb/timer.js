// 排程貼文發布後補第一則留言的計時器（Durable Object，每則貼文一個實例，以貼文 ID 命名）
import { graph, isRateLimit, GraphError } from './graph.js';
import { pageTokens } from './pages.js';
import { postComment, editAfterPost, postFirstNoPreview, finishNoPreview, npHead, NP_METHODS } from './comment.js';
import { setNotice, logCommentFail } from './notices.js';
import { PTYPES, logEvent } from '../core/logs.js';
import { audit } from '../core/staff.js';
import { systemMsg } from '../core/msgs.js';
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
// sync（列表讀取時順便校正，2026-11-26）：{ at }＝還在已排程、臉書上的排定時間；{ published: true }＝出現在已發佈
export const timerStatus = (env, postId, sync = null) => callTimer(env, postId, 'status', sync ? { sync } : undefined);
export const retryTimer = (env, postId, pageId, by = null) => callTimer(env, postId, 'retry', { pageId: String(pageId), ...(by ? { by: { uid: String(by.uid || '').slice(0, 20), name: String(by.name || '').slice(0, 30) } } : {}) });


const FIRST_DELAY = 60;                    // 排定時間後 60 秒第一次檢查
// 一般錯誤的重試間隔（秒）：到點、+30、+60、+120（第 4 次失敗＝2 分鐘，提醒）、+360（第 5 次，最後）
const RETRY = [30, 30, 60, 240];
const MAX_ATTEMPTS = 5;
const MAX_RETIMES = 20;                    // 到點還沒發布的追蹤次數上限
const MAX_RETIMES_VIDEO = 60;              // 影片：臉書處理長影片可能超過 20 分鐘，放寬到約 1 小時
export const PURGE_AFTER = 14 * 86400 * 1000;   // 留言全部結束（完成／取消／失敗）後 14 天刪除整筆紀錄（隱私權政策）
const nowSec = () => Math.floor(Date.now() / 1000);
const toSec = (v) => (typeof v === 'number' ? v : Number.isFinite(Date.parse(v)) ? Math.floor(Date.parse(v) / 1000) : null);
const reply = (o) => Response.json(o);

export const MAX_ITEMS = 4;                 // 一則貼文最多 4 則留言（第 1 則＋警語＋第 2、3 則）

// rec：{ pageId, postId, at（貼文發布時間，秒）, published, retimes, kind?（'video'＝影片物件）,
//        items: [{ message, offset（距發布幾分鐘）, status: pending|posting|done|failed|canceled, attempts, commentId?, error? }] }
// 每則的到點時間＝at＋60 秒＋offset 分鐘；到點的依序留，沒到的排下一個鬧鐘。
const dueOf = (rec, it) => (rec.at + (rec.immediateExtras && it.offset === 0 ? 0 : FIRST_DELAY) + it.offset * 60) * 1000;
const open = (it) => it.status === 'pending' || it.status === 'posting';
// 多文（影片發布）：rec.cross＝[{ page, status: pending|posting|done|failed|unknown, attempts, next?（下次可試的毫秒）, videoId?, error? }]
// 原影片發布後才做：先在原影片 allow_crossposting_for_pages（一次全部），再用各目標粉專 POST /{page}/videos crossposted_video_id
// 臉書處理影片需要時間，重試間隔拉長；posting 中斷＝結果不明（unknown），不自動重送避免重複
export const MAX_CROSS = 10;
const CROSS_RETRY = [60, 120, 300, 600, 900];
const CROSS_TRIES = CROSS_RETRY.length + 1;
const crossOf = (rec) => (Array.isArray(rec.cross) ? rec.cross : []);
const crossDue = (rec, c) => Math.max((rec.at + FIRST_DELAY) * 1000, c.next || 0);
const anyOpen = (rec) => rec.items.some(open) || crossOf(rec).some(open);

function summary(rec) {
  const st = rec.items.map((x) => x.status);
  if (!st.length) return crossOf(rec).some(open) ? 'pending' : 'done';
  if (st.some((x) => x === 'pending' || x === 'posting')) return 'pending';
  if (st.some((x) => x === 'failed')) return 'failed';
  if (st.every((x) => x === 'canceled')) return 'canceled';
  return st.some((x) => x === 'done') ? 'done' : 'canceled';
}

// 要提醒的留言：第一則「失敗」或「失敗累計 ≥ ALERT_AT 次還在重試」的；沒有＝null
// 到點、+30、+60、+120 秒都沒成功（2 分鐘）就提醒；之後照常自動重試，成功就撤掉提醒
export const ALERT_AT = 4;
const CASCADE = '前一則留言失敗，未留';
// 讀取被擋（權限不足）：(#10)、(#200～299)
const isReadDenied = (e) => e instanceof GraphError && (e.code === 10 || (e.code >= 200 && e.code < 300));
// 找不到物件：HTTP 404 或 (#100) subcode 33。對排程中（還沒發布）的貼文留言，臉書也回這個
const isGone = (e) => e instanceof GraphError && (e.status === 404 || (e.code === 100 && e.subcode === 33));
const SYSTEM = { uid: 'SYSTEM', name: '系統' };
const DAY_MS = 86400000;
// 計時器每一步的名稱（錯誤說明前綴）：讀取類（確認發布、確認是否已留）被擋不代表留言沒留上
export const STEP = { token: '取得粉專權杖', published: '確認發布', check: '確認是否已留', comment: '留言' };
// 留言失敗的簡短概述（依臉書錯誤碼／步驟）
export function briefOf(it) {
  const c = it.ecode, msg = String(it.error || '');
  if (msg === CASCADE) return '前一則失敗，未留';
  if (msg.includes('找不到粉專 token')) return '找不到粉專權杖';
  if (msg.includes('貼文遲遲未發布') || it.notYet) return '貼文還沒發布';
  if (it.status === 'failed' && it.unsure) return '可能已留上，請到臉書確認';
  if ([4, 17, 32, 613, 80001].includes(c)) return '臉書限流';
  if (c === 190 || c === 102) return '權杖失效';
  if (c === 10 || (c >= 200 && c < 300)) return '權限不足';
  if (c === 803 || c === 100) return '找不到貼文或欄位';
  if (c === 1 || c === 2 || c === 368) return '臉書暫時無法服務';
  return '留言沒有成功';
}
const seqOf = (it, i) => (Number.isInteger(it.n) && it.n > 0 ? it.n : i + 1);
export function alertOf(rec) {
  if (rec.canceled) return null;   // 整則取消（貼文刪除）就不再提醒
  const i = rec.items.findIndex((x) => x.status === 'failed' || (open(x) && (x.attempts || 0) >= ALERT_AT));
  if (i < 0) return null;
  const it = rec.items[i];
  // seq＝使用者看到的「第幾則」（立即發布第 1 則當場留好時，交給計時器的從第 2 則開始）；idx＝rec.items 位置
  // error＝給使用者看的簡短概述（通知卡、列表、即時狀態）；完整說明（含步驟）與臉書原文只進錯誤日誌
  return { seq: seqOf(it, i), idx: i, error: briefOf(it), failed: it.status === 'failed', attempts: it.attempts || 0 };
}

function normCross(body) {
  const list = body.cross === undefined ? [] : body.cross;
  if (!Array.isArray(list) || list.length > MAX_CROSS || !list.every((p) => typeof p === 'string' && /^\d{1,30}$/.test(p)) || new Set(list).size !== list.length) return null;
  return list.map((page) => ({ page, status: 'pending', attempts: 0 }));
}
function normItems(body, allowEmpty) {
  const list = Array.isArray(body.items) ? body.items : body.message ? [{ message: body.message, offset: 0 }] : null;
  if (allowEmpty && Array.isArray(list) && !list.length) return [];
  if (!list || !list.length || list.length > MAX_ITEMS) return null;
  let prev = -1;
  const out = [];
  for (const x of list) {
    const off = Number(x && x.offset);
    if (!x || typeof x.message !== 'string' || !x.message || !Number.isInteger(off) || off < 0 || off < prev) return null;
    prev = off;
    // recheck：這則可能其實已經留成功（立即發布時沒收到臉書回應），當成「留言途中」，到點先查再留，避免重複
    // n：第幾則（顯示用）；沒給就照順序
    const n = Number(x.n);
    out.push({ message: x.message, offset: off, status: x.recheck ? 'posting' : 'pending', attempts: 0, ...(Number.isInteger(n) && n >= 1 && n <= MAX_ITEMS ? { n } : {}), ...(x.recheck ? { unsure: true } : {}), ...(NP_METHODS.includes(x.np) ? { np: x.np } : {}) });
  }
  return out;
}

// 可以恢復的留言（2026-11-26）：還在等的、因「貼文還沒發布」失敗的（含其後連帶失敗的）、因「貼文已刪除」取消的
function stuckOf(rec) {
  const i = rec.items.findIndex((x) => x.status === 'failed');
  const notYet = i >= 0 && rec.items[i].notYet ? i : -1;
  return { notYet, gone: !!rec.gone && rec.items.some((x) => x.status === 'canceled') };
}
const revivable = (rec) => { const k = stuckOf(rec); return rec.items.some(open) || k.notYet >= 0 || k.gone; };
// 恢復：次數歸零、清錯誤；沒收到回應過的（unsure）保持先查再留
function revive(rec) {
  const k = stuckOf(rec);
  rec.items.forEach((x, j) => {
    if (!(open(x) || (k.notYet >= 0 && j >= k.notYet && x.status === 'failed') || (k.gone && x.status === 'canceled'))) return;
    x.status = x.unsure || x.status === 'posting' ? 'posting' : 'pending';
    x.attempts = 0; delete x.error; delete x.ecode; delete x.eraw; delete x.logged; delete x.notYet;
  });
  if (k.gone) { delete rec.canceled; delete rec.gone; }
  delete rec.purgeAt;
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
      const cross = body.kind === 'video' ? normCross(body) : [];
      const items = normItems(body, !!(cross && cross.length));
      if (!body.pageId || !body.postId || !items || !cross || !Number.isInteger(at)) return reply({ ok: false, error: '資料不完整' });
      const r = { v: 2, pageId: String(body.pageId), postId: String(body.postId), at, published: body.published === true, ...(body.published === true && body.immediateExtras === true ? { immediateExtras: true } : {}), retimes: 0, items, ...(typeof body.by === 'string' && body.by ? { by: body.by.slice(0, 20) } : {}), ...(typeof body.title === 'string' && body.title ? { title: [...body.title].slice(0, 41).join('') } : {}), ...(body.kind === 'video' ? { kind: 'video' } : {}), ...(PTYPES.includes(body.ptype) ? { ptype: body.ptype } : {}), ...(typeof body.pageName === 'string' && body.pageName ? { pageName: body.pageName.slice(0, 80) } : {}), ...(cross.length ? { cross } : {}) };
      await s.put('rec', r);
      await this.schedule(r);
      return reply({ ok: true });
    }
    if (action === 'retime') {
      const at = Number(body.at);
      if (!rec || rec.published || !revivable(rec) || !Number.isInteger(at)) return reply({ ok: false, error: '沒有等待中的留言' });
      rec.at = at;
      revive(rec);
      await s.put('rec', rec);
      await this.schedule(rec);
      return reply({ ok: true });
    }
    if (action === 'cancel') {
      if (rec) { [...rec.items, ...crossOf(rec)].forEach((x) => { if (open(x)) x.status = 'canceled'; }); rec.canceled = true; await s.put('rec', rec); await this.schedule(rec); }
      else await s.deleteAlarm();
      return reply({ ok: true });
    }
    // 重新留言（列表／通知的按鈕）：失敗或重試中的那則起，次數歸零、馬上再試；留過一半的先查再留，不重複
    if (action === 'retry') {
      if (!rec || String(body.pageId || '') !== rec.pageId) return reply({ ok: false, error: '找不到這則貼文的留言' });
      const i = rec.items.findIndex((x) => x.status === 'failed' || (open(x) && (x.attempts || 0) > 0));
      if (i < 0) return reply({ ok: false, error: '沒有失敗的留言' });
      for (const x of rec.items.slice(i)) {
        if (x.status !== 'failed' && !open(x)) continue;
        // 上次沒收到臉書回應的先查再留；舊紀錄（沒有 v，分不出是哪種失敗）有試過的一律先查，避免重複
        x.status = x.unsure || x.status === 'posting' || (!rec.v && (x.attempts || 0) > 0) ? 'posting' : 'pending';
        x.attempts = 0; delete x.error; delete x.ecode; delete x.eraw; delete x.logged;
      }
      if (!rec.published) rec.retimes = 0;
      delete rec.purgeAt;
      // 誰按了重新留言：通知改「已補留言」（notices.js），系統管理者看得到黃框
      rec.retryBy = body.by && body.by.uid ? { uid: body.by.uid, name: body.by.name || '' } : { uid: '', name: '' };
      await s.put('rec', rec);
      await this.note(rec);
      await s.setAlarm(Date.now());
      return reply({ ok: true });
    }
    if (action === 'status') {
      if (!rec) return reply({ ok: true, status: 'none' });
      if (body.sync && typeof body.sync === 'object') { try { await this.sync(rec, body.sync); } catch { /* 校正失敗不影響查狀態 */ } }
      if (!rec.purgeAt && !anyOpen(rec)) await this.schedule(rec);   // 舊紀錄（沒排清除）被查到時補排 14 天清除
      const first = rec.items[0] || {};
      // 頂層欄位沿用第 1 則（列表顯示用），items 是每則的狀態
      return reply({ ok: true, kind: rec.kind === 'video' ? 'video' : 'post', pageId: rec.pageId, postId: rec.postId, at: rec.at, retimes: rec.retimes, status: summary(rec), commentId: first.commentId, attempts: first.attempts, error: first.error, items: rec.items, alert: alertOf(rec),
        cross: crossOf(rec).map((c) => ({ page: c.page, status: c.status, ...(c.videoId ? { videoId: c.videoId } : {}), ...(c.error ? { error: c.error } : {}) })) });
    }
    return reply({ ok: false, error: '不支援的動作' });
  }

  // 列表讀取時校正（只限排程發布的貼文，影片不做）：
  //   { at }：還在已排程，臉書上的時間和計時器不同（改晚／改早）或留言卡在「還沒發布」→ 改用臉書時間、恢復等待
  //   { published: true }：出現在已發佈，計時器還以為沒發布 → 當成已發布、馬上留
  async sync(rec, b) {
    if (rec.kind === 'video' || rec.published || !revivable(rec)) return;
    const now = nowSec(), k = stuckOf(rec), stuck = !anyOpen(rec) && (k.notYet >= 0 || k.gone);
    if (b.published === true) {
      rec.published = true;
      if (rec.at > now - FIRST_DELAY) rec.at = now - FIRST_DELAY;
    } else {
      const at = Number(b.at);
      if (!Number.isInteger(at) || at <= now || (at === rec.at && !stuck)) return;
      rec.at = at;
    }
    revive(rec);
    await this.state.storage.put('rec', rec);
    await this.schedule(rec);
  }

  // 貼文已刪除：留言取消、通知收掉、操作紀錄記一筆（系統偵測）
  async gone(rec) {
    [...rec.items, ...crossOf(rec)].forEach((x) => { if (open(x)) x.status = 'canceled'; });
    rec.canceled = true; rec.gone = true;
    await this.state.storage.put('rec', rec);
    try { await audit(this.env, SYSTEM, 'post_gone', rec.pageId, rec.postId, [rec.title || '', rec.kind === 'video' ? 'kind=video' : ''].filter(Boolean).join(' ')); } catch { /* 記不了不影響 */ }
    return this.schedule(rec);
  }

  // 讀取被拒：馬上通知系統管理者（＋notify 權限組），同粉專 24 小時一次；錯誤紀錄記一筆。失敗不影響留言流程
  async readDenied(rec, e) {
    try {
      const name = rec.pageName || rec.pageId;
      const code = e instanceof GraphError && e.code ? '（臉書碼 ' + e.code + '）' : '';
      const sent = await systemMsg(this.env, name + ' 讀不到貼文狀態' + code + '，粉專權杖可能缺 pages_read_engagement。貼文：' + (rec.title || rec.postId), 'rd:' + rec.pageId, DAY_MS);
      if (sent !== null) await logEvent(this.env, rec.kind === 'video' ? 'fbvideo' : 'fbpost', 'read_denied', rec.pageId, String((e && e.raw) || (e && e.message) || ''), { post: rec.postId, title: rec.title, ptype: rec.ptype, pubAt: rec.at, pageName: rec.pageName });
    } catch { /* 通知失敗不影響 */ }
  }

  // 留言回「找不到物件」（還沒發布時）：這時才查貼文狀態
  async notYet(rec, page, it, e) {
    it.status = 'pending'; delete it.unsure;
    let post;
    try {
      post = await graph(this.env, 'GET', '/' + rec.postId, { fields: 'is_published,scheduled_publish_time' }, page.token);
    } catch (e2) {
      if (isGone(e2)) return this.gone(rec);
      if (isReadDenied(e2)) await this.readDenied(rec, e2);
      it.notYet = true;
      return this.retry(rec, it, e, STEP.comment);
    }
    if (post.is_published) { rec.published = true; delete it.notYet; return this.retry(rec, it, e, STEP.comment); }
    const fbAt = toSec(post.scheduled_publish_time);
    if (fbAt && fbAt !== rec.at) {
      // 臉書上改了時間（改晚或改早）：跟著新時間、次數歸零、不提醒
      rec.retimes = (rec.retimes || 0) + 1;
      if (rec.retimes <= MAX_RETIMES) { rec.at = fbAt; revive(rec); await this.state.storage.put('rec', rec); return this.schedule(rec); }
    }
    it.notYet = true;
    return this.retry(rec, it, e, STEP.comment);
  }

  // 通知與錯誤日誌（notices.js）：提醒狀態有變才寫 D1；每則最後失敗只記一次錯誤日誌。寫失敗不影響留言
  async note(rec) {
    let dirty = false;
    const a = alertOf(rec);
    const it = a ? rec.items[a.idx] : null;   // 提醒出現就記一次錯誤日誌（之後自動重試成功，日誌保留、由系統結案）；後面「前一則失敗未留」的不另記
    if (it && !it.logged) {
      // 錯誤日誌 detail：完整說明（含步驟）＋臉書原文
      const detail = [it.error, it.eraw ? '臉書原文：' + it.eraw : ''].filter(Boolean).join('\n');
      try { await logCommentFail(this.env, rec, it.ecode, detail); it.logged = true; dirty = true; } catch { /* 下次再記 */ }
    }
    const sig = a ? [a.seq, a.failed ? 1 : 0, a.error].join('|') : '';
    if (sig !== (rec.noticeSig || '') || (!a && rec.retryBy)) {
      // 提醒消失時：重新留言造成的＝已補留言；整則取消＝刪除；自動重試成功＝只刪未處理的
      const opts = a ? {} : { retry: rec.retryBy || null, canceled: !!rec.canceled };
      try { await setNotice(this.env, rec, a, opts); rec.noticeSig = sig; if (!a) delete rec.retryBy; dirty = true; } catch { /* 下次再寫 */ }
    }
    if (dirty) await this.state.storage.put('rec', rec);
  }

  // 排下一個鬧鐘：還沒留的裡最早到點的；都結束了就排 14 天後清除整筆紀錄
  async schedule(rec, earliest = 0) {
    await this.note(rec);
    const next = [...rec.items.filter(open).map((x) => dueOf(rec, x)), ...crossOf(rec).filter(open).map((c) => crossDue(rec, c))];
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
    if (!anyOpen(rec)) {   // 都結束了：到清除時間就刪整筆，還沒到（例：舊紀錄沒有 purgeAt）就排清除
      if (rec.purgeAt && rec.purgeAt <= Date.now()) { await s.deleteAlarm(); await s.deleteAll(); return; }
      return this.schedule(rec);
    }
    let page, tokens;
    try { tokens = await pageTokens(this.env); page = tokens.get(rec.pageId); } catch (e) { return rec.items.some(open) ? this.retry(rec, rec.items.find(open), e, STEP.token) : this.crossWait(rec, e); }
    if (!page) { [...rec.items, ...crossOf(rec)].forEach((x) => { if (open(x)) { x.status = 'failed'; x.error = '找不到粉專 token'; } }); await s.put('rec', rec); return this.schedule(rec); }

    // 影片：先確認已發布（確認過就不再查）。排程貼文不先查：直接留，臉書回「找不到物件」才查（notYet）
    if (!rec.published && rec.kind === 'video') {
      let post;
      try {
        // 影片（tools/fbvideo）是影片物件：欄位叫 published
        post = await graph(this.env, 'GET', '/' + rec.postId, { fields: rec.kind === 'video' ? 'published,scheduled_publish_time' : 'is_published,scheduled_publish_time' }, page.token);
        if (rec.kind === 'video') post.is_published = !!post.published;
      } catch (e) {
        if (isGone(e)) return this.gone(rec);
        if (!rec.items.some(open)) return this.crossWait(rec, e);
        // 讀取被擋（權限碼 10／200 系列）：通知系統管理者，不卡在這步，直接試著留言，以臉書對留言的回應為準
        if (isReadDenied(e)) { await this.readDenied(rec, e); post = { is_published: true }; }
        else return this.retry(rec, rec.items.find(open), e, STEP.published);
      }
      if (!post.is_published) {
        rec.retimes = (rec.retimes || 0) + 1;
        if (rec.retimes > (rec.kind === 'video' ? MAX_RETIMES_VIDEO : MAX_RETIMES)) {
          [...rec.items, ...crossOf(rec)].forEach((x) => { if (open(x)) { x.status = 'failed'; x.error = '貼文遲遲未發布'; } });
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

    if (crossOf(rec).some(open)) await this.crossStep(rec, page, tokens);

    // 到點的依序留；一則失敗就停在那則（重試），後面的不跳過
    for (const it of rec.items) {
      if (!open(it)) continue;
      if (dueOf(rec, it) > Date.now()) break;
      let step = STEP.comment;
      try {
        if (it.status === 'posting') {
          step = STEP.check;
          // 上次留言途中中斷：先確認是否已經留過，避免重複
          const d = await graph(this.env, 'GET', '/' + rec.postId + '/comments', { fields: 'from{id},message', limit: 100 }, page.token);
          // 同樣內容的另一則已經留過的不算（兩則可能一字不差）
          const used = new Set(rec.items.filter((x) => x !== it && x.commentId).map((x) => String(x.commentId)));
          // 移除預覽 A 法：可能只留了前半（不含連結的文字），也算已留，接著補完編輯
          const head = it.np === 'a' ? npHead(it.message) : '';
          const mine = (d.data || []).find((c) => c.from && String(c.from.id) === rec.pageId && (c.message === it.message || (head && c.message === head)) && !used.has(String(c.id)));
          if (mine) {
            Object.assign(it, { status: 'done', commentId: String(mine.id) }); delete it.unsure; delete it.notYet;
            rec.published = true;
            if (it.np && !it.preview) {
              if (head && head !== it.message && mine.message === head) Object.assign(it, await finishNoPreview(this.env, page.token, it.commentId, it.message, 'a'));
              else if (it.np === 'b' || !head || head === it.message) Object.assign(it, await finishNoPreview(this.env, page.token, it.commentId, it.message, 'b'));   // B，或 A 但沒有可拆的文字（與 postFirstNoPreview 同樣改用 B）
              else it.preview = 'tried';
            }
            await s.put('rec', rec); continue;
          }
        }
        step = STEP.comment;
        it.status = 'posting';
        await s.put('rec', rec);
        let id, np = {};
        if (it.np) { const x = await postFirstNoPreview(this.env, page.token, rec.postId, it.message, it.np); id = x.id; np = { preview: x.preview, ...(x.previewError ? { previewError: x.previewError } : {}) }; }
        else id = await postComment(this.env, page.token, rec.postId, it.message);
        Object.assign(it, { status: 'done', commentId: id }, np);
        delete it.unsure; delete it.notYet;
        rec.published = true;   // 留得上＝已發布
        await s.put('rec', rec);
        if (!it.np && seqOf(it, rec.items.indexOf(it)) === 1) await editAfterPost(this.env, page.token, id, it.message, rec.by);   // 第 1 則：開關打開時再編輯一次（試去連結預覽）
      } catch (e) {
        // 留言請求臉書明確回錯誤＝確定沒留：下次直接重留；沒收到回應＝可能已留：保持 posting，下次先查再留
        // 還沒確認發布的排程貼文：留言回「找不到物件」才查貼文狀態（改時間／還沒發布／已刪除）
        if ((step === STEP.comment || step === STEP.check) && !rec.published && rec.kind !== 'video' && isGone(e)) return this.notYet(rec, page, it, e);
        if (step === STEP.comment) {
          if (e instanceof GraphError && !e.uncertain) { it.status = 'pending'; delete it.unsure; }
          else it.unsure = true;
        }
        return this.retry(rec, it, e, step);
      }
    }
    return this.schedule(rec);
  }

  // 只剩多文時查不到粉專／貼文：每 60 秒再試，最多 MAX_RETIMES 次後標失敗（避免無限重試）
  async crossWait(rec, e) {
    rec.crossErr = (rec.crossErr || 0) + 1;
    if (rec.crossErr > MAX_RETIMES) {
      crossOf(rec).forEach((c) => { if (open(c)) { c.status = 'failed'; c.error = String((e && e.message) || e).slice(0, 200); } });
      await this.state.storage.put('rec', rec);
      return this.schedule(rec);
    }
    await this.state.storage.put('rec', rec);
    await this.state.storage.setAlarm(Date.now() + 60000);
  }

  // 多文：到點的目標逐一做；各自重試，互不影響
  async crossStep(rec, page, tokens) {
    const s = this.state.storage;
    for (const c of crossOf(rec)) {
      if (!open(c) || crossDue(rec, c) > Date.now()) continue;
      if (c.status === 'posting') { c.status = 'unknown'; c.error = '多文途中中斷，結果不明，請到臉書確認'; await s.put('rec', rec); continue; }
      const t = tokens.get(c.page);
      if (!t) { c.status = 'failed'; c.error = '找不到粉專 token'; await s.put('rec', rec); continue; }
      try {
        if (!rec.crossAllowed) {
          await graph(this.env, 'POST', '/' + rec.postId, { allow_crossposting_for_pages: crossOf(rec).map((x) => ({ page_id: x.page, allow: true })) }, page.token);
          rec.crossAllowed = true;
          await s.put('rec', rec);
        }
        c.status = 'posting';
        await s.put('rec', rec);
        const d = await graph(this.env, 'POST', '/' + c.page + '/videos', { crossposted_video_id: rec.postId }, t.token);
        Object.assign(c, { status: 'done', videoId: String((d && d.id) || '') });
        delete c.error;
      } catch (e) {
        c.attempts = (c.attempts || 0) + 1;
        c.error = String((e && e.message) || e).slice(0, 200);
        if (c.status === 'posting' && e && e.uncertain) c.status = 'unknown';
        else if (isRateLimit(e) || c.attempts >= CROSS_TRIES) c.status = 'failed';
        else { c.status = 'pending'; c.next = Date.now() + CROSS_RETRY[c.attempts - 1] * 1000; }
      }
      await s.put('rec', rec);
    }
  }

  // 失敗：限流立刻標失敗；其他重試（30/60/120/240 秒），第 5 次失敗標失敗。posting 狀態保留，下次先查再留
  // step：哪一步失敗（STEP），寫在錯誤說明最前面，通知、列表、錯誤紀錄都看得到
  async retry(rec, it, e, step = '') {
    const s = this.state.storage;
    const msg = ((step ? step + '：' : '') + String((e && e.message) || e)).slice(0, 200);
    if (!it) return;
    if (it.status === 'posting') it.unsure = true;   // 標失敗後也記得「可能已留」，按重新留言時先查再留
    if (!isGone(e)) delete it.notYet;   // 改因別的錯誤失敗：不再算「貼文還沒發布」
    it.attempts = (it.attempts || 0) + 1;
    it.error = msg;
    if (e instanceof GraphError && Number.isInteger(e.code) && e.code > 0) it.ecode = e.code; else delete it.ecode;
    if (e instanceof GraphError && e.raw) it.eraw = String(e.raw).slice(0, 200); else delete it.eraw;   // 英文原文，只進錯誤日誌
    if (isRateLimit(e) || it.attempts >= MAX_ATTEMPTS) {
      it.status = 'failed';
      // 留言要依序：前一則失敗，後面還沒留的也不留
      rec.items.slice(rec.items.indexOf(it) + 1).forEach((x) => { if (open(x)) { x.status = 'failed'; x.error = CASCADE; } });
      await s.put('rec', rec);
      return this.schedule(rec);
    }
    await s.put('rec', rec);
    await this.note(rec);
    await s.setAlarm(Date.now() + RETRY[it.attempts - 1] * 1000);
  }
}
