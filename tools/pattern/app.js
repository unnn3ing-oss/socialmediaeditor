const PA = window.PATTERN;
const COMPANY = !!PA.company;
let fieldUid = 0; // 動態欄位的 id（label 對應用）

// 畫圖核心在 ui/compose/render.js（和「排程發布」共用），tool.js 載入後放在 PA.compose／PA.renderer。
// 這裡把名稱接成全域，stickers.js、quickfill.js 與下面的批次介面照舊使用。
const {
  SIZE, PRESET_COLORS, MAX_ZOOM, newView, coverGeometry, clampView, loadImg, hasBackground,
  GEN_COLORS, GEN_DEFAULT, GEN_TITLE_X, GEN_TITLE_MAX_W, GEN_L1, GEN_L1_BASE, GEN_L2_BASE,
  BOX_CENTER, LINE_HEIGHT_RATIO, MAX_TITLE_LINES, anchorY, CANVA_TO_PX,
  DEFAULT_CANVA_SIZE_IMAGE, DEFAULT_CANVA_SIZE_COLOR, FONT_SIZE_MIN, FONT_SIZE_MAX,
  canvaToPx, defaultCanvaSizeFor, effectiveCanvaSize, titleRows, parseLines, usesDarkTitle
} = PA.compose;
const { titleFont, fitFontSize, drawImageCover, renderComposite } = PA.renderer;
// 素材載好後要重畫的地方等這幾個（都是同一個 ready）
const ribbonReady = PA.renderer.ready, ribbonNewsReady = PA.renderer.ready, logoReady = PA.renderer.ready;
const whzFontReady = PA.fontReady || Promise.resolve();   // 字型（背景載入）；預覽與輸出前都會等它

// Stepper widget: [－] [number] [＋], number also responds to mouse-wheel
// while hovered/focused. Used for both single mode and each batch item.
function createFontStepper({ initial, onChange }) {
  const root = document.createElement('div');
  root.className = 'font-stepper';

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'step-btn';
  minusBtn.textContent = '－';

  const valueEl = document.createElement('div');
  valueEl.className = 'step-value';
  valueEl.tabIndex = 0;

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'step-btn';
  plusBtn.textContent = '＋';

  let value = initial;
  let locked = false;

  function setValue(next, fire) {
    if (fire && locked) return;
    value = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next));
    valueEl.textContent = value;
    if (fire) onChange(value);
  }

  function setLocked(on) {
    locked = on;
    root.classList.toggle('locked', on);
    minusBtn.disabled = plusBtn.disabled = on;
    valueEl.tabIndex = on ? -1 : 0;
  }

  minusBtn.addEventListener('click', () => setValue(value - 1, true));
  plusBtn.addEventListener('click', () => setValue(value + 1, true));
  valueEl.addEventListener('wheel', e => {
    if (locked) return;
    e.preventDefault();
    setValue(value + (e.deltaY < 0 ? 1 : -1), true);
  }, { passive: false });
  // Press on the number and drag up/down to scrub the value (up = bigger),
  // one step per SCRUB_PX of vertical travel.
  const SCRUB_PX = 8;
  let scrub = null;
  valueEl.addEventListener('pointerdown', e => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    scrub = { id: e.pointerId, startY: e.clientY, startValue: value };
    valueEl.setPointerCapture(e.pointerId);
    root.classList.add('scrubbing');
  });
  valueEl.addEventListener('pointermove', e => {
    if (!scrub || e.pointerId !== scrub.id) return;
    const next = scrub.startValue + Math.round((scrub.startY - e.clientY) / SCRUB_PX);
    const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next));
    if (clamped !== value) setValue(clamped, true);
  });
  const endScrub = e => {
    if (!scrub || e.pointerId !== scrub.id) return;
    scrub = null;
    root.classList.remove('scrubbing');
  };
  valueEl.addEventListener('pointerup', endScrub);
  valueEl.addEventListener('pointercancel', endScrub);
  valueEl.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); setValue(value + 1, true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setValue(value - 1, true); }
  });

  root.appendChild(minusBtn);
  root.appendChild(valueEl);
  root.appendChild(plusBtn);
  setValue(initial, false);

  return { root, setValue: v => setValue(v, false), getValue: () => value, setLocked };
}

const FONT_HINT_IMAGE = '圖片背景固定使用字級 50，無法調整';
const FONT_HINT_COLOR = '純色背景可調整字級，預設 60';

function syncFontStepperLock(stepper, hintEl, bg) {
  const isImage = !bg || bg.type === 'image';
  if (isImage) stepper.setValue(DEFAULT_CANVA_SIZE_IMAGE);
  stepper.setLocked(isImage);
  hintEl.textContent = isImage ? FONT_HINT_IMAGE : FONT_HINT_COLOR;
}

// Sizes and positions the on-image edit box with the same geometry drawTitle
// uses (fitted font size, line height, vertical anchor), so the caret sits on
// the canvas-rendered headline. It's a DOM element, so it never gets exported.
const TITLE_PAD_X = 60;
const TITLE_BOX_PAD_Y = 12;

function layoutTitleOverlay(overlay, canvasEl, bg, title, canvaSize, frame) {
  overlay.classList.toggle('on-light', usesDarkTitle(bg));
  overlay.style.fontWeight = PA.fontLoaded ? 'normal' : '900';
  const k = canvasEl.clientWidth / SIZE;
  if (!k) return;
  if (frame === 'generic' && !(bg && bg.type === 'color')) {
    // 通用框：標題靠左、第一行 72px 基線 915（只有一行時 995），每行 80px
    const rowsG = titleRows(title);
    const drawnG = Math.max(1, Math.min(2, rowsG.lines.length));
    const leadG = rowsG.lines.length ? rowsG.lead : 0;
    const lineH = 80;
    const sizeG = fitFontSize(canvasEl.getContext('2d'), rowsG.lines.length ? [rowsG.lines[0]] : ['點兩下輸入內容'], GEN_TITLE_MAX_W, GEN_L1, 900);
    const firstBase = drawnG === 2 ? GEN_L1_BASE : GEN_L2_BASE;
    const topG = firstBase - 66 - leadG * lineH - TITLE_BOX_PAD_Y;
    overlay.style.textAlign = 'left';
    overlay.style.left = `${canvasEl.offsetLeft + (GEN_TITLE_X - 8) * k}px`;
    overlay.style.top = `${canvasEl.offsetTop + topG * k}px`;
    overlay.style.width = `${(GEN_TITLE_MAX_W + 16) * k}px`;
    overlay.style.height = `${(Math.max(1, rowsG.total) * lineH + TITLE_BOX_PAD_Y * 2) * k}px`;
    overlay.style.paddingTop = overlay.style.paddingBottom = `${Math.max(0, TITLE_BOX_PAD_Y * k - 2)}px`;
    overlay.style.paddingLeft = `${8 * k}px`;
    overlay.style.fontSize = `${sizeG * k}px`;
    overlay.style.lineHeight = `${lineH * k}px`;
    return;
  }
  overlay.style.textAlign = '';
  overlay.style.paddingLeft = '';
  const measured = parseLines(title);
  const measureCtx = canvasEl.getContext('2d');
  measureCtx.save();
  const fontSize = fitFontSize(measureCtx, measured.length ? measured : ['點兩下輸入內容'], SIZE - TITLE_PAD_X * 2, canvaToPx(canvaSize));
  measureCtx.restore();
  const lineHeight = fontSize * LINE_HEIGHT_RATIO;
  // 畫布只畫「第一行有字～最後一行有字」那一段並置中；輸入框要讓有字的那幾行對準畫布上的字，
  // 所以開頭多出來的空行往上推、結尾多出來的空行往下長，游標才會落在畫面文字的位置。
  const rows = titleRows(title);
  const drawn = Math.max(1, rows.lines.length);
  const lineCount = Math.max(1, rows.total);
  const lead = rows.lines.length ? rows.lead : 0;
  const centerY = anchorY(bg && bg.type === 'color' ? SIZE / 2 : BOX_CENTER, Math.min(drawn, MAX_TITLE_LINES), lineHeight);
  const top = centerY - drawn * lineHeight / 2 - lead * lineHeight - TITLE_BOX_PAD_Y;
  const border = 2;
  overlay.style.left = `${canvasEl.offsetLeft + TITLE_PAD_X * k}px`;
  overlay.style.top = `${canvasEl.offsetTop + top * k}px`;
  overlay.style.width = `${(SIZE - TITLE_PAD_X * 2) * k}px`;
  overlay.style.height = `${(lineCount * lineHeight + TITLE_BOX_PAD_Y * 2) * k}px`;
  overlay.style.paddingTop = overlay.style.paddingBottom = `${Math.max(0, TITLE_BOX_PAD_Y * k - border)}px`;
  overlay.style.fontSize = `${fontSize * k}px`;
  overlay.style.lineHeight = `${lineHeight * k}px`;
}

function titlePlaceholder(frame) {
  return frame === 'generic'
    ? '大標題（第一行）\n副標題（第二行，可不填）'
    : '黑人心梗主因曝！\n醫示警「1行為」\n悄悄埋下未爆彈';
}

let batchFx = null;    // 貼圖／馬賽克（stickers.js 設定）：{ forItem(item) -> 那一組的 fx, onView() -> 預覽的對象換了／畫面要更新 }

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;

function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  // some browsers/OS report no MIME type for certain formats (e.g. HEIC) — fall back to extension
  return IMAGE_EXT_RE.test(file.name || '');
}

// Reusable background picker: "upload image" vs "solid color" toggle, used by
// single mode and by each batch item block.
// opts: onImage / onColor / onModeChange(mode, remembered) / getBg() / memory (optional, caller-owned).
// opts.randomColor（側邊欄用）：按「純色背景」時隨機挑一個現有色票來用（不還原上次的顏色）；已經在純色背景時再按不會重抽。
// The picker remembers the last background of each type, so flipping 圖片背景 → 純色背景 → 圖片背景
// brings the picture (with its pan/zoom) back instead of throwing it away. getBg() returns the
// caller's current bg object; onModeChange receives the remembered one (or null) for the new type.
function createBackgroundPicker(opts) {
  const root = document.createElement('div');
  const memory = opts.memory || {};   // { image: { bg, fileName }, color: { bg } }
  let lastFileName = '';

  const toggle = document.createElement('div');
  toggle.className = 'bg-toggle';
  const btnImage = document.createElement('button');
  btnImage.type = 'button';
  btnImage.textContent = '圖片背景';
  btnImage.className = 'active';
  const btnColor = document.createElement('button');
  btnColor.type = 'button';
  btnColor.textContent = '純色背景';
  toggle.appendChild(btnImage);
  toggle.appendChild(btnColor);

  const imageSection = document.createElement('div');
  const dz = document.createElement('div');
  dz.className = 'dropzone';
  dz.tabIndex = 0;
  const thumb = document.createElement('img');
  thumb.className = 'batch-item-thumb';
  thumb.alt = '';
  thumb.style.display = 'none';
  const dzText = document.createElement('div');
  dzText.innerHTML = '點擊選擇圖片<br>或拖曳／貼上（Ctrl+V）圖片到此處';
  const fi = document.createElement('input');
  fi.type = 'file';
  fi.accept = 'image/*';
  dz.appendChild(thumb);
  dz.appendChild(dzText);
  dz.appendChild(fi);
  const hint = document.createElement('div');
  hint.className = 'hint';
  imageSection.appendChild(dz);
  imageSection.appendChild(hint);

  const colorSection = document.createElement('div');
  colorSection.className = 'color-swatches';
  colorSection.style.display = 'none';
  let selectedSwatch = null;
  PRESET_COLORS.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      if (selectedSwatch) selectedSwatch.classList.remove('selected');
      sw.classList.add('selected');
      selectedSwatch = sw;
      opts.onColor(hex);
    });
    colorSection.appendChild(sw);
  });

  function setModeVisual(mode) {
    const isColor = mode === 'color';
    btnImage.classList.toggle('active', !isColor);
    btnColor.classList.toggle('active', isColor);
    imageSection.style.display = isColor ? 'none' : '';
    colorSection.style.display = isColor ? 'flex' : 'none';
  }
  // A toggle click or an explicit reset always starts that mode fresh —
  // clear both sections' leftover visuals so a stale thumbnail/swatch
  // selection never lingers after the underlying state was cleared.
  function clearImageVisual() {
    thumb.src = '';
    thumb.style.display = 'none';
    dzText.style.display = '';
    hint.textContent = '';
  }
  function clearColorVisual() {
    if (selectedSwatch) { selectedSwatch.classList.remove('selected'); selectedSwatch = null; }
  }
  // Remember what the caller currently has under the type we're leaving.
  function remember() {
    const bg = opts.getBg && opts.getBg();
    if (!bg) return;
    if (bg.type === 'image' && bg.image) memory.image = { bg, fileName: lastFileName };
    else if (bg.type === 'color' && bg.color) memory.color = { bg };
  }
  function selectSwatch(hex) {
    const sw = Array.from(colorSection.children).find(el => el.title === hex);
    if (!sw) return;
    if (selectedSwatch) selectedSwatch.classList.remove('selected');
    sw.classList.add('selected');
    selectedSwatch = sw;
  }
  function showImage(image, fileName) {
    thumb.src = image.src;
    thumb.style.display = 'block';
    dzText.style.display = 'none';
    hint.textContent = `已載入：${fileName}`;
  }
  // fresh=true (the 全部清除 reset) forgets everything; a toggle click restores the remembered one.
  function setMode(mode, fresh = false) {
    if (fresh) { delete memory.image; delete memory.color; } else remember();
    setModeVisual(mode);
    clearImageVisual();
    clearColorVisual();
    let kept = fresh ? null : memory[mode] || null;
    if (mode === 'color' && !fresh && opts.randomColor) {
      kept = { bg: { type: 'color', image: null, color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)] } };
    }
    if (kept && mode === 'image') showImage(kept.bg.image, kept.fileName);
    if (kept && mode === 'color') selectSwatch(kept.bg.color);
    if (opts.onModeChange) opts.onModeChange(mode, kept ? kept.bg : null);
  }
  btnImage.addEventListener('click', () => setMode('image'));
  btnColor.addEventListener('click', () => {
    if (opts.randomColor && btnColor.classList.contains('active')) return;
    setMode('color');
  });

  let currentUrl = null;

  function handleFile(file) {
    if (!isImageFile(file)) {
      hint.textContent = file ? `無法辨識「${file.name}」為圖片檔` : '';
      return;
    }
    // Object URL instead of FileReader→data URL: no base64 copy (+33% memory) and no extra decode pass.
    // The previous picture's URL is released once this one replaces it; the current one stays alive
    // because batch mode re-reads image.src to rebuild the thumbnail.
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onerror = () => {
      URL.revokeObjectURL(url);
      hint.textContent = `「${file.name}」無法開啟，可能是不支援的圖片格式（例如 HEIC），請改用 JPG/PNG`;
    };
    image.onload = () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = url;
      remember();                       // loading a picture while on 純色背景 (e.g. 快速產圖) keeps that colour for later
      lastFileName = file.name;
      setModeVisual('image');           // the toggle must follow: the picture is now the background
      showImage(image, file.name);
      opts.onImage(image, file.name);
    };
    image.src = url;
  }

  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('focus', () => { if (opts.onFocus) opts.onFocus(); });
  fi.addEventListener('change', e => handleFile(e.target.files[0]));
  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('drag');
    if (opts.onFocus) opts.onFocus();
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag');
    if (opts.onFocus) opts.onFocus();
    handleFile(e.dataTransfer.files[0]);
  });

  root.appendChild(toggle);
  root.appendChild(imageSection);
  root.appendChild(colorSection);

  function restoreImage(image, fileName) {
    lastFileName = fileName;
    setModeVisual('image');
    showImage(image, fileName);
  }

  function restoreColor(hex) {
    setModeVisual('color');
    selectSwatch(hex);
  }

  return { root, handleFile, setMode, reset: () => setMode('image', true), restoreImage, restoreColor, memory };
}

document.addEventListener('paste', e => {
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      routeFileToExpandedBatchItem(item.getAsFile());
      break;
    }
  }
});

// Canvas PNG exports carry no DPI metadata, so design/print tools that read
// it (Photoshop, InDesign, print pipelines) fall back to 72/96 DPI and
// misjudge the physical size of the same pixels. This tags every exported
// PNG at PNG_DPI by inserting a pHYs chunk right after IHDR, which PNG
// requires to be the very first chunk with a fixed 13-byte data payload —
// so its total chunk length (4 length + 4 type + 13 data + 4 crc) is
// always exactly 25 bytes, right after the 8-byte PNG signature.
const PNG_DPI = 300;

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
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

function writeUint32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xFF;
  bytes[offset + 1] = (value >>> 16) & 0xFF;
  bytes[offset + 2] = (value >>> 8) & 0xFF;
  bytes[offset + 3] = value & 0xFF;
}

// Canvas → PNG Blob with the pHYs chunk spliced in. Works on the raw bytes and
// builds a Blob from the pieces, so there's no base64 round trip (the old
// data-URL path blocked the page for ~0.5s on a photo-heavy 1080×1080 export).
async function pngBlobWithDpi(targetCanvas, dpi) {
  const blob = await new Promise((resolve, reject) =>
    targetCanvas.toBlob(b => (b ? resolve(b) : reject(new Error('產生圖片失敗'))), 'image/png'));
  const pixelsPerMeter = Math.round(dpi / 0.0254);
  const physChunk = new Uint8Array(4 + 4 + 9 + 4); // length + "pHYs" + data + crc
  writeUint32BE(physChunk, 0, 9);
  physChunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  writeUint32BE(physChunk, 8, pixelsPerMeter);
  writeUint32BE(physChunk, 12, pixelsPerMeter);
  physChunk[16] = 1; // unit specifier: meter
  writeUint32BE(physChunk, 17, pngCrc32(physChunk.subarray(4, 17)));
  const ihdrEnd = 8 + 25;
  return new Blob([blob.slice(0, ihdrEnd), physChunk, blob.slice(ihdrEnd)], { type: 'image/png' });
}

// 結果圖的 object URL：換掉或刪除項目時要 revoke
function setItemResultUrl(item, url) {
  if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  item.resultUrl = url;
}

// ---- 批次（每張圖一組；網頁版固定用批次）----
const batchItemsList = document.getElementById('batchItemsList');
const addBatchItemBtn = document.getElementById('addBatchItemBtn');
const batchDownloadAllBtn = document.getElementById('batchDownloadAllBtn');
const batchResetBtn = document.getElementById('batchResetBtn');
const batchCanvas = document.getElementById('batchCanvas');
const batchCtx = batchCanvas.getContext('2d');
const batchStatus = document.getElementById('batchStatus');
const batchThumbs = document.getElementById('batchThumbs');
const batchThumbsShelf = document.getElementById('batchThumbsShelf');
const batchThumbsPrev = document.getElementById('batchThumbsPrev');
const batchThumbsNext = document.getElementById('batchThumbsNext');
batchThumbsPrev.addEventListener('click', () => batchThumbs.scrollBy({ left: -batchThumbs.clientWidth * 0.8 }));
batchThumbsNext.addEventListener('click', () => batchThumbs.scrollBy({ left: batchThumbs.clientWidth * 0.8 }));
// A plain mouse wheel scrolls the row sideways (trackpads already do).
batchThumbs.addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  if (batchThumbs.scrollWidth <= batchThumbs.clientWidth) return;
  e.preventDefault();
  batchThumbs.scrollBy({ left: e.deltaY });
}, { passive: false });
batchThumbs.addEventListener('scroll', () => updateThumbNav(), { passive: true });
new ResizeObserver(() => updateThumbNav()).observe(batchThumbs);
const batchPreviewTitle = document.getElementById('batchPreviewTitle');

let batchItems = [];   // { id, title, bg: {type,image,color}, frame, fontSize, fontSizeTouched, done, resultBlob, resultUrl（blob 的 object URL，縮圖／預覽用）, resultFilename }
let batchIdCounter = 0;

function isItemDone(item) {
  return !!(item.done && item.resultUrl);
}
// Only one item's full edit block is shown at a time (accordion); every
// other item collapses into a summary row, whether it's done or not.
let expandedBatchItemId = null;

function scrollToBatchItem(id) {
  const node = batchItemsList.querySelector(`[data-item-id="${id}"]`);
  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// The caption under the big preview always mirrors the title as one line
// (line breaks become a full-width space instead), no extension needed.
// 預覽的對象換了（或沒有對象了）時，讓貼圖／馬賽克的操作方框跟著換（網頁版）
function syncBatchFx() { if (batchFx) batchFx.onView(); }

function setBatchPreviewTitle(item) {
  batchPreviewTitle.textContent = parseLines(item.title).filter(Boolean).join('　');
  if (document.activeElement !== batchPreviewTitleInput) batchPreviewTitleInput.value = item.title;
  batchPreviewTitleInput.hidden = false;
  layoutTitleOverlay(batchPreviewTitleInput, batchCanvas, item.bg, item.title, effectiveCanvaSize(item.bg, item.fontSize), item.frame);
}

// Expand this item's edit block (collapsing every other item into a row)
// and load it into the shared canvas — used by both a row click and a
// thumbnail click in the preview strip below the canvas.
function expandBatchItem(item) {
  expandedBatchItemId = item.id;
  renderBatchItemsList();
  renderBatchThumbs();
  scrollToBatchItem(item.id);
  setBatchPreviewTitle(item);
  const index = batchItems.indexOf(item);
  if (isItemDone(item)) {
    // Load the saved result as-is — just viewing it should never flip its
    // completed status or claim it's "still a preview".
    const img = new Image();
    img.onload = () => {
      batchCtx.clearRect(0, 0, SIZE, SIZE);
      batchCtx.drawImage(img, 0, 0, SIZE, SIZE);
    };
    img.src = item.resultUrl;
    batchStatus.textContent = `已完成：${item.resultFilename}`;
  } else if (hasBackground(item.bg)) {
    previewBatchItem(item);
  } else {
    batchCtx.clearRect(0, 0, SIZE, SIZE);
    batchStatus.textContent = `圖片 #${index + 1} 尚未設定背景`;
  }
  syncBatchFx();
}

function addBatchItem() {
  const item = {
    id: ++batchIdCounter, title: '',
    bg: { type: 'image', image: null, color: null },
    frame: COMPANY ? 'news' : 'generic',
    gen: GEN_DEFAULT(),
    fontSize: DEFAULT_CANVA_SIZE_IMAGE, fontSizeTouched: false,
    done: false, resultUrl: null, resultBlob: null, resultFilename: null
  };
  batchItems.push(item);
  expandBatchItem(item);
}

async function removeBatchItem(id) {
  const index = batchItems.findIndex(it => it.id === id);
  if (index < 0) return;
  const firstLine = batchItems[index].title.split('\n').find(l => l.trim());
  const ok = await askConfirm({
    title: '確定要移除這組套圖？',
    message: `「#${index + 1}${firstLine ? ' ' + firstLine : ''}」會被刪除，且無法復原。`,
    okText: '移除'
  });
  if (!ok) return;
  const wasExpanded = expandedBatchItemId === id;
  setItemResultUrl(batchItems[index], null);
  batchItems = batchItems.filter(it => it.id !== id);
  if (!wasExpanded) {
    renderBatchItemsList();
    renderBatchThumbs();
    return;
  }
  const fallback = batchItems[batchItems.length - 1];
  if (fallback) {
    expandBatchItem(fallback);
  } else {
    expandedBatchItemId = null;
    batchCtx.clearRect(0, 0, SIZE, SIZE);
    batchPreviewTitle.textContent = '';
    batchPreviewTitleInput.value = '';
    batchPreviewTitleInput.hidden = true;
    batchStatus.textContent = '按某一組的「產生此張」後，預覽會顯示在這裡';
    renderBatchItemsList();
    renderBatchThumbs();
    syncBatchFx();
  }
}

// Thumbnail strip below the batch canvas, one per item (not just completed
// ones) — a finished item shows its result, an unfinished one keeps its
// title text and an "未完成" tag. Click any of them to jump to and expand
// that item's edit block, collapsing every other item.
// 按鈕顏色規則：全部都完成了 →「全部下載」變藍（下一步），否則白。
function syncBatchActions() {
  const allDone = batchItems.length > 0 && batchItems.every(isItemDone);
  batchDownloadAllBtn.classList.toggle('primary', allDone);
}

function renderBatchThumbs() {
  batchDownloadAllBtn.disabled = batchItems.length === 0;
  syncBatchActions();
  batchThumbs.innerHTML = '';
  batchItems.forEach((item, index) => {
    const isDone = isItemDone(item);
    const firstLine = item.title.split('\n').find(l => l.trim()) || '';
    let el;
    if (isDone) {
      el = document.createElement('img');
      el.alt = '';
      el.src = item.resultUrl;
    } else {
      el = document.createElement('div');
      el.className = 'thumb-placeholder';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'thumb-title';
      titleSpan.textContent = firstLine || '（尚未輸入標題）';
      const tagSpan = document.createElement('span');
      tagSpan.className = 'thumb-tag';
      tagSpan.textContent = '未完成';
      el.appendChild(titleSpan);
      el.appendChild(tagSpan);
    }
    el.dataset.thumbId = item.id;
    el.dataset.thumbDone = isDone ? '1' : '';
    el.classList.toggle('active-thumb', item.id === expandedBatchItemId);
    el.title = `#${index + 1} ${firstLine}`;
    el.addEventListener('click', () => expandBatchItem(item));
    batchThumbs.appendChild(el);
  });
  batchThumbsShelf.hidden = batchItems.length === 0;
  // Bring the open item into view, but only when it changes — this runs on
  // every keystroke of a title, and the row mustn't jump back while browsing.
  const active = batchThumbs.querySelector('.active-thumb');
  if (active && expandedBatchItemId !== lastCenteredThumbId) {
    batchThumbs.scrollTo({ left: active.offsetLeft - (batchThumbs.clientWidth - active.offsetWidth) / 2 });
  }
  lastCenteredThumbId = expandedBatchItemId;
  updateThumbNav();
}

let lastCenteredThumbId = null;

// 打字時只更新這一格的文字（不重建整排縮圖）；完成狀態改變才整排重畫
function updateBatchThumb(item) {
  const el = batchThumbs.querySelector(`[data-thumb-id="${item.id}"]`);
  if (!el || Boolean(el.dataset.thumbDone) !== isItemDone(item)) { renderBatchThumbs(); return; }
  const firstLine = item.title.split('\n').find(l => l.trim()) || '';
  const t = el.querySelector('.thumb-title');
  if (t) t.textContent = firstLine || '（尚未輸入標題）';
  el.title = `#${batchItems.indexOf(item) + 1} ${firstLine}`;
}

function updateThumbNav() {
  const max = batchThumbs.scrollWidth - batchThumbs.clientWidth;
  batchThumbsPrev.disabled = batchThumbs.scrollLeft <= 1;
  batchThumbsNext.disabled = batchThumbs.scrollLeft >= max - 1;
}

// Replace only this item's own node in place (keeps every other block/row
// untouched, so the page doesn't jump or lose focus elsewhere).
function refreshBatchItem(item) {
  const index = batchItems.indexOf(item);
  const oldNode = batchItemsList.querySelector(`[data-item-id="${item.id}"]`);
  const newNode = buildBatchItemBlock(item, index);
  if (oldNode) oldNode.replaceWith(newNode);
  else batchItemsList.appendChild(newNode);
}

// Live-preview this item into the shared batch canvas as its fields change
// (font size, title, frame, background) — without marking it done or saving
// a result, so editing gives the same immediate feedback as single mode.
async function previewBatchItem(item) {
  setBatchPreviewTitle(item);
  syncBatchFx();
  if (!hasBackground(item.bg)) return;
  // 不等字型：先用備用字型畫，字型載好後會重畫（輸出前 completeBatchItem 會等字型）
  const fontSize = canvaToPx(effectiveCanvaSize(item.bg, item.fontSize));
  renderComposite(batchCtx, item.bg, item.title, fontSize, item.frame, batchFx && batchFx.forItem(item), item.gen);
  const index = batchItems.indexOf(item);
  batchStatus.textContent = `預覽中（尚未完成）：圖片 #${index + 1}`;
}

async function completeBatchItem(item) {
  if (!hasBackground(item.bg) || !item.title.trim()) {
    item.errorMsg = '需要同時有標題和背景（圖片或純色）才能完成';
    refreshBatchItem(item);
    return false;
  }
  item.errorMsg = null;
  // Must wait for the ribbon/logo art too, not just the font — otherwise a
  // batch item completed very early would permanently save a PNG missing
  // its corner ribbon or bottom logo, since this snapshot is never redrawn.
  await Promise.all([whzFontReady, ribbonReady, ribbonNewsReady, logoReady]);
  const fontSize = canvaToPx(effectiveCanvaSize(item.bg, item.fontSize));
  renderComposite(batchCtx, item.bg, item.title, fontSize, item.frame, batchFx && batchFx.forItem(item), item.gen);
  setBatchPreviewTitle(item);
  const index = batchItems.indexOf(item);
  item.resultFilename = `${PA.tb.stampName(new Date(), index + 1)}.png`;
  item.resultBlob = await pngBlobWithDpi(batchCanvas, PNG_DPI);
  setItemResultUrl(item, URL.createObjectURL(item.resultBlob));
  item.done = true;
  batchStatus.textContent = `已完成：${item.resultFilename}`;
  refreshBatchItem(item);
  renderBatchThumbs();
  return true;
}

function downloadItem(item) {
  PA.tb.download(item.resultBlob, item.resultFilename);
}

// After an item's 完成, fold it back into its summary row so the list stays
// compact — it reopens only when picked again (its thumbnail below the
// preview, or its row). The big preview keeps showing the finished result.
function collapseBatchItems() {
  expandedBatchItemId = null;
  renderBatchItemsList();
  renderBatchThumbs();
  batchPreviewTitleInput.hidden = true;
  batchCanvas.classList.remove('pannable');
  syncBatchFx();
}

// Round red "×" used for 移除 on both the collapsed row and the open block.
// The glyph is an SVG so it looks the same whatever UI font is in effect.
function createRemoveButton(onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'remove-btn';
  btn.title = '移除';
  btn.setAttribute('aria-label', '移除');
  btn.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
  btn.addEventListener('click', onClick);
  return btn;
}

function buildBatchItemRow(item, index) {
  const row = document.createElement('div');
  row.className = 'batch-item-row';
  row.dataset.itemId = item.id;
  if (item.errorMsg) row.title = item.errorMsg;

  const isDone = isItemDone(item);
  const thumb = document.createElement('div');
  thumb.className = 'row-thumb';
  if (isDone) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = item.resultUrl;
    thumb.appendChild(img);
  } else if (item.bg.type === 'image' && item.bg.image) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = item.bg.image.src;
    thumb.appendChild(img);
  } else if (item.bg.type === 'color' && item.bg.color) {
    thumb.style.background = item.bg.color;
  } else {
    thumb.classList.add('row-thumb-empty');
  }

  const title = document.createElement('div');
  title.className = 'row-title';
  const firstLine = item.title.split('\n').find(l => l.trim()) || '（尚未輸入標題）';
  title.textContent = `#${index + 1} ${firstLine}`;

  const badge = document.createElement('span');
  badge.className = 'row-badge' + (isDone ? '' : ' row-badge-pending');
  badge.textContent = isDone ? '✓ 已完成' : '未完成';

  const removeBtn = createRemoveButton(e => { e.stopPropagation(); removeBatchItem(item.id); });

  row.appendChild(thumb);
  row.appendChild(title);
  row.appendChild(badge);
  row.appendChild(removeBtn);
  row.addEventListener('click', () => expandBatchItem(item));
  return row;
}

function buildBatchItemBlock(item, index) {
  if (item.id !== expandedBatchItemId) {
    return buildBatchItemRow(item, index);
  }

  const block = document.createElement('div');
  block.className = 'batch-item-block';
  block.dataset.itemId = item.id;

  const head = document.createElement('div');
  head.className = 'batch-item-head';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = `圖片 #${index + 1}`;
  const doneTag = document.createElement('span');
  doneTag.className = 'label-done-tag';
  doneTag.textContent = '✓ 已完成';
  doneTag.style.display = item.done ? '' : 'none';
  label.appendChild(doneTag);
  // Viewing a completed item (via its thumbnail or row) never touches its
  // done state — only an actual edit to what gets rendered should. Each
  // field handler below calls this first so the tag disappears live,
  // without a full rebuild that would steal focus mid-edit.
  function invalidateDone() {
    if (!item.done) return;
    item.done = false;
    doneTag.style.display = 'none';
    renderBatchThumbs();
  }
  const headBtns = document.createElement('div');
  headBtns.style.display = 'flex';
  headBtns.style.gap = '6px';
  const completeBtn = document.createElement('button');
  completeBtn.type = 'button';
  completeBtn.className = 'primary';
  completeBtn.textContent = '產生此張';
  completeBtn.addEventListener('click', async () => {
    if (await completeBatchItem(item)) collapseBatchItems();
  });
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.textContent = '下載這張';
  downloadBtn.addEventListener('click', async () => {
    if (isItemDone(item) || await completeBatchItem(item)) downloadItem(item);
  });
  const removeBtn = createRemoveButton(() => removeBatchItem(item.id));
  headBtns.appendChild(downloadBtn);
  headBtns.appendChild(completeBtn);
  headBtns.appendChild(removeBtn);
  head.appendChild(label);
  head.appendChild(headBtns);

  // Clicking the open block's header, or its frame (the padding around the
  // fields), folds it back into its row — same as 完成 but without finishing.
  const chevron = document.createElement('span');
  chevron.className = 'collapse-chevron';
  chevron.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5l3-3 3 3"/></svg>';
  label.prepend(chevron);
  head.title = '點一下收合';
  // Only a press that *started* on the header/frame counts: a drag that
  // begins inside a field (e.g. scrubbing the font size) and is released
  // elsewhere also produces a click on their common ancestor, the block.
  let pressedOnFrame = false;
  block.addEventListener('pointerdown', e => {
    pressedOnFrame = e.target === block || (head.contains(e.target) && !e.target.closest('button'));
  });
  block.addEventListener('click', e => {
    const onFrame = e.target === block || (head.contains(e.target) && !e.target.closest('button'));
    if (pressedOnFrame && onFrame) collapseBatchItems();
  });

  // 框：公司模式有「新聞（藍框）／娛樂（粉框）／通用框」；沒密碼只有通用框（不顯示切換，只有通用框的設定）
  const frameToggle = document.createElement('div');
  frameToggle.className = 'bg-toggle';
  frameToggle.hidden = !COMPANY;
  const frameDefs = COMPANY
    ? [['news', '新聞（藍框）'], ['entertainment', '娛樂（粉框）'], ['generic', '通用框']]
    : [['generic', '通用框']];
  const frameBtns = frameDefs.map(([key, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.dataset.frame = key;
    frameToggle.appendChild(b);
    return b;
  });

  // 通用框的設定：角標文字（留空就不畫）、主色
  const genBox = document.createElement('div');
  genBox.className = 'field gen-box';
  const tagLabel = document.createElement('label');
  tagLabel.textContent = '左上角標籤（留空就不顯示）';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.className = 'gen-tag';
  tagInput.id = `genTag${++fieldUid}`;
  tagLabel.htmlFor = tagInput.id;
  tagInput.maxLength = 12;
  tagInput.placeholder = '快訊';
  tagInput.value = item.gen.tag;
  tagInput.style.cssText = 'width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--border); font:inherit; margin-bottom:12px';
  const colorLabel = document.createElement('label');
  colorLabel.textContent = '主色';
  const colorRow = document.createElement('div');
  colorRow.className = 'color-swatches gen-colors';
  const swatchBtns = GEN_COLORS.map(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'color-swatch gen-swatch';
    b.style.background = c.hex;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.dataset.color = c.hex;
    b.style.padding = '0';
    b.style.minWidth = '0';
    colorRow.appendChild(b);
    return b;
  });
  const customColor = document.createElement('input');
  customColor.type = 'color';
  customColor.className = 'gen-custom';
  customColor.title = '自訂顏色';
  customColor.setAttribute('aria-label', '自訂顏色');
  customColor.value = item.gen.color;
  customColor.style.cssText = 'width:34px; height:34px; padding:0; border:1px solid var(--border); border-radius:7px; background:none; cursor:pointer';
  colorRow.appendChild(customColor);
  genBox.appendChild(tagLabel);
  genBox.appendChild(tagInput);
  genBox.appendChild(colorLabel);
  genBox.appendChild(colorRow);
  function syncGenVisual() {
    swatchBtns.forEach(b => b.classList.toggle('selected', b.dataset.color === item.gen.color));
    customColor.value = item.gen.color;
  }
  tagInput.addEventListener('input', () => { invalidateDone(); item.gen.tag = tagInput.value; previewBatchItem(item); });
  swatchBtns.forEach(b => b.addEventListener('click', () => { invalidateDone(); item.gen.color = b.dataset.color; syncGenVisual(); previewBatchItem(item); }));
  customColor.addEventListener('input', () => { invalidateDone(); item.gen.color = customColor.value; syncGenVisual(); previewBatchItem(item); });
  syncGenVisual();

  const applyFrameVisual = () => {
    frameBtns.forEach(b => b.classList.toggle('active', b.dataset.frame === item.frame));
    genBox.hidden = item.frame !== 'generic';
    syncFontLock();
    textarea.placeholder = titlePlaceholder(item.frame);
  };
  frameBtns.forEach(b => b.addEventListener('click', () => {
    invalidateDone();
    item.frame = b.dataset.frame;
    applyFrameVisual();
    previewBatchItem(item);
  }));

  const textareaLabel = document.createElement('label');
  textareaLabel.textContent = '標題（Enter 換行，最多 4 行）';
  const textarea = document.createElement('textarea');
  textarea.id = `titleText${++fieldUid}`;
  textareaLabel.htmlFor = textarea.id;
  textarea.placeholder = titlePlaceholder(item.frame);
  textarea.value = item.title;
  const linesWarn = document.createElement('p');
  linesWarn.className = 'hint warn title-lines-warn';
  linesWarn.setAttribute('role', 'status');
  const checkLines = () => {
    const n = parseLines(textarea.value).length;
    linesWarn.textContent = n > MAX_TITLE_LINES ? `標題有 ${n} 行，最多 ${MAX_TITLE_LINES} 行，第 ${MAX_TITLE_LINES + 1} 行起不會畫上去` : '';
    linesWarn.hidden = !linesWarn.textContent;
  };
  checkLines();
  textarea.addEventListener('input', () => {
    checkLines();
    invalidateDone();
    item.title = textarea.value;
    previewBatchItem(item);
    updateBatchThumb(item); // 只更新這一格的標題文字
  });

  const fontSizeField = document.createElement('div');
  fontSizeField.className = 'field';
  const fontSizeLabel = document.createElement('label');
  fontSizeLabel.textContent = '字級（對照 Canva 字級）';
  const fontStepper = createFontStepper({
    initial: item.fontSize,
    onChange: value => {
      invalidateDone();
      item.fontSizeTouched = true;
      item.fontSize = value;
      previewBatchItem(item);
    }
  });
  const fontSizeHint = document.createElement('div');
  fontSizeHint.className = 'hint';
  fontSizeField.appendChild(fontSizeLabel);
  fontSizeField.appendChild(fontStepper.root);
  fontSizeField.appendChild(fontSizeHint);
  const syncFontLock = () => {
    syncFontStepperLock(fontStepper, fontSizeHint, item.bg);
    if (item.bg.type === 'image') item.fontSize = DEFAULT_CANVA_SIZE_IMAGE;
    // 通用框的字級固定（第一行 72、第二行 50，太長自動縮小），圖片背景時不顯示字級
    fontSizeField.hidden = item.frame === 'generic' && item.bg.type === 'image';
  };
  syncFontLock();

  const picker = createBackgroundPicker({
    memory: item.bgMemory || (item.bgMemory = {}),   // survives the block being rebuilt (collapse/expand)
    getBg: () => item.bg,
    onImage: (image, fileName) => { invalidateDone(); item.bg = { type: 'image', image, color: null, view: newView() }; item.fileName = fileName; syncFontLock(); previewBatchItem(item); },
    onColor: color => { invalidateDone(); item.bg = { type: 'color', image: null, color }; previewBatchItem(item); },
    onModeChange: (mode, remembered) => {
      invalidateDone();
      item.bg = remembered || (mode === 'color' ? { type: 'color', image: null, color: null } : { type: 'image', image: null, color: null });
      // Pressing the 圖片背景／純色背景 toggle always resets to that type's
      // default font size, overriding any manual tweak.
      item.fontSizeTouched = false;
      item.fontSize = defaultCanvaSizeFor(mode);
      fontStepper.setValue(item.fontSize);
      syncFontLock();
      setBatchPreviewTitle(item);
      if (remembered) previewBatchItem(item);   // a remembered picture/colour comes back — show it right away
    }
  });
  item.handleFile = picker.handleFile; // used by global paste routing
  item.invalidateDone = invalidateDone; // used by preview-canvas pan/zoom

  // Dragging or pasting an image directly onto the title textarea works too
  // — no need to click into the dropzone below just to attach a photo.
  textarea.addEventListener('dragover', e => e.preventDefault());
  textarea.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) picker.handleFile(file);
  });
  textarea.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        e.preventDefault();
        e.stopPropagation(); // avoid the document-level paste handler processing the same image again
        picker.handleFile(it.getAsFile());
        break;
      }
    }
  });

  if (item.bg.type === 'color' && item.bg.color) {
    picker.restoreColor(item.bg.color);
  } else if (item.bg.type === 'image' && item.bg.image) {
    picker.restoreImage(item.bg.image, item.fileName || '');
  }

  const errorEl = document.createElement('div');
  errorEl.className = 'hint';
  if (item.errorMsg) {
    errorEl.textContent = item.errorMsg;
    errorEl.style.color = '#dc2626';
  }

  applyFrameVisual();
  block.appendChild(head);
  block.appendChild(picker.root);   // 上傳區（圖片背景／純色背景）排最上面
  block.appendChild(frameToggle);
  block.appendChild(genBox);
  block.appendChild(textareaLabel);
  block.appendChild(textarea);
  block.appendChild(linesWarn);
  block.appendChild(fontSizeField);
  block.appendChild(errorEl);
  return block;
}

function renderBatchItemsList() {
  batchItemsList.innerHTML = '';
  batchItems.forEach((item, index) => {
    batchItemsList.appendChild(buildBatchItemBlock(item, index));
  });
}

// Routes a file dropped or pasted anywhere outside a specific batch item's
// own dropzone (e.g. onto the shared preview canvas) to whichever item is
// currently expanded, since that's the one being edited.
function routeFileToExpandedBatchItem(file) {
  const target = batchItems.find(it => it.id === expandedBatchItemId);
  if (target && target.handleFile) target.handleFile(file);
}

// Dragging an image file directly onto the big preview box works the same
// as dropping it on the sidebar dropzone — no need to scroll back up to it.
function wireCanvasDrop(wrap, onFile) {
  if (!wrap) return;
  wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drag'));
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    wrap.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}
wireCanvasDrop(batchCanvas.closest('.canvas-wrap'), routeFileToExpandedBatchItem);

// Wheel over the preview zooms the background photo around the cursor;
// dragging pans it. Clicking the preview also focuses its box, so Ctrl+V
// right after goes through the document-level paste routing.
function wirePreviewPanZoom(canvasEl, getBg, onChange) {
  const wrap = canvasEl.closest('.canvas-wrap');
  wrap.tabIndex = 0;
  // The edit box ignores the mouse until a double-click, so single clicks,
  // wheel-zoom and drag-pan keep working on the headline area too.
  const titleInput = wrap.querySelector('.title-overlay');
  canvasEl.addEventListener('dblclick', () => {
    if (titleInput.hidden) return;
    titleInput.classList.add('editing');
    titleInput.focus();
    titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
  });
  titleInput.addEventListener('blur', () => titleInput.classList.remove('editing'));
  titleInput.addEventListener('keydown', e => { if (e.key === 'Escape') titleInput.blur(); });
  const activeBg = () => {
    const bg = getBg();
    return bg && bg.type === 'image' && bg.image ? bg : null;
  };
  const toCanvas = (clientX, clientY) => {
    const r = canvasEl.getBoundingClientRect();
    const k = SIZE / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k, k };
  };

  canvasEl.addEventListener('wheel', e => {
    const bg = activeBg();
    if (!bg) return;
    e.preventDefault();
    if (!bg.view) bg.view = newView();
    const view = bg.view;
    const p = toCanvas(e.clientX, e.clientY);
    const before = coverGeometry(bg.image, view);
    const u = (p.x - before.dx) / before.s;
    const v = (p.y - before.dy) / before.s;
    view.zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const after = coverGeometry(bg.image, { zoom: view.zoom, x: 0, y: 0 });
    view.x = p.x - u * after.s - after.dx;
    view.y = p.y - v * after.s - after.dy;
    clampView(bg.image, view);
    onChange();
  }, { passive: false });

  // 單指拖曳＝平移；兩指＝雙指縮放（手機沒有滾輪）：開始時記下兩指中點底下是影像的哪一點，之後讓那一點一直跟著中點走（同時縮放與平移）。
  let drag = null;
  const touches = new Map();   // pointerId -> { x, y }，目前按在預覽上的手指（滑鼠也會進來，但只有兩點同時按住才會進入縮放）
  let pinch = null;
  const pinchGeom = () => {
    const [a, b] = [...touches.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  canvasEl.addEventListener('pointerdown', e => {
    wrap.focus();
    const bg = activeBg();
    if (!bg || e.button !== 0) return;
    if (!bg.view) bg.view = newView();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvasEl.setPointerCapture(e.pointerId);
    if (touches.size === 2) {
      drag = null;
      const g = pinchGeom();
      const p = toCanvas(g.cx, g.cy);
      const before = coverGeometry(bg.image, bg.view);
      pinch = { bg, dist0: Math.max(g.dist, 1), zoom0: bg.view.zoom, u: (p.x - before.dx) / before.s, v: (p.y - before.dy) / before.s };
      canvasEl.classList.add('panning');
    } else if (touches.size === 1) {
      drag = { bg, id: e.pointerId, startX: e.clientX, startY: e.clientY, viewX: bg.view.x, viewY: bg.view.y };
      canvasEl.classList.add('panning');
    }
  });
  canvasEl.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const g = pinchGeom();
      const view = pinch.bg.view;
      view.zoom = Math.min(MAX_ZOOM, Math.max(1, pinch.zoom0 * g.dist / pinch.dist0));
      const p = toCanvas(g.cx, g.cy);
      const after = coverGeometry(pinch.bg.image, { zoom: view.zoom, x: 0, y: 0 });
      view.x = p.x - pinch.u * after.s - after.dx;
      view.y = p.y - pinch.v * after.s - after.dy;
      clampView(pinch.bg.image, view);
      onChange();
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const { k } = toCanvas(e.clientX, e.clientY);
    drag.bg.view.x = drag.viewX + (e.clientX - drag.startX) * k;
    drag.bg.view.y = drag.viewY + (e.clientY - drag.startY) * k;
    clampView(drag.bg.image, drag.bg.view);
    onChange();
  });
  const endDrag = e => {
    const wasDown = touches.delete(e.pointerId);
    if (pinch && touches.size < 2) {
      pinch = null;
      // 剩下的那根手指接著拖曳（從它現在的位置重新算起，畫面不會跳）
      const [[id, pos]] = touches.size ? [...touches.entries()] : [[null, null]];
      const bg = activeBg();
      if (id !== null && bg) drag = { bg, id, startX: pos.x, startY: pos.y, viewX: bg.view.x, viewY: bg.view.y };
      else { drag = null; canvasEl.classList.remove('panning'); }
      return;
    }
    if (!wasDown || !drag || e.pointerId !== drag.id) return;
    drag = null;
    canvasEl.classList.remove('panning');
  };
  canvasEl.addEventListener('pointerup', endDrag);
  canvasEl.addEventListener('pointercancel', endDrag);
}

// The title box inside the preview mirrors the sidebar title field; typing
// in it drives the sidebar field's own input handler so there's one path
// for title changes (render / done-state invalidation / caption).
batchPreviewTitleInput.addEventListener('input', () => {
  const field = batchItemsList.querySelector(`.batch-item-block[data-item-id="${expandedBatchItemId}"] textarea`);
  if (!field) return;
  field.value = batchPreviewTitleInput.value;
  field.dispatchEvent(new Event('input'));
});

// Re-place the edit box when the preview's on-screen size changes (window
// resize, or the canvas becoming visible after a mode switch).
new ResizeObserver(() => {
  const item = batchItems.find(it => it.id === expandedBatchItemId);
  if (item) layoutTitleOverlay(batchPreviewTitleInput, batchCanvas, item.bg, item.title, effectiveCanvaSize(item.bg, item.fontSize), item.frame);
}).observe(batchCanvas);

wirePreviewPanZoom(
  batchCanvas,
  () => {
    const item = batchItems.find(it => it.id === expandedBatchItemId);
    return item && item.bg;
  },
  () => {
    const item = batchItems.find(it => it.id === expandedBatchItemId);
    if (!item) return;
    if (item.invalidateDone) item.invalidateDone();
    previewBatchItem(item);
  }
);

addBatchItemBtn.addEventListener('click', addBatchItem);

// 全部下載 finishes whatever is finishable first: if every item has a title
// and a background, all of them get completed and downloaded; otherwise it
// asks before downloading just the finishable ones and skipping the rest.
batchDownloadAllBtn.addEventListener('click', async () => {
  if (batchItems.length === 0) {
    batchStatus.textContent = '請先按「＋ 再做一張」新增至少一組';
    return;
  }
  const isReady = it => hasBackground(it.bg) && it.title.trim().length > 0;
  const ready = batchItems.filter(isReady);
  const missing = batchItems.length - ready.length;
  if (ready.length === 0) {
    batchStatus.textContent = '還沒有可以下載的套圖：每組都需要標題和背景（圖片或純色）';
    return;
  }
  if (missing > 0) {
    const ok = await askConfirm({
      title: '有未完成的套圖',
      message: `有未完成的套圖（${missing} 組缺標題或背景），要先下載已完成的 ${ready.length} 組嗎？`,
      okText: '下載已完成的'
    });
    if (!ok) return;
  }
  for (const item of ready) {
    if (!isItemDone(item)) await completeBatchItem(item);
  }
  // completeBatchItem leaves the shared canvas on whichever item it finished
  // last — put it back on the one that's actually open.
  const open = batchItems.find(it => it.id === expandedBatchItemId);
  if (open) expandBatchItem(open);
  await PA.tb.download.batch(ready.map(it => ({ blob: it.resultBlob, name: it.resultFilename })));
  const skipNote = missing > 0 ? `，${missing} 組未完成已略過` : '';
  batchStatus.textContent = `已下載 ${ready.length} 組${skipNote}`;
});

batchResetBtn.addEventListener('click', async () => {
  if (!(await askConfirm())) return;
  batchItems.forEach(it => setItemResultUrl(it, null));
  batchItems = [];
  expandedBatchItemId = null;
  batchCtx.clearRect(0, 0, SIZE, SIZE);
  batchPreviewTitle.textContent = '';
  batchPreviewTitleInput.value = '';
  batchPreviewTitleInput.hidden = true;
  batchStatus.textContent = '按某一組的「產生此張」後，預覽會顯示在這裡';
  renderBatchItemsList();
  renderBatchThumbs();
  syncBatchFx();
});

// ---- help modal ----
const helpBtn = document.getElementById('helpBtn');
const helpOverlay = document.getElementById('helpOverlay');
const helpCloseBtn = document.getElementById('helpCloseBtn');
function openHelp() { helpOverlay.classList.add('open'); }
function closeHelp() { helpOverlay.classList.remove('open'); }
helpBtn.addEventListener('click', openHelp);
helpCloseBtn.addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) closeHelp(); });

// ---- confirm modal (used before any "清空全部" action) ----
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
let confirmResolve = null;
function askConfirm({
  title = '確定要全部清除？',
  message = '這會清空目前畫面上的所有設定，且無法復原。',
  okText = '全部清除'
} = {}) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmOkBtn.textContent = okText;
  confirmOverlay.classList.add('open');
  return new Promise(resolve => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  confirmOverlay.classList.remove('open');
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}
confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
confirmOkBtn.addEventListener('click', () => closeConfirm(true));
confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) closeConfirm(false); });

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (confirmOverlay.classList.contains('open')) closeConfirm(false);
  else closeHelp();
});

addBatchItem(); // start with one block

// 緞帶／Logo 圖載好後，重畫目前預覽的那一組（沒完成的才重畫，完成的是存好的圖）
Promise.all([ribbonReady, ribbonNewsReady, logoReady, whzFontReady]).then(() => {
  const it = batchItems.find(i => i.id === expandedBatchItemId);
  if (it && !isItemDone(it) && hasBackground(it.bg)) previewBatchItem(it);
});
