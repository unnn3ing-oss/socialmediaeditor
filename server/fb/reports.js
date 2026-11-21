// 數據報表（tools/fbreports）：唯讀查詢期間內發布的貼文與累計成效
//   GET /fb/reports/posts?page=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD[&asOf=<秒>&scope=<代碼>] → 第一批
//   GET /fb/reports/posts?cursor=<Worker 核發的游標>                                          → 續頁
//   GET /fb/reports/probe?page=<id>（只給系統管理者）→ 欄位檢查（規格步驟 1，用真實權杖在測試 Worker 跑）
// 權限：route(..., 'view')；粉專必須在使用中組別且設定為顯示（每次請求都驗證，含續頁與快取命中）
// 範圍代碼：組別＋顯示中的粉專＋登入者的簽章；續頁或同一輪的下一個粉專帶回來，對不上回 report_scope（前端清掉重讀粉專）
// 用量：每批最多 6 次 Graph 呼叫；用量 ≥90% 或 10 分鐘內被限流先不打臉書（status 'paused'），被限流當批停（'throttled'），都保留游標
import { ok, fail } from '../core/http.js';
import { b64urlEncode, b64urlDecode } from '../core/token.js';
import { graph, isRateLimit, isTokenError, GraphError, GRAPH } from './graph.js';
import { listPages, FbSetupError } from './pages.js';
import { profileId, userToken } from './tokenstore.js';
import { usageBusy } from './usage.js';

export const DATA_VERSION = 'r2';   // r2：續頁改用 paging.next 的翻頁參數
export const GRAPH_VERSION = GRAPH.split('/').pop();
export const MAX_DAYS = 31;
export const BATCH = 5;              // 欄位展開可用時每批 5 篇（1 次呼叫）
export const BATCH_SPLIT = 4;        // 逐篇查成效時每批 4 篇（清單 1＋成效 4，加上試展開失敗那 1 次＝6）
export const MAX_CALLS = 6;
const HEAD_TTL = 60;                 // 同條件 60 秒內重查沿用同一個 asOf（＝清單快取）
const BATCH_TTL = 600;               // 完整成功的批次最多快取 10 分鐘
const ASOF_MAX_AGE = 30 * 60;        // 同一輪其他粉專帶回的 asOf 最多 30 分鐘前
const TZ_MS = 8 * 3600 * 1000;       // Asia/Taipei 固定 UTC+8，沒有日光節約

// 指標來源（Meta Graph v27.0 文件；上線前在測試 Worker 用「欄位檢查」與 Business Suite 核對）
//   瀏覽 post_media_view（取代已停用的 post_impressions）、點擊 post_clicks、心情分項 post_reactions_by_type_total
//   觸及：文件只說 post_total_media_view_unique 是「不重複觀看者」，還沒證實等於觸及 → null（觸及與互動率顯示「—」），實測後再填
export const REACH_METRIC = null;
const INSIGHT_METRICS = ['post_media_view', 'post_clicks', 'post_reactions_by_type_total', ...(REACH_METRIC ? [REACH_METRIC] : [])];
const BASE_FIELDS = 'id,created_time,message,permalink_url,status_type,'
  + 'attachments{media_type,type,subattachments.limit(10){media_type,type}},'
  + 'reactions.summary(total_count).limit(0),comments.filter(stream).summary(total_count).limit(0),shares';
const EXPAND = 'insights.metric(' + INSIGHT_METRICS.join(',') + ')';

// ---- 日期（Asia/Taipei，左閉右開） ----
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function dayStart(s) {   // 'YYYY-MM-DD' → 台北 00:00 的 epoch 秒；不合法回 null
  const m = DATE_RE.exec(String(s || ''));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return Math.floor((ms - TZ_MS) / 1000);
}
export const taipeiDate = (sec) => new Date(sec * 1000 + TZ_MS).toISOString().slice(0, 10);
// 回 { since, until } 或 { error }；until＝min(迄日隔天 00:00, asOf)
export function reportWindow(from, to, asOf) {
  const a = dayStart(from), b = dayStart(to);
  if (a === null || b === null) return { error: '日期格式要是 YYYY-MM-DD。' };
  if (a > b) return { error: '起日不能晚於迄日。' };
  if (to > taipeiDate(asOf)) return { error: '日期不能在未來。' };
  if ((b - a) / 86400 + 1 > MAX_DAYS) return { error: '單次最多查 ' + MAX_DAYS + ' 天。' };
  return { since: a, until: Math.min(b + 86400, asOf) };
}

// ---- 分類（每篇只歸一類；優先 Reels > 一般影片 > 圖片 > 連結 > 文字） ----
export const TYPES = ['text', 'image', 'video', 'reels', 'link', 'other', 'unknown'];
const OTHER_TYPES = /^(event|note|music|offer|status_update_with_fundraiser|fundraiser|job|live_video_scheduled|poll|product|life_event|map|check_in|avatar|file_upload|profile_media|cover_photo)/;
export function classify(p) {
  const url = String(p.permalink_url || '');
  const atts = (p.attachments && Array.isArray(p.attachments.data)) ? p.attachments.data : null;
  const all = [];
  for (const a of atts || []) {
    all.push(a);
    if (a && a.subattachments && Array.isArray(a.subattachments.data)) all.push(...a.subattachments.data);
  }
  const mt = all.map((a) => String((a && a.media_type) || '').toLowerCase());
  const ty = all.map((a) => String((a && a.type) || '').toLowerCase());
  if (/facebook\.com\/reel\//.test(url) || ty.some((t) => t.includes('reel'))) return 'reels';
  if (mt.includes('video') || ty.some((t) => t.startsWith('video'))) return 'video';
  if (mt.includes('photo') || mt.includes('album') || ty.some((t) => t === 'photo' || t === 'album' || t === 'cover_photo' || t === 'profile_media')) return 'image';
  if (mt.includes('link') || ty.some((t) => t === 'share' || t === 'link')) return 'link';
  if (atts && !atts.length && p.message) return 'text';
  if (!atts) return p.message ? 'text' : (p.status_type === 'mobile_status_update' ? 'text' : 'unknown');
  if (ty.some((t) => OTHER_TYPES.test(t)) || mt.some((t) => t && t !== 'unknown')) return 'other';
  return 'unknown';
}

// ---- 成效 ----
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };   // null／缺值＝未知，不當 0
const insightValue = (list, name) => {
  const m = (list || []).find((x) => x && x.name === name);
  if (!m || !Array.isArray(m.values) || !m.values.length) return undefined;
  return m.values[m.values.length - 1].value;
};
// insights：陣列（臉書 data）或 null；why＝成效拿不到的原因（no_permission／unsupported／error／budget）
export function metricsOf(p, insights, why) {
  const out = { views: null, reach: null, clicks: null, reactions: null, comments: null, shares: null };
  const miss = {};
  const ins = (key, name) => {
    if (insights) { const v = num(insightValue(insights, name)); if (v !== null) { out[key] = v; return; } miss[key] = 'no_data'; return; }
    miss[key] = why || 'no_data';
  };
  ins('views', 'post_media_view');
  ins('clicks', 'post_clicks');
  if (REACH_METRIC) ins('reach', REACH_METRIC); else miss.reach = 'unverified';
  const rt = p.reactions && p.reactions.summary ? num(p.reactions.summary.total_count) : null;
  if (rt !== null) out.reactions = rt;
  else {   // 退而求其次：心情分項加總（要是物件且每項都是數字）
    const by = insights ? insightValue(insights, 'post_reactions_by_type_total') : undefined;
    const vals = by && typeof by === 'object' ? Object.values(by).map(Number) : null;
    if (vals && vals.every((v) => Number.isFinite(v) && v >= 0)) out.reactions = vals.reduce((a, b) => a + b, 0);
    else miss.reactions = 'no_data';
  }
  const ct = p.comments && p.comments.summary ? num(p.comments.summary.total_count) : null;
  if (ct !== null) out.comments = ct; else miss.comments = 'no_data';
  // shares：臉書 0 次分享時不回這個欄位（待實測），讀到貼文本身就當 0
  if (p.shares && p.shares.count !== undefined) { const v = num(p.shares.count); if (v !== null) out.shares = v; else miss.shares = 'no_data'; }
  else out.shares = 0;
  return { ...out, missing: miss };
}

// 安全的原文網址：只收 facebook.com 的 https
export function safeUrl(u) {
  try {
    const x = new URL(String(u || ''));
    return x.protocol === 'https:' && /(^|\.)facebook\.com$/.test(x.hostname) ? x.toString() : null;
  } catch { return null; }
}
const summary = (m) => [...String(m || '').replace(/\s+/g, ' ').trim()].slice(0, 80).join('');

// ---- 簽章（游標、範圍代碼） ----
const enc = new TextEncoder();
async function mac(env, label, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET + '|fbreports|' + label), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)))).slice(0, 22);
}
export async function scopeCode(env, pid, pages, uid) {
  return mac(env, 'scope', [pid, pages.map((p) => p.id).sort().join(','), uid].join('|'));
}
export async function signCursor(env, o) {
  const body = b64urlEncode(enc.encode(JSON.stringify(o)));
  return body + '.' + (await mac(env, 'cursor', body));
}
export async function readCursor(env, c) {
  if (typeof c !== 'string' || c.length > 3000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/.test(c)) return null;
  const [body, sig] = c.split('.');
  if (sig !== (await mac(env, 'cursor', body))) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!o || o.v !== 2 || !/^\d{1,30}$/.test(o.p) || !DATE_RE.test(o.f) || !DATE_RE.test(o.t) || !Number.isInteger(o.a) || typeof o.s !== 'string') return null;
    if (o.c !== null && (typeof o.c !== 'string' || !readPaging(o.c))) return null;
    if (!Number.isInteger(o.k) || o.k < 1 || o.k > 10000) return null;
    return o;
  } catch { return null; }
}

// ---- 翻頁參數 ----
// 帶 since／until 查時，臉書用時間翻頁：下一頁要照 paging.next 裡的 until／__paging_token（不能自己混 after）
// 只從 paging.next 抽白名單參數（不含權杖），存成查詢字串放進 Worker 游標；完整網址不外流
const PAGING_KEYS = ['after', 'until', 'since', '__paging_token'];
const PAGING_VAL = { after: /^[A-Za-z0-9_\-=%.]{1,800}$/, __paging_token: /^[A-Za-z0-9_\-=%.]{1,800}$/, until: /^\d{1,12}$/, since: /^\d{1,12}$/ };
export function pagingFrom(d) {
  const pg = d && d.paging;
  if (!pg || typeof pg.next !== 'string') return null;
  let u;
  try { u = new URL(pg.next); } catch { u = null; }
  const out = new URLSearchParams();
  if (u) for (const k of PAGING_KEYS) { const v = u.searchParams.get(k); if (v !== null && PAGING_VAL[k].test(v)) out.set(k, v); }
  if (!out.has('after') && !out.has('__paging_token') && pg.cursors && typeof pg.cursors.after === 'string' && PAGING_VAL.after.test(pg.cursors.after)) out.set('after', pg.cursors.after);
  return out.has('after') || out.has('__paging_token') || out.has('until') ? out.toString() : null;
}
// 游標裡的翻頁參數 → 物件；格式不對回 null
export function readPaging(c) {
  if (typeof c !== 'string' || !c || c.length > 2000) return null;
  const q = new URLSearchParams(c), out = {};
  for (const [k, v] of q) { if (!PAGING_KEYS.includes(k) || !PAGING_VAL[k].test(v) || k in out) return null; out[k] = v; }
  return Object.keys(out).length ? out : null;
}

// ---- 讀一批 ----
const noExpand = new Set();   // 這個執行個體試過欄位展開失敗的粉專（不同執行個體各自一份）
const inflight = new Map();   // 相同的在途查詢合併
const permErr = (e) => e instanceof GraphError && (e.code === 10 || (e.code >= 200 && e.code < 300));
const badParam = (e) => e instanceof GraphError && e.code === 100;

class Throttled extends Error {}

async function call(env, budget, path, params, token) {
  if (budget.used >= MAX_CALLS) throw new Error('budget');
  budget.used++;
  try { return await graph(env, 'GET', path, params, token); } catch (e) {
    if (isRateLimit(e)) throw new Throttled();
    throw e;
  }
}

// after＝翻頁參數查詢字串（第一批 null）；回 { items, after(下一頁翻頁參數或 null), issues, complete(可快取) }
export async function readBatch(env, page, token, win, after) {
  const budget = { used: 0 };
  const issues = new Set();
  let d = null, withIns = false;
  // 第一批帶期間；續頁只照臉書給的翻頁參數（另外仍用 created_time 過濾、看到比起日早就停）
  const pgp = after ? readPaging(after) : null;
  const listParams = (limit, fields) => (pgp ? { fields, limit, ...pgp } : { fields, limit, since: win.since, until: win.until });
  if (!noExpand.has(page)) {
    try { d = await call(env, budget, '/' + page + '/published_posts', listParams(BATCH, BASE_FIELDS + ',' + EXPAND), token); withIns = true; }
    catch (e) {
      if (e instanceof Throttled || isTokenError(e)) throw e;
      if (badParam(e)) noExpand.add(page);   // 臉書不接受欄位展開才記住；暫時錯誤只這批改逐篇
      issues.add('expand_fallback'); d = null;
    }
  }
  if (!d) d = await call(env, budget, '/' + page + '/published_posts', listParams(BATCH_SPLIT, BASE_FIELDS), token);
  const items = [];
  let older = false, complete = true;
  for (const p of (d && d.data) || []) {
    if (!p || typeof p.id !== 'string' || !p.id.startsWith(page + '_')) continue;
    const t = Math.floor(Date.parse(p.created_time) / 1000);
    if (!Number.isFinite(t)) continue;
    if (t < win.since) { older = true; continue; }   // 清單由新到舊：比起日早就不用再翻
    if (t >= win.until) continue;
    let insights = null, why = '';
    if (withIns) {
      if (p.insights && Array.isArray(p.insights.data)) insights = p.insights.data; else { why = 'no_data'; issues.add('insights_empty'); }   // 缺 read_insights 時臉書可能整個不回
    } else if (budget.used < MAX_CALLS) {
      try { insights = ((await call(env, budget, '/' + p.id + '/insights', { metric: INSIGHT_METRICS.join(',') }, token)) || {}).data || []; }
      catch (e) {
        if (e instanceof Throttled || isTokenError(e)) throw e;
        why = permErr(e) ? 'no_permission' : badParam(e) ? 'unsupported' : 'error';
        if (why === 'error') complete = false;
      }
    } else { why = 'budget'; complete = false; }
    if (insights && !insights.length) { insights = null; why = 'no_data'; issues.add('insights_empty'); }   // 缺 read_insights 時臉書回空資料
    if (why === 'no_permission') issues.add('no_permission');
    const m = metricsOf(p, insights, why);
    items.push({ page, id: p.id, time: new Date(t * 1000).toISOString(), type: classify(p), text: summary(p.message), url: safeUrl(p.permalink_url), ...m });
  }
  const next = !older ? pagingFrom(d) : null;
  return { items, after: next, issues: [...issues], complete, calls: budget.used };
}

// ---- 路由 ----
const NOSTORE = { 'cache-control': 'no-store' };
const kvGet = async (env, k) => { try { return env.CACHE ? await env.CACHE.get(k, 'json') : null; } catch { return null; } };
const kvPut = async (env, k, v, ttl) => { try { if (env.CACHE) await env.CACHE.put(k, JSON.stringify(v), { expirationTtl: ttl }); } catch { /* 快取失敗不影響查詢 */ } };

// 驗證粉專（使用中組別＋顯示中）→ { page, token, pid, scope } 或 Response
async function resolve(request, env, me, pageId) {
  if (!/^\d{1,30}$/.test(String(pageId || ''))) return fail(request, env, 'bad_request');
  const [pages, pid] = await Promise.all([listPages(env, { withToken: true }), profileId(env)]);
  const scope = await scopeCode(env, pid, pages, me.who.uid);
  const p = pages.find((x) => x.id === pageId);
  if (!p) return fail(request, env, 'report_scope');
  return { page: p.id, token: p.token, pid, scope };
}

export async function reportPosts(request, env, me) {
  const q = new URL(request.url).searchParams;
  const now = Math.floor(Date.now() / 1000);
  let cur;
  if (q.get('cursor')) {
    cur = await readCursor(env, q.get('cursor'));
    if (!cur) return fail(request, env, 'bad_request', '游標無效，請重新查詢。');
  }
  const pageId = cur ? cur.p : q.get('page');
  const r = await resolve(request, env, me, pageId);
  if (r instanceof Response) return r;
  const wantScope = cur ? cur.s : q.get('scope');
  if (wantScope && wantScope !== r.scope) return fail(request, env, 'report_scope');
  let from, to, asOf, after, seq;
  if (cur) ({ f: from, t: to, a: asOf, c: after, k: seq } = cur);
  else {
    from = q.get('from'); to = q.get('to'); after = null; seq = 1;
    const given = Number(q.get('asOf'));
    if (q.get('asOf') && (!Number.isInteger(given) || given > now || now - given > ASOF_MAX_AGE)) return fail(request, env, 'bad_request', '查詢時間已過期，請重新查詢。');
    const headKey = ['rep', DATA_VERSION, GRAPH_VERSION, 'head', r.pid, r.scope, r.page, from, to].join(':');
    const head = given ? null : await kvGet(env, headKey);
    asOf = given || (head && Number.isInteger(head.asOf) ? head.asOf : now);
    if (!given && !head) await kvPut(env, headKey, { asOf }, HEAD_TTL);
  }
  const win = reportWindow(from, to, asOf);
  if (win.error) return fail(request, env, 'bad_request', win.error);
  if (win.since >= win.until) return ok(request, env, { items: [], next: null, status: 'ok', issues: [], asOf, scope: r.scope, page: r.page }, NOSTORE);

  const retry = await signCursor(env, { v: 2, p: r.page, f: from, t: to, a: asOf, s: r.scope, c: after, k: seq });
  const base = { asOf, scope: r.scope, page: r.page, seq };
  // 翻頁參數可能很長（KV key 上限 512 bytes）→ 放雜湊
  const ah = after ? b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(after)))).slice(0, 22) : '-';
  const key = ['rep', DATA_VERSION, GRAPH_VERSION, 'b', r.pid, r.scope, r.page, from, to, asOf, ah].join(':');
  const hit = await kvGet(env, key);
  let res = hit;
  if (!res) {
    const busy = await usageBusy(env, r.page).catch(() => '');
    if (busy) return ok(request, env, { ...base, items: [], next: retry, status: 'paused', issues: ['busy_' + busy] }, NOSTORE);
    let p = inflight.get(key);
    if (!p) {
      p = readBatch(env, r.page, r.token, win, after).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    try { res = await p; } catch (e) {
      if (e instanceof Throttled) return ok(request, env, { ...base, items: [], next: retry, status: 'throttled', issues: ['throttled'] }, NOSTORE);
      if (isTokenError(e)) throw new FbSetupError('fb_token', e.message);
      throw e;
    }
    if (res.complete) await kvPut(env, key, res, BATCH_TTL);
  }
  const next = res.after ? await signCursor(env, { v: 2, p: r.page, f: from, t: to, a: asOf, s: r.scope, c: res.after, k: seq + 1 }) : null;
  return ok(request, env, { ...base, items: res.items, next, status: 'ok', issues: res.issues, cached: !!hit, retry: res.complete ? null : retry }, NOSTORE);
}

// ---- 欄位檢查（只給系統管理者；不回傳貼文內容與 ID） ----
const PROBE_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_clicks_by_type', 'post_reactions_by_type_total', 'post_video_views', 'post_impressions', 'post_impressions_unique'];
export async function reportProbe(request, env, me) {
  if (!me.admin) return fail(request, env, 'fb_no_perm');
  const r = await resolve(request, env, me, new URL(request.url).searchParams.get('page'));
  if (r instanceof Response) return r;
  const out = { graph: GRAPH_VERSION, permissions: null, expand: null, sinceUntil: null, paging: null, posts: [], calls: 0 };
  const g = async (path, params, token = r.token) => { out.calls++; try { return { d: await graph(env, 'GET', path, params, token) }; } catch (e) { return { e: e instanceof GraphError ? { code: e.code, message: String(e.message).slice(0, 160) } : { code: -1, message: 'error' } }; } };
  const { token: ut } = await userToken(env);
  if (ut) {
    const p = await g('/me/permissions', {}, ut);
    out.permissions = p.d ? Object.fromEntries((p.d.data || []).map((x) => [x.permission, x.status])) : p.e;
  }
  const list = await g('/' + r.page + '/published_posts', { fields: BASE_FIELDS, limit: 6 });
  if (list.e) return ok(request, env, { ...out, error: list.e }, NOSTORE);
  const posts = (list.d.data || []).slice(0, 6);
  const ex = await g('/' + r.page + '/published_posts', { fields: 'id,' + EXPAND, limit: 1 });
  out.expand = ex.e ? { ok: false, error: ex.e } : { ok: true, hasInsights: !!(ex.d.data && ex.d.data[0] && ex.d.data[0].insights) };
  if (posts.length >= 2) {   // since 設在第 2 新那篇之後：支援的話只會回 1 篇
    const t = Math.floor(Date.parse(posts[1].created_time) / 1000) + 1;
    const su = await g('/' + r.page + '/published_posts', { fields: 'id,created_time', limit: 5, since: t });
    out.sinceUntil = su.e ? { ok: false, error: su.e } : { ok: true, honored: (su.d.data || []).every((x) => Date.parse(x.created_time) / 1000 >= t), returned: (su.d.data || []).length };
  }
  // 翻第 2 頁：照 paging.next 的翻頁參數續讀（和報表同一套）
  const p1 = await g('/' + r.page + '/published_posts', { fields: 'id,created_time', limit: 2, since: Math.floor(Date.now() / 1000) - 30 * 86400, until: Math.floor(Date.now() / 1000) });
  if (p1.e) out.paging = { ok: false, error: p1.e };
  else {
    const pc = pagingFrom(p1.d);
    if (!pc) out.paging = { ok: true, page2: false, note: '30 天內不到 3 篇，沒有第 2 頁' };
    else {
      const p2 = await g('/' + r.page + '/published_posts', { fields: 'id,created_time', limit: 2, ...readPaging(pc) });
      out.paging = p2.e ? { ok: false, params: Object.keys(readPaging(pc)), error: p2.e } : { ok: true, page2: true, params: Object.keys(readPaging(pc)), returned: (p2.d.data || []).length };
    }
  }
  // 前 3 篇逐項測指標；第 4～6 篇只看分類（省呼叫）
  for (const [i, p] of posts.slice(0, 6).entries()) {
    const row = { n: i + 1, type: classify(p), statusType: p.status_type || null, attachments: ((p.attachments && p.attachments.data) || []).map((a) => ({ media_type: a.media_type || null, type: a.type || null, sub: ((a.subattachments && a.subattachments.data) || []).length })),
      hasReactions: !!(p.reactions && p.reactions.summary), hasComments: !!(p.comments && p.comments.summary), hasShares: p.shares !== undefined, reelUrl: /\/reel\//.test(String(p.permalink_url || '')), metrics: {} };
    if (i >= 3) { delete row.metrics; out.posts.push(row); continue; }
    for (const m of PROBE_METRICS) {
      const x = await g('/' + p.id + '/insights', { metric: m });
      row.metrics[m] = x.e ? { error: x.e.code } : (() => { const v = insightValue(x.d.data, m); return v === undefined ? { empty: true } : { value: v }; })();
    }
    out.posts.push(row);
  }
  return ok(request, env, out, NOSTORE);
}

export function registerReports(route) {
  route('GET', /^\/fb\/reports\/posts$/, (request, env, ctx, m, me) => reportPosts(request, env, me), 'view');
  route('GET', /^\/fb\/reports\/probe$/, (request, env, ctx, m, me) => reportProbe(request, env, me), 'view');
}
