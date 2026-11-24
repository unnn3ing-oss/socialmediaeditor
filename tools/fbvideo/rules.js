// 影片發布的純規則（沒有 DOM，單元測試用）：檔名 → 標題、Reels 判斷、貼文大框的行位、RD 文字
export const BUILTIN_PREFIXES = ['Reels_', 'Shorts_'];
export const REEL_MAX_SEC = 90;
export const REEL_MIN_SEC = 3;
// 上傳方式（臉書 API）：Reels 專用（/video_reels）只收 3～90 秒；其他一律走一般影片（/videos），臉書後台一樣顯示成 Reels
//   kind＝使用者看到的類型（橫式／Reels，影響 RD、hashtag、放待排 2359）；route＝實際用哪個 API 上傳
export const routeOf = (kind, duration) => (kind === 'reel' && Number.isFinite(duration) && duration >= REEL_MIN_SEC && duration <= REEL_MAX_SEC ? 'reel' : 'video');
export function routeText(kind, duration) {
  if (kind !== 'reel') return '上傳方式：一般影片';
  if (!Number.isFinite(duration)) return '上傳方式：一般影片（讀不到影片長度）';
  if (duration > REEL_MAX_SEC) return '上傳方式：一般影片（超過 90 秒，臉書後台一樣顯示為 Reels）';
  if (duration < REEL_MIN_SEC) return '上傳方式：一般影片（不到 3 秒）';
  return '上傳方式：Reels';
}

const lower = (s) => s.toLocaleLowerCase();
const startsI = (s, p) => lower(s).startsWith(lower(p));
const endsI = (s, p) => lower(s).endsWith(lower(p));

// 檔名開頭是 Reels_（只有這個才自動加 Reels hashtag）
export const isReelsName = (name) => /^reels_/i.test(String(name || ''));
// Reels 判斷：檔名開頭 Reels_／Shorts_，或影片高＞寬
export function autoKind(name, width, height) {
  if (/^(reels|shorts)_/i.test(String(name || ''))) return 'reel';
  return Number(height) > Number(width) && Number(width) > 0 ? 'reel' : 'video';
}

// 檔名 → 標題：去副檔名；反覆去掉內建（Reels_、Shorts_）與自訂前綴、自訂後綴（不分大小寫）；去頭尾空白
export function titleFromName(name, { prefixes = [], suffixes = [] } = {}) {
  let t = String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  const pre = [...BUILTIN_PREFIXES, ...prefixes].filter(Boolean);
  const suf = suffixes.filter(Boolean);
  for (let guard = 0, changed = true; changed && guard < 20; guard++) {
    changed = false;
    for (const p of pre) if (t.length > p.length && startsI(t, p)) { t = t.slice(p.length).trim(); changed = true; }
    for (const s of suf) if (t.length > s.length && endsI(t, s)) { t = t.slice(0, -s.length).trim(); changed = true; }
  }
  return t;
}

// ===== 貼文大框 =====
// 預設：第 1 行空白（小編文）／【標題】／hashtag 行／授權行（沒內容的行不放）
export function defaultText(title, tag = '', license = '') {
  const lines = ['', title ? `【${title}】` : ''];
  if (tag) lines.push(tag);
  if (license) lines.push(license);
  return lines.join('\n');
}
const split = (text) => String(text || '').replace(/\r/g, '').split('\n');
// 標題行＝第一個「【…】」行
export const titleLine = (lines) => lines.findIndex((l) => /^【.*】$/.test(l.trim()));
const isTagLine = (l) => /^#/.test(String(l || '').trim());
const pad = (lines, n) => { while (lines.length < n) lines.push(''); };

// 換標題：有標題行就換那行；沒有且框是空的 → 預設排法；沒有但有內容 → 插在第 2 行
export function setTitle(text, title) {
  if (!String(text || '').trim()) return defaultText(title);
  const lines = split(text);
  const i = titleLine(lines);
  if (i >= 0) lines[i] = `【${title}】`;
  else { pad(lines, 1); lines.splice(1, 0, `【${title}】`); }
  return lines.join('\n');
}

// hashtag 行在哪：{ index, exists, fallback }。標題下一行；找不到標題改用固定第 3 行（index 2）
function tagSlot(lines) {
  const ti = titleLine(lines);
  const index = ti >= 0 ? ti + 1 : 2;
  return { index, exists: isTagLine(lines[index]), fallback: ti < 0 };
}
export const tagsIn = (text) => {
  const lines = split(text);
  const s = tagSlot(lines);
  return s.exists ? lines[s.index].trim().split(/\s+/) : [];
};
// 按 hashtag 按鈕：hashtag 行有就移除、沒有就加到行尾；行變空就刪掉；沒有 hashtag 行就插一行
export function toggleTag(text, tag) {
  const lines = split(text);
  const s = tagSlot(lines);
  if (s.exists) {
    const tags = lines[s.index].trim().split(/\s+/);
    const at = tags.indexOf(tag);
    if (at >= 0) tags.splice(at, 1); else tags.push(tag);
    if (tags.length) lines[s.index] = tags.join(' '); else lines.splice(s.index, 1);
  } else {
    pad(lines, s.index);
    lines.splice(s.index, 0, tag);
  }
  return { text: lines.join('\n'), fallback: s.fallback };
}

// 影片授權：找到上次帶入的那行就原地換（清空＝刪那行）；找不到就插在 hashtag 行（或標題）下一行；沒有標題用固定第 4 行（index 3）
export function setLicense(text, next, prev = '') {
  const lines = split(text);
  next = String(next || '').replace(/[\r\n]+/g, ' ').trim();
  prev = String(prev || '').trim();
  const at = prev ? lines.findIndex((l) => l.trim() === prev) : -1;
  if (at >= 0) {
    if (next) lines[at] = next; else lines.splice(at, 1);
    return { text: lines.join('\n'), fallback: false };
  }
  if (!next) return { text: lines.join('\n'), fallback: false };
  const ti = titleLine(lines);
  let index;
  if (ti >= 0) index = isTagLine(lines[ti + 1]) ? ti + 2 : ti + 1;
  else index = 3;
  pad(lines, index);
  lines.splice(index, 0, next);
  return { text: lines.join('\n'), fallback: ti < 0 };
}

// 送出的內文：去掉開頭空白行（沒寫小編文時不送空行）
export const stripLead = (t) => String(t).replace(/^(?:[ \t　]*\n)+/, '');

// ===== RD =====
const LABELS = ['快訊', '最新', '新'];
const clean = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '');
// SLUG：手填優先；空白時取標題前 4 字（有斜線取斜線後；只剩「快訊／最新／新」改用下一行）
export function slugOf(manual, title) {
  const m = clean(manual);
  if (m) return m;
  for (const raw of String(title || '').replace(/\r/g, '').split('\n')) {
    let line = raw.trim();
    if (!clean(line)) continue;
    const at = line.search(/[/／]/);
    if (at >= 0 && clean(line.slice(at + 1))) line = line.slice(at + 1);
    const c = clean(line);
    if (LABELS.includes(c)) continue;
    return [...c].slice(0, 4).join('');
  }
  return '';
}
// 橫式：純影/SLUG；Reels：Reels/SLUG
export const rdText = (kind, slug) => `${kind === 'reel' ? 'Reels' : '純影'}/${slug}`;
// 放待排 2359 的 RD 文字：檔名 Shorts_ 開頭 → Shorts/SLUG，其他直式 → Reels/SLUG
export const isShortsName = (name) => /^shorts_/i.test(String(name || ''));
export const rdTextQ = (name, slug) => `${isShortsName(name) ? 'Shorts' : 'Reels'}/${slug}`;
// 放待排 2359：今天（本機時間）23:59:00 的秒數；離現在不到 minS 秒（臉書排程至少提前 10 分鐘，即 23:49 之後）回 null
export function q2359At(nowMs, minS = 600) {
  const d = new Date(nowMs); d.setHours(23, 59, 0, 0);
  const at = Math.floor(d.getTime() / 1000);
  return at - Math.floor(nowMs / 1000) >= minS ? at : null;
}
