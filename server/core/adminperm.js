// 管理頁權限：誰在用（adminWho）、每條 /admin/* 屬於哪張卡片（cardFor），以及 /admin/me。
//   admin 憑證（管理頁輸入管理員密碼，只放記憶體）＝系統管理者、已解鎖，全部卡片。
//   員工憑證（uid）且是 SYS_STAFF_ID ＝系統管理者、未解鎖：敏感卡片不能用（舊版首頁管理員憑證 adm:1 同樣，已不再發出）。
//   其他員工憑證＝依權限組裡的 card:<key>（沒有層級了）；bearer() 每次查名單，停用／改密碼／換權限組立即生效。
//   沒有 uid、沒有 adm 的舊公司密碼憑證不能進管理頁。
//   沒對應到卡片的路徑一律只給已解鎖的系統管理者（新增路由忘了標也不會開放出去）。
import { fail } from './http.js';
import { bearer } from './auth.js';
import { CARD_KEYS, SENSITIVE, LEVEL_NAMES, DASH_KEYS } from './levels.js';
import { cardsOf, dashOf } from './staff.js';

// 完整比對；順序：staff-groups 在 staff 前
export const ROUTES = [
  [/^\/admin\/dash\/config$/, 'dashcfg'],
  [/^\/admin\/site\/vis$/, 'toolvis'],
  [/^\/admin\/fb\/access$/, 'access'],
  [/^\/admin\/fb\/profiles(\/p[0-9a-f]{1,8}(\/activate)?)?$/, 'profiles'],
  [/^\/admin\/fb\/(status|token|app|refresh)$/, 'fbconn'],
  [/^\/admin\/fb\/webhook$/, 'webhook'],
  [/^\/admin\/fb\/conn$/, 'fbstate'],
  [/^\/admin\/fb\/guard(\/pages(\/\d{1,30})?|\/log(\/\d{1,30}(_\d{1,30})?\/(hide|unhide))?)?$/, 'guard'],
  [/^\/admin\/fb\/usage(\/refresh)?$/, 'usage'],
  [/^\/admin\/fb\/pages$/, 'pages'],
  [/^\/admin\/fb\/presets$/, 'presets'],
  [/^\/admin\/fb\/(comment|video)-opts$/, 'labs'],
  [/^\/admin\/fb\/video-settings$/, 'video'],
  [/^\/admin\/fb\/backgrounds(\/fetch|\/random|\/\d{6,20}(\/img)?)?$/, 'bg'],
  [/^\/admin\/staff-groups(\/\d{1,9})?$/, 'groups'],
  [/^\/admin\/staff(\/[^/]+(\/reset)?)?$/, 'staff'],
  [/^\/admin\/audit$/, 'audit'],
  [/^\/admin\/rundown(\/ping)?$/, 'rundown'],
  [/^\/admin\/assets(\/[^/]+)?$/, 'assets'],
  [/^\/admin\/logs(\/read)?$/, 'logs']
];
export function cardFor(path) {
  for (const [re, key] of ROUTES) if (re.test(path)) return key;
  return null;
}

// 有效回 { role:'sys'|'staff', unlocked, cards:Set, dash:Set, name, staff?, uid? }；否則 null
//   dash＝首頁儀表板可看的項目（系統管理者不論解鎖＝全部；員工＝權限組 dash:*）；還要和全站開關取交集（dash.js）
export async function adminWho(request, env) {
  if (await bearer(request, env, 'admin')) return { role: 'sys', unlocked: true, cards: new Set(CARD_KEYS), dash: new Set(DASH_KEYS), name: LEVEL_NAMES.sys };
  const t = await bearer(request, env, 'company');
  if (!t) return null;
  if (!t.staff) return null;
  // 系統管理者（SYS_STAFF_ID 員工登入）＝未解鎖的系統管理者，敏感卡片要在管理頁再輸入管理員密碼
  if (t.staff.level === 'sys') return { role: 'sys', unlocked: false, cards: new Set(CARD_KEYS.filter((k) => !SENSITIVE.includes(k))), dash: new Set(DASH_KEYS), name: t.staff.name, staff: t.staff, uid: t.staff.id };
  return { role: 'staff', unlocked: false, cards: new Set(cardsOf(t.staff.perms)), dash: new Set(dashOf(t.staff.perms)), name: t.staff.name, staff: t.staff, uid: t.staff.id };
}

export const meInfo = (who) => ({ role: who.role, roleName: who.role === 'sys' ? LEVEL_NAMES.sys : (who.staff && who.staff.groupName) || '員工', unlocked: !!who.unlocked, cards: CARD_KEYS.filter((k) => who.cards.has(k)), dash: DASH_KEYS.filter((k) => who.dash && who.dash.has(k)), name: who.name, ...(who.uid ? { id: who.uid } : {}) });

// 通過回 null；擋下回錯誤 Response
export function gate(request, env, who, path) {
  const card = cardFor(path);
  // 發送通知（msgs.js）：只有系統管理者，不用解鎖進階設定；不在 CARDS 裡，所以權限組勾不到
  if (/^\/admin\/msgs(\/|$)/.test(path)) return who.role === 'sys' ? null : fail(request, env, 'forbidden');
  if (card ? who.cards.has(card) : who.role === 'sys' && who.unlocked) return null;
  // 權限組卡片要讀名單資料（權限組清單與使用人數）：只有權限組卡片的人也能 GET /admin/staff
  if (card === 'staff' && path === '/admin/staff' && request.method === 'GET' && who.cards.has('groups')) return null;
  return fail(request, env, 'forbidden');
}
