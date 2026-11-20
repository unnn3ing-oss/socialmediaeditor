// 留言守門（設計 docs/superpowers/specs/2026-11-20-comment-guard-design.md）
//   Webhook（/fbhook）收到粉專 feed 的留言新增／編輯 → 文字預篩（不打 API）→ 命中才讀留言標註 → 規則判斷 → 記錄或隱藏
//   設定 D1 fb_settings k='guard'；統計 k='guard_stats'；紀錄表 fb_guard_log（30 天清除）
//   權杖固定用「守門用組別」（不跟著發文使用中組別切換）
//   管理路由 /admin/fb/guard*（卡片 guard，掛在 core/admin.js 的 adminExtras）
import { ok, fail, readBody } from '../core/http.js';
import { graph, GraphError } from './graph.js';
import { activePageTokens, FbSetupError } from './pages.js';
import { forProfile, readProfiles, userToken, appCred, PROFILE_ID_RE } from './tokenstore.js';
import { readUsage } from './usage.js';
import { audit } from '../core/staff.js';

const KEY = 'guard';
const STATS_KEY = 'guard_stats';
export const MODES = ['off', 'observe', 'hide'];
export const MAX_ITEMS = 50;
export const MAX_ITEM_LEN = 20;
export const MAX_MSG = 500;
export const KEEP_DAYS = 30;
const DAY = 86400000;
const BUSY_PCT = 90;
const RECENT_MS = 10 * 60 * 1000;
export const DEFAULT_RULES = {
  names: ['寶爸', '寳爸'],
  leads: ['老師', '進群', '交流群', '選股', '飆股', '獲利', '追蹤', '帶單', '理財群'],
  allow: [],
  auto: { r1: true, r2: false }
};
const ACTIONS = ['observe', 'hidden', 'failed', 'manual', 'unhidden'];
const ID_RE = /^\d{1,30}$/;
const CID_RE = /^\d{1,30}(_\d{1,30})?$/;

// ---- 規則（純函式）----
// 全形／半形、大小寫統一；去掉空白（洗版常把字拆開：「幸 好 一 直 看」）
export const normText = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

function cleanList(v, re = null) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const x of v) {
    const s = String(x == null ? '' : x).trim();
    if (!s) continue;
    if ([...s].length > MAX_ITEM_LEN || (re && !re.test(s))) return null;
    if (!out.includes(s)) out.push(s);
  }
  return out.length > MAX_ITEMS ? null : out;
}
// 管理頁送來的規則；不合格回 null
export function cleanRules(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const names = cleanList(raw.names), leads = cleanList(raw.leads), allow = cleanList(raw.allow, ID_RE);
  if (!names || !leads || !allow) return null;
  const a = raw.auto && typeof raw.auto === 'object' ? raw.auto : {};
  return { names, leads, allow, auto: { r1: a.r1 !== false, r2: a.r2 === true } };
}
const has = (text, list) => list.some((w) => { const n = normText(w); return n && text.includes(n); });

// 不同引導詞出現幾個
const leadCount = (t, leads) => new Set(leads.map(normText).filter((w) => w && t.includes(w))).size;
// 預篩（與規則一致，不會漏抓）：文字含名稱關鍵字（被標註的名稱會出現在文字裡），或含 ≥2 個不同引導詞
export function prefilter(message, rules) {
  const t = normText(message);
  return !!t && (has(t, rules.names) || leadCount(t, rules.leads) >= 2);
}

// 判斷一則留言（Graph 讀回來的 { message, message_tags, from }）
export function judge(c, rules, pageId) {
  const from = c && c.from && c.from.id ? String(c.from.id) : '';
  const tags = (Array.isArray(c && c.message_tags) ? c.message_tags : []).filter((x) => x && x.name && String(x.id || '') !== String(pageId));
  const names = tags.map((x) => String(x.name).slice(0, 60));
  const miss = { hit: false, rule: '', tags: names };
  if (from && from === String(pageId)) return miss;
  if (from && rules.allow.includes(from)) return miss;
  if (!tags.length) return miss;
  if (names.some((n) => has(normText(n), rules.names))) return { hit: true, rule: 'r1', tags: names };
  if (leadCount(normText(c.message), rules.leads) >= 2) return { hit: true, rule: 'r2', tags: names };
  return miss;
}

// ---- 設定 ----
async function ensureSettings(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
}
async function readRow(env, k) {
  try { const r = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(k).first(); return r ? JSON.parse(r.v) : null; } catch { return null; }
}
async function writeRow(env, k, v) {
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(k, JSON.stringify(v), Date.now()).run();
}

export async function readGuard(env) {
  const o = await readRow(env, KEY);
  const rules = (o && cleanRules(o.rules)) || structuredClone(DEFAULT_RULES);
  return {
    mode: o && MODES.includes(o.mode) ? o.mode : 'off',
    profile: o && PROFILE_ID_RE.test(String(o.profile || '')) ? String(o.profile) : '',
    pages: o && Array.isArray(o.pages) ? o.pages.map(String).filter((x) => ID_RE.test(x)).slice(0, 100) : [],
    rules
  };
}
export async function saveGuard(env, cfg) { await writeRow(env, KEY, cfg); }

const STAT_KEYS = ['noText', 'skipped', 'checked', 'observe', 'hidden', 'failed'];
export async function readStats(env) {
  const o = await readRow(env, STATS_KEY) || {};
  const out = { since: Number(o.since) || 0 };
  for (const k of STAT_KEYS) out[k] = Number(o[k]) || 0;
  return out;
}
async function bump(env, key) {
  try {
    const s = await readStats(env);
    if (!s.since) s.since = Date.now();
    s[key] = (s[key] || 0) + 1;
    await writeRow(env, STATS_KEY, s);
  } catch { /* 統計失敗不影響 */ }
}

// ---- 紀錄表 ----
async function ensureLog(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_guard_log (cid TEXT PRIMARY KEY, page TEXT NOT NULL, post TEXT, uid TEXT, uname TEXT, msg TEXT, tags TEXT, rule TEXT, action TEXT NOT NULL, edited INTEGER NOT NULL DEFAULT 0, exempt INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, link TEXT)').run();
}
async function getLog(env, cid) {
  await ensureLog(env);
  return env.DB.prepare('SELECT * FROM fb_guard_log WHERE cid = ?').bind(cid).first();
}
// 新增或更新（同一則留言只有一列；併發的新增與編輯也不會重複）
async function upsertLog(env, r) {
  await ensureLog(env);
  await env.DB.prepare(`INSERT INTO fb_guard_log (cid, page, post, uid, uname, msg, tags, rule, action, edited, exempt, at, link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(cid) DO UPDATE SET msg = excluded.msg, tags = excluded.tags, rule = excluded.rule,
      action = CASE WHEN fb_guard_log.exempt = 1 THEN fb_guard_log.action ELSE excluded.action END,
      edited = MAX(fb_guard_log.edited, excluded.edited), at = excluded.at, link = COALESCE(excluded.link, fb_guard_log.link)`)
    .bind(r.cid, r.page, r.post || '', r.uid || '', (r.uname || '').slice(0, 60), (r.msg || '').slice(0, MAX_MSG), JSON.stringify(r.tags || []).slice(0, 1000),
      r.rule || '', r.action, r.edited ? 1 : 0, r.at || Date.now(), r.link || null).run();
}
export async function cleanupGuard(env, nowMs) {
  try { await ensureLog(env); await env.DB.prepare('DELETE FROM fb_guard_log WHERE at < ?').bind(nowMs - KEEP_DAYS * DAY).run(); } catch { /* 靜默 */ }
}

// ---- 權杖與用量 ----
export async function guardProfile(env, cfg) { return cfg.profile || (await readProfiles(env)).active; }
async function guardTokens(env, cfg) {
  try { return await activePageTokens(forProfile(env, await guardProfile(env, cfg))); } catch (e) { if (e instanceof FbSetupError) return new Map(); throw e; }
}
// 用量 ≥90% 或 10 分鐘內被限流 → 先不讀留言（不影響排程發布）
async function busy(env, page, now = Date.now()) {
  const u = await readUsage(env);
  const fresh = (x) => x && now - (Number(x.at) || 0) < RECENT_MS;
  const peak = (x) => Math.max(x.callCount || 0, x.totalTime || 0, x.totalCputime || 0);
  if (fresh(u.throttle)) return true;
  if (fresh(u.app) && peak(u.app) >= BUSY_PCT) return true;
  const p = u.pages && u.pages[page];
  return !!(fresh(p) && peak(p) >= BUSY_PCT);
}

// ---- Webhook 事件 ----
// body＝已驗過簽章的 Webhook 內容；錯誤不往外丟
export async function guardEvent(env, body) {
  if (!env.DB || !body || body.object !== 'page' || !Array.isArray(body.entry)) return;
  let cfg;
  try { cfg = await readGuard(env); } catch { return; }
  if (cfg.mode === 'off') return;
  for (const e of body.entry.slice(0, 50)) {
    const page = String(e && e.id || '');
    if (!cfg.pages.includes(page)) continue;
    for (const c of Array.isArray(e.changes) ? e.changes.slice(0, 50) : []) {
      try { await handleChange(env, cfg, page, c); } catch { /* 單則失敗不影響其他 */ }
    }
  }
}

async function handleChange(env, cfg, page, c) {
  const v = c && c.field === 'feed' && c.value;
  if (!v || v.item !== 'comment' || !['add', 'edited'].includes(v.verb)) return;
  const cid = String(v.comment_id || '');
  if (!CID_RE.test(cid)) return;
  if (v.from && v.from.id && String(v.from.id) === page) return;   // 粉專自己
  if (typeof v.message !== 'string') { await bump(env, 'noText'); return; }   // 沒附文字：不讀（避免大量呼叫）
  const prev = await getLog(env, cid);
  if (prev && prev.exempt) return;                                // 手動取消隱藏過
  if (prev && (prev.action === 'hidden' || prev.action === 'manual')) {   // 已經隱藏：再編輯也不必再讀
    if (v.verb === 'edited' && !prev.edited) await env.DB.prepare('UPDATE fb_guard_log SET edited = 1 WHERE cid = ?').bind(cid).run();
    return;
  }
  if (!prefilter(v.message, cfg.rules)) {
    if (prev && v.verb === 'edited') await env.DB.prepare('UPDATE fb_guard_log SET edited = 1 WHERE cid = ?').bind(cid).run();
    return;
  }
  if (await busy(env, page)) { await bump(env, 'skipped'); return; }
  const tokens = await guardTokens(env, cfg);
  const pt = tokens.get(page);
  if (!pt) return;
  await bump(env, 'checked');
  const cm = await graph(env, 'GET', '/' + cid, { fields: 'message,message_tags,from,is_hidden,permalink_url' }, pt.token);
  const j = judge(cm, cfg.rules, page);
  if (!j.hit) {
    if (prev && v.verb === 'edited') await env.DB.prepare('UPDATE fb_guard_log SET edited = 1 WHERE cid = ?').bind(cid).run();
    return;
  }
  let action = 'observe';
  if (cm.is_hidden) action = 'hidden';
  else if (cfg.mode === 'hide' && cfg.rules.auto[j.rule]) {
    try { await graph(env, 'POST', '/' + cid, { is_hidden: 'true' }, pt.token); action = 'hidden'; } catch (err) { if (!(err instanceof GraphError)) throw err; action = 'failed'; }
  }
  const from = (cm && cm.from) || v.from || {};
  await upsertLog(env, {
    cid, page, post: String(v.post_id || ''), uid: String(from.id || ''), uname: String(from.name || ''),
    msg: String(cm.message != null ? cm.message : v.message), tags: j.tags, rule: j.rule, action,
    edited: v.verb === 'edited' || !!(prev && prev.edited), link: typeof cm.permalink_url === 'string' && /^https:\/\//.test(cm.permalink_url) ? cm.permalink_url.slice(0, 300) : null
  });
  await bump(env, action);
}

// ---- 管理路由 ----
async function readJson(request, max) {
  const buf = await readBody(request, max);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}

// 各組別是否有 pages_manage_metadata（只在管理頁打開卡片時查）
async function profileInfo(env) {
  const st = await readProfiles(env);
  const out = [];
  for (const p of st.list) {
    let meta = null;
    try {
      const { token } = await userToken(forProfile(env, p.id));
      if (token) {
        const d = await graph(env, 'GET', '/debug_token', { input_token: token }, token);
        const scopes = d && d.data ? [...(d.data.scopes || []), ...((d.data.granular_scopes || []).map((x) => x && x.scope))] : [];
        meta = scopes.includes('pages_manage_metadata');
      }
    } catch { meta = null; }
    out.push({ id: p.id, name: p.name, active: p.id === st.active, meta });
  }
  return out;
}

const rowOut = (r) => {
  let tags = [];
  try { tags = JSON.parse(r.tags || '[]'); } catch { tags = []; }
  return { cid: r.cid, page: r.page, post: r.post, uid: r.uid, uname: r.uname, msg: r.msg, tags, rule: r.rule, action: r.action, edited: !!r.edited, exempt: !!r.exempt, at: r.at, link: r.link || '' };
};

export async function adminGuard(request, env, path, who) {
  if (!path.startsWith('/admin/fb/guard')) return null;
  try {
    if (path === '/admin/fb/guard' && request.method === 'GET') {
      const cfg = await readGuard(env);
      // 組別權限（debug_token）只在 ?check=1 時查，打開卡片不花呼叫次數
      const check = new URL(request.url).searchParams.get('check') === '1';
      let profiles;
      if (check) profiles = await profileInfo(env);
      else { const st = await readProfiles(env); profiles = st.list.map((p) => ({ id: p.id, name: p.name, active: p.id === st.active, meta: null })); }
      const suggest = cfg.profile || (profiles.find((p) => p.meta) || profiles.find((p) => p.active) || {}).id || '';
      return ok(request, env, { ...cfg, profiles, suggest, stats: await readStats(env), defaults: DEFAULT_RULES });
    }
    if (path === '/admin/fb/guard' && request.method === 'POST') {
      const b = await readJson(request, 16384);
      const rules = b && cleanRules(b.rules);
      if (!b || !MODES.includes(b.mode) || !rules) return fail(request, env, 'bad_request', '每類最多 ' + MAX_ITEMS + ' 筆、每筆最多 ' + MAX_ITEM_LEN + ' 字；白名單只能填數字 ID。');
      const profile = String(b.profile || '');
      if (!PROFILE_ID_RE.test(profile) || !(await readProfiles(env)).list.some((p) => p.id === profile)) return fail(request, env, 'bad_request', '找不到這個組別。');
      const cur = await readGuard(env);
      const next = { mode: b.mode, profile, pages: profile === cur.profile ? cur.pages : [], rules };
      await saveGuard(env, next);
      if (cur.mode !== next.mode) await audit(env, who, 'guard_mode', '', '', 'mode=' + next.mode);
      return ok(request, env, { ...next, stats: await readStats(env) });
    }
    if (path === '/admin/fb/guard/pages' && request.method === 'GET') {
      const cfg = await readGuard(env);
      const pid = await guardProfile(env, cfg);
      const tokens = await guardTokens(env, cfg);
      const check = new URL(request.url).searchParams.get('check') === '1';
      const cred = check ? await appCred(forProfile(env, pid)).catch(() => null) : null;
      const out = [];
      for (const p of tokens.values()) {
        let sub = null;
        if (check) {
          try {
            const d = await graph(env, 'GET', '/' + p.id + '/subscribed_apps', {}, p.token);
            const list = Array.isArray(d && d.data) ? d.data : [];
            sub = list.some((a) => (!cred || !cred.appId || String(a.id) === String(cred.appId)) && Array.isArray(a.subscribed_fields) && a.subscribed_fields.includes('feed'));
          } catch { sub = null; }
        }
        out.push({ id: p.id, name: p.name, on: cfg.pages.includes(p.id), sub });
      }
      return ok(request, env, { profile: pid, pages: out });
    }
    let m = /^\/admin\/fb\/guard\/pages\/(\d{1,30})$/.exec(path);
    if (m && request.method === 'POST') {
      const b = await readJson(request, 1024);
      if (!b || typeof b.on !== 'boolean') return fail(request, env, 'bad_request');
      const cfg = await readGuard(env);
      const pt = (await guardTokens(env, cfg)).get(m[1]);
      if (!pt) return fail(request, env, 'bad_request', '守門用組別沒有這個粉專的權杖。');
      if (b.on) await graph(env, 'POST', '/' + m[1] + '/subscribed_apps', { subscribed_fields: 'feed' }, pt.token);
      else await graph(env, 'DELETE', '/' + m[1] + '/subscribed_apps', {}, pt.token);
      const fresh = await readGuard(env);
      fresh.pages = b.on ? [...new Set([...fresh.pages, m[1]])] : fresh.pages.filter((x) => x !== m[1]);
      await saveGuard(env, fresh);
      return ok(request, env, { id: m[1], on: b.on, sub: b.on });
    }
    if (path === '/admin/fb/guard/log' && request.method === 'GET') {
      const q = new URL(request.url).searchParams;
      const action = q.get('action') || '', page = q.get('page') || '', before = Number(q.get('before')) || 0;
      if ((action && !ACTIONS.includes(action)) || (page && !ID_RE.test(page))) return fail(request, env, 'bad_request');
      await ensureLog(env);
      const where = [], args = [];
      if (action) { where.push('action = ?'); args.push(action); }
      if (page) { where.push('page = ?'); args.push(page); }
      if (before) { where.push('at < ?'); args.push(before); }
      const sql = 'SELECT * FROM fb_guard_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY at DESC LIMIT 51';
      const rows = (await env.DB.prepare(sql).bind(...args).all()).results || [];
      return ok(request, env, { items: rows.slice(0, 50).map(rowOut), more: rows.length > 50 });
    }
    m = /^\/admin\/fb\/guard\/log\/(\d{1,30}(?:_\d{1,30})?)\/(hide|unhide)$/.exec(path);
    if (m && request.method === 'POST') {
      const row = await getLog(env, m[1]);
      if (!row) return fail(request, env, 'bad_request', '找不到這則紀錄。');
      const cfg = await readGuard(env);
      const pt = (await guardTokens(env, cfg)).get(row.page);
      if (!pt) return fail(request, env, 'bad_request', '守門用組別沒有這個粉專的權杖。');
      const hide = m[2] === 'hide';
      await graph(env, 'POST', '/' + m[1], { is_hidden: hide ? 'true' : 'false' }, pt.token);
      await env.DB.prepare('UPDATE fb_guard_log SET action = ?, exempt = ? WHERE cid = ?').bind(hide ? 'manual' : 'unhidden', hide ? 0 : 1, m[1]).run();
      await audit(env, who, hide ? 'guard_hide' : 'guard_unhide', row.page, m[1]);
      return ok(request, env, rowOut(await getLog(env, m[1])));
    }
    return null;
  } catch (e) {
    if (e instanceof FbSetupError) return fail(request, env, e.code);
    if (e instanceof GraphError) return fail(request, env, 'fb_error', '臉書：' + String(e.message).slice(0, 200));
    throw e;
  }
}
