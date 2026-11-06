// 純文字貼文的底色卡片（仿 Facebook 的背景色票）。
// 色票的 bg 有兩種表示法：
//   - 字串 '#rrggbb'：純色
//   - 物件 { from, to }：左上 → 右下 135 度的雙色漸層
// 畫布固定 1080×1080。
const SIZE = 1080;
const MAX_W = 880;       // 文字最大寬度
const MAX_H = 880;       // 文字區最大高度
const FONT_MAX = 72, FONT_MIN = 36;
const LINE_RATIO = 1.35; // 行高 / 字級
const FONT_STACK = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

export const TEXT_SWATCHES = [
  { id: 'purple', name: '紫', bg: '#8E44EF', fg: '#ffffff' },
  { id: 'red', name: '紅', bg: '#F02849', fg: '#ffffff' },
  { id: 'orange', name: '橘', bg: '#F7923B', fg: '#ffffff' },
  { id: 'green', name: '綠', bg: '#45BD62', fg: '#ffffff' },
  { id: 'blue', name: '藍', bg: '#1877F2', fg: '#ffffff' },
  { id: 'navy', name: '深藍', bg: '#0B2A5B', fg: '#ffffff' },
  { id: 'black', name: '黑', bg: '#1C1E21', fg: '#ffffff' },
  { id: 'pink', name: '粉', bg: '#FF66B3', fg: '#ffffff' },
  { id: 'gray', name: '淺灰', bg: '#E4E6EB', fg: '#1C1E21' },
  { id: 'sunset', name: '夕陽', bg: { from: '#FF9A3D', to: '#F02849' }, fg: '#ffffff' },
  { id: 'ocean', name: '海洋', bg: { from: '#36D1DC', to: '#1877F2' }, fg: '#ffffff' },
  { id: 'dusk', name: '暮光', bg: { from: '#8E44EF', to: '#FF66B3' }, fg: '#ffffff' }
];

// 給 UI 色塊用的 CSS background 值
export function swatchCss(swatch) {
  const bg = swatch && swatch.bg;
  if (!bg) return '#1877F2';
  if (typeof bg === 'string') return bg;
  return `linear-gradient(135deg, ${bg.from}, ${bg.to})`;
}

function fillBackground(c, swatch) {
  const bg = (swatch && swatch.bg) || TEXT_SWATCHES[4].bg;
  if (typeof bg === 'string') {
    c.fillStyle = bg;
  } else {
    const g = c.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    c.fillStyle = g;
  }
  c.fillRect(0, 0, SIZE, SIZE);
}

// 不能出現在行首的標點（避頭點）：折行時留在上一行
const NO_LINE_START = '，。、；：？！）」』】》〉,.;:?!)]}%…—';
const TOKEN_RE = /[\x21-\x7E]+|\s+|[\s\S]/gu;   // 英數連續字當一個詞、空白、其他一字一詞

function wrapLine(c, line, maxW) {
  const out = [];
  let cur = '';
  const push = () => { out.push(cur.replace(/\s+$/, '')); cur = ''; };
  const tokens = line.match(TOKEN_RE) || [];
  for (const tok of tokens) {
    const isSpace = /^\s+$/.test(tok);
    if (isSpace && !cur) continue;                       // 行首不放空白
    if (c.measureText(cur + tok).width <= maxW) { cur += tok; continue; }
    if (isSpace) { push(); continue; }
    if (NO_LINE_START.includes(tok[0]) && cur) { cur += tok; continue; }   // 避頭點
    if (cur) push();
    if (c.measureText(tok).width <= maxW) { cur = tok; continue; }
    // 單一詞比整行還寬：逐字拆開
    for (const ch of tok) {
      if (cur && c.measureText(cur + ch).width > maxW) push();
      cur += ch;
    }
  }
  if (cur || !out.length) out.push(cur.replace(/\s+$/, ''));
  return out;
}

function layout(c, text) {
  const paras = text.replace(/\r/g, '').split('\n');
  let size = FONT_MAX, lines = [];
  for (; size >= FONT_MIN; size -= 2) {
    c.font = `700 ${size}px ${FONT_STACK}`;
    lines = paras.flatMap(p => (p.trim() ? wrapLine(c, p, MAX_W) : ['']));
    if (lines.length * size * LINE_RATIO <= MAX_H) break;
  }
  size = Math.max(FONT_MIN, Math.min(FONT_MAX, size));
  return { size, lines };
}

// canvas 需為 1080×1080（這裡會自行設定）。opts.hint 為 true 且沒有文字時畫淡淡的「輸入文字」
export function drawTextCard(canvas, { text = '', swatch, hint = false } = {}) {
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext('2d');
  fillBackground(c, swatch);
  const fg = (swatch && swatch.fg) || '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (!String(text).trim()) {
    if (hint) {
      c.globalAlpha = 0.5;
      c.fillStyle = fg;
      c.font = `700 56px ${FONT_STACK}`;
      c.fillText('輸入文字', SIZE / 2, SIZE / 2);
      c.globalAlpha = 1;
    }
    return;
  }
  const { size, lines } = layout(c, String(text));
  const lh = size * LINE_RATIO;
  c.font = `700 ${size}px ${FONT_STACK}`;
  c.fillStyle = fg;
  const top = SIZE / 2 - (lines.length * lh) / 2 + lh / 2;
  lines.forEach((l, i) => c.fillText(l, SIZE / 2, top + i * lh));
}
