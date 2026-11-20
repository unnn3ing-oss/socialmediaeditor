// 數據報表的計算口徑（純函式，不碰畫面；node 單元測試直接 import）
//   item：後端 /fb/reports/posts 的一篇 { page, id, time, type, text, url, views, reach, clicks, reactions, comments, shares, missing }
//   null＝未知；0＝明確的 0

export const TYPES = [
  ['text', '文字'], ['image', '圖片'], ['video', '影片'], ['reels', 'Reels'], ['link', '連結'], ['other', '其他'], ['unknown', '未分類']
];
export const TYPE_NAME = Object.fromEntries(TYPES);
export const METRICS = [
  ['posts', '發文數'], ['views', '瀏覽數'], ['engagement', '互動數'], ['rate', '互動率'], ['clicks', '點擊數'], ['reactions', '心情數'], ['reach', '觸及數']
];
export const METRIC_NAME = Object.fromEntries(METRICS);
export const METRIC_NOTE = {
  views: '各篇瀏覽次數加總（post_media_view）',
  engagement: '心情＋留言＋分享；任一項未知該篇不計',
  rate: 'Σ互動數 ÷ Σ觸及數 × 100%，只算兩者都有的貼文',
  clicks: '貼文總點擊（post_clicks）',
  reactions: '心情總數',
  reach: '各篇觸及加總，同一人可能重複計入'
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// 單篇互動數：任一分量未知＝null
export function engagement(it) {
  return isNum(it.reactions) && isNum(it.comments) && isNum(it.shares) ? it.reactions + it.comments + it.shares : null;
}
// 單篇互動率（%），沒有有效分母＝null
export function postRate(it) {
  const e = engagement(it);
  return e !== null && isNum(it.reach) && it.reach > 0 ? (e / it.reach) * 100 : null;
}
const valueOf = (it, key) => (key === 'engagement' ? engagement(it) : key === 'rate' ? postRate(it) : it[key]);
export const metricValue = valueOf;

// 加總型：{ value(已知小計), known(有資料篇數), total(篇數) }
export function sumOf(items, key) {
  let value = 0, known = 0;
  for (const it of items) { const v = valueOf(it, key); if (isNum(v)) { value += v; known++; } }
  return { value, known, total: items.length };
}
// 互動率彙總：Σ互動 ÷ Σ觸及（同一批貼文）
export function rateOf(items) {
  let e = 0, r = 0, known = 0;
  for (const it of items) {
    const x = engagement(it);
    if (x !== null && isNum(it.reach) && it.reach > 0) { e += x; r += it.reach; known++; }
  }
  return { value: known ? (e / r) * 100 : null, known, total: items.length };
}
// 七項指標
export function summarize(items) {
  const out = { posts: { value: items.length, known: items.length, total: items.length } };
  for (const k of ['views', 'engagement', 'clicks', 'reactions', 'reach']) out[k] = sumOf(items, k);
  out.rate = rateOf(items);
  return out;
}

// 台北日期（YYYY-MM-DD）
export const taipeiDate = (t) => new Date((typeof t === 'number' ? t * 1000 : Date.parse(t)) + 8 * 3600e3).toISOString().slice(0, 10);
export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dateList(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
export function dayCount(from, to) { return dateList(from, to).length; }
// 預設期間：最近 N 天含今天
export const presetRange = (days, today) => ({ from: addDays(today, -(days - 1)), to: today });

// 依發布日分組：[{ date, items, summary }]，沒貼文的日子也列出
export function byDate(items, from, to) {
  const m = new Map(dateList(from, to).map((d) => [d, []]));
  for (const it of items) { const d = taipeiDate(it.time); if (m.has(d)) m.get(d).push(it); }
  return [...m].map(([date, list]) => ({ date, items: list, summary: summarize(list) }));
}
// 分組（粉專、類型）
export function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return m;
}
// 類型成效列
export function typeRows(items) {
  const g = groupBy(items, (it) => it.type || 'unknown');
  return TYPES.filter(([k]) => g.has(k)).map(([k, name]) => {
    const list = g.get(k), s = summarize(list);
    const avg = (x) => (x.known ? x.value / x.known : null);
    return { type: k, name, items: list, summary: s, share: items.length ? (list.length / items.length) * 100 : 0, avgEngagement: avg(s.engagement), avgReach: avg(s.reach) };
  });
}

// 排序：未知值一律放最後
export function sortItems(items, key, dir = 'desc') {
  const f = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const x = key === 'time' ? Date.parse(a.time) : valueOf(a, key), y = key === 'time' ? Date.parse(b.time) : valueOf(b, key);
    const nx = !isNum(x), ny = !isNum(y);
    if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;
    return (x - y) * f;
  });
}

// 去重合併：粉專 ID＋貼文 ID
export function mergeItems(map, items) {
  let added = 0;
  for (const it of items) { const k = it.page + ':' + it.id; if (!map.has(k)) added++; map.set(k, it); }
  return added;
}

// 顯示
const nf = new Intl.NumberFormat('zh-TW');
export const fmtNum = (v) => (isNum(v) ? nf.format(Math.round(v)) : '—');
export const fmtRate = (v) => (isNum(v) ? v.toFixed(2) + '%' : '—');
// 彙總值：全部有資料只顯示數字；部分有資料加「（18／30 篇有資料）」；都沒有「—」
export function fmtAgg(key, a) {
  if (key === 'posts') return fmtNum(a.value);
  if (!a.known) return key === 'rate' || a.total ? '—' : '0';   // 當天沒貼文：加總型 0、互動率 —
  const v = key === 'rate' ? fmtRate(a.value) : fmtNum(a.value);
  return a.known < a.total ? `${v}（${a.known}／${a.total} 篇有資料）` : v;
}
// 指標卡：{ value, note }（note＝「4／5 篇有資料」，全部有資料時空白）
export function aggParts(key, a) {
  const full = fmtAgg(key, a);
  const m = /^(.*)（(.*)）$/.exec(full);
  return m ? { value: m[1], note: m[2] } : { value: full, note: '' };
}
export const fmtCell = (key, v) => (key === 'rate' ? fmtRate(v) : fmtNum(v));
