// 管理頁首頁儀表板（2026-11-23，設計 docs/superpowers/specs/2026-11-23-admin-dashboard-design.md）
//   GET /admin/dash：各項狀態 { key, name, level:'ok'|'info'|'warn'|'bad', text, tab }；不呼叫臉書，只讀 D1／記憶體已存的資料
//     完整結果存這個執行個體的記憶體 5 分鐘、所有人共用；回傳前依「全站開關 ∩ 這個人可看的項目」篩選（看不到的不送到前端）
//     ?fresh=1：略過暫存重讀（同一人 10 秒內再按回上一份）
//   GET／POST /admin/dash/config：全站開關（進階設定「儀表板顯示項目」，卡片 dashcfg），D1 fb_settings k='dash' {"items":[...]}，沒存過＝全部
import { ok, fail, readBody } from './http.js';
import { all, first } from './db.js';
import { ensureSettings } from './once.js';
import { DASH_ITEMS, DASH_KEYS } from './levels.js';

export const CACHE_MS = 5 * 60 * 1000;
export const FRESH_GAP_MS = 10 * 1000;
export const ONLINE_MS = 5 * 60 * 1000;
export const USAGE_RECENT_MS = 60 * 60 * 1000;
const CFG_KEY = 'dash';
const DAY = 86400000;

// ---- 各項等級規則（純函式，方便測試）----
const cut = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
export function ago(ms, now = Date.now()) {
  const d = Math.max(0, now - ms);
  if (d < 60000) return '剛剛';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分鐘前';
  if (d < DAY) return Math.floor(d / 3600000) + ' 小時前';
  return Math.floor(d / DAY) + ' 天前';
}
export function accessItem(st) {
  if (st.mode === 'company') return { level: 'ok', text: '開放中' };
  return { level: 'info', text: '關閉中（只有管理員可用）' + (st.reason ? '：' + cut(st.reason, 30) : '') };
}
// warn＝pages.js tokenWarn 的結果；hasStored＝有存粉專權杖；hasUser＝有使用者權杖（D1 或 Secret）
export function tokenItem({ warn, hasStored, hasUser }) {
  if (warn && warn.level === 'bad') return { level: 'bad', text: warn.days !== undefined && warn.days <= 0 ? '已到期，要換新權杖' : '已失效，要換新權杖' };
  if (warn && warn.level === 'warn') return { level: 'warn', text: warn.days + ' 天後到期' };
  if (hasStored) return { level: 'ok', text: '正常' };
  if (hasUser) return { level: 'info', text: '只有使用者權杖，到期日要到臉書連線查看' };
  return { level: 'warn', text: '尚未設定權杖' };
}
export function webhookItem({ signReady, last }, now = Date.now()) {
  if (!signReady) return { level: 'info', text: '未設定 App 密鑰（留言管理未使用）' };
  return { level: 'ok', text: last ? ago(last.at, now) + '收到通知' : '尚未收到通知' };
}
export function selfregItem(n) { return n > 0 ? { level: 'warn', text: n + ' 位自行註冊尚未指派權限組' } : { level: 'ok', text: '沒有待指派的人' }; }
export function logsItem(n) { return n > 0 ? { level: 'bad', text: n + ' 則未處理' } : { level: 'ok', text: '沒有未處理的錯誤' }; }
const RD_TEXT = { ok: '已設定', missing: '未設定網址與金鑰', url: '網址未設定或格式不對', token: '金鑰空白' };
export function rundownItem(state) { return state === 'ok' ? { level: 'ok', text: RD_TEXT.ok } : { level: 'bad', text: RD_TEXT[state] || '設定有誤' }; }
// u＝usage.js readUsage 的結果；只看 1 小時內的紀錄
export function usageItem(u, now = Date.now()) {
  const recent = (x) => x && now - (Number(x.at) || 0) < USAGE_RECENT_MS;
  if (u && u.throttle && now - (Number(u.throttle.at) || 0) < 10 * 60 * 1000) return { level: 'bad', text: '10 分鐘內被臉書限流' };
  const list = [u && u.app, ...Object.values((u && u.pages) || {})].filter(recent);
  if (!list.length) return { level: 'info', text: '1 小時內沒有用量紀錄' };
  const max = Math.max(...list.map((x) => Math.max(Number(x.callCount) || 0, Number(x.totalTime) || 0, Number(x.totalCputime) || 0)));
  return { level: max >= 90 ? 'bad' : max >= 75 ? 'warn' : 'ok', text: '最高 ' + max + '%（1 小時內）' };
}
// exps＝還沒下載的圖樣網址到期時間（秒）；null＝還沒匯入
export function bgItem(exps, now = Date.now()) {
  if (exps === null) return { level: 'info', text: '尚未匯入' };
  const s = now / 1000;
  const gone = exps.filter((e) => e <= s).length, soon = exps.filter((e) => e > s && e - s < 86400).length;
  if (gone) return { level: 'bad', text: gone + ' 張未下載的圖樣網址已過期' };
  if (soon) return { level: 'warn', text: soon + ' 張未下載的圖樣 1 天內到期' };
  return { level: 'ok', text: exps.length ? exps.length + ' 張待下載' : '正常' };
}

// ---- 讀取（每項各自 try；失敗回「讀取失敗」不影響其他項）----
async function read(env, now) {
  const fbAccess = () => import('../fb/access.js');
  const ts = () => import('../fb/tokenstore.js');
  const jobs = {
    access: async () => accessItem(await (await fbAccess()).accessState(env)),
    profile: async () => { const st = await (await ts()).readProfiles(env); const p = st.list.find((x) => x.id === st.active); return { level: 'info', text: p ? p.name : '預設' }; },
    fbtoken: async () => {
      const t = await ts(), { tokenWarn } = await import('../fb/pages.js');
      const [stored, broken, user] = await Promise.all([t.storedPageTokens(env), t.brokenAt(env), t.userToken(env)]);
      return tokenItem({ warn: tokenWarn({ stored, userExpires: null, broken, now }), hasStored: !!stored, hasUser: !!user.token });
    },
    webhook: async () => { const [creds, w] = await Promise.all([(await ts()).allAppCreds(env), import('../fb/webhook.js')]); return webhookItem({ signReady: creds.length > 0, last: await w.readLast(env) }, now); },
    groups: async () => {
      const { ensureStaff } = await import('./staff.js');
      await ensureStaff(env);
      const g = await first(env, 'SELECT COUNT(*) AS n FROM staff_groups');
      const s = await first(env, 'SELECT COUNT(*) AS n, SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) AS off FROM staff');
      const off = Number(s && s.off) || 0;
      return { level: 'info', text: (Number(g && g.n) || 0) + ' 組、名單 ' + (Number(s && s.n) || 0) + ' 人' + (off ? '（停用 ' + off + '）' : '') };
    },
    logs: async () => { const { ensurePageCol } = await import('./logs.js'); await ensurePageCol(env); const r = await first(env, "SELECT COUNT(*) AS n FROM logs WHERE st = 'open'"); return logsItem(Number(r && r.n) || 0); },
    rundown: async () => rundownItem((await import('../fb/rundown.js')).rundownState(env)),
    usage: async () => usageItem(await (await import('../fb/usage.js')).readUsage(env), now),
    online: async () => {
      const { ensureStaff } = await import('./staff.js');
      await ensureStaff(env);
      const r = await first(env, 'SELECT COUNT(*) AS n FROM staff WHERE enabled = 1 AND last_seen >= ?', now - ONLINE_MS);
      return { level: 'info', text: (Number(r && r.n) || 0) + ' 人' };
    },
    selfreg: async () => {
      const { ensureStaff, sysId } = await import('./staff.js');
      await ensureStaff(env);
      const r = await first(env, 'SELECT COUNT(*) AS n FROM staff WHERE grp = 0 AND enabled = 1 AND id != ?', sysId(env) || '');
      return selfregItem(Number(r && r.n) || 0);
    },
    bg: async () => {
      const { urlExpiry } = await import('../fb/bgstore.js');
      let rows;
      try { rows = await all(env, "SELECT url FROM fb_backgrounds WHERE type = 'image' AND img = 0 AND url IS NOT NULL"); } catch { return bgItem(null, now); }
      const any = await first(env, 'SELECT COUNT(*) AS n FROM fb_backgrounds').catch(() => null);
      if (!any || !Number(any.n)) return bgItem(null, now);
      return bgItem(rows.map((r) => urlExpiry(r.url)).filter((e) => e), now);
    }
  };
  const out = await Promise.all(DASH_ITEMS.map(async (d) => {
    let r;
    try { r = await jobs[d.key](); } catch { r = { level: 'warn', text: '讀取失敗' }; }
    return { key: d.key, name: d.name, level: r.level, text: cut(r.text, 60), tab: d.tab };
  }));
  return out;
}

// ---- 暫存（每個 D1 綁定一份，只在記憶體）----
const memo = new WeakMap();   // db → { at, p }
const lastFresh = new WeakMap(); // db → Map<使用者, 時間>
export async function snapshot(env, { fresh = false, user = '', now = Date.now() } = {}) {
  const db = env.DB || env;
  const hit = memo.get(db);
  if (hit && fresh) {
    let m = lastFresh.get(db);
    if (!m) lastFresh.set(db, (m = new Map()));
    const prev = m.get(user) || 0;
    if (now - prev < FRESH_GAP_MS) fresh = false;
    else m.set(user, now);
  }
  if (hit && !fresh && now - hit.at < CACHE_MS) return hit.p;
  const ent = { at: now, p: read(env, now).then((items) => ({ at: now, items })) };
  memo.set(db, ent);
  ent.p.catch(() => { if (memo.get(db) === ent) memo.delete(db); });
  return ent.p;
}
export const forgetDash = (env) => memo.delete(env.DB || env);

// ---- 全站開關 ----
export async function readDashCfg(env) {
  try {
    await ensureSettings(env);
    const r = await first(env, 'SELECT v FROM fb_settings WHERE k = ?', CFG_KEY);
    const o = r ? JSON.parse(r.v) : null;
    if (o && Array.isArray(o.items)) return DASH_KEYS.filter((k) => o.items.includes(k));
  } catch { /* 壞掉＝全部 */ }
  return DASH_KEYS.slice();
}
async function saveDashCfg(env, items) {
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(CFG_KEY, JSON.stringify({ items }), Date.now()).run();
}

// cfg=true：/admin/dash/config（已通過 gate 卡片 dashcfg）；否則 /admin/dash（自己依 who.dash 篩選）
export async function adminDash(request, env, who, cfg = false) {
  if (cfg) {
    if (request.method === 'GET') return ok(request, env, { items: await readDashCfg(env), all: DASH_ITEMS.map((d) => ({ key: d.key, name: d.name })) });
    if (request.method !== 'POST') return null;
    const buf = await readBody(request, 2048);
    let b = null;
    try { b = buf ? JSON.parse(new TextDecoder().decode(buf)) : null; } catch { b = null; }
    if (!b || !Array.isArray(b.items) || !b.items.every((k) => typeof k === 'string')) return fail(request, env, 'bad_request');
    const items = DASH_KEYS.filter((k) => b.items.includes(k));
    await saveDashCfg(env, items);
    return ok(request, env, { items });
  }
  const mine = who.dash || new Set();
  if (!mine.size) return fail(request, env, 'forbidden');
  const on = new Set(await readDashCfg(env));
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  const snap = await snapshot(env, { fresh, user: who.uid || 'sys' });
  const items = snap.items.filter((x) => on.has(x.key) && mine.has(x.key)).map(({ key, name, level, text, tab }) => ({ key, name, level, text, tab }));
  return ok(request, env, { at: snap.at, items });
}
