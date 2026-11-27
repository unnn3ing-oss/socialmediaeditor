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

// 多行標題合併成一行：預覽（照片套圖、純文字圖）的每個換行處補一個空格
export function joinTitle(title) {
  const lines = String(title || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.join(' ');   // 預覽換行處一律空一格
}

// 標題改了：貼文內容第一個整行是【…】的那一行換成【新標題】；沒有那一行就原樣回傳（不補回）
// 第 1 行是小編文（使用者可能自己寫【…】），不換；標題清空時不動
export function syncTitleLine(msg, title) {
  const t = joinTitle(title);
  if (!t) return msg;
  const lines = String(msg || '').split('\n');
  const i = lines.findIndex((l, k) => k > 0 && /^【.*】$/.test(l.trim()));
  if (i < 0) return msg;
  lines[i] = `【${t}】`;
  return lines.join('\n');
}

// 純文字＋文字背景（純函式）：依 Enter 分出的每一行（不去頭尾空行，和輸入框的行一一對齊），每行 11 字。只提醒，不擋送出。
export const TEXT_LINE_MAX = 11;
export function textCheck(text) {
  const lines = String(text || '').split('\n');
  const widths = lines.map((l) => charWidth(l));
  const over = widths.findIndex((w) => w > TEXT_LINE_MAX);
  return { widths, over, text: over >= 0 ? '字數超過可能換行顯示' : '' };
}
