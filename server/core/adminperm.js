// 管理頁權限：誰在用（adminWho）、每條 /admin/* 屬於哪張卡片（cardFor），以及 /admin/me、/admin/levels。
//   admin 憑證（管理頁輸入管理員密碼，只放記憶體）＝系統管理者、已解鎖，全部卡片。
//   員工憑證（uid）且是 SYS_STAFF_ID ＝系統管理者、未解鎖：敏感卡片不能用（舊版首頁管理員憑證 adm:1 同樣，已不再發出）。
//   其他員工憑證＝依名單層級（mgr／user）與層級權限表；bearer() 每次查名單，停用／改密碼立即失效。
//   沒有 uid、沒有 adm 的舊公司密碼憑證不能進管理頁。
//   沒對應到卡片的路徑一律只給已解鎖的系統管理者（新增路由忘了標也不會開放出去）。
import { ok, fail, readBody } from './http.js';
import { bearer } from './auth.js';
import { CARDS, CARD_KEYS, SENSITIVE, GRANTABLE, LEVEL_NAMES, DEFAULT_LEVELS, readLevels, saveLevels } from './levels.js';

// 完整比對；順序：staff-groups 在 staff 前
export const ROUTES = [
  [/^\/admin\/levels$/, 'levels'],
  [/^\/admin\/fb\/access$/, 'access'],
  [/^\/admin\/fb\/profiles(\/p[0-9a-f]{1,8}(\/activate)?)?$/, 'profiles'],
  [/^\/admin\/fb\/(status|token|app|refresh)$/, 'fbconn'],
  [/^\/admin\/fb\/webhook$/, 'webhook'],
  [/^\/admin\/fb\/conn$/, 'fbstate'],
  [/^\/admin\/fb\/guard(\/pages(\/\d{1,30})?|\/log(\/\d{1,30}(_\d{1,30})?\/(hide|unhide))?)?$/, 'guard'],
  [/^\/admin\/fb\/usage(\/refresh)?$/, 'usage'],
  [/^\/admin\/fb\/pages$/, 'pages'],
  [/^\/admin\/fb\/presets$/, 'presets'],
  [/^\/admin\/fb\/video-settings$/, 'video'],
  [/^\/admin\/fb\/backgrounds(\/fetch|\/\d{6,20}(\/img)?)?$/, 'bg'],
  [/^\/admin\/staff-groups(\/\d{1,9})?$/, 'groups'],
  [/^\/admin\/staff(\/[^/]+(\/reset)?)?$/, 'staff'],
  [/^\/admin\/audit$/, 'audit'],
  [/^\/admin\/rundown(\/ping)?$/, 'rundown'],
  [/^\/admin\/assets(\/[^/]+)?$/, 'assets'],
  [/^\/admin\/logs$/, 'logs']
];
export function cardFor(path) {
  for (const [re, key] of ROUTES) if (re.test(path)) return key;
  return null;
}

// 有效回 { role:'sys'|'mgr'|'user', unlocked, cards:Set, name, staff?, uid? }；否則 null
export async function adminWho(request, env) {
  if (await bearer(request, env, 'admin')) return { role: 'sys', unlocked: true, cards: new Set(CARD_KEYS), name: LEVEL_NAMES.sys };
  const t = await bearer(request, env, 'company');
  if (!t) return null;
  if (!t.staff) return null;
  // 系統管理者（SYS_STAFF_ID 員工登入）＝未解鎖的系統管理者，敏感卡片要在管理頁再輸入管理員密碼
  if (t.staff.level === 'sys') return { role: 'sys', unlocked: false, cards: new Set(CARD_KEYS.filter((k) => !SENSITIVE.includes(k))), name: t.staff.name, staff: t.staff, uid: t.staff.id };
  const role = t.staff.level === 'mgr' ? 'mgr' : 'user';
  const lv = await readLevels(env);
  return { role, unlocked: false, cards: new Set(lv[role]), name: t.staff.name, staff: t.staff, uid: t.staff.id };
}

export const meInfo = (who) => ({ role: who.role, roleName: LEVEL_NAMES[who.role], unlocked: !!who.unlocked, cards: CARD_KEYS.filter((k) => who.cards.has(k)), name: who.name, ...(who.uid ? { id: who.uid } : {}) });

// 通過回 null；擋下回錯誤 Response
export function gate(request, env, who, path) {
  const card = cardFor(path);
  if (card ? who.cards.has(card) : who.role === 'sys' && who.unlocked) return null;
  // 權限組卡片要讀名單資料（權限組清單與使用人數）：只有權限組卡片的人也能 GET /admin/staff
  if (card === 'staff' && path === '/admin/staff' && request.method === 'GET' && who.cards.has('groups')) return null;
  return fail(request, env, 'forbidden');
}

async function readJson(request) {
  const buf = await readBody(request, 4096);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}
const levelsState = async (env) => ({ levels: await readLevels(env), defaults: DEFAULT_LEVELS, cards: CARDS.map((c) => ({ key: c.key, name: c.name, sensitive: !!c.sensitive, locked: !!c.locked })), grantable: GRANTABLE });

// GET／POST /admin/levels（gate 已確認是已解鎖的系統管理者）
export async function adminLevels(request, env, path) {
  if (path !== '/admin/levels') return null;
  if (request.method === 'GET') return ok(request, env, await levelsState(env));
  if (request.method === 'POST') {
    const v = await saveLevels(env, await readJson(request));
    if (!v) return fail(request, env, 'bad_request');
    return ok(request, env, await levelsState(env));
  }
  return fail(request, env, 'not_found');
}
