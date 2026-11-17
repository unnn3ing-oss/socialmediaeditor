// 共用畫圖核心（1080×1080 套版）：「圖片套版」與「排程發布」共用，兩邊輸出一模一樣。
// 不讀任何工具的畫面元素，也不寫死任何工具的規則（例如框怎麼依網址判斷由各工具決定）。
// 公司素材（緞帶、Logo）與字型是否載入由呼叫端傳進 createRenderer。
//
// source：{ type: 'image', image, view } | { type: 'color', color }
// frame：'generic'（通用框 C）| 'entertainment'（粉）| 'news'（藍）
// fx（見 fx.js）：{ photo(ctx) 照片畫完馬上叫；mosaic(ctx) 背景之後、邊框與標題之前；stickers(ctx) 最後 }
// gen（通用框）：{ tag, color }

export const SIZE = 1080;

// ---- 色票（純色背景）----
// HSB/HSV breakdown of a #rrggbb color — used to sort the swatch list.
function hexToHSB(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation: max === 0 ? 0 : delta / max, brightness: max };
}
// Near-neutrals come first, dark → light; then colors by hue (pinks/magentas count as reds).
const NEUTRAL_SATURATION = 0.15;
const PINK_HUE_START = 320;
const redFamilyHue = hue => (hue >= PINK_HUE_START ? hue - 360 : hue);
export const PRESET_COLORS = [
  '#c80000','#ff3916','#5fa646','#4c8b74','#ff9900','#1c6294','#cb6ce6','#d84040','#ff7ead','#004aad',
  '#000000','#48413f','#a6a6a6','#5CAFCC','#FFDD30','#7261C9','#D13885','#3667A8','#3F8C59'
].sort((a, b) => {
  const ha = hexToHSB(a), hb = hexToHSB(b);
  const aNeutral = ha.saturation < NEUTRAL_SATURATION, bNeutral = hb.saturation < NEUTRAL_SATURATION;
  if (aNeutral !== bNeutral) return aNeutral ? -1 : 1;
  if (aNeutral) return ha.brightness - hb.brightness;
  return redFamilyHue(ha.hue) - redFamilyHue(hb.hue) || hb.saturation - ha.saturation;
});

// ---- 照片位置：view = { zoom, x, y }；zoom 1 是置中 cover，x/y 是偏移（畫布 px）----
export const MAX_ZOOM = 5;
export function newView() { return { zoom: 1, x: 0, y: 0 }; }
export function coverGeometry(image, view) {
  const s = Math.max(SIZE / image.width, SIZE / image.height) * view.zoom;
  const dw = image.width * s, dh = image.height * s;
  return { s, dw, dh, dx: (SIZE - dw) / 2 + view.x, dy: (SIZE - dh) / 2 + view.y };
}
export function clampView(image, view) {
  view.zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const { dw, dh } = coverGeometry(image, view);
  const mx = (dw - SIZE) / 2, my = (dh - SIZE) / 2;
  view.x = Math.min(mx, Math.max(-mx, view.x));
  view.y = Math.min(my, Math.max(-my, view.y));
}

export function loadImg(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

export function hasBackground(source) {
  return !!source && ((source.type === 'color' && source.color) || (source.type === 'image' && source.image));
}

// ---- 通用框（框 C）常數 ----
export const GEN_COLORS = [
  { name: '墨黑', hex: '#202124' }, { name: '海軍藍', hex: '#1f3a5f' }, { name: '磚紅', hex: '#b03a2e' },
  { name: '森綠', hex: '#2f6b4f' }, { name: '琥珀', hex: '#e0a100' }
];
export const GEN_DEFAULT = () => ({ tag: '快訊', color: GEN_COLORS[0].hex });
export const GEN_TITLE_X = 108, GEN_TITLE_MAX_W = 900;
export const GEN_L1 = 72, GEN_L2 = 50, GEN_L1_BASE = 915, GEN_L2_BASE = 995;

// ---- 標題版面 ----
export const BOX_CENTER = 880;      // 標題區塊固定的垂直中心（實測 TVBS 輸出，1～3 行都對齊這裡）
export const LINE_HEIGHT_RATIO = 93 / 67;
export const MAX_TITLE_LINES = 4;     // 標題最多 4 行，第 5 行起不畫
// 「排程發布」的套版排法（照舊版排程發布）：最後一行中心固定在 y 931、往上長；行距 93（66px 時，隨字級等比）；左右留白 30
export const BOTTOM_TITLE = { lastY: 931, lineHeight: 93, basePx: 66, padX: 30 };
export const bottomLineHeight = (px) => BOTTOM_TITLE.lineHeight * px / BOTTOM_TITLE.basePx;
// 1～3 行以 BOX_CENTER 置中；4 行時最後一行對齊 3 行的底線、整塊往上長
export const anchorY = (centerY, n, lineHeight) => (centerY === BOX_CENTER && n > 3 ? centerY - (n - 3) * lineHeight / 2 : centerY);

// 字級以 Canva「字級」為單位（Canva 50 ＝ 1080 畫布上 67px）
export const CANVA_TO_PX = 67 / 50;
export const DEFAULT_CANVA_SIZE_IMAGE = 50; // 圖片／緞帶框
export const DEFAULT_CANVA_SIZE_COLOR = 60; // 純色背景
export const FONT_SIZE_MIN = 50;
export const FONT_SIZE_MAX = 70;
export const canvaToPx = (canvaSize) => canvaSize * CANVA_TO_PX;
export const defaultCanvaSizeFor = (bgType) => (bgType === 'color' ? DEFAULT_CANVA_SIZE_COLOR : DEFAULT_CANVA_SIZE_IMAGE);
// 圖片背景固定字級 50，只有純色背景可調
export const effectiveCanvaSize = (bg, chosen) => (bg && bg.type === 'image' ? DEFAULT_CANVA_SIZE_IMAGE : chosen);

// 輸入框怎麼分行，畫面就怎麼分行：頭尾的空行不畫，中間的空行留成空隙
export function titleRows(titleText) {
  const rows = titleText.replace(/\r/g, '').split('\n').map(l => (l.trim() ? l : ''));
  let first = 0, last = rows.length - 1;
  while (first <= last && !rows[first]) first++;
  while (last >= first && !rows[last]) last--;
  return { lines: rows.slice(first, last + 1), lead: first, total: rows.length };
}
export const parseLines = (titleText) => titleRows(titleText).lines;

// 淺色純色背景用深色標題（WCAG 相對亮度門檻）
const DARK_TEXT_LUMINANCE = 0.35;
export const TITLE_LIGHT = '#ffffff';
export const TITLE_DARK = '#111111';
export function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const usesDarkTitle = (bg) => !!(bg && bg.type === 'color' && bg.color && relativeLuminance(bg.color) > DARK_TEXT_LUMINANCE);

const RIBBON_W = 230, RIBBON_H = 215; // 緞帶原始尺寸
const LOGO_W = 170, LOGO_H = 100, LOGO_X = 455, LOGO_Y = 955;
const FONT_FALLBACK = `"Microsoft JhengHei", "PingFang TC", "PMingLiU", sans-serif`;

// assets：{ ribbonEnt, ribbonNews, logo }（網址，可為 null）；fontLoaded：公司標題字型 WHZ-Heavy 已載入
export function createRenderer({ ribbonEnt = null, ribbonNews = null, logo = null, fontLoaded = false } = {}) {
  let ribbonImg = null, ribbonNewsImg = null, logoImg = null;
  const ready = Promise.all([
    loadImg(ribbonEnt).then(im => { ribbonImg = im; }),
    loadImg(ribbonNews).then(im => { ribbonNewsImg = im; }),
    loadImg(logo).then(im => { logoImg = im; })
  ]);

  // 標題字型：有公司字型就用它；沒有就用 Noto Sans TC（粗細由 weight 指定）
  function titleFont(size, weight = 900) {
    return fontLoaded
      ? `${size}px "WHZ-Heavy", ${FONT_FALLBACK}`
      : `${weight} ${size}px "Noto Sans TC", ${FONT_FALLBACK}`;
  }

  function fitFontSize(targetCtx, lines, maxWidth, baseSize, weight = 900) {
    let size = baseSize;
    targetCtx.font = titleFont(size, weight);
    const widest = Math.max(...lines.map(l => targetCtx.measureText(l).width));
    if (widest > maxWidth) size = Math.max(24, Math.floor(size * maxWidth / widest));
    return size;
  }

  function drawImageCover(targetCtx, image, view = newView()) {
    const g = coverGeometry(image, view);
    targetCtx.drawImage(image, g.dx, g.dy, g.dw, g.dh);
  }

  function drawGradient(targetCtx) {
    const grad = targetCtx.createLinearGradient(0, 0, 0, SIZE);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    targetCtx.fillStyle = grad;
    targetCtx.fillRect(0, 0, SIZE, SIZE);
  }

  function drawRibbon(targetCtx, frame) {
    const im = frame === 'news' ? ribbonNewsImg : ribbonImg;
    if (!im) return;
    targetCtx.drawImage(im, SIZE - RIBBON_W, 0, RIBBON_W, RIBBON_H);
  }

  function drawLogoBottom(targetCtx) {
    if (!logoImg) return;
    targetCtx.drawImage(logoImg, LOGO_X, LOGO_Y, LOGO_W, LOGO_H);
  }

  // ---- 通用框：照片滿版＋底部黑色漸層＋左上角標籤＋左側主色直條的標題 ----
  function drawGenericGradient(c) {
    const grad = c.createLinearGradient(0, 560, 0, SIZE);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.78)');
    c.fillStyle = grad;
    c.fillRect(0, 560, SIZE, SIZE - 560);
  }
  // 角標留空就整個不畫；字太長時色塊變寬（左右各留 48px）
  function genTagWidth(c, tag) {
    c.font = titleFont(50, 900);
    return Math.max(290, Math.ceil(c.measureText(tag).width) + 96);
  }
  function drawGenericTag(c, gen) {
    const tag = (gen.tag || '').trim();
    if (!tag) return;
    const w = genTagWidth(c, tag);
    c.fillStyle = gen.color;
    c.fillRect(0, 70, w, 96);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(w, 70, 14, 96);
    c.fillStyle = '#fff';
    c.font = titleFont(50, 900);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText(tag, w / 2, 135);
  }
  // 第一行大標 72px、第二行副標 50px（可空）；只有一行時整組下移，標題底部對齊 y≈995
  function genTitleLines(titleText) {
    const lines = parseLines(titleText).filter(l => l.trim());
    return { l1: lines[0] || '', l2: lines.slice(1).join(' ') };
  }
  function genTitleLayout(c, titleText) {
    const { l1, l2 } = genTitleLines(titleText);
    if (!l1 && !l2) return null;
    const main = l1 || l2;
    const sub = l1 ? l2 : '';
    const s1 = fitFontSize(c, [main], GEN_TITLE_MAX_W, GEN_L1, 900);
    const s2 = sub ? fitFontSize(c, [sub], GEN_TITLE_MAX_W, GEN_L2, 500) : 0;
    const base1 = sub ? GEN_L1_BASE : GEN_L2_BASE;
    return { main, sub, s1, s2, base1, base2: GEN_L2_BASE };
  }
  function drawGenericTitle(c, titleText, gen) {
    const L = genTitleLayout(c, titleText);
    if (!L) return;
    // 主色直條：從第一行字頂到最後一行基線下方 7px
    const top = L.base1 - Math.round(L.s1 * 0.875);
    const bottom = (L.sub ? L.base2 : L.base1) + 7;
    c.fillStyle = gen.color;
    c.fillRect(72, top, 10, bottom - top);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff';
    c.font = titleFont(L.s1, 900);
    c.fillText(L.main, GEN_TITLE_X, L.base1);
    if (L.sub) {
      c.globalAlpha = 0.9;
      c.font = titleFont(L.s2, 500);
      c.fillText(L.sub, GEN_TITLE_X, L.base2);
      c.globalAlpha = 1;
    }
  }

  // 排程發布用：最後一行固定在 BOTTOM_TITLE.lastY，往上排（不影響「圖片套版」的置中排法）
  function drawTitleBottom(targetCtx, lines, baseSize, color = TITLE_LIGHT) {
    lines = lines.slice(0, MAX_TITLE_LINES);
    if (lines.length === 0) return;
    const fontSize = fitFontSize(targetCtx, lines, SIZE - BOTTOM_TITLE.padX * 2, baseSize);
    const lh = bottomLineHeight(fontSize);
    const n = lines.length;
    targetCtx.textAlign = 'center';
    targetCtx.textBaseline = 'middle';
    targetCtx.font = titleFont(fontSize);
    targetCtx.fillStyle = color;
    lines.forEach((line, i) => targetCtx.fillText(line, SIZE / 2, BOTTOM_TITLE.lastY - (n - 1 - i) * lh));
  }

  function drawTitle(targetCtx, lines, baseSize, centerY, color = TITLE_LIGHT) {
    lines = lines.slice(0, MAX_TITLE_LINES);
    if (lines.length === 0) return;
    const paddingX = 60;
    const maxWidth = SIZE - paddingX * 2;
    const fontSize = fitFontSize(targetCtx, lines, maxWidth, baseSize);
    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const n = lines.length;
    centerY = anchorY(centerY, n, lineHeight);
    targetCtx.textAlign = 'center';
    targetCtx.textBaseline = 'middle';
    targetCtx.font = titleFont(fontSize);
    lines.forEach((line, i) => {
      const y = centerY - (n - 1) * lineHeight / 2 + i * lineHeight;
      targetCtx.fillStyle = color;
      targetCtx.fillText(line, SIZE / 2, y);
    });
  }

  // fontSize 是畫布 px（用 canvaToPx 換算）
  function renderComposite(targetCtx, source, titleText, fontSize, frame, fx, gen, opts = {}) {
    targetCtx.clearRect(0, 0, SIZE, SIZE);
    targetCtx.canvas.classList.toggle('pannable', !!(source && source.type === 'image' && source.image));
    if (source && source.type === 'color') {
      targetCtx.fillStyle = source.color;
      targetCtx.fillRect(0, 0, SIZE, SIZE);
      if (fx && fx.mosaic) fx.mosaic(targetCtx);
      drawLogoBottom(targetCtx);
      drawTitle(targetCtx, parseLines(titleText), fontSize, SIZE / 2, usesDarkTitle(source) ? TITLE_DARK : TITLE_LIGHT);
    } else {
      drawImageCover(targetCtx, source.image, source.view);
      if (fx && fx.photo) fx.photo(targetCtx);
      if (fx && fx.mosaic) fx.mosaic(targetCtx);
      if (frame === 'generic') {
        const g = gen || GEN_DEFAULT();
        drawGenericGradient(targetCtx);
        drawGenericTag(targetCtx, g);
        drawGenericTitle(targetCtx, titleText, g);
      } else {
        drawGradient(targetCtx);
        drawRibbon(targetCtx, frame);
        if (opts.titleAnchor === 'bottom') drawTitleBottom(targetCtx, parseLines(titleText), fontSize);
        else drawTitle(targetCtx, parseLines(titleText), fontSize, BOX_CENTER);
      }
    }
    if (fx && fx.stickers) fx.stickers(targetCtx);
  }

  // 字型晚一步載好時（loadComposeAssets 的 waitFont:false）用它切換成公司字型
  function setFontLoaded(v) { fontLoaded = Boolean(v); }

  return { ready, fontLoaded, setFontLoaded, titleFont, fitFontSize, drawImageCover, renderComposite };
}

// Google 把 Noto Sans TC 切成很多段，canvas 畫字不會自動載入沒用過的那段，缺字會退回系統字型。
// 畫標題前先用實際文字載入（粗體 900 與副標 500 兩種），最多等 5 秒就放行。公司字型缺字時也會退到 Noto。
export function loadTitleGlyphs(text, timeoutMs = 5000) {
  const t = String(text || '').replace(/\s+/g, '') || '標題';
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return Promise.race([
    Promise.all([
      document.fonts.load(`900 67px "Noto Sans TC"`, t),
      document.fonts.load(`500 50px "Noto Sans TC"`, t),
    ]).catch(() => {}),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}
