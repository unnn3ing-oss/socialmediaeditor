// 管理頁卡片定義（卡片清單、敏感卡片、可勾給權限組的卡片）。
//   管理頁能看到哪些卡片由「權限組」決定（權限 card:<key>，見 staff.js）；系統管理者（SYS_STAFF_ID）另有敏感卡片（輸入管理員密碼解鎖後）。
//   舊版「層級權限」（D1 fb_settings k='admin_levels'）只在第一次升級搬移權限組時讀一次（staff.js migratePerms），之後不再使用。
import { ensureSettings } from './once.js';
export const CARDS = [
  { key: 'access', name: '排程發布 開放／關閉', sensitive: true, locked: true },
  { key: 'profiles', name: '權杖組別', sensitive: true },
  { key: 'fbconn', name: '臉書連線（含 App 密鑰、重新讀取粉專）', sensitive: true },
  { key: 'webhook', name: 'Webhook', sensitive: true },
  { key: 'guard', name: '留言管理' },
  { key: 'fbstate', name: '臉書粉專連線狀態' },
  { key: 'usage', name: '速率限制' },
  { key: 'pages', name: '粉專設定' },
  { key: 'presets', name: '活動留言' },
  { key: 'video', name: '影片設定' },
  { key: 'bg', name: '文字背景' },
  { key: 'staff', name: '授權名單' },
  { key: 'groups', name: '權限組', sensitive: true },
  { key: 'dashcfg', name: '儀表板顯示項目', sensitive: true },
  { key: 'audit', name: '操作紀錄' },
  { key: 'rundown', name: 'Rundown 連線' },
  { key: 'assets', name: '素材設定' },
  { key: 'logs', name: '錯誤日誌' }
];
export const CARD_KEYS = CARDS.map((c) => c.key);
// 管理頁首頁儀表板的項目（2026-11-23）：權限組可勾 dash:<key>；進階設定「儀表板顯示項目」決定全站要不要顯示
//   tab＝點了跳到的管理頁分類
export const DASH_ITEMS = [
  { key: 'access', name: '排程發布', tab: 'adv' },
  { key: 'profile', name: '使用中權杖組別', tab: 'adv' },
  { key: 'fbtoken', name: '臉書權杖', tab: 'adv' },
  { key: 'webhook', name: 'Webhook', tab: 'adv' },
  { key: 'groups', name: '權限組', tab: 'adv' },
  { key: 'logs', name: '未處理錯誤', tab: 'rec' },
  { key: 'rundown', name: 'Rundown 連線', tab: 'conn' },
  { key: 'usage', name: '速率用量', tab: 'conn' },
  { key: 'online', name: '目前在線', tab: 'people' },
  { key: 'bg', name: '文字背景圖樣', tab: 'post' }
];
export const DASH_KEYS = DASH_ITEMS.map((d) => d.key);
export const SENSITIVE = CARDS.filter((c) => c.sensitive).map((c) => c.key);
// 可以勾進權限組的卡片（非敏感、非 locked）；敏感卡片只有系統管理者
export const GRANTABLE = CARDS.filter((c) => !c.locked && !c.sensitive).map((c) => c.key);
export const LEVEL_NAMES = { sys: '系統管理者' };
// 舊版層級預設（只供升級搬移：讀不到 admin_levels 時用）
export const DEFAULT_LEVELS = {
  mgr: ['guard', 'fbstate', 'usage', 'pages', 'presets', 'video', 'bg', 'staff', 'audit', 'rundown', 'assets', 'logs'],
  user: []
};

// 升級搬移用：讀舊版 admin_levels（壞掉或沒有用預設）；{ mgr, user }（只留可勾卡片）
export async function readOldLevels(env) {
  let raw = null;
  try {
    await ensureSettings(env);
    const row = await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind('admin_levels').first();
    if (row) raw = JSON.parse(row.v);
  } catch { raw = null; }
  const r = raw && typeof raw === 'object' ? raw : {};
  const clean = (v, def) => (Array.isArray(v) ? GRANTABLE.filter((k) => v.includes(k)) : def.slice());
  return { mgr: clean(r.mgr, DEFAULT_LEVELS.mgr), user: clean(r.user, DEFAULT_LEVELS.user) };
}
