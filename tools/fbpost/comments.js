// 第 N 則留言（第 2 則以後）的規格與純函式。後端 server/core/fbqueue.js 用同一組數字（test 會比對）。
// 第 2 則以後：純文字（可含活動連結、表情符號），不自動帶文章連結／utm；各則延遲都從「發布時間」起算。
export const MAX_COMMENTS = 3;        // 含第一則；之後要擴充只改這裡與後端 MAX_COMMENTS
export const DELAY_MIN = 5;           // 分鐘
export const DELAY_MAX = 1440;
export const DELAY_STEP = 5;
export const DELAY_DEFAULT = 5;

// 第一則之外還能再加幾則
export const EXTRA_SLOTS = MAX_COMMENTS - 1;

// 任意輸入 → 合法延遲：非數字回預設；四捨五入到 5 的倍數；夾在 5～1440
export function clampDelay(value) {
  const n = Math.round(Number(value) / DELAY_STEP) * DELAY_STEP;
  if (!Number.isFinite(n)) return DELAY_DEFAULT;
  return Math.min(DELAY_MAX, Math.max(DELAY_MIN, n));
}

// 滾輪／方向鍵：dir 為 +1 或 -1，每次 5 分鐘（先對齊到 5 的倍數再加減）
export function stepDelay(value, dir) {
  return clampDelay(clampDelay(value) + (dir < 0 ? -DELAY_STEP : DELAY_STEP));
}

// 新增一則時的預設延遲：第一個額外留言 5 分鐘；之後＝上一則＋5
export function nextDelay(delays) {
  return delays.length ? clampDelay(delays[delays.length - 1] + DELAY_STEP) : DELAY_DEFAULT;
}

// 畫面列 → 要送的內容：空白略過、延遲夾進範圍
export function collectExtras(rows) {
  return (rows || [])
    .map((r) => ({ message: String((r && r.message) || '').trim(), delay: clampDelay(r && r.delay) }))
    .filter((r) => r.message)
    .slice(0, EXTRA_SLOTS);
}

// 5 → '5 分鐘'；60 → '1 小時'；90 → '1 小時 30 分'
export function delayText(minutes) {
  const m = Math.round(Number(minutes) || 0);
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${m} 分鐘`;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
}
