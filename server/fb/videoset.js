// 影片發布的設定（管理頁「影片設定」）：標題要去掉的前綴／後綴、Reels 自動 hashtag、hashtag 按鈕
// 存在 D1 fb_settings 一列（k='video'，v＝JSON）；讀不到或壞掉用預設
import { ensureSettings } from '../core/once.js';
const KEY = 'video';
export const DEFAULT_REELS_TAG = '#焦點新聞影音都在TVBS';
export const LIMITS = { affixes: 20, affixLen: 30, tags: 20, tagLen: 50, reelsTagLen: 100 };
const DEFAULTS = () => ({ prefixes: [], suffixes: [], reelsTag: DEFAULT_REELS_TAG, tags: [] });

const oneLine = (v, max) => typeof v === 'string' && !/[\r\n]/.test(v) && [...v.trim()].length <= max;

// 驗證；不合法回 null。清單去頭尾空白、去空白項、去重複
export function validVideoSettings(body) {
  if (!body || typeof body !== 'object') return null;
  const list = (arr, n, len) => {
    if (arr === undefined) return [];
    if (!Array.isArray(arr) || arr.length > n) return null;
    const out = [];
    for (const x of arr) {
      if (!oneLine(x, len)) return null;
      const t = x.trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  };
  const prefixes = list(body.prefixes, LIMITS.affixes, LIMITS.affixLen);
  const suffixes = list(body.suffixes, LIMITS.affixes, LIMITS.affixLen);
  const tags = list(body.tags, LIMITS.tags, LIMITS.tagLen);
  if (!prefixes || !suffixes || !tags) return null;
  if (body.reelsTag !== undefined && !oneLine(body.reelsTag, LIMITS.reelsTagLen)) return null;
  const reelsTag = body.reelsTag === undefined ? DEFAULT_REELS_TAG : body.reelsTag.trim();
  return { prefixes, suffixes, reelsTag, tags };
}

export async function getVideoSettings(env) {
  let v;
  try { v = (await env.DB.prepare('SELECT v FROM fb_settings WHERE k = ?').bind(KEY).first() || {}).v; } catch { v = null; }
  if (!v) return DEFAULTS();
  try { return validVideoSettings(JSON.parse(v)) || DEFAULTS(); } catch { return DEFAULTS(); }
}

export async function saveVideoSettings(env, s) {
  await ensureSettings(env);
  await env.DB.prepare('INSERT INTO fb_settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated')
    .bind(KEY, JSON.stringify(s), Date.now()).run();
}
