// 標題字數提醒（純函式）：每行 15 字（全形 1、半形 0.5），最多 4 行。只提醒，不擋送出。
import { charWidth } from '../../sdk/news-rules.js';
import { titleRows } from '../../ui/compose/render.js';

export const LINE_MAX = 15;
export const LINES_MAX = 4;
const RULE = `每行 ${LINE_MAX} 字（全形 1、半形 0.5），最多 ${LINES_MAX} 行`;

// 回傳 { widths, ok, text }：text 是要顯示在標題旁的說明（ok＝false 時要用紅字）
export function titleCheck(title) {
  const lines = titleRows(String(title || '')).lines;   // 和畫在圖上的行一致（頭尾空行不算）
  const widths = lines.map((l) => charWidth(l));
  if (!lines.length) return { widths, ok: true, text: RULE };
  const over = widths.findIndex((w) => w > LINE_MAX);
  if (over >= 0) return { widths, ok: false, text: `第 ${over + 1} 行 ${widths[over]} 字，超過 ${LINE_MAX} 字（仍可送出）` };
  if (lines.length > LINES_MAX) return { widths, ok: false, text: `${lines.length} 行，超過 ${LINES_MAX} 行（第 ${LINES_MAX + 1} 行起不會畫在圖上）` };
  return { widths, ok: true, text: `${RULE}・目前 ${widths.join('／')}` };
}
