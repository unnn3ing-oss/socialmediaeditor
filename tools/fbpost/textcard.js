// 純文字貼文的底圖卡片：照網新排程（schedulenewnet web/app.js 的 drawTextCard）。
// 色票資料取自網新 config.js 的 textCardStyles（只是顏色，不是公司素材）；網新底部的 wordmark 圖是公司素材，這裡不畫。
// 版面（量自網新後端產圖）：字級 76、行距 110、最大寬 880、整塊置中在 y≈524（不論幾行）、深色陰影右下偏移 5px。
// 畫布固定 1080×1080。
const SIZE = 1080;
const TC = { px: 76, lineH: 110, maxW: 880, centerY: 524, baseOff: 23, shadow: 'rgba(0,0,0,.85)', blur: 5, off: 5 };
const FALLBACK = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "PMingLiU", sans-serif';

const RAW_STYLES = [
  { key: 'flash', label: '快訊紅', bg: '#b00020' }, { key: 'intl', label: '國際藍', bg: '#0d2b6b' },
  { key: 'wx', label: '氣象青', bg: '#0a6e7c' }, { key: 'life', label: '生活橘', bg: '#c46a1a' },
  { key: 'night', label: '深夜黑', bg: '#111111' }, { key: 'money', label: '財經綠', bg: '#0f5132' },
  { key: 'mocha', label: '咖啡灰', bg: '#5a5448' },
  { key: 'qpt-c80000', label: 'QPT #C80000', bg: '#c80000' }, { key: 'qpt-ff3916', label: 'QPT #FF3916', bg: '#ff3916' },
  { key: 'qpt-5fa646', label: 'QPT #5FA646', bg: '#5fa646' }, { key: 'qpt-4c8b74', label: 'QPT #4C8B74', bg: '#4c8b74' },
  { key: 'qpt-ff9900', label: 'QPT #FF9900', bg: '#ff9900' }, { key: 'qpt-1c6294', label: 'QPT #1C6294', bg: '#1c6294' },
  { key: 'qpt-cb6ce6', label: 'QPT #CB6CE6', bg: '#cb6ce6' }, { key: 'qpt-d84040', label: 'QPT #D84040', bg: '#d84040' },
  { key: 'qpt-ff7ead', label: 'QPT #FF7EAD', bg: '#ff7ead' }, { key: 'qpt-004aad', label: 'QPT #004AAD', bg: '#004aad' },
  { key: 'qpt-000000', label: 'QPT #000000', bg: '#000000' }, { key: 'qpt-48413f', label: 'QPT #48413F', bg: '#48413f' },
  { key: 'qpt-a6a6a6', label: 'QPT #A6A6A6', bg: '#a6a6a6' }, { key: 'qpt-5cafcc', label: 'QPT #5CAFCC', bg: '#5cafcc' },
  { key: 'qpt-ffdd30', label: 'QPT #FFDD30', bg: '#ffdd30' }, { key: 'qpt-7261c9', label: 'QPT #7261C9', bg: '#7261c9' },
  { key: 'qpt-d13885', label: 'QPT #D13885', bg: '#d13885' }, { key: 'qpt-3667a8', label: 'QPT #3667A8', bg: '#3667a8' },
  { key: 'qpt-3f8c59', label: 'QPT #3F8C59', bg: '#3f8c59' },
].map((s) => ({ ...s, fg: '#ffffff' }));

// 底色按 HSB 排序（同網新 app.js／QPT：中性色在前、依亮度；其餘依色相，粉紅歸到紅色家族）
function hexToHSB(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6; else if (max === g) hue = (b - r) / delta + 2; else hue = (r - g) / delta + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  return { hue, saturation: max === 0 ? 0 : delta / max, brightness: max };
}
const NEUTRAL_SATURATION = 0.15, PINK_HUE_START = 320;
const redFamilyHue = (h) => (h >= PINK_HUE_START ? h - 360 : h);
export const TEXT_SWATCHES = RAW_STYLES.slice().sort((a, b) => {
  const ha = hexToHSB(a.bg), hb = hexToHSB(b.bg);
  const an = ha.saturation < NEUTRAL_SATURATION, bn = hb.saturation < NEUTRAL_SATURATION;
  if (an !== bn) return an ? -1 : 1;
  if (an) return ha.brightness - hb.brightness;
  return redFamilyHue(ha.hue) - redFamilyHue(hb.hue) || hb.saturation - ha.saturation;
});
export const DEFAULT_SWATCH = RAW_STYLES[0].key;
export const swatchCss = (s) => (s && s.bg) || '#b00020';

const fontOf = (fontLoaded) => (fontLoaded ? `${TC.px}px "WHZ-Heavy", ${FALLBACK}` : `900 ${TC.px}px "Noto Sans TC", ${FALLBACK}`);

// 一行超過 maxW 就折行
export function wrapRows(c, text) {
  const rows = [];
  String(text).split('\n').forEach((para) => {
    let cur = '';
    for (const ch of para) { if (cur && c.measureText(cur + ch).width > TC.maxW) { rows.push(cur); cur = ''; } cur += ch; }
    rows.push(cur);
  });
  return rows;
}

// text＝標題（一行一句，\n 分行）；沒有字時畫提示
export function drawTextCard(canvas, { text = '', swatch, fontLoaded = false } = {}) {
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext('2d');
  const st = swatch || TEXT_SWATCHES[0];
  c.fillStyle = st.bg;
  c.fillRect(0, 0, SIZE, SIZE);
  const real = String(text || '').trim();
  c.font = fontOf(fontLoaded);
  c.fillStyle = st.fg;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  if (!real) c.globalAlpha = 0.5;
  c.shadowColor = TC.shadow; c.shadowBlur = TC.blur; c.shadowOffsetX = TC.off; c.shadowOffsetY = TC.off;
  const rows = wrapRows(c, real || '在右邊輸入標題');
  const y0 = TC.centerY - (rows.length - 1) * TC.lineH / 2 + TC.baseOff;
  rows.forEach((r, i) => c.fillText(r, SIZE / 2, y0 + i * TC.lineH));
  c.shadowColor = 'transparent'; c.shadowOffsetX = c.shadowOffsetY = 0;
  c.globalAlpha = 1;
}
