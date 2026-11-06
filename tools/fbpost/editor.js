// 作圖框的單張照片編輯器：照片（拖曳平移、滾輪／雙指縮放）＋框＋標題＋貼圖／馬賽克，輸出一張 1080×1080。
// 繪製邏輯移植自 tools/pattern/app.js 與 stickers.js（公司風格一致）。
// wrap 需要可定位（本模組會設 position:relative）；貼圖／馬賽克的操作方框是疊在畫布上的 DOM，匯出時不會包含。
const SIZE = 1080;
const MAX_ZOOM = 5;
const MAX_BYTES = 30 * 1024 * 1024;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- 照片視角：zoom 1 = 置中 cover；x/y 為偏移（畫布 px）；clampView 確保不露白邊 ----
function newView() { return { zoom: 1, x: 0, y: 0 }; }
function coverGeometry(image, view) {
  const s = Math.max(SIZE / image.width, SIZE / image.height) * view.zoom;
  const dw = image.width * s, dh = image.height * s;
  return { s, dw, dh, dx: (SIZE - dw) / 2 + view.x, dy: (SIZE - dh) / 2 + view.y };
}
function clampView(image, view) {
  view.zoom = clamp(view.zoom, 1, MAX_ZOOM);
  const { dw, dh } = coverGeometry(image, view);
  const mx = (dw - SIZE) / 2, my = (dh - SIZE) / 2;
  view.x = clamp(view.x, -mx, mx);
  view.y = clamp(view.y, -my, my);
}

// ---- 圖片載入：先用 crossOrigin 載（匯出才不會污染畫布），失敗再退回一般載入 ----
function loadImg(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const tryLoad = cors => {
      const im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => (cors ? tryLoad(false) : resolve(null));
      im.src = url;
    };
    tryLoad(true);
  });
}

// ---- 版面常數（同 pattern）----
const RIBBON_W = 230, RIBBON_H = 215;
const LOGO_W = 170, LOGO_H = 100, LOGO_X = 455, LOGO_Y = 955;
const BOX_CENTER = 880;
const LINE_HEIGHT_RATIO = 93 / 67;
const TITLE_FONT_PX = 50 * (67 / 50);   // 圖片背景固定 Canva 字級 50 → 67px
const MAX_TITLE_LINES = 3;

const GEN_COLORS = [
  { name: '墨黑', hex: '#202124' }, { name: '海軍藍', hex: '#1f3a5f' }, { name: '磚紅', hex: '#b03a2e' },
  { name: '森綠', hex: '#2f6b4f' }, { name: '琥珀', hex: '#e0a100' }
];
const GEN = { tag: '快訊', color: GEN_COLORS[0].hex };
const GEN_TITLE_X = 108, GEN_TITLE_MAX_W = 900;
const GEN_L1 = 72, GEN_L2 = 50, GEN_L1_BASE = 915, GEN_L2_BASE = 995;
const FONT_FALLBACK = '"Microsoft JhengHei", "PingFang TC", "PMingLiU", sans-serif';

const STICKER_NAMES = [
  ['smile', '笑臉'], ['shock', '驚嚇'], ['cry', '大哭'], ['angry', '生氣'],
  ['kiss', '親親'], ['laugh', '笑哭'], ['meh', '無言']
];
const STICKER_W = 300, MOSAIC_W = 320, MOSAIC_H = 240;
const MIN_SIZE = 40, MAX_SIZE = SIZE * 1.4, MAX_ITEMS = 30;
const BLOCK_DIV = 5, BLOCK_MIN = 14;

export function createPhotoEditor({ canvas, wrap, fxBar, assets = {} }) {
  const company = !!assets.company;
  const ctx = canvas.getContext('2d');
  canvas.width = SIZE;
  canvas.height = SIZE;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

  const titleFont = (size, weight = 900) => (assets.fontLoaded
    ? `${size}px "WHZ-Heavy", ${FONT_FALLBACK}`
    : `${weight} ${size}px "Noto Sans TC", ${FONT_FALLBACK}`);

  // ---- 狀態 ----
  let image = null, view = newView();
  let frame = company ? 'news' : 'generic';
  let titleLines = [];
  let items = [];        // 貼圖／馬賽克
  let selectedId = null;
  let nextId = 1;
  const listeners = new Set();
  let rafId = 0;

  const imgs = { ribbonEnt: null, ribbonNews: null, logo: null };
  const stickerImgs = {};
  const stickerDefs = STICKER_NAMES.filter(([id]) => assets.stickers && assets.stickers[id]);

  const emit = () => { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); };
  const renderSoon = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; render(ctx, true); }); };
  const changed = () => { renderSoon(); layoutBoxes(); syncBar(); emit(); };

  // 資源載好只重畫一次，不算「內容改變」
  loadImg(assets.ribbonEnt).then(im => { imgs.ribbonEnt = im; renderSoon(); });
  loadImg(assets.ribbonNews).then(im => { imgs.ribbonNews = im; renderSoon(); });
  loadImg(assets.logo).then(im => { imgs.logo = im; renderSoon(); });
  stickerDefs.forEach(([id]) => loadImg(assets.stickers[id]).then(im => { stickerImgs[id] = im; renderSoon(); }));
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('900 50px "Noto Sans TC"', '標題'),
      document.fonts.load('500 50px "Noto Sans TC"', '標題'),
      assets.fontLoaded ? document.fonts.load('50px "WHZ-Heavy"', '標題') : null
    ].filter(Boolean)).catch(() => {}).then(renderSoon);
  }

  // ---- 繪製 ----
  function fitFontSize(c, lines, maxWidth, baseSize, weight = 900) {
    let size = baseSize;
    c.font = titleFont(size, weight);
    const widest = Math.max(...lines.map(l => c.measureText(l).width));
    if (widest > maxWidth) size = Math.max(24, Math.floor(size * maxWidth / widest));
    return size;
  }

  function drawCover(c) {
    const g = coverGeometry(image, view);
    c.drawImage(image, g.dx, g.dy, g.dw, g.dh);
  }

  function drawGradient(c) {
    const grad = c.createLinearGradient(0, 0, 0, SIZE);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    c.fillStyle = grad;
    c.fillRect(0, 0, SIZE, SIZE);
  }

  function drawRibbon(c) {
    const im = frame === 'news' ? imgs.ribbonNews : imgs.ribbonEnt;
    if (im) c.drawImage(im, SIZE - RIBBON_W, 0, RIBBON_W, RIBBON_H);
  }

  function drawLogo(c) {
    if (imgs.logo) c.drawImage(imgs.logo, LOGO_X, LOGO_Y, LOGO_W, LOGO_H);
  }

  // 公司框標題：置中、固定垂直中心 880，最多 3 行
  function drawTitle(c) {
    if (!titleLines.length) return;
    const fontSize = fitFontSize(c, titleLines, SIZE - 120, TITLE_FONT_PX);
    const lh = fontSize * LINE_HEIGHT_RATIO;
    const n = titleLines.length;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = titleFont(fontSize);
    c.fillStyle = '#ffffff';
    titleLines.forEach((line, i) => c.fillText(line, SIZE / 2, BOX_CENTER - (n - 1) * lh / 2 + i * lh));
  }

  // 通用框 C：底部黑漸層＋左上角標＋左側主色直條標題
  function drawGenericGradient(c) {
    const grad = c.createLinearGradient(0, 560, 0, SIZE);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.78)');
    c.fillStyle = grad;
    c.fillRect(0, 560, SIZE, SIZE - 560);
  }
  function drawGenericTag(c) {
    const tag = GEN.tag.trim();
    if (!tag) return;
    c.font = titleFont(50, 900);
    const w = Math.max(290, Math.ceil(c.measureText(tag).width) + 96);
    c.fillStyle = GEN.color;
    c.fillRect(0, 70, w, 96);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(w, 70, 14, 96);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText(tag, w / 2, 135);
  }
  function drawGenericTitle(c) {
    const l1 = titleLines[0] || '', l2 = titleLines.slice(1).join(' ');
    if (!l1 && !l2) return;
    const main = l1 || l2, sub = l1 ? l2 : '';
    const s1 = fitFontSize(c, [main], GEN_TITLE_MAX_W, GEN_L1, 900);
    const s2 = sub ? fitFontSize(c, [sub], GEN_TITLE_MAX_W, GEN_L2, 500) : 0;
    const base1 = sub ? GEN_L1_BASE : GEN_L2_BASE;
    const top = base1 - Math.round(s1 * 0.875);
    const bottom = (sub ? GEN_L2_BASE : base1) + 7;
    c.fillStyle = GEN.color;
    c.fillRect(72, top, 10, bottom - top);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff';
    c.font = titleFont(s1, 900);
    c.fillText(main, GEN_TITLE_X, base1);
    if (sub) {
      c.globalAlpha = 0.9;
      c.font = titleFont(s2, 500);
      c.fillText(sub, GEN_TITLE_X, GEN_L2_BASE);
      c.globalAlpha = 1;
    }
  }

  // 馬賽克：把框內像素平均成大方塊
  function pixelate(c, m) {
    const x0 = Math.max(0, Math.floor(m.x)), y0 = Math.max(0, Math.floor(m.y));
    const x1 = Math.min(SIZE, Math.ceil(m.x + m.w)), y1 = Math.min(SIZE, Math.ceil(m.y + m.h));
    const w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return;
    const b = Math.max(BLOCK_MIN, Math.round(Math.min(m.w, m.h) / BLOCK_DIV));
    let data;
    try { data = c.getImageData(x0, y0, w, h).data; } catch (e) {
      c.save(); c.fillStyle = '#808080'; c.fillRect(x0, y0, w, h); c.restore(); return;   // 畫布被污染讀不到像素，用灰色蓋住
    }
    c.save();
    for (let by = 0; by < h; by += b) {
      for (let bx = 0; bx < w; bx += b) {
        const bw = Math.min(b, w - bx), bh = Math.min(b, h - by);
        let r = 0, g = 0, bl = 0;
        for (let yy = by; yy < by + bh; yy++) {
          let i = (yy * w + bx) * 4;
          for (let xx = 0; xx < bw; xx++, i += 4) { r += data[i]; g += data[i + 1]; bl += data[i + 2]; }
        }
        const n = bw * bh;
        c.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(bl / n)})`;
        c.fillRect(x0 + bx, y0 + by, bw, bh);
      }
    }
    c.restore();
  }

  // preview=true 才畫沒照片時的底色與提示
  function render(c, preview) {
    c.clearRect(0, 0, SIZE, SIZE);
    if (!image) {
      if (preview) {
        c.fillStyle = '#d9e2f2';
        c.fillRect(0, 0, SIZE, SIZE);
        c.fillStyle = '#6b7a99';
        c.font = '600 44px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('點選、拖曳或貼上照片', SIZE / 2, SIZE / 2);
      }
      return;
    }
    drawCover(c);
    items.forEach(it => { if (it.kind === 'mosaic') pixelate(c, it); });
    if (frame === 'generic') {
      drawGenericGradient(c); drawGenericTag(c); drawGenericTitle(c);
    } else if (frame === 'news' || frame === 'ent') {
      drawGradient(c); drawRibbon(c); drawTitle(c);
    } else {
      // 'none'：只有照片，標題也不畫（無框無字）
    }
    items.forEach(it => {
      const im = stickerImgs[it.key];
      if (it.kind === 'sticker' && im && im.complete && im.naturalWidth) c.drawImage(im, it.x, it.y, it.w, it.h);
    });
  }

  // ---- 載入照片 ----
  function setImage(im) {
    image = im; view = newView(); items = []; selectedId = null;
    rebuildBoxes();
    canvas.style.cursor = 'grab';
    changed();
  }
  function loadUrl(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { setImage(im); resolve(); };
      im.onerror = () => reject(new Error('照片讀取失敗'));
      im.src = url;
    });
  }
  async function loadFile(file) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('不是圖片');
    if (file.size > MAX_BYTES) throw new Error('照片超過 30MB');
    const url = URL.createObjectURL(file);
    try { await loadUrl(url); } finally { URL.revokeObjectURL(url); }
  }

  // ---- 平移／縮放（沒有照片時不作用）----
  const toCanvas = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    const k = SIZE / r.width;
    return { x: (cx - r.left) * k, y: (cy - r.top) * k, k };
  };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('wheel', e => {
    if (!image) return;
    e.preventDefault();
    const p = toCanvas(e.clientX, e.clientY);
    const before = coverGeometry(image, view);
    const u = (p.x - before.dx) / before.s, v = (p.y - before.dy) / before.s;
    view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0015), 1, MAX_ZOOM);
    const after = coverGeometry(image, { zoom: view.zoom, x: 0, y: 0 });
    view.x = p.x - u * after.s - after.dx;
    view.y = p.y - v * after.s - after.dy;
    clampView(image, view);
    changed();
  }, { passive: false });

  const touches = new Map();
  let drag = null, pinch = null;
  const pinchGeom = () => {
    const [a, b] = [...touches.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  canvas.addEventListener('pointerdown', e => {
    if (selectedId !== null) { selectedId = null; layoutBoxes(); syncBar(); }
    if (!image || e.button !== 0) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    if (touches.size === 2) {
      drag = null;
      const g = pinchGeom(), p = toCanvas(g.cx, g.cy), before = coverGeometry(image, view);
      pinch = { dist0: Math.max(g.dist, 1), zoom0: view.zoom, u: (p.x - before.dx) / before.s, v: (p.y - before.dy) / before.s };
    } else if (touches.size === 1) {
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      canvas.style.cursor = 'grabbing';
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!image) return;
    if (pinch && touches.size === 2) {
      const g = pinchGeom();
      view.zoom = clamp(pinch.zoom0 * g.dist / pinch.dist0, 1, MAX_ZOOM);
      const p = toCanvas(g.cx, g.cy);
      const after = coverGeometry(image, { zoom: view.zoom, x: 0, y: 0 });
      view.x = p.x - pinch.u * after.s - after.dx;
      view.y = p.y - pinch.v * after.s - after.dy;
      clampView(image, view);
      changed();
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const { k } = toCanvas(e.clientX, e.clientY);
    view.x = drag.vx + (e.clientX - drag.sx) * k;
    view.y = drag.vy + (e.clientY - drag.sy) * k;
    clampView(image, view);
    changed();
  });
  const endDrag = e => {
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) {
      pinch = null;
      const rest = [...touches.entries()][0];
      drag = rest ? { id: rest[0], sx: rest[1].x, sy: rest[1].y, vx: view.x, vy: view.y } : null;
    } else if (drag && e.pointerId === drag.id) drag = null;
    if (!drag) canvas.style.cursor = image ? 'grab' : '';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- 貼圖／馬賽克 DOM 方框 ----
  const layer = document.createElement('div');
  Object.assign(layer.style, { position: 'absolute', pointerEvents: 'none', zIndex: '4' });
  layer.hidden = true;
  wrap.appendChild(layer);

  const boxEl = id => layer.querySelector(`[data-id="${id}"]`);

  function layoutBoxes() {
    const k = canvas.clientWidth / SIZE;
    layer.hidden = !image || !items.length;
    if (!k) return;
    Object.assign(layer.style, {
      left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`,
      width: `${canvas.clientWidth}px`, height: `${canvas.clientHeight}px`
    });
    items.forEach(it => {
      const box = boxEl(it.id);
      if (!box) return;
      Object.assign(box.style, { left: `${it.x * k}px`, top: `${it.y * k}px`, width: `${it.w * k}px`, height: `${it.h * k}px` });
      const sel = it.id === selectedId;
      box.style.outline = sel ? '2px dashed #fff' : '';
      box.style.boxShadow = sel ? '0 0 0 1px rgba(0,0,0,.5), 0 0 0 3px rgba(24,119,242,.55)' : '';
      box.firstChild.style.display = sel ? 'block' : 'none';
    });
  }

  function scaleItem(it, f, only) {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    let w = it.w, h = it.h;
    if (it.kind === 'mosaic' && only === 'w') w = clamp(w * f, MIN_SIZE, MAX_SIZE);
    else if (it.kind === 'mosaic' && only === 'h') h = clamp(h * f, MIN_SIZE, MAX_SIZE);
    else {
      const s = clamp(it.w * f, MIN_SIZE, MAX_SIZE) / it.w;
      const s2 = clamp(it.h * f, MIN_SIZE, MAX_SIZE) / it.h;
      const sc = f > 1 ? Math.min(s, s2) : Math.max(s, s2);
      w = it.w * sc; h = it.h * sc;
    }
    it.w = w; it.h = h; it.x = cx - w / 2; it.y = cy - h / 2;
  }

  function select(id) { selectedId = id; layoutBoxes(); syncBar(); }
  function removeItem(id) {
    const i = items.findIndex(it => it.id === id);
    if (i >= 0) items.splice(i, 1);
    const b = boxEl(id);
    if (b) b.remove();
    if (selectedId === id) selectedId = null;
    changed();
  }

  function buildBox(it) {
    const box = document.createElement('div');
    box.dataset.id = it.id;
    box.title = it.kind === 'mosaic' ? '馬賽克：拖曳移動、滾輪縮放（Shift＝只調寬、Alt＝只調高）' : '拖曳移動、滾輪縮放';
    Object.assign(box.style, {
      position: 'absolute', pointerEvents: 'auto', cursor: 'move', touchAction: 'none',
      boxSizing: 'border-box', borderRadius: '4px'
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = '刪除（Delete）';
    Object.assign(del.style, {
      position: 'absolute', top: '-12px', right: '-12px', width: '26px', height: '26px', padding: '0',
      border: '0', borderRadius: '50%', background: '#f02849', color: '#fff', fontSize: '16px',
      lineHeight: '26px', cursor: 'pointer', display: 'none', zIndex: '1'
    });
    del.addEventListener('pointerdown', e => e.stopPropagation());
    del.addEventListener('click', e => { e.stopPropagation(); removeItem(it.id); });
    box.appendChild(del);

    const ptrs = new Map();
    let dg = null, pin = null;
    const startDrag = (id, x, y) => { dg = { id, sx: x, sy: y, x: it.x, y: it.y }; };
    box.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      select(it.id);
      const i = items.indexOf(it);
      if (i >= 0 && i !== items.length - 1) { items.splice(i, 1); items.push(it); layer.appendChild(box); }   // 點到的移到最上層
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      box.setPointerCapture(e.pointerId);
      if (ptrs.size === 2) {
        dg = null;
        const [a, b] = [...ptrs.values()];
        pin = { d0: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), w: it.w, h: it.h, cx: it.x + it.w / 2, cy: it.y + it.h / 2 };
      } else if (ptrs.size === 1) startDrag(e.pointerId, e.clientX, e.clientY);
      changed();
    });
    box.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pin && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        it.w = pin.w; it.h = pin.h; it.x = pin.cx - pin.w / 2; it.y = pin.cy - pin.h / 2;
        scaleItem(it, Math.hypot(a.x - b.x, a.y - b.y) / pin.d0);
        changed();
        return;
      }
      if (!dg || e.pointerId !== dg.id) return;
      const k = SIZE / canvas.clientWidth;
      it.x = clamp(dg.x + (e.clientX - dg.sx) * k, -it.w / 2, SIZE - it.w / 2);   // 中心點不離開畫布
      it.y = clamp(dg.y + (e.clientY - dg.sy) * k, -it.h / 2, SIZE - it.h / 2);
      changed();
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (pin && ptrs.size < 2) {
        pin = null;
        const rest = [...ptrs.entries()][0];
        if (rest) startDrag(rest[0], rest[1].x, rest[1].y); else dg = null;
      } else if (dg && e.pointerId === dg.id) dg = null;
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      scaleItem(it, Math.exp(-d * 0.0015), e.shiftKey && !e.altKey ? 'w' : e.altKey && !e.shiftKey ? 'h' : null);
      select(it.id);
      changed();
    }, { passive: false });
    return box;
  }

  function rebuildBoxes() {
    layer.textContent = '';
    items.forEach(it => layer.appendChild(buildBox(it)));
    layoutBoxes();
  }

  function addItem(kind, key) {
    if (!image || items.length >= MAX_ITEMS) return;
    let w, h;
    if (kind === 'sticker') {
      const im = stickerImgs[key];
      w = STICKER_W;
      h = im && im.naturalWidth ? w * im.naturalHeight / im.naturalWidth : w;
    } else { w = MOSAIC_W; h = MOSAIC_H; }
    const n = items.length % 6;
    const it = { id: nextId++, kind, key: key || null, w, h, x: (SIZE - w) / 2 + (n - 2.5) * 36, y: (SIZE - h) / 2 + (n - 2.5) * 36 };
    items.push(it);
    layer.appendChild(buildBox(it));
    selectedId = it.id;
    changed();
  }

  document.addEventListener('keydown', e => {
    if (selectedId === null || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    removeItem(selectedId);
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(layoutBoxes).observe(canvas);

  // ---- fxBar：貼圖列 ＋ 馬賽克 ＋ 刪除選取 ----
  const btns = [];
  let delBtn = null;
  (function buildBar() {
    fxBar.textContent = '';
    Object.assign(fxBar.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' });
    const mk = (text, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      Object.assign(b.style, {
        height: '44px', padding: '0 12px', border: '1px solid rgba(0,74,173,.18)', borderRadius: '12px',
        background: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap'
      });
      fxBar.appendChild(b);
      btns.push(b);
      return b;
    };
    stickerDefs.forEach(([id, name]) => {
      const b = mk('', `貼圖：${name}`);
      b.style.width = '44px'; b.style.padding = '3px';
      const im = document.createElement('img');
      im.src = assets.stickers[id];
      im.alt = name;
      im.draggable = false;
      Object.assign(im.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' });
      b.appendChild(im);
      b.addEventListener('click', () => addItem('sticker', id));
    });
    mk('馬賽克', '馬賽克：加一個方塊馬賽克到預覽').addEventListener('click', () => addItem('mosaic'));
    delBtn = mk('刪除選取', '刪除目前選取的貼圖或馬賽克（Delete）');
    delBtn.addEventListener('click', () => { if (selectedId !== null) removeItem(selectedId); });
  })();
  function syncBar() {
    btns.forEach(b => { b.disabled = !image; b.style.opacity = image ? '' : '.5'; });
    if (delBtn) { const off = !image || selectedId === null; delBtn.disabled = off; delBtn.style.opacity = off ? '.5' : ''; }
  }

  // ---- 對外 API ----
  const api = {
    loadFile, loadUrl,
    clearImage() {
      image = null; view = newView(); items = []; selectedId = null;
      rebuildBoxes();
      canvas.style.cursor = '';
      changed();
    },
    clearAll() {
      api.clearImage();
      titleLines = [];
      frame = company ? 'news' : 'generic';
      changed();
    },
    hasImage: () => !!image,
    setFrame(kind) {
      let k = ['news', 'ent', 'generic', 'none'].includes(kind) ? kind : frame;
      if (!company && (k === 'news' || k === 'ent')) k = 'generic';
      frame = k;
      changed();
    },
    getFrame: () => frame,
    frames: () => (company ? ['news', 'ent', 'none'] : ['generic', 'none']),
    setTitle(text) {
      titleLines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, MAX_TITLE_LINES);
      changed();
    },
    exportBlob(type = 'image/jpeg', quality = 0.92) {
      if (!image) return Promise.reject(new Error('請先放照片'));
      const off = document.createElement('canvas');
      off.width = SIZE; off.height = SIZE;
      const c = off.getContext('2d');
      if (type === 'image/jpeg') { c.fillStyle = '#fff'; c.fillRect(0, 0, SIZE, SIZE); }
      render(c, false);
      return new Promise((resolve, reject) => {
        try {
          off.toBlob(b => (b ? resolve(b) : reject(new Error('匯出失敗'))), type, quality);
        } catch (e) { reject(new Error('匯出失敗（圖片來源不允許讀取）')); }
      });
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };

  syncBar();
  render(ctx, true);
  return api;
}
