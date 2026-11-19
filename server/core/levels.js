// 管理頁層級：系統管理者（管理員密碼）／管理者（mgr）／普通（user）。
//   卡片清單、敏感卡片、預設分配；勾選表存 D1 fb_settings k='admin_levels'（{ mgr:[], user:[] }），讀不到或壞掉用預設。
//   不變式（存與讀都強制）：不含 'levels'；普通 ⊆ 管理者。
export const CARDS = [
  { key: 'access', name: '排程發布 開放／關閉' },
  { key: 'profiles', name: '權杖組別', sensitive: true },
  { key: 'fbconn', name: '臉書連線（含 App 密鑰、重新讀取粉專）', sensitive: true },
  { key: 'webhook', name: 'Webhook', sensitive: true },
  { key: 'usage', name: '速率限制' },
  { key: 'pages', name: '粉專設定' },
  { key: 'presets', name: '活動留言' },
  { key: 'video', name: '影片設定' },
  { key: 'staff', name: '授權名單' },
  { key: 'groups', name: '權限組', sensitive: true },
  { key: 'audit', name: '操作紀錄' },
  { key: 'rundown', name: 'Rundown 連線' },
  { key: 'assets', name: '素材' },
  { key: 'logs', name: '錯誤日誌' },
  { key: 'levels', name: '層級權限', sensitive: true, locked: true }
];
export const CARD_KEYS = CARDS.map((c) => c.key);
export const SENSITIVE = CARDS.filter((c) => c.sensitive).map((c) => c.key);
// 可以勾給管理者／普通的卡片（levels 永遠只有系統管理者）
export const GRANTABLE = CARDS.filter((c) => !c.locked).map((c) => c.key);
export const LEVELS = ['user', 'mgr'];
export const LEVEL_NAMES = { sys: '系統管理者', mgr: '管理者', user: '普通' };
export const DEFAULT_LEVELS = {
  mgr: ['access', 'usage', 'pages', 'presets', 'video', 'staff', 'audit', 'rundown', 'assets', 'logs'],
  user: []
};
const KEY = 'admin_levels';

const clean = (v) => (Array.isArray(v) ? GRANTABLE.filter((k) => v.includes(k)) : null);

// 套用不變式；raw 某一層壞掉就用那層的預設
export function normLevels(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const mgr = clean(r.mgr) || DEFAULT_LEVELS.mgr.slice();
  const user = (clean(r.user) || DEFAULT_LEVELS.user.slice()).filter((k) => mgr.includes(k));
  return { mgr, user };
}

export async function readLevels(env) {
  let raw = null;
  try {
    const row = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first();
    if (row) raw = JSON.parse(row.v);
  } catch { raw = null; }
  return normLevels(raw);
}

// 存檔：普通勾的自動併入管理者；回傳實際存的值
export async function saveLevels(env, body) {
  const mgr = clean(body && body.mgr), user = clean(body && body.user);
  if (!mgr || !user) return null;
  const v = normLevels({ mgr: GRANTABLE.filter((k) => mgr.includes(k) || user.includes(k)), user });
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS fb_settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)').run();
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(KEY, JSON.stringify(v), Date.now()).run();
  return v;
}

// 某層級（'mgr'／'user'）可用的卡片
export async function cardsFor(env, level) {
  const lv = await readLevels(env);
  return level === 'mgr' ? lv.mgr : lv.user;
}
