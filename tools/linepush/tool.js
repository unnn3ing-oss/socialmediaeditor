// LINE 推播：搬自舊「LinePushPatternTool」的做圖部分（版面、標題、照片、貼圖、輸出）。
// 推送／排程／訊息中心／試驗功能 P1 不搬。公司素材一律用 tb.assets.get 取得，沒密碼時走通用版。
import { tb } from '../../sdk/toolbox.js';

tb.init('linepush');

// ---------------------------------------------------------------------------
// 素材與模式：有公司素材 → 公司模式（新聞黃條＋娛樂拍立得，只有「新聞／娛樂」兩個版型，不出現四格 A）；
// 沒有 → 通用模式（六宮格＋四格 A），畫面不出現任何公司字樣。
// ---------------------------------------------------------------------------
const STICKER_IDS = ['smile', 'shock', 'cry', 'angry', 'kiss', 'laugh', 'meh'];
const [headerAsset, grid4Asset, ...stickerAssets] = await Promise.all([
  tb.assets.get('line.header'),
  tb.assets.get('line.grid4'),
  ...STICKER_IDS.map(id => tb.assets.get(`sticker.${id}`)),
]);
const fontAsset = await tb.assets.get('font.line');
const COMPANY = Boolean(headerAsset?.url || grid4Asset?.url);

// 標題字型：公司版台北黑體粗體（同舊工具，FontFace 載入）；通用版 Noto Sans TC 900（Google Fonts）。
const TITLE_FONT = 'TbTitleFont';
async function loadTitleFont() {
  try {
    if (COMPANY && fontAsset?.url) {
      const face = new FontFace(TITLE_FONT, `url(${fontAsset.url})`, { weight: '900' });
      await face.load();
      document.fonts.add(face);
      return;
    }
  } catch { /* 字型載入失敗就退回 Noto Sans TC */ }
  try { await document.fonts.load('900 40px "Noto Sans TC"', '標題'); } catch { /* 網路不通就用系統字 */ }
}
// >>> 原檔 1876-1994
// ---------------------------------------------------------------------------
// Layout constants (must match the fixed 熱門話題 template: 1040x800, yellow
// header bar, 3 columns x 2 rows of image cells).
// ---------------------------------------------------------------------------
// CANVAS_W/H follow the active mode (新聞 1040×800 / 娛樂 1200×1200); the
// 新聞 grid geometry below stays pinned to its own fixed 1040×800 size.
let CANVAS_W = 1040, CANVAS_H = 800;
const NEWS_W = 1040, NEWS_H = 800;
const HEADER_H = 46;
// Thin black cap line along the very top edge of the yellow header bar —
// part of the reference design but not baked into the template PNG, so it
// has to be drawn separately on top of it.
const HEADER_TOP_LINE_H = 3;
const COLS = 3, ROWS = 2;
const COL_EDGES = [0, NEWS_W / 3, (NEWS_W / 3) * 2, NEWS_W];
// Page 1 (with header) reserves the top HEADER_H for the yellow bar, so its
// 2 rows split the remaining height. Page 2 (no header) has no such gap —
// its rows fill the full canvas height edge-to-edge, matching the real
// reference export where photos run flush to the very top.
const ROW_EDGES_HEADER = [HEADER_H, HEADER_H + (NEWS_H - HEADER_H) / 2, NEWS_H];
const ROW_EDGES_PLAIN = [0, NEWS_H / 2, NEWS_H];
function rowEdgesFor(showHeader) { return showHeader ? ROW_EDGES_HEADER : ROW_EDGES_PLAIN; }
const FONT_STACK = `"TbTitleFont", "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;

// ---------------------------------------------------------------------------
// 四格 A（通用版）：1040×1040 白底，2×2 四格，每格 514×514，格間白縫 12px。
// 每格可加一行說明：格左下內縮 24px、圓角 8 的 #202124 不透明度 .88 底條，高 60，
// 字 36px 粗 700，左右內距 16px。
// ---------------------------------------------------------------------------
const G4_SIZE = 1040, G4_CELL = 514;
const G4_CELLS = [[0, 0], [526, 0], [0, 526], [526, 526]].map(([x, y]) => ({ x, y, w: G4_CELL, h: G4_CELL }));
const G4_CAP = { inset: 24, h: 60, font: 36, padX: 16, radius: 8, bar: 'rgba(32,33,36,0.88)' };

// ---------------------------------------------------------------------------
// 娛樂 layout: 4 polaroid frames on a 1200×1200 page. Every number below was
// measured off the designer's reference template/sample (drawn at 1040 and
// scaled ×1200/1040): `photo` is the bbox of each frame's see-through window
// (+3px so no gap shows at its tilted edges — the frame covers the excess),
// cx/y1/y2 are the sample text's ink centers on the yellow sticky note, hw
// the half-width the headline may fill, and tagX/tagBottom anchor the blue
// kicker tag just above the note.
// ---------------------------------------------------------------------------
const ENT_W = 1200, ENT_H = 1200;
// Frames in the same row share one y for line 1, line 2 and the tag (the
// row's average of the measured positions), so left/right text lines up
// instead of sitting a few px apart like the hand-placed sample.
const ENT_ROW_Y = [
  { y1: 467.3, y2: 535.7, tagBottom: 421 },
  { y1: 1055.8, y2: 1123.9, tagBottom: 1015.5 },
];
const ENT_CELLS = [
  { photo: { x: 44, y: 23, w: 535, h: 409 }, cx: 301.7, hw: 285.6, tagX: 18, ...ENT_ROW_Y[0] },
  { photo: { x: 632, y: 13, w: 546, h: 416 }, cx: 907.5, hw: 283.3, tagX: 625, ...ENT_ROW_Y[0] },
  { photo: { x: 36, y: 628, w: 531, h: 389 }, cx: 294.2, hw: 282.7, tagX: 9, ...ENT_ROW_Y[1] },
  { photo: { x: 632, y: 615, w: 542, h: 406 }, cx: 894.6, hw: 283.0, tagX: 613, ...ENT_ROW_Y[1] },
];
// Sample text is TaipeiSans Bold at 53px on the 1040 artboard → 61px here.
const ENT_BASE_FONT_SIZE = 61;
// Tag text size; the tape is built from it (text + padding), so the whole tag
// scales together. Padding keeps the earlier 58px-text look in proportion
// (tape ≈ 1.59× the text height, ≈ 0.42× the text height of padding per side).
const ENT_TAG_BASE_FONT_SIZE = 50;
const ENT_TAG_PAD_X = 21, ENT_TAG_PAD_Y = 14.6;
const ENT_TAG_ROTATE = -3 * Math.PI / 180;
// A light same-colour outline to thicken TaipeiSans Bold toward the sample's
// weight; kept at 1px since heavier strokes plus the tight negative spacing
// make neighbouring glyphs run together.
const ENT_TEXT_STROKE = 1;
// Measured on the sample's long lines (≈ -0.056em); a little headroom past
// that before the font size starts dropping.
const ENT_MIN_SPACING_EM = -0.07;

const LAYOUTS = {
  news: {
    name: '新聞', W: NEWS_W, H: NEWS_H, exportW: NEWS_W, exportH: NEWS_H, cellCount: 6,
    cellLabels: ['左上', '中上', '右上', '左下', '中下', '右下'],
    lineColors: ['#ffffff', '#ffff00', '#ff2b2b', '#3aa0ff', '#37c871', '#000000'],
    tagColors: ['#ff0000', '#a5a5a5'],
    stickerBase: 110, previewMaxWidth: 720,
    sub: '「新聞」：熱門話題六宮格，兩頁各自獨立（第1頁含標籤列、第2頁不含），每頁 1040×800。',
  },
  ent: {
    name: '娛樂', W: ENT_W, H: ENT_H, exportW: 1040, exportH: 1040, cellCount: 4,
    cellLabels: ['左上', '右上', '左下', '右下'],
    lineColors: ['#0075d6', '#000000', '#ffffff', '#ff2b2b', '#37c871', '#ffff00'],
    tagColors: ['#00bbf0', '#a5a5a5'],
    stickerBase: 127, previewMaxWidth: 620,
    sub: '「娛樂」：拍立得四格，兩頁各自獨立，每頁輸出 1040×1040。',
  },
  grid4: {
    name: '四格 A', W: G4_SIZE, H: G4_SIZE, exportW: G4_SIZE, exportH: G4_SIZE, cellCount: 4,
    cellLabels: ['左上', '右上', '左下', '右下'],
    lineColors: ['#ffffff'],
    tagColors: ['#ff0000'],
    stickerBase: 110, previewMaxWidth: 620,
    sub: '「四格 A」：白底 2×2 四格，兩頁各自獨立，每頁輸出 1040×1040。',
  },
};
if (!COMPANY) { LAYOUTS.news.name = '六宮格'; LAYOUTS.news.sub = '「六宮格」：兩頁各自獨立，每頁輸出 1040×800。'; }
let mode = 'news';
function L() { return LAYOUTS[mode]; }
// 新聞／娛樂 work in two steps: 1 編輯畫面, 2 畫面檢查 (photos locked, downloads
// unlocked). 拼圖 has no headline check, so it has no steps.
let step = 1;
const stepByMode = { news: 1, ent: 1, grid4: 1 };
// Whether a cell is picked: only then does its editor float on the left and its
// frame light up on the preview. Clicking empty space un-picks it.
let cellSelected = false;
// 新聞 only: the yellow 「熱門話題」 bar on the preview is picked instead of a cell
// (opens the 頂部標籤 editor on the left).
let headerSelected = false;
let quickfillOpen = true;
// 步驟 1 option: show the photo-edge check right on the preview (check range + yellow "!").
let edgeCheckOn = false;
let chromeReady = false;     // syncChrome() waits until every element it touches exists
function isLocked() { return step === 2; }
// Mode-dependent values the rest of the code reads as plain globals.
let CELL_COUNT, CELL_LABELS, LINE_COLORS, TAG_COLORS, STICKER_BASE_SIZE;
function applyModeGlobals() {
  const l = L();
  CANVAS_W = l.W; CANVAS_H = l.H;
  CELL_COUNT = l.cellCount;
  CELL_LABELS = l.cellLabels;
  LINE_COLORS = l.lineColors;
  TAG_COLORS = l.tagColors;
  STICKER_BASE_SIZE = l.stickerBase;
}
applyModeGlobals();
// >>> 原檔 2055-2938
// 新聞 default colours alternate white/yellow by column: column 0 & 2 are
// white-on-top, yellow-on-bottom; column 1 is the reverse. 娛樂 matches its
// sample: blue first line, black second.
function defaultColorsFor(i) {
  if (mode === 'ent') return { color1: '#0075d6', color2: '#000000' };
  const col = i % COLS;
  return col % 2 === 0
    ? { color1: '#ffffff', color2: '#ffff00' }
    : { color1: '#ffff00', color2: '#ffffff' };
}

const headlineFontReady = loadTitleFont();

// The header/gradient artwork is the actual Canva-exported template PNGs —
// composited as-is, never redrawn from scratch. Two page variants are
// provided: one with the yellow "熱門話題" header bar, one without it (a
// plain top vignette instead), for slides that don't repeat the header.
function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
// The exported 新聞 template PNGs leave their outermost pixel columns thinner than the rest (the plain one
// has a fully clear left column and a ~85% second column, and a ~25% last column), so the photo shows through
// as a light strip at the page's left edge. Fill the two outer columns on each side from the nearest full
// column so the black gradient / band reaches the very edge.
function fillTemplateEdges(img) {
  if (!img) return img;
  const w = img.naturalWidth, h = img.naturalHeight, E = 2;
  if (w < E * 2 + 4) return img;
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, w, h), px = data.data;
    const copy = (from, to, y) => { const f = (y * w + from) * 4, t = (y * w + to) * 4; px[t] = px[f]; px[t + 1] = px[f + 1]; px[t + 2] = px[f + 2]; px[t + 3] = px[f + 3]; };
    for (let y = 0; y < h; y++) {
      for (let i = 0; i < E; i++) { copy(E, i, y); copy(w - 1 - E, w - 1 - i, y); }
    }
    x.putImageData(data, 0, 0);
    return c;
  } catch (e) { return img; }   // e.g. opened from file:// (tainted canvas): keep the original artwork
}
let templateHeaderImg = null, templatePlainImg = null, templateEntImg = null;
// 通用版只有 template-plain（公開檔）；黃色標題條、娛樂拍立得四格只在公司模式取得。
const templatesReady = Promise.all([
  headerAsset?.url ? loadImage(headerAsset.url).then(img => { templateHeaderImg = fillTemplateEdges(img); }) : null,
  loadImage('assets/template-plain.png').then(img => { templatePlainImg = fillTemplateEdges(img); }),
  grid4Asset?.url ? loadImage(grid4Asset.url).then(img => { templateEntImg = img; }) : null,
]);

// Small face-covering stickers the user can drop onto a cell's photo to hide
// a bystander. Loaded once up front the same way as the template artwork.
const STICKER_DEFS = STICKER_IDS.map((id, i) => ({ key: `t${i + 1}`, src: stickerAssets[i]?.url || '' }))
  .filter(def => def.src);
const stickerImages = {};
const stickersReady = Promise.all(
  STICKER_DEFS.map(def => loadImage(def.src).then(img => { stickerImages[def.key] = img; }))
);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Converts full-width punctuation (as Chinese IMEs commonly produce for ！？
// （）＂＇，：；etc.) to their half-width/ASCII form, plus curly quotes and
// 。、to their straight/ASCII equivalents — every substitution is one
// character for one character, so callers can safely restore the caret
// position afterwards without any offset math.
function toHalfWidth(str) {
  if (!str) return str;
  return str
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/。/g, '.')
    .replace(/、/g, ',');
}

// Normalizes a text <input>'s value in place (for use in its own 'input'
// listener) and returns the normalized string, preserving the caret
// position since toHalfWidth never changes string length.
function normalizeInputValue(inputEl) {
  const normalized = toHalfWidth(inputEl.value);
  if (normalized !== inputEl.value) {
    const pos = inputEl.selectionStart;
    inputEl.value = normalized;
    inputEl.setSelectionRange(pos, pos);
  }
  return normalized;
}

// In 娛樂 mode this is each frame's photo window; showHeader only matters
// for 新聞, where page 1's header bar pushes the grid down.
function cellRect(i, showHeader) {
  if (mode === 'ent') return ENT_CELLS[i].photo;
  if (mode === 'grid4') return G4_CELLS[i];
  const row = Math.floor(i / COLS), col = i % COLS;
  const x = COL_EDGES[col], x1 = COL_EDGES[col + 1];
  const rowEdges = rowEdgesFor(showHeader);
  const y = rowEdges[row], y1 = rowEdges[row + 1];
  return { x, y, w: x1 - x, h: y1 - y };
}

// ---------------------------------------------------------------------------
// State — two independent pages (page 1 = with header, page 2 = plain),
// each holding its own 6-cell grid of cards. Only one page is edited/shown
// at a time, switched via the page tabs.
// ---------------------------------------------------------------------------
function freshCardState(i) {
  const c = defaultColorsFor(i);
  return {
    line1: '',
    line2: '',
    tag: '',
    tagColor: TAG_COLORS[0],
    // 新聞 only: a second tag, plus each tag's drag offset from its default
    // spot (null = default).
    tag2: '',
    tag2Color: TAG_COLORS[0],
    // From quick fill, for 「複製推播連結」: the article link.
    url: '',
    tagPos: null,
    tag2Pos: null,
    color1: c.color1,
    color2: c.color2,
    img: null,
    imgSource: '',   // 'auto' (fetched by quick fill) | 'manual' (user-picked) | ''
    fileName: '',
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    fx: 0.5,
    fy: 0.5,
    stickers: [],
  };
}

function makePageState(pageIndex) {
  const withHeader = COMPANY && mode === 'news' && pageIndex === 0;
  return {
    showHeader: withHeader,
    topLabel: withHeader ? '熱門話題' : '',
    bg: '#ffffff',          // 四格 A：底色
    capColor: '#ffffff',   // 四格 A：說明字色
    cards: CELL_LABELS.map((_, i) => freshCardState(i)),
  };
}

const PAGE_COUNT = 2;
let pages = [makePageState(0), makePageState(1)];
let activePageIndex = 0;
// Each mode keeps its own pages, so switching 新聞/娛樂 never loses work.
const pagesByMode = { news: null, ent: null, grid4: null };
const pageIndexByMode = { news: 0, ent: 0, grid4: 0 };
function activePage() { return pages[activePageIndex]; }
let activeCard = 0;

// ---------------------------------------------------------------------------
// Text fitting: shrink letter-spacing first, only shrink font size once
// letter-spacing has hit its minimum and the line still overflows.
// ---------------------------------------------------------------------------
const BASE_FONT_SIZE = 40;
const MIN_FONT_SIZE = 14;
const NORMAL_SPACING = 0.5;

// The bold weight of this font draws the straight double-quote glyph as two
// thick, tall bars that read as visually much bigger than its actual advance
// width (narrower than a Han character) would suggest — it dominates next to
// dense Chinese glyphs. Render (and count the width of) that one glyph at a
// reduced scale so it looks proportionate instead of shrinking unrelated text.
const GLYPH_SCALE = { '"': 0.7 };
function scaledFontSize(fontSize, ch) {
  const s = GLYPH_SCALE[ch];
  return s ? fontSize * s : fontSize;
}
function measureChar(ctx, ch, fontSize) {
  ctx.font = `900 ${scaledFontSize(fontSize, ch)}px ${FONT_STACK}`;
  return ctx.measureText(ch).width;
}

function measureWithSpacing(ctx, text, spacing, fontSize) {
  if (!text) return 0;
  let w = 0;
  for (const ch of text) w += measureChar(ctx, ch, fontSize) + spacing;
  return w - spacing;
}

// Shared fit algorithm for every text box (header label, tag, headline
// lines): natural letter-spacing first: if the text already fits, leave it
// alone (never stretched to fill the box). If it overflows, compress
// spacing down towards 0 — but never past 0, since a negative gap starts
// overlapping glyph strokes for this font. Only once spacing has hit that
// floor and it still overflows does the font size drop a step, then the
// same spacing search repeats at the smaller size.
// minSpacingEm sets how far spacing may be squeezed before the font shrinks:
// 0 for 新聞 (never tighter than touching), negative for 娛樂, whose sample
// keeps near-full size on long lines by tucking glyphs together instead.
function computeFit(ctx, text, maxWidth, baseFontSize, minSpacingEm = 0) {
  if (!text) return { fontSize: baseFontSize, spacing: NORMAL_SPACING };
  const chars = [...text];
  const n = chars.length;
  let fontSize = baseFontSize;
  while (fontSize >= MIN_FONT_SIZE) {
    let sumW = 0;
    for (const ch of chars) sumW += measureChar(ctx, ch, fontSize);
    if (n <= 1) {
      if (sumW <= maxWidth) return { fontSize, spacing: 0 };
    } else {
      const naturalWidth = sumW + NORMAL_SPACING * (n - 1);
      if (naturalWidth <= maxWidth) return { fontSize, spacing: NORMAL_SPACING };
      const required = (maxWidth - sumW) / (n - 1);
      if (required >= minSpacingEm * fontSize) {
        return { fontSize, spacing: required };
      }
    }
    fontSize -= 1;
  }
  // Pathologically long text: even the smallest font size at spacing=0
  // still overflows. Scale the font size down further (spacing stays 0,
  // never negative) so the line never spills outside its box.
  let sumW = 0;
  for (const ch of chars) sumW += measureChar(ctx, ch, MIN_FONT_SIZE);
  if (sumW > maxWidth && sumW > 0) {
    return { fontSize: MIN_FONT_SIZE * (maxWidth / sumW), spacing: 0 };
  }
  return { fontSize: MIN_FONT_SIZE, spacing: 0 };
}

// strokeW > 0 thickens the glyphs with a same-colour round-joined outline
// (the font has no heavier weight to switch to).
function drawSpacedText(ctx, text, centerX, y, fontSize, spacing, fillColor, strokeW = 0) {
  if (!text) return;
  const total = measureWithSpacing(ctx, text, spacing, fontSize);
  let cx = centerX - total / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fillColor;
  if (strokeW > 0) {
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = strokeW;
    ctx.lineJoin = 'round';
  }
  for (const ch of text) {
    const w = measureChar(ctx, ch, fontSize);
    if (strokeW > 0) ctx.strokeText(ch, cx, y);
    ctx.fillText(ch, cx, y);
    cx += w + spacing;
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
// The header bar / gradient artwork is the real Canva-exported template PNG,
// composited as-is (never redrawn) on top of the photos. showHeader picks
// which of the two provided template pages to use: the one with the yellow
// "熱門話題" bar and icon baked in, or the plain page (top vignette, no bar)
// for slides that don't repeat the header.
function drawTemplateOverlay(ctx, showHeader) {
  if (mode === 'grid4') return;   // 四格 A 沒有疊圖，只有底色與說明條
  if (mode === 'ent') {
    if (templateEntImg) ctx.drawImage(templateEntImg, 0, 0, CANVAS_W, CANVAS_H);
    return;
  }
  const img = newsTemplate(showHeader);
  if (!img) return;
  // Exporting at an exact multiple of the template: copy its pixels as they are (no re-smoothing).
  ctx.save();
  if (templateNearest) ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
  if (showHeader) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_W, HEADER_TOP_LINE_H);
  }
}

// The label text ("熱門話題" by default) is not baked into the template PNG
// (only the icon is), so it's still drawn dynamically on top of it.
function drawHeaderLabel(ctx, label) {
  if (!label) return;
  // Measured directly from the template PNG's baked-in speaker icon (its
  // right edge sits at x=68 in the 1040-wide canvas) plus the gap seen in
  // the reference design — not a formula guess, since a formula estimate of
  // the icon's width drifts from the real asset and misplaces the label.
  const iconRightEdge = 68, labelGap = 33;
  const labelStartX = iconRightEdge + labelGap;
  const maxLabelWidth = CANVAS_W - labelStartX - 20;
  const fit = computeFit(ctx, label, maxLabelWidth, 38);
  ctx.font = `900 ${fit.fontSize}px ${FONT_STACK}`;
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'left';
  // actualBoundingBoxAscent/Descent are measured relative to whatever
  // textBaseline is active at the time of measureText() — this must be set
  // to 'alphabetic' *before* measuring, or a leftover 'middle' from drawing
  // the cell headlines skews the ink bounds and the centering math below.
  ctx.textBaseline = 'alphabetic';

  // canvas 'middle' baseline centers on the font's em-box, not the glyphs'
  // actual ink — for this font that sits visibly above the bar's true
  // center. Measure the real ink bounds and center on those instead.
  const m = ctx.measureText(label);
  const asc = m.actualBoundingBoxAscent || fit.fontSize * 0.72;
  const desc = m.actualBoundingBoxDescent || fit.fontSize * 0.02;
  // Center on the visible yellow area only (below the black top line), not
  // the full HEADER_H — otherwise the top line's own height silently eats
  // into the bar and the text reads as drifted upward.
  const yellowTop = HEADER_TOP_LINE_H;
  const baselineY = yellowTop + (HEADER_H - yellowTop) / 2 + (asc - desc) / 2 + 3;
  let cx = labelStartX;
  for (const ch of label) {
    const w = measureChar(ctx, ch, fit.fontSize);
    ctx.fillText(ch, cx, baselineY);
    cx += w + fit.spacing;
  }
}

// Optional small kicker tag (e.g. "關鍵竟是房東") that sits flush to the
// cell's left edge, directly above the headline block. Unlike line 1/2 it
// is never stretched to fill the width — it just shrinks to fit if needed.
// Background is either red or gray (state.tagColor), chosen per card.
const TAG_BASE_FONT_SIZE = 28;
const TAG_PAD_X = 10, TAG_PAD_Y = 6, TAG_GAP = 4;

function drawTag(ctx, t, bgColor) {
  const { text, fontSize, spacing, left, top, boxW, boxH } = t;
  ctx.fillStyle = bgColor;
  ctx.fillRect(left, top, boxW, boxH);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  let cx = left + TAG_PAD_X;
  const cy = top + boxH / 2;
  for (const ch of text) {
    const w = measureChar(ctx, ch, fontSize);
    ctx.fillText(ch, cx, cy);
    cx += w + spacing;
  }
}

// Face-covering stickers: freely draggable/scalable per instance, stored as
// canvas-space center coordinates so drag/scale math stays a simple delta.
const STICKER_MIN_SCALE = 0.3, STICKER_MAX_SCALE = 3;
const STICKER_DELETE_R = 14;
// The actual click/tap target is bigger than the visible circle — a small
// dot at the sticker's corner is hard to land on precisely, especially on
// touch, so the invisible hit area extends past what's drawn.
const STICKER_DELETE_HIT_R = 22;

// The source PNGs aren't perfectly square (e.g. 221×192), so `scale` sizes a
// bounding box and the sticker is fit inside it at its own aspect ratio —
// never stretched to fill a square, on drag, scale, or hit-testing alike.
function stickerDrawSize(st, img) {
  const box = STICKER_BASE_SIZE * st.scale;
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const fit = box / Math.max(iw, ih);
  return { w: iw * fit, h: ih * fit };
}

function drawCellStickers(ctx, state, interactive) {
  const list = state.stickers;
  if (!list || !list.length) return;
  for (const st of list) {
    const img = stickerImages[st.key];
    if (!img) continue;
    const { w, h } = stickerDrawSize(st, img);
    ctx.drawImage(img, st.x - w / 2, st.y - h / 2, w, h);
    if (interactive) {
      const bx = st.x + w / 2 - STICKER_DELETE_R;
      const by = st.y - h / 2 + STICKER_DELETE_R;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, STICKER_DELETE_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,20,20,0.65)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      const r = 5;
      ctx.beginPath();
      ctx.moveTo(bx - r, by - r); ctx.lineTo(bx + r, by + r);
      ctx.moveTo(bx + r, by - r); ctx.lineTo(bx - r, by + r);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// Hit-tests topmost-first (last added draws on top) so overlapping stickers
// resolve to whichever one is visually in front.
function stickerHit(state, x, y) {
  const list = state.stickers;
  if (!list) return -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i];
    const img = stickerImages[st.key];
    if (!img) continue;
    const { w, h } = stickerDrawSize(st, img);
    if (Math.abs(x - st.x) <= w / 2 && Math.abs(y - st.y) <= h / 2) return i;
  }
  return -1;
}

function stickerDeleteHit(state, x, y) {
  const list = state.stickers;
  if (!list) return -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i];
    const img = stickerImages[st.key];
    if (!img) continue;
    const { w, h } = stickerDrawSize(st, img);
    const bx = st.x + w / 2 - STICKER_DELETE_R;
    const by = st.y - h / 2 + STICKER_DELETE_R;
    const dx = x - bx, dy = y - by;
    if (dx * dx + dy * dy <= STICKER_DELETE_HIT_R * STICKER_DELETE_HIT_R) return i;
  }
  return -1;
}

function clampStickerPos(cell, st) {
  st.x = clamp(st.x, cell.x, cell.x + cell.w);
  st.y = clamp(st.y, cell.y, cell.y + cell.h);
}

function drawCellImage(ctx, cell, state) {
  if (!state.img) {
    ctx.fillStyle = '#c7cbd1';
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    ctx.fillStyle = '#8b909a';
    ctx.font = `14px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('點擊或拖曳上傳圖片', cell.x + cell.w / 2, cell.y + cell.h / 2);
    return;
  }
  const { dw, dh } = cellImageSize(cell, state);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cell.x, cell.y, cell.w, cell.h);
  ctx.clip();
  ctx.drawImage(state.img, 0, 0, state.img.width, state.img.height,
    cell.x + state.offsetX, cell.y + state.offsetY, dw, dh);
  ctx.restore();
}

function cellImageSize(cell, state) {
  const baseScale = Math.max(cell.w / state.img.width, cell.h / state.img.height);
  const eff = baseScale * state.scale;
  return { dw: state.img.width * eff, dh: state.img.height * eff };
}

const IMG_OVERSHOOT = 0.07;
function clampCardOffset(i) {
  const state = activePage().cards[i];
  if (!state.img) return;
  const cell = cellRect(i, activePage().showHeader);
  const { dw, dh } = cellImageSize(cell, state);
  // The photo may be pushed past the cell by IMG_OVERSHOOT of its own size on
  // every side (leaving white showing), so someone at the photo's edge can be
  // brought toward the middle when zoomed in.
  const mx = dw * IMG_OVERSHOOT, my = dh * IMG_OVERSHOOT;
  state.offsetX = clamp(state.offsetX, cell.w - dw - mx, mx);
  state.offsetY = clamp(state.offsetY, cell.h - dh - my, my);
  state.fx = dw > 0 ? (cell.w / 2 - state.offsetX) / dw : 0.5;
  state.fy = dh > 0 ? (cell.h / 2 - state.offsetY) / dh : 0.5;
}

function applyScale(i, newScale) {
  const state = activePage().cards[i];
  state.scale = clamp(newScale, 1, 3.5);
  if (!state.img) return;
  const cell = cellRect(i, activePage().showHeader);
  const { dw, dh } = cellImageSize(cell, state);
  state.offsetX = cell.w / 2 - state.fx * dw;
  state.offsetY = cell.h / 2 - state.fy * dh;
  clampCardOffset(i);
}

function computeCardFit(ctx, cell, state) {
  // The text box runs flush to the cell's left/right grid lines — no side
  // padding — so natural-spacing text can fill all the way to the edge
  // before compression ever kicks in.
  const maxWidth = cell.w;
  const line1 = (state.line1 || '').trim();
  const line2 = (state.line2 || '').trim();
  const tag = (state.tag || '').trim();
  const tag2 = (state.tag2 || '').trim();
  const key = `${cell.w}|${line1}|${line2}|${tag}|${tag2}`;
  if (state._fitCache && state._fitCache.key === key) return state._fitCache;

  const fit1 = line1 ? computeFit(ctx, line1, maxWidth, BASE_FONT_SIZE) : null;
  const fit2 = line2 ? computeFit(ctx, line2, maxWidth, BASE_FONT_SIZE) : null;
  const tagMaxWidth = cell.w - 20;
  const tagFit = tag ? computeFit(ctx, tag, tagMaxWidth, TAG_BASE_FONT_SIZE) : null;
  const tag2Fit = tag2 ? computeFit(ctx, tag2, tagMaxWidth, TAG_BASE_FONT_SIZE) : null;

  const result = {
    key, line1, line2, tag, tag2,
    tag2FontSize: tag2Fit ? tag2Fit.fontSize : TAG_BASE_FONT_SIZE,
    tag2Spacing: tag2Fit ? tag2Fit.spacing : NORMAL_SPACING,
    fontSize1: fit1 ? fit1.fontSize : BASE_FONT_SIZE,
    sp1: fit1 ? fit1.spacing : 0,
    fontSize2: fit2 ? fit2.fontSize : BASE_FONT_SIZE,
    sp2: fit2 ? fit2.spacing : 0,
    tagFontSize: tagFit ? tagFit.fontSize : TAG_BASE_FONT_SIZE,
    tagSpacing: tagFit ? tagFit.spacing : NORMAL_SPACING,
  };
  state._fitCache = result;
  return result;
}

// The headline block of a 新聞 cell hangs from this y (its bottom edge). Bottom row: the cell's own bottom.
// Top row: the headline sits in the black band that runs on below the cell, down to where the lower row's
// photo starts to show (measured off the template PNGs: 432 with the yellow bar, 414 without), so it is
// moved down to end TOP_ROW_TEXT_GAP px above that edge. Tags, the blue/red frames and the copy button
// are all measured from the headline, so they follow.
const TOP_ROW_TEXT_GAP = 5;
const NEWS_BAND_EDGE = { [ROW_EDGES_HEADER[0]]: 432, [ROW_EDGES_PLAIN[0]]: 414 };
function newsTextBottom(cell) {
  const edge = NEWS_BAND_EDGE[cell.y];
  // The ink of the last line ends 6px above this y (4px padding + the glyph's own side bearing), so
  // y = edge - (gap - 5) leaves exactly `gap` px of black below the text.
  return edge === undefined ? cell.y + cell.h : edge - (TOP_ROW_TEXT_GAP - 5);
}
// The template's black gradient over the photos (it fades in from clear to solid black, 55px tall, just
// above the headline) was drawn for headlines at the old height. With the top row's headlines lower, the
// top row's gradient is slid down so that it starts the same distance above the bottom-left tag as the
// bottom row's does (the tag sits that far into the gradient). The solid black band below it is shortened
// to fit, so its lower edge (NEWS_BAND_EDGE) does not move. Both the drawn template and the 露白 visibility
// map use this adjusted copy.
const NEWS_GRADIENT_TOP = { h: 263, p: 247 };       // first row of the top-row gradient in each template PNG
const NEWS_GRADIENT_TOP_ROW2 = { h: 648, p: 645 };  // same for the bottom row (left as drawn)
// top of the default bottom-left tag of a two-line headline at the standard sizes (see newsTagLimitBottom)
function stdTagTop(textBottom) {
  return textBottom - 4 - BASE_FONT_SIZE * 0.5 - BASE_FONT_SIZE * 1.18 - BASE_FONT_SIZE * 0.5 - TAG_GAP - (TAG_BASE_FONT_SIZE + TAG_PAD_Y * 2);
}
const newsTemplateCache = new Map();
function newsTemplate(showHeader) {
  const img = showHeader ? templateHeaderImg : templatePlainImg;
  if (!img) return null;
  const key = showHeader ? 'h' : 'p';
  if (newsTemplateCache.has(key)) return newsTemplateCache.get(key);
  const rowTop = showHeader ? ROW_EDGES_HEADER[0] : ROW_EDGES_PLAIN[0];
  const edge = NEWS_BAND_EDGE[rowTop];
  const gTop = NEWS_GRADIENT_TOP[key];
  const rows = showHeader ? ROW_EDGES_HEADER : ROW_EDGES_PLAIN;
  const lead2 = stdTagTop(rows[2]) - NEWS_GRADIENT_TOP_ROW2[key];          // bottom row: gradient starts this far above the tag
  const gradTarget = Math.round(stdTagTop(newsTextBottom({ y: rowTop, h: 0 })) - lead2);   // where the top row's gradient should start
  const d = gradTarget - gTop;
  let out = img;
  if (d > 0) {
    const c = document.createElement('canvas');
    c.width = NEWS_W; c.height = NEWS_H;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, NEWS_W, NEWS_H);
    x.clearRect(0, gTop, NEWS_W, edge - gTop);
    // rows [gTop, edge - d) of the template move down to [gradTarget, edge)
    x.drawImage(img, 0, gTop, NEWS_W, edge - d - gTop, 0, gradTarget, NEWS_W, edge - d - gTop);
    out = c;
  }
  newsTemplateCache.set(key, out);
  return out;
}
// The whole area of a cell as the viewer sees it (step 2's selection highlight and the copy button's
// centre): 新聞 from the top of the visible photo to the lower edge of the cell's black band; 娛樂 is its quarter of the page.
function stepTwoCellRect(i, showHeader) {
  if (mode === 'grid4') return { ...G4_CELLS[i] };
  if (mode === 'ent') {
    const w = CANVAS_W / 2, h = CANVAS_H / 2;
    return { x: (i % 2) * w, y: Math.floor(i / 2) * h, w, h };
  }
  const cell = cellRect(i, showHeader);
  // from where the cell starts to show (below the yellow bar's edge / the upper row's black band) ...
  const top = cardVisibleWindow(cell, showHeader).top;
  // ... to the lower edge of its own black band (the top row's band runs on below the cell)
  const edge = NEWS_BAND_EDGE[cell.y];
  const bottom = edge === undefined ? cell.y + cell.h : edge;
  return { x: cell.x, y: top, w: cell.w, h: bottom - top };
}
function drawCellText(ctx, cell, state) {
  const paddingBottom = 4;
  const centerX = cell.x + cell.w / 2;
  const { line1, line2, fontSize1, sp1, fontSize2, sp2 } = computeCardFit(ctx, cell, state);

  // Anchored off BASE_FONT_SIZE (not this cell's own fontSize1/2, which may
  // have shrunk to fit long text) so line 1 and line 2 land at the exact
  // same height in every cell of a row — a cell with a long, shrunk title
  // still lines up with its neighbors instead of sitting lower/higher.
  const bottomAnchor = newsTextBottom(cell) - paddingBottom - BASE_FONT_SIZE * 0.5;
  const lineGap = BASE_FONT_SIZE * 1.18;

  let baseY1 = null, baseY2 = null;
  if (line1 && line2) {
    baseY2 = bottomAnchor;
    baseY1 = baseY2 - lineGap;
    drawSpacedText(ctx, line2, centerX, baseY2, fontSize2, sp2, state.color2);
    drawSpacedText(ctx, line1, centerX, baseY1, fontSize1, sp1, state.color1);
  } else if (line2) {
    baseY2 = bottomAnchor;
    drawSpacedText(ctx, line2, centerX, baseY2, fontSize2, sp2, state.color2);
  } else if (line1) {
    baseY1 = bottomAnchor;
    drawSpacedText(ctx, line1, centerX, baseY1, fontSize1, sp1, state.color1);
  }

  const t1 = newsTagLayout(ctx, cell, state, 1);
  if (t1) drawTag(ctx, t1, state.tagColor || TAG_COLORS[0]);
  const t2 = newsTagLayout(ctx, cell, state, 2);
  if (t2) drawTag(ctx, t2, state.tag2Color || TAG_COLORS[0]);
}

// Where tag n (1 or 2) of a 新聞 cell sits. Tag 1 defaults to the cell's
// bottom-left, right above the headline; tag 2 to the cell's top-right. Each
// can be dragged: `tagPos`/`tag2Pos` hold the offset from that default.
const TAG_SNAP = 14;
// The template's photo windows start below a dark band (the shadow under the
// yellow header bar, the black strip between the two rows, the faint top
// vignette on the plain page). Tags stay below it. Keyed by a cell's top y;
// numbers measured off the template PNGs' transparent windows plus a few px.
const TAG_TOP_LIMITS = {
  [ROW_EDGES_HEADER[0]]: 60, [ROW_EDGES_HEADER[1]]: 434,
  [ROW_EDGES_PLAIN[0]]: 26, [ROW_EDGES_PLAIN[1]]: 416,
};
function newsTagLimitTop(cell) { return TAG_TOP_LIMITS[cell.y] ?? cell.y; }
function newsTagLayout(ctx, cell, state, n) {
  const f = computeCardFit(ctx, cell, state);
  const text = n === 1 ? f.tag : f.tag2;
  if (!text) return null;
  const fontSize = n === 1 ? f.tagFontSize : f.tag2FontSize;
  const spacing = n === 1 ? f.tagSpacing : f.tag2Spacing;
  const boxH = fontSize + TAG_PAD_Y * 2;
  const boxW = Math.min(cell.w, measureWithSpacing(ctx, text, spacing, fontSize) + TAG_PAD_X * 2);
  const limit = newsTagLimitBottom(cell, f);
  let defLeft, defTop;
  if (n === 1) {
    defLeft = cell.x;
    defTop = limit - boxH;
  } else {
    defLeft = cell.x + cell.w - boxW;
    defTop = newsTagLimitTop(cell);
  }
  const pos = n === 1 ? state.tagPos : state.tag2Pos;
  // Re-clamped every time (not just while dragging), so a tag dragged earlier
  // never ends up over the headline after the headline grows to two lines.
  return { n, text, fontSize, spacing, boxW, boxH, defLeft, defTop, limit,
    left: clamp(defLeft + (pos ? pos.dx : 0), cell.x, cell.x + cell.w - boxW),
    top: clamp(defTop + (pos ? pos.dy : 0), newsTagLimitTop(cell), Math.max(newsTagLimitTop(cell), limit - boxH)) };
}

// Tags live between the header bar's shadow (see newsTagLimitTop) and the headline:
// this is the y just above the headline block, where tag 1 sits by default
// and the lowest a tag may reach.
function newsTagLimitBottom(cell, f) {
  const tb = newsTextBottom(cell);
  const topLineBaseline = f.line1 ? tb - 4 - BASE_FONT_SIZE * 0.5 - (f.line2 ? BASE_FONT_SIZE * 1.18 : 0)
    : f.line2 ? tb - 4 - BASE_FONT_SIZE * 0.5
    : tb - 4;
  const topLineFontSize = f.line1 ? f.fontSize1 : f.fontSize2;
  return topLineBaseline - topLineFontSize * 0.5 - TAG_GAP;
}

// The part of a 新聞 cell that shows the photo, as drawn by both the blue selection frame and the red
// 「檢查照片邊緣」 frame: from where the photo starts to show (below the header bar / the upper row's black
// text band) down to the top of the first headline line (the small tag's lower edge).
function newsPhotoFrame(ctx, cell, state, showHeader) {
  const top = cardVisibleWindow(cell, showHeader).top;
  // Measured from the standard font size (like the headline's own baseline), not this cell's possibly
  // shrunk one, so the frames of a row all end at the same height.
  const hasLine1 = !!(state.line1 || '').trim(), hasLine2 = !!(state.line2 || '').trim();
  const tb = newsTextBottom(cell);
  const bottomAnchor = tb - 4 - BASE_FONT_SIZE * 0.5;
  const topLineBaseline = hasLine1 ? bottomAnchor - (hasLine2 ? BASE_FONT_SIZE * 1.18 : 0)
    : hasLine2 ? bottomAnchor : tb - 4;
  const bottom = topLineBaseline - BASE_FONT_SIZE * 0.5 - TAG_GAP;
  return { top, bottom: clamp(bottom, top + 24, tb) };
}

// Topmost tag under the point (tag 2 is drawn last, so it wins).
function newsTagHit(ctx, cell, state, x, y) {
  for (const n of [2, 1]) {
    const t = newsTagLayout(ctx, cell, state, n);
    if (t && x >= t.left && x <= t.left + t.boxW && y >= t.top && y <= t.top + t.boxH) return n;
  }
  return 0;
}

// New offset for a tag dragged by (dx,dy) from `startPos`: its edges snap
// flush to the cell's edges when within TAG_SNAP (no guide lines are drawn),
// and it always stays inside its own cell, above the headline.
function newsTagDragTo(ctx, cell, state, n, startPos, dx, dy) {
  const t = newsTagLayout(ctx, cell, state, n);
  let left = t.defLeft + (startPos ? startPos.dx : 0) + dx;
  let top = t.defTop + (startPos ? startPos.dy : 0) + dy;
  const snap = (lo, hi, a, b) => {
    const cands = [a - lo, b - hi];
    const best = cands.reduce((m, d) => Math.abs(d) < Math.abs(m) ? d : m, cands[0]);
    return Math.abs(best) <= TAG_SNAP ? best : 0;
  };
  left += snap(left, left + t.boxW, cell.x, cell.x + cell.w);
  const minTop = newsTagLimitTop(cell);
  top += snap(top, top + t.boxH, minTop, t.limit);
  left = clamp(left, cell.x, cell.x + cell.w - t.boxW);
  top = clamp(top, minTop, Math.max(minTop, t.limit - t.boxH));
  return { dx: left - t.defLeft, dy: top - t.defTop };
}

// 娛樂 uses the exact same fit rules as 新聞 (computeFit: natural spacing →
// squeeze spacing to 0 → drop font size), just with its own text boxes.
function computeEntFit(ctx, i, state) {
  const c = ENT_CELLS[i];
  const line1 = (state.line1 || '').trim();
  const line2 = (state.line2 || '').trim();
  const tag = (state.tag || '').trim();
  const key = `ent|${i}|${line1}|${line2}|${tag}`;
  if (state._fitCache && state._fitCache.key === key) return state._fitCache;
  const maxWidth = c.hw * 2 - ENT_TEXT_STROKE;
  const fit1 = line1 ? computeFit(ctx, line1, maxWidth, ENT_BASE_FONT_SIZE, ENT_MIN_SPACING_EM) : null;
  const fit2 = line2 ? computeFit(ctx, line2, maxWidth, ENT_BASE_FONT_SIZE, ENT_MIN_SPACING_EM) : null;
  const tagFit = tag ? computeFit(ctx, tag, maxWidth * 0.8 - ENT_TAG_PAD_X * 2, ENT_TAG_BASE_FONT_SIZE) : null;
  const result = {
    key, line1, line2, tag,
    fontSize1: fit1 ? fit1.fontSize : ENT_BASE_FONT_SIZE,
    sp1: fit1 ? fit1.spacing : 0,
    fontSize2: fit2 ? fit2.fontSize : ENT_BASE_FONT_SIZE,
    sp2: fit2 ? fit2.spacing : 0,
    tagFontSize: tagFit ? tagFit.fontSize : ENT_TAG_BASE_FONT_SIZE,
    tagSpacing: tagFit ? tagFit.spacing : NORMAL_SPACING,
  };
  state._fitCache = result;
  return result;
}

// Line y positions are fixed per frame (not derived from the fitted font
// size), so a shrunk long headline still sits on the same lines as the
// sample. A lone line is centered on the sticky note instead of hugging one
// of the two slots.
function drawEntCellText(ctx, i, state) {
  const c = ENT_CELLS[i];
  const f = computeEntFit(ctx, i, state);
  const sw = ENT_TEXT_STROKE;
  if (f.line1 && f.line2) {
    drawSpacedText(ctx, f.line1, c.cx, c.y1 + ENT_INK_DY, f.fontSize1, f.sp1, state.color1, sw);
    drawSpacedText(ctx, f.line2, c.cx, c.y2 + ENT_INK_DY, f.fontSize2, f.sp2, state.color2, sw);
  } else if (f.line1 || f.line2) {
    const midY = (c.y1 + c.y2) / 2 + ENT_INK_DY;
    if (f.line1) drawSpacedText(ctx, f.line1, c.cx, midY, f.fontSize1, f.sp1, state.color1, sw);
    else drawSpacedText(ctx, f.line2, c.cx, midY, f.fontSize2, f.sp2, state.color2, sw);
  }
  if (f.tag) drawEntTag(ctx, c, f.tag, f.tagFontSize, f.tagSpacing, state.tagColor || TAG_COLORS[0]);
}

// Canvas 'middle' centers the em box, not the ink; measured offset that puts
// this font's ink center on the sample text's ink center.
const ENT_INK_DY = 0;

// Torn-tape outline from the reference tag artwork: straight top/bottom,
// wavy left/right ends whose curves scale with the tape's height only, so
// the tape stretches horizontally to fit any text without distorting them.
function traceTapePath(ctx, w, h) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y0);
  ctx.bezierCurveTo(x1 - 0.16 * h, y0 + 0.3 * h, x1 + 0.06 * h, y0 + 0.62 * h, x1 - 0.04 * h, y1);
  ctx.lineTo(x0 - 0.05 * h, y1);
  ctx.bezierCurveTo(x0 + 0.14 * h, y1 - 0.3 * h, x0 - 0.04 * h, y1 - 0.66 * h, x0, y0);
  ctx.closePath();
}

// Blue torn-tape kicker tag, tilted like the reference, sitting on the top
// edge of the frame's sticky note. The text is tilted along with the tape.
function drawEntTag(ctx, c, text, fontSize, spacing, bgColor) {
  const textW = measureWithSpacing(ctx, text, spacing, fontSize);
  const boxW = textW + ENT_TAG_PAD_X * 2;
  const boxH = fontSize + ENT_TAG_PAD_Y * 2;
  const cxBox = c.tagX + boxW / 2;
  const cyBox = c.tagBottom - boxH / 2;
  ctx.save();
  ctx.translate(cxBox, cyBox);
  ctx.rotate(ENT_TAG_ROTATE);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = bgColor;
  traceTapePath(ctx, boxW, boxH);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  drawSpacedText(ctx, text, 0, ENT_INK_DY, fontSize, spacing, '#ffffff');
  ctx.restore();
}

// 四格 A 的說明條：格左下內縮 24px、圓角 8、#202124 不透明度 .88、高 60；字 36px 粗 700；左右內距 16px。
// 說明留空就不畫；字太長時縮小字級，讓底條不超出格子。
function drawGrid4Caption(ctx, cell, text, color) {
  text = (text || '').trim();
  if (!text) return;
  const { inset, h, padX, radius } = G4_CAP;
  const maxW = cell.w - inset * 2;
  let fontSize = G4_CAP.font;
  ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
  let tw = ctx.measureText(text).width;
  if (tw + padX * 2 > maxW) {
    fontSize = Math.max(12, Math.floor(fontSize * (maxW - padX * 2) / tw));
    ctx.font = `700 ${fontSize}px ${FONT_STACK}`;
    tw = ctx.measureText(text).width;
  }
  const bw = Math.min(maxW, tw + padX * 2);
  const x = cell.x + inset, y = cell.y + cell.h - inset - h;
  ctx.save();
  ctx.fillStyle = G4_CAP.bar;
  ctx.beginPath();
  ctx.roundRect(x, y, bw, h, radius);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.restore();
}

function renderTo(ctx, renderMode, pageState, opts = {}) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  if (renderMode === 'final') {
    ctx.fillStyle = mode === 'grid4' ? (pageState.bg || '#ffffff') : '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < CELL_COUNT; i++) drawCellImage(ctx, cellRect(i, pageState.showHeader), pageState.cards[i]);
  }
  drawTemplateOverlay(ctx, pageState.showHeader);
  if (renderMode === 'final') {
    for (let i = 0; i < CELL_COUNT; i++) drawCellStickers(ctx, pageState.cards[i], opts.interactive && !isLocked());
    for (let i = 0; i < CELL_COUNT; i++) {
      if (mode === 'grid4') drawGrid4Caption(ctx, cellRect(i), pageState.cards[i].line1, pageState.capColor || '#ffffff');
      else if (mode === 'ent') drawEntCellText(ctx, i, pageState.cards[i]);
      else if (mode === 'news') drawCellText(ctx, cellRect(i, pageState.showHeader), pageState.cards[i]);
    }
    if (pageState.showHeader) drawHeaderLabel(ctx, pageState.topLabel || '熱門話題');
  }
  // On-screen aids only (never exported):
  //  - 步驟 1 with the 「檢查照片邊緣」 switch on: a red frame around the part of each cell where the
  //    photo can be seen — just a reference while editing, nothing is checked or flagged here.
  //  - 步驟 2: the check itself — a circled "!" on every cell that needs a look (red when something
  //    is missing, yellow when the photo shows white).
  if (opts.interactive && !isLocked() && edgeCheckOn) {
    if (mode === 'ent') {
      for (let i = 0; i < CELL_COUNT; i++) {
        const ov = entCheckOverlay(i);
        if (ov) { const cell = cellRect(i, pageState.showHeader); ctx.drawImage(ov, cell.x, cell.y); }
      }
    } else {
      for (let i = 0; i < CELL_COUNT; i++) {
        const cell = cellRect(i, pageState.showHeader);
        const fr = mode === 'news' ? newsPhotoFrame(ctx, cell, pageState.cards[i], pageState.showHeader) : { top: cell.y, bottom: cell.y + cell.h };
        ctx.save();
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 3;
        ctx.strokeRect(cell.x + 1.5, fr.top + 1.5, cell.w - 3, fr.bottom - fr.top - 3);
        ctx.restore();
      }
    }
  }
  if (opts.interactive && isLocked()) {
    for (let i = 0; i < CELL_COUNT; i++) {
      const kind = cardBadgeKind(pageState, i);
      if (!kind) continue;
      const missing = kind === 'bad';
      const { x: bx, y: by } = badgeAnchor(i, pageState.showHeader);
      ctx.save();
      ctx.beginPath(); ctx.arc(bx, by, 15, 0, Math.PI * 2);
      ctx.fillStyle = missing ? '#dc2626' : '#facc15'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = missing ? '#ffffff' : '#1f2328'; ctx.stroke();
      ctx.fillStyle = missing ? '#ffffff' : '#1f2328'; ctx.font = `800 20px ${FONT_STACK}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', bx, by + 1);
      ctx.restore();
    }
  }

  if (opts.showHeaderBorder && headerSelected && pageState.showHeader) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,74,173,0.9)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, CANVAS_W - 3, HEADER_H - 3);
    ctx.restore();
  }
  if (opts.showActiveBorder && cellSelected && activeCard != null && activeCard >= 0 && activeCard < CELL_COUNT) {
    const cell = cellRect(activeCard, pageState.showHeader);
    if (isLocked()) {
      // 步驟 2: no frame; the whole cell is just dimmed (black at 10%).
      const rc = stepTwoCellRect(activeCard, pageState.showHeader);
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
      ctx.restore();
    } else {
      // 新聞: the frame marks the photo you can see, not the text area (same range as the red edge-check frame).
      let frameTop = cell.y, frameBottom = cell.y + cell.h;
      if (mode === 'news') {
        const fr = newsPhotoFrame(ctx, cell, pageState.cards[activeCard], pageState.showHeader);
        frameTop = fr.top; frameBottom = fr.bottom;
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(0,74,173,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeRect(cell.x + 1.5, frameTop + 1.5, cell.w - 3, frameBottom - frameTop - 3);
      ctx.restore();
    }
  }
}
// >>> 原檔 2989-3376
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function render() {
  renderTo(ctx, 'final', activePage(), { showActiveBorder: true, showHeaderBorder: true, interactive: true });
  syncDockContext();
  updateDownloadState();
}

// ---------------------------------------------------------------------------
// Left-panel card UI
// ---------------------------------------------------------------------------
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;
function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(file.name || '');
}

function loadImageFile(file, onLoaded, onError) {
  if (!isImageFile(file)) { if (onError) onError(`無法辨識「${file ? file.name : ''}」為圖片檔`); return; }
  const reader = new FileReader();
  reader.onerror = () => onError && onError(`讀取「${file.name}」失敗，請換一張圖片`);
  reader.onload = e => {
    const image = new Image();
    image.onerror = () => onError && onError(`「${file.name}」無法開啟，可能是不支援的圖片格式`);
    image.onload = () => onLoaded(image, file.name);
    image.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Puts a photo into cell i of any page (not only the visible one). Photos the
// user picks are 'manual'; ones quick fill fetched are 'auto', which a later
// quick fill may replace while leaving manual ones alone.
function setCardImageAt(pageIdx, i, image, fileName, source = 'manual') {
  const pg = pages[pageIdx];
  const state = pg.cards[i];
  state.img = image;
  state.imgSource = source;
  state.fileName = fileName;
  state.scale = 1;
  state.fx = 0.5;
  state.fy = 0.5;
  const cell = cellRect(i, pg.showHeader);
  const { dw, dh } = cellImageSize(cell, state);
  state.offsetX = (cell.w - dw) / 2;
  state.offsetY = (cell.h - dh) / 2;
  if (pageIdx === activePageIndex) refreshCardThumb(i);
  render();
  if (isLocked()) syncChrome();
}
function setCardImage(i, image, fileName) { setCardImageAt(activePageIndex, i, image, fileName, 'manual'); }

const cellsList = document.getElementById('cellsList');
let cardEls = [];
let cellsHost = cellsList;   // 目前版面的格子編輯面板容器（每個版面各一個，切換只改 hidden）

function buildCardUI(i) {
  const box = document.createElement('div');
  box.className = 'cell-box';
  box.dataset.index = i;

  const head = document.createElement('div');
  head.className = 'cell-head';
  head.innerHTML = `<span class="cell-name">第 ${i + 1} ${L().cellNoun || '格'}</span><span class="cell-tag">${CELL_LABELS[i] || ''}</span>`;
  box.appendChild(head);

  const dz = document.createElement('div');
  dz.className = 'dropzone';
  const dzThumb = document.createElement('img');
  dzThumb.className = 'dz-thumb';
  const dzText = document.createElement('div');
  dzText.className = 'dz-text';
  dzText.textContent = '點擊、拖曳圖片，或先點此格再貼上（Ctrl+V）';
  const fi = document.createElement('input');
  fi.type = 'file';
  fi.accept = 'image/*';
  dz.appendChild(dzThumb);
  dz.appendChild(dzText);
  dz.appendChild(fi);
  // 複製推播連結 is not offered while editing; in step 2 it floats over the hovered cell.
  const dzRow = document.createElement('div');
  dzRow.className = 'dz-row';
  dzRow.appendChild(dz);
  box.appendChild(dzRow);

  function handleFile(file) {
    loadImageFile(file, (image, name) => {
      setCardImage(i, image, name);
      dzThumb.src = image.src;
      dzThumb.style.display = 'block';
      dzText.textContent = `已載入：${name}`;
    }, msg => { dzText.textContent = msg; });
  }

  dz.addEventListener('click', () => { setActiveCard(i); fi.click(); });
  fi.addEventListener('change', e => handleFile(e.target.files[0]));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); setActiveCard(i); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag');
    setActiveCard(i);
    handleFile(e.dataTransfer.files[0]);
  });

  // Each field's color row sits ABOVE its text input, label (field name) on
  // the left and the color picker on the right; the palette itself defaults
  // to collapsed (just a small dot showing the current color) so the panel
  // isn't dominated by swatches — clicking the label/dot reveals it.
  function buildSwatchRow(labelText, colorKey, palette, opts = {}) {
    const row = document.createElement('div');
    row.className = 'swatch-row field-header';
    if (opts.collapsible) row.classList.add('collapsed');
    const label = document.createElement('span');
    label.className = 'swatch-label';
    label.textContent = labelText;
    row.appendChild(label);
    let indicator = null;
    if (opts.collapsible) {
      indicator = document.createElement('span');
      indicator.className = 'swatch-indicator';
      indicator.style.background = activePage().cards[i][colorKey];
      indicator.title = '點擊選擇顏色';
      row.appendChild(indicator);
      // Listen on the whole row (not just the label/dot) so clicking
      // anywhere in the header toggles it — a small hit target there is an
      // easy miss to click past.
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => row.classList.toggle('collapsed'));
    }
    const els = [];
    palette.forEach(hex => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch';
      sw.style.background = hex;
      sw.title = hex;
      if (hex.toLowerCase() === activePage().cards[i][colorKey].toLowerCase()) sw.classList.add('selected');
      sw.addEventListener('click', e => {
        // Stop the row's own toggle listener from firing too, which would
        // immediately re-collapse the palette right after picking a color.
        e.stopPropagation();
        setActiveCard(i);
        activePage().cards[i][colorKey] = hex;
        els.forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        if (indicator) indicator.style.background = hex;
        render();
      });
      els.push(sw);
      row.appendChild(sw);
    });
    return { row, els, indicator };
  }

  const scaleRow = document.createElement('div');
  scaleRow.className = 'scale-row';
  const scaleLabelWrap = document.createElement('span');
  scaleLabelWrap.className = 'swatch-label';
  scaleLabelWrap.textContent = '圖片縮放';
  const scaleInput = document.createElement('input');
  scaleInput.type = 'range';
  scaleInput.min = '1';
  scaleInput.max = '3.5';
  scaleInput.step = '0.01';
  scaleInput.value = '1';
  const scaleVal = document.createElement('span');
  scaleVal.className = 'scale-val';
  scaleVal.textContent = '1.00x';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'reset-pos-btn';
  resetBtn.textContent = '重設位置';

  scaleInput.addEventListener('input', () => {
    setActiveCard(i);
    applyScale(i, Number(scaleInput.value));
    scaleVal.textContent = `${Number(scaleInput.value).toFixed(2)}x`;
    render();
  });
  resetBtn.addEventListener('click', () => {
    setActiveCard(i);
    const state = activePage().cards[i];
    state.scale = 1;
    state.fx = 0.5;
    state.fy = 0.5;
    scaleInput.value = '1';
    scaleVal.textContent = '1.00x';
    if (state.img) {
      const cell = cellRect(i, activePage().showHeader);
      const { dw, dh } = cellImageSize(cell, state);
      state.offsetX = (cell.w - dw) / 2;
      state.offsetY = (cell.h - dh) / 2;
    }
    render();
  });

  scaleRow.appendChild(scaleLabelWrap);
  scaleRow.appendChild(scaleInput);
  scaleRow.appendChild(scaleVal);
  scaleRow.appendChild(resetBtn);
  box.appendChild(scaleRow);

  const { row: header1, els: swatchEls1, indicator: indicator1 } = buildSwatchRow(mode === 'grid4' ? '說明（選填，留空就不畫）' : '第一行標題', 'color1', LINE_COLORS, { collapsible: true });
  box.appendChild(header1);
  const row1 = document.createElement('div');
  row1.className = 'field-row';
  const in1 = document.createElement('input');
  in1.type = 'text';
  in1.placeholder = '輸入內容';
  in1.value = activePage().cards[i].line1;
  row1.appendChild(in1);
  box.appendChild(row1);

  const { row: header2, els: swatchEls2, indicator: indicator2 } = buildSwatchRow('第二行標題', 'color2', LINE_COLORS, { collapsible: true });
  box.appendChild(header2);
  const row2 = document.createElement('div');
  row2.className = 'field-row';
  const in2 = document.createElement('input');
  in2.type = 'text';
  in2.placeholder = '輸入內容';
  in2.value = activePage().cards[i].line2;
  row2.appendChild(in2);
  box.appendChild(row2);

  const { row: headerTag, els: tagSwatchEls, indicator: indicatorTag } = buildSwatchRow('標籤文字', 'tagColor', TAG_COLORS, { collapsible: true });
  box.appendChild(headerTag);
  const tagRow = document.createElement('div');
  tagRow.className = 'field-row';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.placeholder = '輸入內容';
  tagInput.value = activePage().cards[i].tag;
  tagRow.appendChild(tagInput);
  box.appendChild(tagRow);

  // 新聞 only: second tag (default top-right of the cell) + reset for both
  // tags' dragged positions.
  let tag2Input = null, tag2SwatchEls = null, indicatorTag2 = null;
  if (mode === 'news') {
    const h2 = buildSwatchRow('標籤文字 2', 'tag2Color', TAG_COLORS, { collapsible: true });
    tag2SwatchEls = h2.els; indicatorTag2 = h2.indicator;
    box.appendChild(h2.row);
    const tag2Row = document.createElement('div');
    tag2Row.className = 'field-row';
    tag2Input = document.createElement('input');
    tag2Input.type = 'text';
    tag2Input.placeholder = '選填：預設在格子右上角，可在預覽圖拖曳';
    tag2Input.value = activePage().cards[i].tag2;
    tag2Row.appendChild(tag2Input);
    box.appendChild(tag2Row);
    tag2Input.addEventListener('focus', () => setActiveCard(i));
    tag2Input.addEventListener('input', () => { activePage().cards[i].tag2 = normalizeInputValue(tag2Input); render(); });
    const tagResetBtn = document.createElement('button');
    tagResetBtn.type = 'button';
    tagResetBtn.className = 'reset-pos-btn';
    tagResetBtn.textContent = '標籤位置還原';
    tagResetBtn.style.marginBottom = '10px';
    tagResetBtn.addEventListener('click', () => {
      setActiveCard(i);
      const st = activePage().cards[i];
      st.tagPos = null; st.tag2Pos = null;
      render();
    });
    box.appendChild(tagResetBtn);
  }

  tagInput.addEventListener('focus', () => setActiveCard(i));
  in1.addEventListener('focus', () => setActiveCard(i));
  in2.addEventListener('focus', () => setActiveCard(i));
  tagInput.addEventListener('input', () => { activePage().cards[i].tag = normalizeInputValue(tagInput); render(); });
  in1.addEventListener('input', () => { activePage().cards[i].line1 = normalizeInputValue(in1); render(); });
  in2.addEventListener('input', () => { activePage().cards[i].line2 = normalizeInputValue(in2); render(); });

  // 四格 A：只有一行說明，沒有第二行、標籤；說明字色在底部「說明字色」選
  if (mode === 'grid4') {
    header1.querySelectorAll('.color-swatch, .swatch-indicator').forEach(el => { el.hidden = true; });
    header1.style.pointerEvents = 'none';
    in1.placeholder = '說明文字（選填）';
    [header2, row2, headerTag, tagRow].forEach(el => { el.hidden = true; });
  }

  box.addEventListener('mousedown', () => setActiveCard(i));

  cellsHost.appendChild(box);
  cardEls.push({ box, dzThumb, dzText, tagInput, tagSwatchEls, in1, in2, swatchEls1, swatchEls2, indicator1, indicator2, indicatorTag, scaleInput, scaleVal, tag2Input, tag2SwatchEls, indicatorTag2 });
}

// Refreshes one cell's DOM controls from the active page's current state —
// used both after an image/scale change and when switching page tabs.
function syncCellUIFromState(i) {
  const el = cardEls[i];
  const state = activePage().cards[i];
  if (state.img) {
    el.dzThumb.src = state.img.src;
    el.dzThumb.style.display = 'block';
    el.dzText.textContent = `已載入：${state.fileName || '圖片'}`;
  } else {
    el.dzThumb.src = '';
    el.dzThumb.style.display = 'none';
    el.dzText.textContent = '點擊、拖曳圖片，或先點此格再貼上（Ctrl+V）';
  }
  el.tagInput.value = state.tag;
  el.in1.value = state.line1;
  el.in2.value = state.line2;
  el.tagSwatchEls.forEach(s => s.classList.toggle('selected', s.title.toLowerCase() === (state.tagColor || TAG_COLORS[0]).toLowerCase()));
  el.swatchEls1.forEach(s => s.classList.toggle('selected', s.title.toLowerCase() === state.color1.toLowerCase()));
  el.swatchEls2.forEach(s => s.classList.toggle('selected', s.title.toLowerCase() === state.color2.toLowerCase()));
  el.indicator1.style.background = state.color1;
  el.indicator2.style.background = state.color2;
  el.indicatorTag.style.background = state.tagColor || TAG_COLORS[0];
  if (el.tag2Input) {
    el.tag2Input.value = state.tag2;
    el.tag2SwatchEls.forEach(s => s.classList.toggle('selected', s.title.toLowerCase() === (state.tag2Color || TAG_COLORS[0]).toLowerCase()));
    el.indicatorTag2.style.background = state.tag2Color || TAG_COLORS[0];
  }
  el.scaleInput.value = String(state.scale);
  el.scaleVal.textContent = `${state.scale.toFixed(2)}x`;
}

function refreshCardThumb(i) { syncCellUIFromState(i); }

function syncAllCellUI() {
  for (let i = 0; i < CELL_COUNT; i++) syncCellUIFromState(i);
}

function setActiveCard(i, select = true) {
  activeCard = i;
  if (select) { cellSelected = true; headerSelected = false; }
  cardEls.forEach((el, idx) => el.box.classList.toggle('active', idx === i));
  syncChrome();
  render();
}
function clearSelection() {
  if (!cellSelected && !headerSelected) return;
  cellSelected = false;
  headerSelected = false;
  syncChrome();
  render();
}
// 新聞: click the yellow bar (or the 「頂部標籤」 button when the bar is off).
function openHeaderEditor() {
  if (!COMPANY || mode !== 'news' || isLocked()) return;
  cellSelected = false;
  headerSelected = true;
  syncChrome();
  render();
}

// The per-cell editors depend on the mode (cell count, colour palettes), so
// they're rebuilt from scratch whenever the mode changes.
const cellsByMode = {};
function buildAllCardUI() {
  if (!cellsByMode[mode]) {
    const wrap = document.createElement('div');
    cellsList.appendChild(wrap);
    cellsByMode[mode] = { wrap, els: [] };
    cellsHost = wrap;
    cardEls = cellsByMode[mode].els;
    for (let i = 0; i < CELL_COUNT; i++) buildCardUI(i);
  }
  Object.entries(cellsByMode).forEach(([m, o]) => { o.wrap.hidden = m !== mode; });
  cardEls = cellsByMode[mode].els;
  cellsHost = cellsByMode[mode].wrap;
}
buildAllCardUI();
setActiveCard(0, false);

// ---------------------------------------------------------------------------
// Canvas drag-to-pan / wheel-to-zoom
// ---------------------------------------------------------------------------
function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  const point = evt.touches && evt.touches.length ? evt.touches[0] : evt;
  return { x: (point.clientX - rect.left) * scaleX, y: (point.clientY - rect.top) * scaleY };
}

function cellIndexAt(x, y) {
  if (mode === 'grid4') {
    if (x < 0 || x > CANVAS_W || y < 0 || y > CANVAS_H) return -1;
    return (y < CANVAS_H / 2 ? 0 : 2) + (x < CANVAS_W / 2 ? 0 : 1);
  }
  if (mode === 'ent') {
    if (x < 0 || x > CANVAS_W || y < 0 || y > CANVAS_H) return -1;
    return (y < CANVAS_H / 2 ? 0 : 2) + (x < CANVAS_W / 2 ? 0 : 1);
  }
  const rowEdges = rowEdgesFor(activePage().showHeader);
  if (x < 0 || x > NEWS_W || y < rowEdges[0] || y > rowEdges[2]) return -1;
  let col = COLS - 1;
  for (let c = 0; c < COLS; c++) {
    if (x >= COL_EDGES[c] && x < COL_EDGES[c + 1]) { col = c; break; }
  }
  const row = y < rowEdges[1] ? 0 : 1;
  return row * COLS + col;
}

let drag = null;
let stickerDrag = null;
let lockProbe = null;   // pointer pressed on a cell while locked: a drag from here shows the reminder
let tagDrag = null;
function pointerDown(evt) {
  const pos = getCanvasPos(evt);
  const idx = cellIndexAt(pos.x, pos.y);
  if (idx < 0) {
    const onHeader = mode === 'news' && !isLocked() && activePage().showHeader &&
      pos.x >= 0 && pos.x <= NEWS_W && pos.y >= 0 && pos.y < HEADER_H;
    if (onHeader) openHeaderEditor(); else clearSelection();
    return;
  }
  const state = activePage().cards[idx];

  // 步驟 2: photos, tags and stickers are locked. A click just picks the cell;
  // dragging it shows the 「返回上一步更改」 reminder.
  if (isLocked()) {
    setActiveCard(idx);
    lockProbe = { startX: pos.x, startY: pos.y };
    return;
  }

  if (mode === 'news') {
    const cell = cellRect(idx, activePage().showHeader);
    const n = newsTagHit(ctx, cell, state, pos.x, pos.y);
    if (n) {
      evt.preventDefault();
      setActiveCard(idx);
      tagDrag = { idx, n, startX: pos.x, startY: pos.y, startPos: n === 1 ? state.tagPos : state.tag2Pos };
      canvas.style.cursor = 'grabbing';
      return;
    }
  }

  const delIdx = stickerDeleteHit(state, pos.x, pos.y);
  if (delIdx >= 0) {
    evt.preventDefault();
    setActiveCard(idx);
    state.stickers.splice(delIdx, 1);
    render();
    return;
  }

  const stIdx = stickerHit(state, pos.x, pos.y);
  if (stIdx >= 0) {
    evt.preventDefault();
    setActiveCard(idx);
    const st = state.stickers[stIdx];
    stickerDrag = { idx, stickerIdx: stIdx, startX: pos.x, startY: pos.y, startStX: st.x, startStY: st.y };
    canvas.style.cursor = 'grabbing';
    return;
  }

  setActiveCard(idx);
  if (!state.img) return;
  evt.preventDefault();
  drag = { idx, startX: pos.x, startY: pos.y, startOffsetX: state.offsetX, startOffsetY: state.offsetY };
  canvas.style.cursor = 'grabbing';
}

function pointerMove(evt) {
  const pos = getCanvasPos(evt);
  if (lockProbe) {
    if (Math.hypot(pos.x - lockProbe.startX, pos.y - lockProbe.startY) > 6) { lockProbe = null; showLockReminder(); }
    return;
  }
  if (isLocked() && !drag && !tagDrag && !stickerDrag) {
    canvas.style.cursor = cellIndexAt(pos.x, pos.y) >= 0 ? 'pointer' : 'default';
    return;
  }
  if (tagDrag) {
    evt.preventDefault();
    const state = activePage().cards[tagDrag.idx];
    const cell = cellRect(tagDrag.idx, activePage().showHeader);
    const off = newsTagDragTo(ctx, cell, state, tagDrag.n, tagDrag.startPos, pos.x - tagDrag.startX, pos.y - tagDrag.startY);
    if (tagDrag.n === 1) state.tagPos = off; else state.tag2Pos = off;
    render();
    return;
  }
  if (stickerDrag) {
    evt.preventDefault();
    const state = activePage().cards[stickerDrag.idx];
    const st = state.stickers[stickerDrag.stickerIdx];
    if (st) {
      st.x = stickerDrag.startStX + (pos.x - stickerDrag.startX);
      st.y = stickerDrag.startStY + (pos.y - stickerDrag.startY);
      clampStickerPos(cellRect(stickerDrag.idx, activePage().showHeader), st);
      render();
    }
    return;
  }
  if (!drag) {
    const idx = cellIndexAt(pos.x, pos.y);
    if (idx < 0) {
      const overHeader = mode === 'news' && !isLocked() && activePage().showHeader && pos.y >= 0 && pos.y < HEADER_H && pos.x >= 0 && pos.x <= NEWS_W;
      canvas.style.cursor = overHeader ? 'pointer' : 'default';
      return;
    }
    const state = activePage().cards[idx];
    if (mode === 'news' && newsTagHit(ctx, cellRect(idx, activePage().showHeader), state, pos.x, pos.y)) {
      canvas.style.cursor = 'grab';
      return;
    }
    const overSticker = stickerHit(state, pos.x, pos.y) >= 0 || stickerDeleteHit(state, pos.x, pos.y) >= 0;
    canvas.style.cursor = overSticker || state.img ? 'grab' : 'pointer';
    return;
  }
  evt.preventDefault();
  const state = activePage().cards[drag.idx];
  state.offsetX = drag.startOffsetX + (pos.x - drag.startX);
  state.offsetY = drag.startOffsetY + (pos.y - drag.startY);
  clampCardOffset(drag.idx);
  render();
}

function pointerUp() {
  lockProbe = null;
  drag = null;
  stickerDrag = null;
  tagDrag = null;
  canvas.style.cursor = 'default';
}

canvas.addEventListener('mousedown', pointerDown);
window.addEventListener('mousemove', pointerMove);
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('dblclick', evt => {
  if (isLocked()) { showLockReminder(); return; }
  const pos = getCanvasPos(evt);
  const idx = cellIndexAt(pos.x, pos.y);
  if (idx < 0) return;
  const state = activePage().cards[idx];
  if (stickerHit(state, pos.x, pos.y) >= 0 || stickerDeleteHit(state, pos.x, pos.y) >= 0) return;
  if (mode === 'news' && newsTagHit(ctx, cellRect(idx, activePage().showHeader), state, pos.x, pos.y)) return;
  setActiveCard(idx);
  cardEls[idx].box.querySelector('.dropzone').click();
});
canvas.addEventListener('touchstart', pointerDown, { passive: false });
window.addEventListener('touchmove', pointerMove, { passive: false });
window.addEventListener('touchend', pointerUp);

canvas.addEventListener('wheel', evt => {
  const pos = getCanvasPos(evt);
  const idx = cellIndexAt(pos.x, pos.y);
  if (idx < 0) return;
  const state = activePage().cards[idx];
  if (isLocked()) {
    if (state.img || state.stickers.length) { evt.preventDefault(); showLockReminder(); }
    return;
  }

  const stIdx = stickerHit(state, pos.x, pos.y);
  if (stIdx >= 0) {
    evt.preventDefault();
    setActiveCard(idx);
    const st = state.stickers[stIdx];
    const factor = 1 - evt.deltaY * 0.0015;
    st.scale = clamp(st.scale * factor, STICKER_MIN_SCALE, STICKER_MAX_SCALE);
    clampStickerPos(cellRect(idx, activePage().showHeader), st);
    render();
    return;
  }

  if (!state.img) return;
  evt.preventDefault();
  setActiveCard(idx);
  const factor = 1 - evt.deltaY * 0.0015;
  applyScale(idx, state.scale * factor);
  refreshCardThumb(idx);
  render();
}, { passive: false });

canvas.addEventListener('dragover', evt => evt.preventDefault());
canvas.addEventListener('drop', evt => {
  evt.preventDefault();
  if (isLocked()) { showLockReminder(); return; }
  const pos = getCanvasPos(evt);
  const idx = cellIndexAt(pos.x, pos.y);
  if (idx < 0) return;
  const file = evt.dataTransfer.files[0];
  loadImageFile(file, (image, name) => {
    setCardImage(idx, image, name);
    refreshCardThumb(idx);
  }, () => {});
});

document.addEventListener('paste', e => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (isLocked()) { showLockReminder(); break; }
      if (!cellSelected || activeCard < 0 || activeCard >= CELL_COUNT) {
        statusEl.show('先點預覽圖選一格，再按 Ctrl+V 貼上圖片');
        break;
      }
      loadImageFile(file, (image, name) => {
        setCardImage(activeCard, image, name);
        refreshCardThumb(activeCard);
      }, () => {});
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// Inputs / downloads / reset
// ---------------------------------------------------------------------------
// 四格 A：底色與說明字色（每頁各自一份）
const g4BgInput = document.getElementById('g4Bg');
const g4CapInput = document.getElementById('g4Cap');
g4BgInput.addEventListener('input', () => { activePage().bg = g4BgInput.value; render(); });
g4CapInput.addEventListener('input', () => { activePage().capColor = g4CapInput.value; render(); });
const topLabelInput = document.getElementById('topLabel');
const showHeaderToggle = document.getElementById('showHeaderToggle');
topLabelInput.addEventListener('input', () => {
  activePage().topLabel = normalizeInputValue(topLabelInput);
  render();
});
function syncTopToggleUI() {
  topLabelInput.disabled = !showHeaderToggle.checked;
  document.getElementById('newsHeaderBox').classList.toggle('header-off', !showHeaderToggle.checked);
}
showHeaderToggle.addEventListener('change', () => {
  activePage().showHeader = showHeaderToggle.checked;
  syncTopToggleUI();
  render();
});

// Refreshes the page-level controls (label text / header toggle) from the
// active page's state — used when switching page tabs.
function syncTopUIFromState() {
  const p = activePage();
  topLabelInput.value = p.topLabel;
  showHeaderToggle.checked = p.showHeader;
  syncTopToggleUI();
  g4BgInput.value = p.bg || '#ffffff';
  g4CapInput.value = p.capColor || '#ffffff';
}

const pageTabs = Array.from(document.querySelectorAll('.page-tab'));
pageTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.page);
    if (idx === activePageIndex) return;
    activePageIndex = idx;
    pageTabs.forEach(b => b.classList.toggle('active', Number(b.dataset.page) === idx));
    updateSegKnobs();
    syncTopUIFromState();
    syncAllCellUI();
    cellSelected = false;
    headerSelected = false;
    if (typeof hideGapTip === 'function') hideGapTip(true);
    setActiveCard(0, false);
  });
});


// Status messages (quick-fill results, copy / download feedback, errors) pop up
// at the bottom of the page, stay 5 seconds, then fade out. The grey line under
// the preview (#status) is now just a static hint. Assigning to
// statusEl.textContent shows the toast, so every existing call keeps working.
const statusToast = document.getElementById('statusToast');
const STATUS_TOAST_MS = 5000;
let statusToastTimer = null, statusToastHideTimer = null;
function hideStatusToast() {
  clearTimeout(statusToastTimer);
  statusToast.classList.remove('show');
  clearTimeout(statusToastHideTimer);
  statusToastHideTimer = setTimeout(() => { statusToast.hidden = true; }, 600);   // after the fade
}
// kind: 'success' (green) for completed actions, 'error' (red) for failures,
// '' (dark) for neutral notes such as limits and progress.
const statusEl = {
  get textContent() { return statusToast.textContent; },
  set textContent(msg) { this.show(msg, ''); },
  show(msg, kind = '') {
    if (!msg) return;
    clearTimeout(statusToastHideTimer);
    statusToast.textContent = msg;
    statusToast.classList.toggle('success', kind === 'success');
    statusToast.classList.toggle('error', kind === 'error');
    statusToast.hidden = false;
    void statusToast.offsetWidth;            // let the entrance transition run from hidden
    statusToast.classList.add('show');
    clearTimeout(statusToastTimer);
    statusToastTimer = setTimeout(hideStatusToast, STATUS_TOAST_MS);
  },
};
statusToast.addEventListener('click', hideStatusToast);

// ---------------------------------------------------------------------------
// Export resolution / DPI
// ---------------------------------------------------------------------------
// Downloads are lossless PNG at each layout's fixed exportW/H (新聞 1040×800, 娛樂 1040×1040,
// 拼圖 1080 wide) — the pixel size never changes. To make those pixels as clean as possible the page
// is drawn at SUPERSAMPLE× the size (photos are resampled once, straight from their originals; text
// and edges get 9 samples per pixel) and then averaged down to the exact export size.
// EXPORT_DPI is written into the file's own PNG pHYs chunk.
const SUPERSAMPLE = 3;
const MAX_EXPORT_AREA = 14e6;     // stay below the canvas size limit of the strictest browsers (~16.7M px)
const EXPORT_DPI = 300;
let templateNearest = false;      // set while exporting at an exact whole-number multiple of the template

const PNG_CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = PNG_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Inserts a pHYs chunk (pixel density) right after the mandatory IHDR chunk
// — PNG's own way of carrying a DPI value — since the browser's PNG encoder
// doesn't write one on its own.
function pngWithDpi(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254); // pixels per meter, PNG's native unit
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  data[8] = 1; // unit specifier: 1 = meters
  const type = new TextEncoder().encode('pHYs');
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  cv.setUint32(8 + data.length, pngCrc32(chunk.subarray(4, 8 + data.length)));
  const IHDR_END = 8 + 4 + 4 + 13 + 4; // signature + IHDR(length+type+data+crc)
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, IHDR_END), 0);
  out.set(chunk, IHDR_END);
  out.set(bytes.subarray(IHDR_END), IHDR_END + chunk.length);
  return out;
}

// Opening this file directly as file:// (instead of via a real http/https
// server such as GitHub Pages) makes Chrome treat the local template PNGs
// as cross-origin, which taints the canvas and blocks toDataURL(). Catch
// that specific failure and explain it, rather than failing silently.
// The push platform only accepts files under 2 MB. A PNG of a busy photo can be bigger than that, and
// the pixel size is locked, so when the lossless file is too big the colours are rounded a little more
// each time (step 2, 4, 8, 16 levels — invisible at the first steps) until it fits. Returns
// { bytes, step, size, tooBig }.
const EXPORT_MAX_BYTES = 1990000;
const QUANT_STEPS = [1, 2, 4, 8, 16];
function quantizeCanvas(src, step) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const cx = c.getContext('2d');
  const img = src.getContext('2d').getImageData(0, 0, src.width, src.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, Math.round(d[i] / step) * step);
    d[i + 1] = Math.min(255, Math.round(d[i + 1] / step) * step);
    d[i + 2] = Math.min(255, Math.round(d[i + 2] / step) * step);
  }
  cx.putImageData(img, 0, 0);
  return c;
}
async function encodePngUnderLimit(off) {
  let best = null;
  for (const step of QUANT_STEPS) {
    const cv = step === 1 ? off : quantizeCanvas(off, step);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('PNG encode failed');
    const bytes = pngWithDpi(new Uint8Array(await blob.arrayBuffer()), EXPORT_DPI);
    best = { bytes, step, size: bytes.length, tooBig: bytes.length >= EXPORT_MAX_BYTES };
    if (!best.tooBig) break;
  }
  return best;
}

// Opening this file directly as file:// (instead of via a real http/https
// server such as GitHub Pages) makes Chrome treat the local template PNGs
// as cross-origin, which taints the canvas and blocks export. Catch
// that specific failure and explain it, rather than failing silently.
async function exportCanvas(off, filename) {
  try {
    const res = await encodePngUnderLimit(off);
    tb.download(new Blob([res.bytes], { type: 'image/png' }), filename);
    return res;
  } catch (err) {
    tb.log.error('export-failed');
    statusEl.show('下載失敗，請重新整理後再試一次。', 'error');
    throw err;
  }
}
const fmtMB = n => `${(n / 1048576).toFixed(2)} MB`;
// One line after a download when the 2 MB rule had to step in (silent when the lossless PNG already fit).
function reportExport(results) {
  const tooBig = results.filter(r => r.tooBig);
  const tuned = results.filter(r => r.step > 1 && !r.tooBig);
  if (tooBig.length) statusEl.show(`已下載，但檔案仍有 ${tooBig.map(r => fmtMB(r.size)).join('、')}，超過 2MB 上限；請換掉細節很多的照片，或縮小照片放大倍率後再下載。`, 'error');
  else if (tuned.length) statusEl.show(`已下載。為符合 2MB 上限，已微調色階（${tuned.map(r => fmtMB(r.size)).join('、')}），尺寸不變。`, 'success');
}

// Averages a SUPERSAMPLE× canvas down to w×h (each output pixel = the mean of the f×f block it covers).
function boxDownscale(big, w, h) {
  const f = big.width / w;
  const src = big.getContext('2d').getImageData(0, 0, big.width, big.height).data;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');
  const out = octx.createImageData(w, h);
  const dst = out.data, bw = big.width, n = f * f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * bw + x * f) * 4;
        for (let dx = 0; dx < f; dx++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; }
      }
      const o = (y * w + x) * 4;
      dst[o] = Math.round(r / n); dst[o + 1] = Math.round(g / n); dst[o + 2] = Math.round(b / n); dst[o + 3] = Math.round(a / n);
    }
  }
  octx.putImageData(out, 0, 0);
  return off;
}

// Renders the page at the layout's fixed export size (see SUPERSAMPLE above). 娛樂 is designed at
// 1200² but delivered at 1040², so its drawing scale is not a whole number; the final averaging
// step still lands on exactly exportW×exportH.
function renderPageToOffscreen(pageState, renderMode) {
  const exportW = L().exportW;
  const exportH = L().exportH;
  let ss = SUPERSAMPLE;
  while (ss > 1 && exportW * ss * exportH * ss > MAX_EXPORT_AREA) ss--;
  const big = document.createElement('canvas');
  big.width = exportW * ss;
  big.height = exportH * ss;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.scale(big.width / CANVAS_W, big.height / CANVAS_H);
  templateNearest = Number.isInteger(big.width / CANVAS_W) && big.width / CANVAS_W >= 2;
  try { renderTo(bctx, renderMode, pageState); } finally { templateNearest = false; }
  return ss === 1 ? big : boxDownscale(big, exportW, exportH);
}

async function ensureAssetsReady() {
  await headlineFontReady;
  await document.fonts.ready;
  await templatesReady;
  await stickersReady;
}

// e.g. 20260925新聞Line推播圖_第1頁.png — date is the local date at download.
function exportFileName(pageIndex) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${ymd}${L().name}${COMPANY ? 'Line推播圖' : '推播圖'}_第${pageIndex + 1}頁.png`;
}

// 新聞／娛樂 completeness: every cell needs both headline lines and a photo.
// (拼圖 has no such rule.) 「全部下載」 stays locked until every cell on every
// page is complete; 「下載本頁」 asks first when the current page isn't.
function cardMissing(st) {
  const miss = [];
  // 四格 A 的說明可以留空；其他版面兩行標題都要有
  if (mode !== 'grid4' && (!(st.line1 || '').trim() || !(st.line2 || '').trim())) miss.push('標題');
  if (!st.img) miss.push('圖片');
  return miss;
}
function pageMissingReport(pageState) {
  const rows = [];
  // 四格 A：整頁都空的就不算缺（可以只做一頁）
  if (mode === 'grid4' && !pageIsEdited(pageState)) return rows;
  pageState.cards.forEach((st, i) => {
    const m = cardMissing(st);
    if (m.length) rows.push(`第 ${i + 1} 格缺${m.join('、')}`);
  });
  return rows;
}
// 露白: the photo shows white (or nothing) at the edge of its cell. A warning only — it can't
// be told apart from a photo that is meant to have a white border, so it never locks downloads.
// Only the part of the cell where the photo can actually be SEEN counts. In 新聞 the template
// covers some of it almost solid: the yellow header bar and its shadow, the dark top edge, the
// black text band at the bottom, and the upper row's band that spills a few pixels into the lower
// row. A gap under those is invisible, so it is not flagged (see cardVisibleWindow).
// Two checks, both on the cell as it will be exported:
//   1. geometry: the photo no longer covers the visible window of the cell;
//   2. pixels: the cell is drawn on its own and a 3px band along each edge of that window is
//      scanned — an edge counts as white when >= 90% of its pixels are near-white (R,G,B >= 240)
//      or see-through. This also catches photos that carry their own white / transparent border.
const EDGE_BAND_PX = 3, EDGE_WHITE_MIN = 240, EDGE_WHITE_RATIO = 0.9;
const OVERLAY_HIDE_ALPHA = 240;   // template pixels at least this opaque (0-255, ~94%) hide a white gap; higher = stricter
let imgIdCounter = 0;
const overlayAlphaCache = new Map();
// Alpha channel of the 新聞 template for this page, or null if it can't be read.
function overlayAlphaData(showHeader) {
  const img = newsTemplate(showHeader);
  if (!img) return null;
  const key = showHeader ? 'h' : 'p';
  if (overlayAlphaCache.has(key)) return overlayAlphaCache.get(key);
  let data = null;
  try {
    const c = document.createElement('canvas');
    c.width = NEWS_W; c.height = NEWS_H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, NEWS_W, NEWS_H);
    data = x.getImageData(0, 0, NEWS_W, NEWS_H).data;
  } catch (err) { data = null; }
  overlayAlphaCache.set(key, data);
  return data;
}
// The vertical range (canvas y) of the cell where its photo is visible.
function cardVisibleWindow(cell, showHeader) {
  const full = { top: cell.y, bottom: cell.y + cell.h };
  if (mode !== 'news') return full;
  const data = overlayAlphaData(showHeader);
  if (!data) return full;
  const cols = [0.2, 0.5, 0.8].map(f => Math.round(cell.x + cell.w * f));
  // A row is "hidden" only if the template is nearly opaque at all sampled columns.
  const hidden = y => cols.every(x => data[(y * NEWS_W + x) * 4 + 3] >= OVERLAY_HIDE_ALPHA);
  const y0 = Math.round(cell.y), y1 = Math.round(cell.y + cell.h);
  let top = y0;
  while (top < y1 && hidden(top)) top++;
  let bottom = y1;
  while (bottom > top && hidden(bottom - 1)) bottom--;
  return { top, bottom };
}
// 娛樂: the photo shows through a slightly skewed hole in the template (frame, tape and the yellow
// caption strip cover the rest), so "visible" is a mask, not a rectangle. For each photo cell:
//   vis  = template is not (almost) opaque there,
//   ring = visible pixels within 3px of the edge of that area (what the white-edge scan looks at),
//   side = which edge of the cell each ring pixel belongs to (0 左, 1 上, 2 右, 3 下).
const entMaskCache = new Map();
let entAlphaCache = null;
function entAlphaData() {
  if (entAlphaCache !== null) return entAlphaCache || null;
  if (!templateEntImg) return null;      // not loaded yet: try again later
  entAlphaCache = false;
  try {
    const c = document.createElement('canvas');
    c.width = ENT_W; c.height = ENT_H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(templateEntImg, 0, 0, ENT_W, ENT_H);
    entAlphaCache = x.getImageData(0, 0, ENT_W, ENT_H).data;
  } catch (err) { entAlphaCache = false; }
  return entAlphaCache || null;
}
function entCellMask(i) {
  if (entMaskCache.has(i)) return entMaskCache.get(i);
  const data = entAlphaData();
  if (!data) return null;
  const r = ENT_CELLS[i].photo;
  const cx = Math.round(r.x), cy = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  const vis = new Uint8Array(w * h);
  let count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[((cy + y) * ENT_W + cx + x) * 4 + 3] < OVERLAY_HIDE_ALPHA) { vis[y * w + x] = 1; count++; }
  }
  // Erode by a square of radius R (pixels outside the cell count as "not visible").
  const erode = R => {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let d = -R; d <= R && ok; d++) { const xx = x + d; if (xx < 0 || xx >= w || !vis[y * w + xx]) ok = 0; }
      tmp[y * w + x] = ok;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let d = -R; d <= R && ok; d++) { const yy = y + d; if (yy < 0 || yy >= h || !tmp[yy * w + x]) ok = 0; }
      out[y * w + x] = ok;
    }
    return out;
  };
  const inner = erode(EDGE_BAND_PX), inner1 = erode(1);
  const ring = new Uint8Array(w * h), side = new Uint8Array(w * h), edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (!vis[k]) continue;
    if (!inner1[k]) edge[k] = 1;
    if (inner[k]) continue;
    ring[k] = 1;
    const d = [x, y, w - 1 - x, h - 1 - y];
    side[k] = d.indexOf(Math.min(...d));
  }
  const m = { cx, cy, w, h, vis, ring, side, edge, count };
  entMaskCache.set(i, m);
  return m;
}
// On-screen picture of the visible photo area of one 娛樂 cell: a red frame along its edge. Built once per cell.
const entOverlayCache = new Map();
function entCheckOverlay(i) {
  if (entOverlayCache.has(i)) return entOverlayCache.get(i);
  const m = entCellMask(i);
  if (!m) return null;
  const c = document.createElement('canvas');
  c.width = m.w; c.height = m.h;
  const x = c.getContext('2d');
  const img = x.createImageData(m.w, m.h);
  for (let k = 0; k < m.w * m.h; k++) {
    const p = k * 4;
    if (m.ring[k]) { img.data[p] = 220; img.data[p + 1] = 38; img.data[p + 2] = 38; img.data[p + 3] = 255; }
  }
  x.putImageData(img, 0, 0);
  entOverlayCache.set(i, c);
  return c;
}
function entGeoGap(pageState, i) {
  const st = pageState.cards[i];
  if (!st.img) return false;
  const m = entCellMask(i);
  if (!m) return false;
  if (!st.img.__id) st.img.__id = ++imgIdCounter;
  const gkey = `${st.img.__id}|${st.scale}|${st.offsetX}|${st.offsetY}`;
  if (st._entGeo && st._entGeo.key === gkey) return st._entGeo.val;
  const cell = cellRect(i, pageState.showHeader);
  const { dw, dh } = cellImageSize(cell, st);
  const x0 = st.offsetX, y0 = st.offsetY, x1 = x0 + dw, y1 = y0 + dh;
  let outside = 0;
  for (let y = 0; y < m.h; y++) {
    const yIn = y + 0.5 >= y0 && y + 0.5 < y1;
    for (let x = 0; x < m.w; x++) {
      if (!m.vis[y * m.w + x]) continue;
      if (!(yIn && x + 0.5 >= x0 && x + 0.5 < x1)) outside++;
    }
  }
  const val = outside > m.count * 0.001;   // more than ~0.5px of visible area not covered by the photo
  st._entGeo = { key: gkey, val };
  return val;
}
function entWhiteEdges(pageState, i) {
  const st = pageState.cards[i];
  if (!st.img) return [];
  const m = entCellMask(i);
  if (!m) return [];
  const cell = cellRect(i, pageState.showHeader);
  const off = document.createElement('canvas');
  off.width = m.w; off.height = m.h;
  const octx = off.getContext('2d', { willReadFrequently: true });
  drawCellImage(octx, { x: 0, y: 0, w: cell.w, h: cell.h }, st);
  let data;
  try { data = octx.getImageData(0, 0, m.w, m.h).data; } catch (err) { return []; }
  const n = [0, 0, 0, 0], white = [0, 0, 0, 0];
  for (let k = 0; k < m.w * m.h; k++) {
    if (!m.ring[k]) continue;
    const sd = m.side[k], p = k * 4;
    n[sd]++;
    if (data[p + 3] < 250 || (data[p] >= EDGE_WHITE_MIN && data[p + 1] >= EDGE_WHITE_MIN && data[p + 2] >= EDGE_WHITE_MIN)) white[sd]++;
  }
  const names = ['左', '上', '右', '下'];
  return names.filter((_, sd) => n[sd] >= 20 && white[sd] / n[sd] >= EDGE_WHITE_RATIO);
}
function cardGeoGap(pageState, i) {
  if (mode === 'ent') return entGeoGap(pageState, i);
  const st = pageState.cards[i];
  if (!st.img) return false;
  const cell = cellRect(i, pageState.showHeader);
  const win = cardVisibleWindow(cell, pageState.showHeader);
  const { dw, dh } = cellImageSize(cell, st);
  const e = 0.5;
  const left = cell.x + st.offsetX, top = cell.y + st.offsetY;
  return left > cell.x + e || left + dw < cell.x + cell.w - e || top > win.top + e || top + dh < win.bottom - e;
}
// Which edges of the visible part of cell i look white/see-through: a subset of ['左', '上', '右', '下'].
function cardWhiteEdges(pageState, i) {
  const st = pageState.cards[i];
  if (!st.img) return [];
  const cell = cellRect(i, pageState.showHeader);
  if (mode === 'ent') {
    if (!st.img.__id) st.img.__id = ++imgIdCounter;
    const ekey = `${st.img.__id}|${st.scale}|${st.offsetX}|${st.offsetY}|ent`;
    if (st._edgeCache && st._edgeCache.key === ekey) return st._edgeCache.sides;
    const sides = entWhiteEdges(pageState, i);
    st._edgeCache = { key: ekey, sides };
    return sides;
  }
  const win = cardVisibleWindow(cell, pageState.showHeader);
  if (!st.img.__id) st.img.__id = ++imgIdCounter;
  const key = `${st.img.__id}|${st.scale}|${st.offsetX}|${st.offsetY}|${cell.w}|${cell.h}|${win.top}|${win.bottom}|${mode}`;
  if (st._edgeCache && st._edgeCache.key === key) return st._edgeCache.sides;
  const w = Math.ceil(cell.w), h = Math.ceil(cell.h);
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d', { willReadFrequently: true });
  drawCellImage(octx, { x: 0, y: 0, w: cell.w, h: cell.h }, st);
  let data;
  try { data = octx.getImageData(0, 0, w, h).data; } catch (err) { return []; }   // tainted canvas: skip the pixel check
  const white = (x, y) => {
    const p = (y * w + x) * 4;
    return data[p + 3] < 250 || (data[p] >= EDGE_WHITE_MIN && data[p + 1] >= EDGE_WHITE_MIN && data[p + 2] >= EDGE_WHITE_MIN);
  };
  const wy0 = clamp(Math.floor(win.top - cell.y), 0, h - 1);
  const wy1 = clamp(Math.ceil(win.bottom - cell.y), wy0 + 1, h);
  const band = Math.max(1, Math.min(EDGE_BAND_PX, w, wy1 - wy0));
  const ratio = (xs, ys) => {
    let n = 0, total = 0;
    for (let y = ys[0]; y < ys[1]; y++) for (let x = xs[0]; x < xs[1]; x++) { total++; if (white(x, y)) n++; }
    return total ? n / total : 0;
  };
  const sides = [];
  if (ratio([0, band], [wy0, wy1]) >= EDGE_WHITE_RATIO) sides.push('左');
  if (ratio([0, w], [wy0, wy0 + band]) >= EDGE_WHITE_RATIO) sides.push('上');
  if (ratio([w - band, w], [wy0, wy1]) >= EDGE_WHITE_RATIO) sides.push('右');
  if (ratio([0, w], [wy1 - band, wy1]) >= EDGE_WHITE_RATIO) sides.push('下');
  st._edgeCache = { key, sides };
  return sides;
}
function cardHasGap(pageState, i) {
  return cardGeoGap(pageState, i) || cardWhiteEdges(pageState, i).length > 0;
}
// Where a cell's "!" sits: 24px in from the left and 24px down from where the photo starts to SHOW. For 新聞 that is
// below the yellow header / the upper row's black band (the lower row's cell starts under that band, so using the
// cell's own top would put its "!" on the band, i.e. up in the top row).
function badgeAnchor(i, showHeader) {
  const cell = cellRect(i, showHeader);
  const top = mode === 'news' && i >= CELL_COUNT / 2 ? cardVisibleWindow(cell, showHeader).top : cell.y;   // only the lower row starts under a band
  return { x: cell.x + 24, y: top + 24 };
}
// Which "!" a cell wears on the preview: 'bad' (red, something missing — step 2 only), 'warn' (yellow,
// photo edge shows white), or null.
function cardBadgeKind(pageState, i) {
  if (!isLocked()) return null;   // the check and its marks belong to 步驟 2
  if (cardMissing(pageState.cards[i]).length > 0) return 'bad';
  return cardHasGap(pageState, i) ? 'warn' : null;
}
// What the hover pop-up says about a cell's "!".
function cardBadgeText(pageState, i) {
  const miss = cardMissing(pageState.cards[i]);
  if (isLocked() && miss.length) return { title: '尚未完成', body: `缺${miss.join('、')}，補齊後才能「全部下載」` };
  return { title: '疑似露白', body: cardGapReason(pageState, i) || '照片邊緣疑似露出空白' };
}
// Tooltip text for a cell flagged 露白.
function cardGapReason(pageState, i) {
  if (cardGeoGap(pageState, i)) return '照片被拖離格子，邊緣露出空白';
  const sides = cardWhiteEdges(pageState, i);
  return sides.length ? `照片${sides.join('、')}邊疑似白邊或透明` : '';
}
function pageGapCount(pageState) {
  let n = 0;
  for (let i = 0; i < pageState.cards.length; i++) if (cardHasGap(pageState, i)) n++;
  return n;
}
function updateDownloadState() {
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const missing = pages.reduce((n, pg) => n + pageMissingReport(pg).length, 0);
  const gaps = step !== 2 ? 0 : pages.reduce((n, pg) => n + pageGapCount(pg), 0);
  const locked = missing > 0;
  downloadAllBtn.setAttribute('aria-disabled', locked ? 'true' : 'false');
  if (locked) { const c = document.getElementById('dlConfirm'); if (c) c.hidden = true; }
  downloadAllBtn.classList.toggle('is-disabled', locked);
  if (locked) downloadAllBtn.dataset.tip = '圖片製作未完成！'; else delete downloadAllBtn.dataset.tip;
  const chip = document.getElementById('dockChip');
  if (chip) {
    const show = step === 2 && (missing || gaps);
    chip.hidden = !show;
    if (show) {
      chip.className = 'dock-chip ' + (missing ? 'bad' : 'warn');
      chip.textContent = '';
      if (!missing) { const d = document.createElement('i'); d.className = 'warn-dot'; d.textContent = '!'; chip.appendChild(d); chip.append(` ${gaps} 格圖片疑似露白，仍可下載`); }
      else chip.textContent = `${missing} 項待補，尚不能全部下載`;
    }
  }
}
document.getElementById('downloadJpgBtn').addEventListener('click', async () => {
  {
    const report = pageMissingReport(activePage());
    const gapCells = activePage().cards.map((_, i) => i).filter(i => cardHasGap(activePage(), i));
    if (gapCells.length) report.push(`第 ${gapCells.map(i => i + 1).join('、')} 格圖片疑似露白`);
    if (report.length) {
      const ok = await askConfirm({
        title: pageMissingReport(activePage()).length ? '尚有未完成部分確定要下載?' : '圖片有露白確定要下載嗎？',
        body: report.join('；'),
        okText: '仍要下載',
      });
      if (!ok) return;
    }
  }
  await ensureAssetsReady();
  const off = renderPageToOffscreen(activePage(), 'final');
  const donePage = activePageIndex;
  const res1 = await exportCanvas(off, exportFileName(donePage));
  reportExport([res1]);
});

async function runDownloadAll() {
  await ensureAssetsReady();
  const results = [];
  for (let p = 0; p < PAGE_COUNT; p++) {
    if (mode === 'grid4' && !pageIsEdited(pages[p])) continue;   // 四格 A：空白頁不輸出
    const off = renderPageToOffscreen(pages[p], 'final');
    results.push(await exportCanvas(off, exportFileName(p)));
    // Small gap so the browser treats these as two distinct downloads
    // rather than racing them back-to-back.
    if (p < PAGE_COUNT - 1) await new Promise(r => setTimeout(r, 600));
  }
  reportExport(results);
}
// 全部下載 first asks for a last check (typos / white edges) in a popover at the
// button; 確認下載 goes ahead, 再修改 (or clicking elsewhere / Esc) closes it.
const dlConfirm = document.getElementById('dlConfirm');
function hideDlConfirm() { dlConfirm.hidden = true; }
function openDlConfirm(e) {
  e.stopPropagation();
  if (e.currentTarget.getAttribute('aria-disabled') === 'true') return;
  const gapTotal = pages.reduce((n, pg) => n + pageGapCount(pg), 0);
  dlConfirm.querySelector('.dl-confirm-text').textContent = gapTotal ? '圖片有露白確定要下載嗎？' : '已確認無錯字、圖片無露白？';
  document.getElementById('dlConfirmOk').textContent = gapTotal ? '仍要下載' : '確認下載';
  dlConfirm.hidden = !dlConfirm.hidden;
  if (!dlConfirm.hidden) hideStatusToast();
}
document.getElementById('downloadAllBtn').addEventListener('click', openDlConfirm);
document.getElementById('dlConfirmBack').addEventListener('click', hideDlConfirm);
document.getElementById('dlConfirmOk').addEventListener('click', () => { hideDlConfirm(); runDownloadAll(); });
document.addEventListener('click', e => { if (!dlConfirm.hidden && !dlConfirm.contains(e.target)) hideDlConfirm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideDlConfirm(); });

// Parses pasted "★tag)line1 line2" or "★line1 line2(tag)" blocks (plus a
// url line, skipped) into up to 12 {line1, line2, tag, tagColor} entries —
// only lines starting with ★ carry content. The tag can appear two ways:
// a bare "tag)"/"tag）" right after ★ with no opening paren (the format
// actually pasted in practice), or a normal matched "(tag)"/"（tag）" at
// the end of the line (kept working too). Either way "國際" selects gray,
// everything else defaults to red. Whatever's left after the tag is pulled
// out is split on its FIRST space into line1 / line2, the space itself
// dropped.
// Breaks a headline into line 1 / line 2 at the first space (half- or
// full-width) or "!"/"?" (full-width ones arrive already half-width). The
// punctuation stays at the end of line 1 (a run like "!?" stays together);
// the space itself is dropped. Everything after the break is line 2.
function splitHeadline(content) {
  const m = content.match(/[ !?]/);
  if (!m) return { line1: content.trim(), line2: '' };
  let end = m.index;
  let rest = end + 1;
  if (m[0] !== ' ') {
    while (end < content.length && (content[end] === '!' || content[end] === '?')) end++;
    rest = end;
  }
  return { line1: content.slice(0, end).trim(), line2: content.slice(rest).trim() };
}

// >>> 原檔 4415-4473
function cleanUrl(u) { return u.replace(/[?!.,;:，。、）)\]】]+$/, ''); }
// 「國際」 tags are grey, everything else the default red/blue.
function tagColorFor(tag) { return tag === '國際' ? TAG_COLORS[1] : TAG_COLORS[0]; }
function parseQuickFillText(text) {
  const entries = [];
  let current = null;
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line.startsWith('★')) {
      // The article link sits on the line(s) after a ★ line: remember it for
      // that entry (used to fetch the photo), skip everything else.
      const m = line.match(/https?:\/\/\S+/);
      if (m && current && !current.url) current.url = cleanUrl(m[0]);
      continue;
    }
    if (entries.length >= PAGE_COUNT * CELL_COUNT) break;
    // A link on the ★ line itself belongs to the entry, not the headline.
    let inlineUrl = '';
    line = line.replace(/https?:\/\/\S+/, m => { inlineUrl = cleanUrl(m); return ''; }).trim();
    let content = line.slice(1).trim();
    // Up to two tags, always right after ★, each in one of two coexisting syntaxes: bare text +
    // bare ")" ("日本)...") or a matched "(文字)"/"（文字）" pair ("(獨家)...").
    // e.g. "★（國際）（急集體隔離）標題..." or "★國際)急集體隔離)標題...".
    const tags = [];
    while (tags.length < 2) {
      const frontBareMatch = content.match(/^([^()（）]+)[)）]/);
      const frontPairMatch = !frontBareMatch && content.match(/^[(（]([^()（）]+)[)）]/);
      const tagMatch = frontBareMatch || frontPairMatch;
      if (!tagMatch) break;
      const t = toHalfWidth(tagMatch[1].trim());
      content = content.slice(tagMatch[0].length).trim();
      if (t) tags.push(t);
    }
    const entry = splitHeadline(toHalfWidth(content).replace(/　/g, ' '));
    entry.tags = tags;
    // First tag as before (kept for 娛樂, which has a single tag).
    entry.tag = tags[0] || '';
    entry.tagColor = tagColorFor(entry.tag);
    entry.tag2 = '';
    entry.tag2Color = TAG_COLORS[0];
    if (tags.length === 2) {
      // 新聞 shows two tags. If exactly one of them is 「國際」 or 「獨家」, that one goes to the top right
      // (the second tag) and the other one stays at the bottom left; otherwise they keep their order:
      // first at the bottom left, second at the top right.
      const special = t => t === '國際' || t === '獨家';
      const [a, b] = tags;
      const [left, right] = (special(a) !== special(b) && special(a)) ? [b, a] : [a, b];
      entry.newsTag = left; entry.newsTagColor = tagColorFor(left);
      entry.tag2 = right; entry.tag2Color = tagColorFor(right);
    } else {
      entry.newsTag = entry.tag; entry.newsTagColor = entry.tagColor;
    }
    entry.url = inlineUrl;
    entries.push(entry);
    current = entry;
  }
  return entries;
}

// >>> 原檔 4526-4659
// 文章首圖：照舊 Worker 的原網址呼叫（P1 不搬後端程式）。
const IMAGE_PROXY = 'https://og-image-proxy.19jpz-3.workers.dev';
const imageProxyUrl = () => IMAGE_PROXY;
let imageFetchRun = 0;
function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法解讀圖片')); };
    img.src = url;
  });
}
// Returns a status suffix. Cells holding a photo the user chose themselves are
// left alone; ones holding an earlier auto photo are replaced.
async function autoFetchImages(entries, baseMsg) {
  const withUrl = entries.map((entry, idx) => ({ entry, idx })).filter(j => j.entry.url);
  if (!withUrl.length) return;
  const proxy = imageProxyUrl();
  if (!proxy) return;
  const run = ++imageFetchRun;
  const startMode = mode, startPages = pages;
  const failed = [];
  let ok = 0, done = 0, kept = 0;
  const progress = () => { statusEl.textContent = `${baseMsg}；抓取文章圖片 ${done}/${withUrl.length}…`; };
  progress();
  await Promise.all(withUrl.map(async ({ entry, idx }) => {
    const p = Math.floor(idx / CELL_COUNT), c = idx % CELL_COUNT;
    const card = startPages[p].cards[c];
    try {
      if (card.img && card.imgSource === 'manual') { kept++; return; }
      const res = await fetch(`${proxy}?url=${encodeURIComponent(entry.url)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const image = await blobToImage(await res.blob());
      if (run !== imageFetchRun || mode !== startMode || pages !== startPages) return;   // superseded
      setCardImageAt(p, c, image, '文章首圖', 'auto');
      ok++;
    } catch (err) {
      failed.push(idx + 1);
    } finally {
      done++;
      if (run === imageFetchRun) progress();
    }
  }));
  if (run !== imageFetchRun) return;
  let msg = `${baseMsg}；圖片抓取完成，成功 ${ok} 張`;
  if (kept) msg += `，${kept} 格已有手動放的圖，保留不動`;
  if (failed.length) msg += `；第 ${failed.sort((a, b) => a - b).join('、')} 格沒抓到圖，請手動放圖`;
  statusEl.show(msg, failed.length ? 'error' : 'success');
}

document.getElementById('quickfillBtn').addEventListener('click', () => {
  const entries = parseQuickFillText(document.getElementById('quickfillText').value);
  entries.forEach((entry, idx) => {
    const card = pages[Math.floor(idx / CELL_COUNT)].cards[idx % CELL_COUNT];
    card.line1 = entry.line1;
    card.line2 = entry.line2;
    if (mode === 'grid4') {
      card.line1 = [entry.line1, entry.line2].filter(Boolean).join(' ');   // 四格 A 只有一行說明
      card.line2 = '';
    } else if (mode === 'news') {
      card.tag = entry.newsTag;
      card.tagColor = entry.newsTagColor;
      card.tag2 = entry.tag2;
      card.tag2Color = entry.tag2Color;
    } else {
      card.tag = entry.tag;
      card.tagColor = entry.tagColor;
    }
    if (mode === 'grid4') { card.tag = ''; card.tag2 = ''; }
    card.url = entry.url || '';
  });
  syncAllCellUI();
  render();
  const baseMsg = `快速填入完成，共套用 ${entries.length} 格`;
  if (entries.length) statusEl.show(baseMsg, 'success');
  else statusEl.show('沒有找到任何「★」開頭的內容可以填入', 'error');
  if (entries.length) autoFetchImages(entries, baseMsg);
  // Once something was actually filled in, tuck the panel away (it stays open
  // when nothing matched, so the pasted text can be fixed); 「快速填入」 on the
  // left brings it back.
  if (entries.length) { quickfillOpen = false; syncChrome(); }
});
document.getElementById('quickfillClose').addEventListener('click', () => { quickfillOpen = false; syncChrome(); });
document.getElementById('quickfillReopen').addEventListener('click', () => {
  quickfillOpen = true;
  cellSelected = false;
  headerSelected = false;
  syncChrome();
  render();
});


const CONFIRM_DEFAULTS = {
  title: '確定要清除本頁？',
  body: '這會清空「本頁」所有格子目前的文字、標籤與圖片設定，且無法復原（不會影響另一頁）。',
  okText: '清除本頁',
};
function askConfirm(opts = {}) {
  const o = { ...CONFIRM_DEFAULTS, ...opts };
  document.getElementById('confirmTitle').textContent = o.title;
  document.getElementById('confirmBody').textContent = o.body;
  document.getElementById('confirmOkBtn').textContent = o.okText;
  const overlay = document.getElementById('confirmOverlay');
  overlay.classList.add('open');
  return new Promise(resolve => {
    const ok = document.getElementById('confirmOkBtn');
    const cancel = document.getElementById('confirmCancelBtn');
    function cleanup(result) {
      overlay.classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

document.getElementById('resetAllBtn').addEventListener('click', async () => {
  if (!(await askConfirm())) return;
  pages[activePageIndex] = makePageState(activePageIndex);
  cellSelected = false;
  headerSelected = false;
  setActiveCard(0, false);
  syncTopUIFromState();
  syncAllCellUI();
  render();
});

const helpOverlay = document.getElementById('helpOverlay');
document.getElementById('helpDetailBtn').addEventListener('click', () => helpOverlay.classList.add('open'));
document.getElementById('helpCloseBtn').addEventListener('click', () => helpOverlay.classList.remove('open'));
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) helpOverlay.classList.remove('open'); });
// >>> 原檔 4773-4798
const stickerHintShown = { news: false, ent: false };
const stickerPalette = document.getElementById('stickerPalette');
STICKER_DEFS.forEach(def => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sticker-btn';
  btn.title = '加入貼圖到目前選取的格子';
  const img = document.createElement('img');
  img.src = def.src;
  img.alt = '貼圖';
  btn.appendChild(img);
  btn.addEventListener('click', () => {
    const idx = activeCard;
    if (!cellSelected || idx < 0 || idx >= CELL_COUNT) { statusEl.show('先點預覽圖選一格，再加貼圖'); return; }
    const state = activePage().cards[idx];
    const cell = cellRect(idx, activePage().showHeader);
    state.stickers.push({ key: def.key, x: cell.x + cell.w / 2, y: cell.y + cell.h / 2, scale: 1 });
    render();
    // 新聞 and 娛樂: the first sticker added on any cell (per mode) gets a one-time how-to hint.
    if ((mode === 'news' || mode === 'ent') && !stickerHintShown[mode]) {
      stickerHintShown[mode] = true;
      statusEl.show('可拖曳移動、游標在貼圖上使用滑鼠滾輪縮放');
    }
  });
  stickerPalette.appendChild(btn);
});
// >>> 原檔 4800-4889
// ---------------------------------------------------------------------------
// 新聞 / 娛樂 mode switch
// ---------------------------------------------------------------------------
// 版面頁籤：公司模式＝新聞／娛樂（不提供四格 A）；通用模式＝六宮格／四格 A（公司版面與字樣都不出現）。
const modeTabsEl = document.querySelector('.mode-tabs');
(COMPANY ? ['news', 'ent'] : ['news', 'grid4']).forEach((m, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mode-tab' + (i === 0 ? ' active' : '');
  b.dataset.mode = m;
  b.textContent = LAYOUTS[m].name;
  modeTabsEl.appendChild(b);
});
const modeTabs = Array.from(document.querySelectorAll('.mode-tab'));
// 說明文字裡的「四格 A」只在通用模式出現
document.getElementById('helpGrid4').hidden = COMPANY;
const newsHeaderBox = document.getElementById('newsHeaderBox');
const modeSubEl = document.getElementById('modeSub');

function applyModeChrome() {
  const l = L();
  canvas.width = l.W;
  canvas.height = l.H;
  canvas.style.aspectRatio = `${l.W} / ${l.H}`;
  canvas.style.maxWidth = `${l.previewMaxWidth}px`;
  modeSubEl.textContent = l.sub;
  modeTabs.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  pageTabs.forEach(b => b.classList.toggle('active', Number(b.dataset.page) === activePageIndex));
  updateSegKnobs();
  fitPreviewSize();
  syncChrome();
}

// The preview is as large as the window allows: from where it starts (just under the top bar / page
// tabs) down to PREVIEW_DOCK_GAP above the floating dock — both measured from the real elements, so a
// shorter window, a wrapped dock or the compact short-window dock all keep the same breathing room
// above and below. Never above the mode's normal preview width, never narrower than the minimum below.
const PREVIEW_DOCK_GAP = 16;
function fitPreviewSize() {
  const l = L();
  if (window.innerWidth <= 900) { canvas.style.maxWidth = `${l.previewMaxWidth}px`; document.getElementById('stage').style.paddingBottom = ''; return; }
  const dock = document.getElementById('dock');
  const top = canvas.getBoundingClientRect().top + window.scrollY;   // does not depend on the canvas's own size
  const availH = dock.getBoundingClientRect().top - PREVIEW_DOCK_GAP - top;
  // Tall boards may go narrower than 320px so the whole thing still fits.
  const minW = Math.max(120, Math.min(320, 320 * l.W / l.H));
  const fit = Math.floor(availH * l.W / l.H);
  const w = clamp(fit, minW, l.previewMaxWidth);
  canvas.style.maxWidth = `${w}px`;
  // It fits above the dock, so the page itself needs no extra scroll room; only when the window is so
  // short that the minimum width wins does the page get room to scroll the preview clear of the dock.
  document.getElementById('stage').style.paddingBottom = fit < minW ? `${Math.ceil(dock.getBoundingClientRect().height) + 36}px` : '12px';
  alignFloatStack();
}
window.addEventListener('resize', fitPreviewSize);

// The quick-fill box is per mode too: its pasted text and open/closed state
// are stashed on switch and restored when coming back.
const quickfillText = document.getElementById('quickfillText');
const quickfillByMode = {
  news: { text: '', open: true },
  ent: { text: '', open: true },
  grid4: { text: '', open: true },
};

function setMode(newMode) {
  if (newMode === mode) return;
  pagesByMode[mode] = pages;
  pageIndexByMode[mode] = activePageIndex;
  quickfillByMode[mode] = { text: quickfillText.value, open: quickfillOpen };
  quickfillText.value = quickfillByMode[newMode].text;
  quickfillOpen = quickfillByMode[newMode].open;
  stepByMode[mode] = step;
  step = stepByMode[newMode];
  cellSelected = false;
  headerSelected = false;
  hideDlConfirm();
  hideLockReminder();
  hideGapTip(true);
  drag = null;
  tagDrag = null;
  lockProbe = null;
  stickerDrag = null;
  mode = newMode;
  applyModeGlobals();
  pages = pagesByMode[mode] || [makePageState(0), makePageState(1)];
  activePageIndex = pageIndexByMode[mode];
  applyModeChrome();
  buildAllCardUI();
  syncTopUIFromState();
  syncAllCellUI();
  setActiveCard(0, false);
}

modeTabs.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

// ---------------------------------------------------------------------------
// 兩步驟流程與浮動面板：1 編輯畫面 → 2 畫面檢查（鎖定照片、開放下載）
// ---------------------------------------------------------------------------
function goStep(n) {
  hideGapTip(true);
  n = n === 2 ? 2 : 1;
  if (n === step) return;
  step = n;
  stepByMode[mode] = n;
  hideDlConfirm();
  hideLockReminder();
  headerSelected = false;
  cellSelected = false;   // each step starts with nothing picked
  drag = null; tagDrag = null; stickerDrag = null; lockProbe = null;
  syncChrome();
  render();
}
document.querySelectorAll('.step-btn').forEach(b => b.addEventListener('click', () => { const n = Number(b.dataset.step); if (n === 2 && step === 1 && !canLeaveStep1()) return; goStep(n); }));
document.getElementById('nextStepBtn').addEventListener('click', () => { if (canLeaveStep1()) goStep(2); });
document.getElementById('backStepBtn').addEventListener('click', () => goStep(1));

// Clicking empty space (not a panel, the preview or a button) un-picks the cell.
document.getElementById('stage').addEventListener('mousedown', e => {
  const id = e.target.id;
  if (id === 'stage' || id === 'centerCol' || id === 'canvasWrap') clearSelection();
});

// Dragging a photo, tag or sticker while step 2 has them locked.
const lockToast = document.getElementById('lockToast');
const LOCK_TOAST_MS = 3000;
let lockToastTimer = null;
function showLockReminder() {
  hideStatusToast();
  clearTimeout(lockToastTimer);
  lockToast.hidden = false;
  void lockToast.offsetWidth;
  lockToast.classList.add('show');
  lockToastTimer = setTimeout(hideLockReminder, LOCK_TOAST_MS);
}
function hideLockReminder() {
  clearTimeout(lockToastTimer);
  lockToast.classList.remove('show');
  lockToast.hidden = true;
}
document.getElementById('lockToastBtn').addEventListener('click', () => { hideLockReminder(); goStep(1); });

// >>> 原檔 5186-5482
function renderCheckPanel() {
  const panel = document.getElementById('checkPanel');
  const pg = activePage();
  let bad = 0, warn = 0;
  const rows = pg.cards.map((st, i) => {
    const miss = cardMissing(st);
    const gap = cardHasGap(pg, i);
    bad += miss.length;
    if (gap) warn++;
    return { st, i, miss, gap };
  });
  panel.textContent = '';
  const head = document.createElement('div');
  head.className = 'check-head';
  head.append('畫面檢查');
  const sum = document.createElement('small');
  sum.className = bad ? 'bad' : (warn ? 'warn' : 'ok');
  sum.textContent = bad ? `${bad} 項待補` : (warn ? `${warn} 格疑似露白` : '全部通過');
  head.appendChild(sum);
  panel.appendChild(head);
  rows.forEach(({ st, i, miss, gap }) => {
    const row = document.createElement('div');
    row.className = 'check-row' + (cellSelected && i === activeCard ? ' sel' : '');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
    const t = document.createElement('span'); t.className = 't';
    const title = [st.line1, st.line2].map(x => (x || '').trim()).filter(Boolean).join(' ');
    t.textContent = title || (mode === 'grid4' ? '（無說明）' : '尚未填入');
    if (!title) t.classList.add('empty');
    row.append(n, t);
    const mark = (kind, text, title) => {
      const slot = document.createElement('span'); slot.className = 'chip-slot';
      const d = document.createElement('i'); d.className = `dot ${kind}`; d.textContent = text; d.title = title;
      slot.appendChild(d); row.appendChild(slot);
    };
    if (miss.includes('圖片')) mark('bad', '!', '缺圖片');
    else if (gap) mark('warn', '!', cardGapReason(pg, i) || '圖片疑似露白');
    else mark('ok', '圖', '圖片 OK');
    if (mode === 'grid4') { /* 說明選填，不檢查 */ }
    else if (miss.includes('標題')) mark('bad', '!', '缺標題');
    else mark('ok', '字', '標題 OK');
    row.addEventListener('click', () => setActiveCard(i));
    panel.appendChild(row);
  });
  const note = document.createElement('div');
  note.className = 'check-note';
  note.textContent = bad
    ? '紅色「!」＝缺圖片或缺標題，補齊前不能全部下載；黃色「!」＝圖片疑似露白，仍可下載。要修改請按下方「返回編輯」。'
    : (warn
      ? '黃色「!」＝圖片疑似露白，仍可下載，下載前會再確認；要調整請按下方「返回編輯」。'
      : (mode === 'grid4' ? '每格都有圖。' : '每格都有圖、有標題。'));
  panel.appendChild(note);
  // The other page counts too: 全部下載 needs both pages complete.
  const otherIdx = 1 - activePageIndex;
  const other = pages[otherIdx];
  const ob = pageMissingReport(other).length, og = pageGapCount(other);
  const line = document.createElement('div');
  line.className = 'check-other';
  line.append(`第 ${otherIdx + 1} 頁：${ob ? `${ob} 項待補` : (og ? `${og} 格疑似露白` : '全部通過')}`);
  const go = document.createElement('button');
  go.type = 'button';
  go.textContent = '前往';
  go.addEventListener('click', () => document.querySelector(`.page-tab[data-page="${otherIdx}"]`).click());
  line.appendChild(go);
  panel.appendChild(line);
}

// The left panels sit right beside the preview image (a small gap away, not at the
// window edge) and start level with the top of it.
const PANEL_W = 300, PANEL_GAP = 18, STACK_PAD_X = 18;   // content width, gap to the preview, stack's side padding
function alignFloatStack() {
  const stack = document.getElementById('floatStack');
  const stage = document.getElementById('stage');
  if (!stack || !stage) return;
  if (window.innerWidth <= 900) { stage.style.paddingLeft = ''; stack.style.top = ''; stack.style.left = ''; stack.style.maxHeight = ''; return; }
  // Keep the preview centred on the window; only when there isn't room for the panel
  // on its left does it shift right, by just enough.
  const W = window.innerWidth, cw = canvas.getBoundingClientRect().width;
  const need = PANEL_W + PANEL_GAP + STACK_PAD_X + 12;   // canvas left edge must be at least this far from the window edge
  stage.style.paddingLeft = `${Math.max(20, Math.round(2 * need - W + 20 + cw))}px`;
  const sr = stage.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  const top = Math.max(0, Math.round(cr.top - sr.top) - 8);   // 8 = the stack's own top padding
  const left = Math.max(2, Math.round(cr.left - sr.left - PANEL_GAP - PANEL_W - STACK_PAD_X));
  stack.style.top = `${top}px`;
  stack.style.left = `${left}px`;
  stack.style.maxHeight = `${Math.max(200, window.innerHeight - sr.top - top - 104)}px`;
}
window.addEventListener('resize', alignFloatStack);
document.getElementById('headerOpenBtn').addEventListener('click', openHeaderEditor);

document.getElementById('edgeCheckToggle').addEventListener('change', e => {
  edgeCheckOn = e.target.checked;
  hideGapTip(true);
  render();
});

// Hover pop-up for the "!" marks drawn on the preview (step 2, or step 1 with the edge-check switch on).
const gapTip = document.getElementById('gapTip');
let gapTipCell = -1, gapTipTimer = null, gapTipHideTimer = null;
const GAP_TIP_FADE_DELAY_MS = 1000;
function badgeCellAt(pos) {
  if (!isLocked()) return -1;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!cardBadgeKind(activePage(), i)) continue;
    const a = badgeAnchor(i, activePage().showHeader);
    if (Math.hypot(pos.x - a.x, pos.y - a.y) <= 19) return i;
  }
  return -1;
}
function showGapTip(i) {
  clearTimeout(gapTipTimer); clearTimeout(gapTipHideTimer);
  gapTipCell = i;
  const t = cardBadgeText(activePage(), i);
  gapTip.textContent = '';
  const b = document.createElement('b'); b.textContent = `第 ${i + 1} 格　${t.title}`;
  gapTip.append(b, t.body);
  gapTip.hidden = false;
  const r = canvas.getBoundingClientRect();
  const a = badgeAnchor(i, activePage().showHeader);
  const sx = r.left + a.x * r.width / CANVAS_W, sy = r.top + a.y * r.height / CANVAS_H;
  gapTip.style.left = '0px'; gapTip.style.top = '0px';
  const w = gapTip.offsetWidth, h = gapTip.offsetHeight;
  gapTip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, sx + 20))}px`;
  gapTip.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, sy + 20))}px`;
  void gapTip.offsetWidth;
  gapTip.classList.add('show');
}
// Pointer left the "!": wait a second, then fade out (immediately when `now`).
function hideGapTip(now) {
  clearTimeout(gapTipTimer); clearTimeout(gapTipHideTimer);
  gapTipCell = -1;
  if (gapTip.hidden) return;
  const fade = () => { gapTip.classList.remove('show'); gapTipHideTimer = setTimeout(() => { gapTip.hidden = true; }, 300); };
  if (now) { gapTip.classList.remove('show'); gapTip.hidden = true; return; }
  gapTipTimer = setTimeout(fade, GAP_TIP_FADE_DELAY_MS);
}
canvas.addEventListener('mousemove', evt => {
  const i = badgeCellAt(getCanvasPos(evt));
  if (i >= 0) { if (i !== gapTipCell || gapTip.hidden || !gapTip.classList.contains('show')) showGapTip(i); }
  else if (gapTipCell >= 0) hideGapTip(false);
});
canvas.addEventListener('mouseleave', () => { if (gapTipCell >= 0) hideGapTip(false); });

// One place that decides what is visible for the current mode / step / selection.
// Dock items that depend on what is on the pages: 「下一步」 stays greyed out until either page has
// something on it, 貼圖 are dimmed until a cell is picked, 下載本頁 needs this page to have content.
function pageIsEdited(pg) {
  return pg.cards.some(c => c.img || (c.line1 || '').trim() || (c.line2 || '').trim() || (c.tag || '').trim() || (c.tag2 || '').trim() || c.stickers.length);
}
function syncDockContext() {
  if (!chromeReady) return;
  const $ = id => document.getElementById(id);
  const editing = step === 1;
  const checking = step === 2;
  $('g4Colors').hidden = !(mode === 'grid4' && editing);
  $('dockStickers').hidden = checking;
  $('dockSep').hidden = checking;
  $('stickerPalette').classList.toggle('need-cell', !cellSelected);
  $('edgeSwitch').hidden = !editing;
  $('resetAllBtn').hidden = checking;
  const blank = editing && !pages.some(pageIsEdited);
  const next = $('nextStepBtn');
  next.classList.toggle('is-disabled', blank);
  next.setAttribute('aria-disabled', blank ? 'true' : 'false');
  if (blank) next.dataset.tip = NEXT_BLANK_TIP; else delete next.dataset.tip;
  $('downloadJpgBtn').hidden = !(checking && pageIsEdited(activePage()));
}
const NEXT_BLANK_TIP = '請先貼上快速填入或放入照片';
// 步驟 2 is closed while both pages are blank (the 下一步 button and the stepper's ②).
function canLeaveStep1() {
  if (pages.some(pageIsEdited)) return true;
  statusEl.show(NEXT_BLANK_TIP);
  return false;
}

function syncChrome() {
  if (!chromeReady) return;
  const $ = id => document.getElementById(id);
  const editing = step === 1;
  const checking = step === 2;

  document.querySelectorAll('.step-btn').forEach(b => {
    const n = Number(b.dataset.step);
    b.classList.toggle('active', n === step);
    b.classList.toggle('done', n < step);
    b.querySelector('i').textContent = n < step ? '✓' : String(n);
  });
  $('stepLine').classList.toggle('done', step === 2);

  const idle = editing && !cellSelected && !headerSelected;
  $('quickfillBox').hidden = !(idle && quickfillOpen);
  $('quickfillReopen').hidden = !(editing && !quickfillOpen);
  $('newsHeaderBox').hidden = !(COMPANY && mode === 'news' && editing && headerSelected);
  // Both buttons live in the top bar, right of the mode tabs. The yellow bar can be
  // unticked away; its button is then the way back in.
  $('headerOpenBtn').hidden = !(COMPANY && mode === 'news' && editing && !activePage().showHeader);
  $('tbTools').hidden = $('quickfillReopen').hidden && $('headerOpenBtn').hidden;
  $('cellsList').hidden = !(cellSelected && !checking);
  $('checkPanel').hidden = !checking;
  if (checking) renderCheckPanel();

  document.querySelectorAll('.page-tab').forEach(b => b.classList.toggle('active', Number(b.dataset.page) === activePageIndex));
  updateSegKnobs();

  $('dock').classList.toggle('checking', checking);
  $('nextStepBtn').hidden = !editing;
  $('backStepBtn').hidden = !checking;
  $('downloadJpgBtn').textContent = '下載本頁';
  $('downloadAllBtn').hidden = !checking;
  $('downloadAllBtn').textContent = '全部下載';
  syncDockContext();
  updateDownloadState();
  alignFloatStack();
  fitPreviewSize();   // the page tabs / dock buttons just changed what is above and below the preview
}

// ---- sliding knob for the 新聞/娛樂/拼圖 and 頁數 capsules (also draggable) ----------------
function segKnobOf(track) {
  let k = track.querySelector(':scope > .seg-knob');
  if (!k) { k = document.createElement('span'); k.className = 'seg-knob'; track.prepend(k); }
  return k;
}
function placeSegKnob(track, btn) {
  btn = btn || track.querySelector(':scope > button.active');
  if (!btn || !btn.offsetWidth) return;
  const k = segKnobOf(track);
  k.style.width = `${btn.offsetWidth}px`;
  k.style.transform = `translateX(${btn.offsetLeft}px)`;
  if (!track.classList.contains('ready')) { void k.offsetWidth; requestAnimationFrame(() => track.classList.add('ready')); }
}
function updateSegKnobs() {
  document.querySelectorAll('.seg-track').forEach(t => { if (!t.classList.contains('dragging')) placeSegKnob(t); });
}
document.querySelectorAll('.mode-tabs, .page-tabs').forEach(track => {
  track.classList.add('seg-track');
  segKnobOf(track);
  if (window.ResizeObserver) new ResizeObserver(updateSegKnobs).observe(track);
  const btns = () => Array.from(track.querySelectorAll(':scope > button'));
  let down = null, moved = false;
  track.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const cur = track.querySelector(':scope > button.active');
    if (!cur) return;
    down = { x: e.clientX, id: e.pointerId, left: cur.offsetLeft, w: cur.offsetWidth };
    moved = false;
  });
  const nearest = cx => {   // the button whose centre is closest to knob-centre cx (track coordinates)
    let best = null, bd = Infinity;
    btns().forEach(b => { const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - cx); if (d < bd) { bd = d; best = b; } });
    return best;
  };
  track.addEventListener('pointermove', e => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x;
    if (!moved) {
      if (Math.abs(dx) < 5) return;
      moved = true;
      track.classList.add('dragging');
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture */ }
    }
    const bs = btns();
    const min = bs[0].offsetLeft, max = bs[bs.length - 1].offsetLeft + bs[bs.length - 1].offsetWidth - down.w;
    const left = Math.max(min, Math.min(max, down.left + dx));
    segKnobOf(track).style.transform = `translateX(${left}px)`;
    const hot = nearest(left + down.w / 2);
    bs.forEach(b => b.classList.toggle('hot', b === hot));
  });
  const end = e => {
    if (!down || (e && e.pointerId !== down.id)) return;
    const wasDrag = moved;
    down = null; moved = false;
    if (!wasDrag) return;
    const hot = track.querySelector(':scope > button.hot');
    track.classList.remove('dragging');
    btns().forEach(b => b.classList.remove('hot'));
    if (hot && !hot.classList.contains('active')) hot.click();
    placeSegKnob(track);
    // the click that follows a drag must not re-trigger a button
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    track.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => track.removeEventListener('click', stop, { capture: true }), 0);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
});
updateSegKnobs();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateSegKnobs);
window.addEventListener('resize', updateSegKnobs);


// ---------------------------------------------------------------------------
// 啟動
// ---------------------------------------------------------------------------
quickfillText.placeholder = COMPANY
  ? '★標題第一行 標題第二行\n整段過審推播新聞貼入即可\n標題含有空格或驚嘆號、問號，就會自動換行\n（連結會自動抓文章第一張圖）'
  : '★標題第一行 標題第二行\n標題含有空格或驚嘆號、問號，就會自動換行\n（下一行貼上文章網址，會自動抓文章第一張圖）';
chromeReady = true;
applyModeChrome();
render();
headlineFontReady.then(render);
document.fonts.ready.then(render);
templatesReady.then(render);
stickersReady.then(render);
if (COMPANY) document.getElementById('stickerLabel').textContent = 'T寶貼圖';
