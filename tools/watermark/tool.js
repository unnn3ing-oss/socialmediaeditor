// 浮水印：一次放一張或多張照片，把 Logo 疊在上面，
// 位置只能在四個角（預設自動：每張照片各自挑最暗的角），可調大小、透明度、邊距，下載時維持原圖尺寸。設定套用到所有照片。
// 預覽用縮小的畫布，下載時用原圖大小重畫一次；位置、大小都用「佔整張圖的比例」記錄，所以兩邊的結果一致。
//
// 搬進小編工具箱：選檔／拖曳／貼上改用 SDK（tb.files.bind），下載改用 tb.download。
// 公司 Logo（新版、舊版）不在程式裡，輸入公司密碼後才用 tb.assets.get('logo.news'／'logo.old') 從後端取；
// 沒密碼時只有「上傳自己的 Logo」。
// =====================================================================================
import { tb } from '../../sdk/toolbox.js';
import { askConfirm, isImageFile } from './confirm.js';

tb.init('watermark');

(function () {
  const $ = id => document.getElementById(id);
  const wmApp = $('watermarkApp');
  if (!wmApp) return;

  // ---- 狀態 ----------------------------------------------------------------------
  // 位置只有 4 個角：[px, py]，0＝貼齊左／上（扣掉邊距）、1＝貼齊右／下
  const ANCHORS = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const ANCHOR_NAME = { '0,0': '左上', '1,0': '右上', '0,1': '左下', '1,1': '右下' };
  const HIT_PAD = 96;                      // 預覽上拖曳 Logo 的判定區：在 Logo 外圍再加大這麼多（螢幕上的像素），Logo 本身大小不變
  // px／py 是「全部照片共用」的位置；auto 開著時改成每張照片各自挑四角最暗的（見 darkestCorner）。
  // 某張照片在預覽上單獨拖過，就會有自己的 p.pos 蓋掉上面兩種
  const DEFAULTS = { px: 1, py: 0, auto: true, size: 13, transparency: 0, margin: 3 };   // 預設自動（平手時右上角）、13%、邊距 3%、不透明
  const PREVIEW_MAX = 1080;                // 預覽畫布的長邊
  const THUMB = 208;                       // 展示窗縮圖的邊長（畫素，顯示成 104px）
  const MAX_PHOTOS = 50;                   // 一次最多放幾張
  const MAX_EXPORT_PIXELS = 100e6;         // 下載圖的畫素上限（超過會等比縮小，避免瀏覽器畫布失敗）
  const st = {
    photos: [], cur: 0, nextId: 1,
    fmt: 'auto',
    logoMode: 'custom', logoNew: null, logoOld: null, custom: null, customUrl: null,   // 浮水印圖：new／old＝公司的新版、舊版（要有密碼才有），custom＝自己上傳
    ...DEFAULTS,
  };
  const photo = () => st.photos[st.cur] || null;

  const canvas = $('wmCanvas');
  const emptyEl = $('wmEmpty');
  const statusEl = $('wmStatus');
  const downloadBtn = $('wmDownloadBtn');
  const downloadAllBtn = $('wmDownloadAllBtn');
  const photoHint = $('wmPhotoHint');
  const logoDrop = $('wmLogoDrop');
  const logoThumb = $('wmLogoThumb');
  const logoText = $('wmLogoText');
  const logoHint = $('wmLogoHint');
  const shelf = $('wmShelf');
  const thumbsEl = $('wmThumbs');
  const sliders = { size: $('wmSize'), transparency: $('wmTransparency'), margin: $('wmMargin') };
  const outs = { size: $('wmSizeOut'), transparency: $('wmTransparencyOut'), margin: $('wmMarginOut') };
  let busy = false;

  let company = false;                    // 有公司密碼、而且拿得到公司 Logo 才是 true
  const logoField = $('wmLogoField');
  const LOGO_HINT_COMPANY = '新版是向量圖、放多大都清楚；舊版是 170×100 的白色 PNG，放大會偏糊。兩個都是淺色，照片偏亮時可以改成自己上傳的圖。';
  const LOGO_HINT_UPLOAD = '建議用背景透明的 PNG／SVG；也能直接把圖拖進來、或貼上（先點一下上面的框再按 Ctrl+V）。';
  let LOGO_HINT_DEFAULT = LOGO_HINT_UPLOAD;
  const logoToggle = $('wmLogoToggle');
  // 沒密碼：tb.assets.get 回 { upload: true }，只顯示「上傳自己的 Logo」。有密碼：回 { url }，出現公司 Logo 選項。
  (async () => {
    const [news, old] = await Promise.all([tb.assets.get('logo.news').catch(() => null), tb.assets.get('logo.old').catch(() => null)]);
    const items = [['new', news], ['old', old]].filter(([, a]) => a && a.url);
    company = items.length > 0;
    if (company) {
      for (const [key, a] of items) {
        const im = new Image();
        im.onload = () => { st[key === 'new' ? 'logoNew' : 'logoOld'] = im; schedule(); };
        im.src = a.url;
      }
      logoToggle.querySelectorAll('button[data-logo]').forEach(b => { b.hidden = b.dataset.logo !== 'custom' && !items.some(([k]) => k === b.dataset.logo); });
      logoToggle.hidden = false;
      st.logoMode = items[0][0];
      logoToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.logo === st.logoMode));
      logoDrop.hidden = true;
      LOGO_HINT_DEFAULT = LOGO_HINT_COMPANY;
    } else {
      LOGO_HINT_DEFAULT = LOGO_HINT_UPLOAD;
    }
    defaultMode = company ? items[0][0] : 'custom';
    logoHint.textContent = LOGO_HINT_DEFAULT;
    logoField.hidden = false;
    schedule();
  })();
  let defaultMode = 'custom';
  const currentLogo = () => (st.logoMode === 'custom' ? st.custom : st.logoMode === 'old' ? st.logoOld : st.logoNew);

  // ---- 繪製 ----------------------------------------------------------------------
  // 照片縮圖的亮度積分表（summed-area table），之後任何矩形的平均亮度都只要查 4 個數字。
  // 透明的地方當白色算（輸出 JPG 會墊白底；PNG 的透明處看起來也是淺的），讀不到像素就回傳 null
  function lumaTable(c) {
    try {
      const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
      const t = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, a = d[i + 3] / 255;
          row += a * (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) + (1 - a) * 255;
          t[(y + 1) * (w + 1) + x + 1] = t[y * (w + 1) + x + 1] + row;
        }
      }
      return { w, h, t };
    } catch (e) { return null; }
  }
  function meanLuma(L, x, y, w, h) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(L.w, Math.max(x0 + 1, Math.ceil(x + w))), y1 = Math.min(L.h, Math.max(y0 + 1, Math.ceil(y + h)));
    const W = L.w + 1, t = L.t;
    return (t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
  }
  // 自動位置：四個角裡，Logo 實際會蓋到的那塊區域平均最暗的角（內建 Logo 是淺色，放暗處最清楚）。
  // 每張照片各自算；跟著目前的大小、邊距、Logo 比例即時算，所以調滑桿後也會重新挑。
  // 差不到 2（0～255）的算平手，平手時優先共用位置（預設右上），免得幾乎一樣暗的照片位置亂跳
  function darkestCorner(p) {
    const logo = currentLogo();
    if (!p || !p.luma || !logo) return null;
    const L = p.luma;
    const order = [[st.px, st.py], ...ANCHORS.filter(a => a[0] !== st.px || a[1] !== st.py)];
    let best = null, bl = Infinity;
    for (const a of order) {
      const r = logoRect(L.w, L.h, logo, a);
      const v = meanLuma(L, r.x, r.y, r.w, r.h);
      if (v < bl - 2) { bl = v; best = a; }
    }
    return best;
  }
  // 沒有單獨拖過時的位置：自動模式＝這張最暗的角，否則＝共用位置
  const basePos = p => (st.auto && darkestCorner(p)) || [st.px, st.py];
  // 這張照片實際用的位置：自己單獨設定過就用自己的，否則用上面的
  const posOf = p => (p && p.pos) || basePos(p);

  // 浮水印在 W×H 的畫面上的位置（pos 預設是目前這張照片的位置）
  function logoRect(W, H, logo, pos = posOf(photo())) {
    const w = W * st.size / 100;
    const h = w * logo.naturalHeight / logo.naturalWidth;
    const m = Math.min(W, H) * st.margin / 100;
    const rx = W - w - 2 * m, ry = H - h - 2 * m;
    return {
      x: rx > 0 ? m + pos[0] * rx : (W - w) / 2,
      y: ry > 0 ? m + pos[1] * ry : (H - h) / 2,
      w, h, m, rx, ry,
    };
  }
  // 在 g 上畫「照片＋浮水印」。src 可以是 Image 或縮圖畫布；ox/oy 是照片左上角在 g 上的位置
  function drawComposite(g, src, ox, oy, W, H, opaqueBg, pos) {
    g.imageSmoothingQuality = 'high';
    if (opaqueBg) { g.fillStyle = '#fff'; g.fillRect(ox, oy, W, H); }
    g.drawImage(src, ox, oy, W, H);
    const logo = currentLogo();
    if (!logo) return;
    const r = logoRect(W, H, logo, pos);
    g.save();
    g.globalAlpha = 1 - st.transparency / 100;
    g.drawImage(logo, ox + r.x, oy + r.y, r.w, r.h);
    g.restore();
  }

  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

  let dragging = false, hover = false, zoneScale = 1;
  function drawGuides(g, W, H, cur) {      // 拖曳時在預覽上標出 4 個角可以停的位置（只在畫面上，不會下載出去）
    const logo = currentLogo();
    if (!logo) return;
    g.save();
    g.lineWidth = Math.max(2, W / 400);
    g.setLineDash([g.lineWidth * 3, g.lineWidth * 3]);
    for (const a of ANCHORS) {
      const r = logoRect(W, H, logo, a);
      g.strokeStyle = a[0] === cur[0] && a[1] === cur[1] ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 4;
      g.strokeRect(r.x, r.y, r.w, r.h);
    }
    g.restore();
  }
  // 判定區（可以抓到 Logo 的範圍）：Logo 外圍加大 HIT_PAD 個螢幕像素
  function zoneOf(r, scale) {
    const pad = HIT_PAD * scale;
    return { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
  }
  function drawZone(g, W, H, pos) {         // 滑鼠移進判定區時，用淡淡的虛線框讓使用者知道可以抓
    const logo = currentLogo();
    if (!logo) return;
    const z = zoneOf(logoRect(W, H, logo, pos), zoneScale);
    g.save();
    g.lineWidth = Math.max(1.5, W / 500);
    g.setLineDash([g.lineWidth * 4, g.lineWidth * 3]);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 3;
    g.beginPath();
    g.roundRect(z.x, z.y, z.w, z.h, 10 * zoneScale);
    g.fill(); g.stroke();
    g.restore();
  }

  function render() {
    for (const k of Object.keys(sliders)) outs[k].textContent = `${st[k]}%`;
    const p = photo(), logo = currentLogo();
    const curPos = posOf(p);
    for (const b of $('wmGrid').querySelectorAll('button[data-px]')) {
      const at = Number(b.dataset.px) === curPos[0] && Number(b.dataset.py) === curPos[1];
      b.classList.toggle('active', at && (!st.auto || !!(p && p.pos)));
      b.classList.toggle('auto-pick', at && st.auto && !(p && p.pos));     // 自動挑到的角：淡一點的框，跟手動選的區分
    }
    $('wmAutoBtn').classList.toggle('active', st.auto);
    $('wmPosHint').textContent = p && p.pos
      ? `這張照片的位置是在預覽上單獨調整的；按上面的按鈕會套用到全部照片。`
      : st.auto
        ? `自動：每張照片各自放在四個角最暗的地方${p ? `（這張是「${ANCHOR_NAME[curPos.join()]}」）` : ''}；在預覽上拖曳 Logo 可以單獨改這一張。`
        : '按上面的位置鈕會套用到全部照片；在預覽上拖曳 Logo 則只改目前這一張。';
    const n = st.photos.length;
    if (p) {
      const s = Math.min(1, PREVIEW_MAX / Math.max(p.img.naturalWidth, p.img.naturalHeight));
      const W = Math.max(1, Math.round(p.img.naturalWidth * s)), H = Math.max(1, Math.round(p.img.naturalHeight * s));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, W, H);
      drawComposite(g, p.img, 0, 0, W, H, false, curPos);
      if (dragging) drawGuides(g, W, H, curPos); else if (hover) drawZone(g, W, H, curPos);
    }
    canvas.hidden = !p;
    emptyEl.hidden = !!p;
    const ready = !!p && !!logo;
    downloadBtn.disabled = busy || !ready;
    downloadBtn.textContent = n > 1 ? '下載本張' : '下載圖片';
    downloadAllBtn.hidden = n < 2;
    downloadAllBtn.disabled = busy || !logo;
    downloadAllBtn.textContent = `全部下載（${n} 張）`;
    if (!busy) {
      statusEl.textContent = !p ? '請先上傳照片' : !logo ? '請上傳浮水印圖' : (n > 1 ? `預覽已更新（第 ${st.cur + 1}／${n} 張）` : '預覽已更新');
    }
    drawThumbs();
  }

  // ---- 展示窗（多張照片）----------------------------------------------------------
  // 縮圖：照片完整縮進正方形（不裁切，才看得到邊角的浮水印），上面疊同樣的浮水印
  function paintThumb(c, p) {
    const g = c.getContext('2d');
    g.fillStyle = '#e8eef7'; g.fillRect(0, 0, THUMB, THUMB);
    const k = Math.min(THUMB / p.small.width, THUMB / p.small.height);
    const w = Math.round(p.small.width * k), h = Math.round(p.small.height * k);
    drawComposite(g, p.small, Math.round((THUMB - w) / 2), Math.round((THUMB - h) / 2), w, h, false, posOf(p));
  }

  let thumbKey = '';
  function drawThumbs() {
    shelf.hidden = st.photos.length < 2;
    const key = st.photos.map(p => p.id).join(',');
    if (key !== thumbKey) {            // 張數或順序變了才重建；平常只重畫縮圖內容
      thumbKey = key;
      thumbsEl.textContent = '';
      st.photos.forEach((p, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'wm-thumb';
        wrap.dataset.id = String(p.id);
        wrap.title = `#${i + 1} ${p.name}`;
        const c = document.createElement('canvas');
        c.width = c.height = THUMB;
        const badge = document.createElement('span');
        badge.className = 'wm-thumb-no';
        badge.textContent = String(i + 1);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'remove-btn wm-thumb-rm';
        rm.title = '移除這張'; rm.setAttribute('aria-label', `移除第 ${i + 1} 張`);
        rm.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
        rm.addEventListener('click', e => { e.stopPropagation(); removePhoto(p.id); });
        wrap.addEventListener('click', () => { st.cur = st.photos.findIndex(x => x.id === p.id); schedule(); });
        wrap.append(c, badge, rm);
        thumbsEl.append(wrap);
      });
      updateShelfNav();
    }
    st.photos.forEach((p, i) => {
      const wrap = thumbsEl.children[i];
      if (!wrap) return;
      wrap.classList.toggle('active-thumb', i === st.cur);
      wrap.classList.toggle('own-pos', !!p.pos);
      wrap.title = `#${i + 1} ${p.name}${p.pos ? '（位置單獨設定）' : ''}`;
      paintThumb(wrap.firstChild, p);
    });
    const active = thumbsEl.children[st.cur];
    if (active && lastCentered !== `${thumbKey}|${st.cur}`) {
      lastCentered = `${thumbKey}|${st.cur}`;
      thumbsEl.scrollTo({ left: active.offsetLeft - (thumbsEl.clientWidth - active.offsetWidth) / 2 });
    }
  }
  let lastCentered = '';
  function updateShelfNav() {
    const max = thumbsEl.scrollWidth - thumbsEl.clientWidth;
    $('wmShelfPrev').disabled = thumbsEl.scrollLeft <= 1;
    $('wmShelfNext').disabled = thumbsEl.scrollLeft >= max - 1;
  }
  $('wmShelfPrev').addEventListener('click', () => thumbsEl.scrollBy({ left: -thumbsEl.clientWidth * 0.8 }));
  $('wmShelfNext').addEventListener('click', () => thumbsEl.scrollBy({ left: thumbsEl.clientWidth * 0.8 }));
  thumbsEl.addEventListener('scroll', updateShelfNav, { passive: true });
  thumbsEl.addEventListener('wheel', e => {     // 滑鼠滾輪也能左右捲動（觸控板本來就可以）
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (thumbsEl.scrollWidth <= thumbsEl.clientWidth) return;
    e.preventDefault();
    thumbsEl.scrollBy({ left: e.deltaY, behavior: 'auto' });
  }, { passive: false });
  new ResizeObserver(updateShelfNav).observe(thumbsEl);

  function removePhoto(id) {
    const i = st.photos.findIndex(p => p.id === id);
    if (i < 0) return;
    const [p] = st.photos.splice(i, 1);
    URL.revokeObjectURL(p.url);
    if (st.cur > i || st.cur >= st.photos.length) st.cur = Math.max(0, st.cur - 1);
    updateHint();
    schedule();
  }

  // ---- 載入照片／浮水印圖 --------------------------------------------------------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => resolve({ im, url });
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      im.src = url;
    });
  }
  const isImage = f => (isImageFile(f));

  function updateHint(extra) {
    const n = st.photos.length, p = photo();
    const base = !n ? '輸出會保持原圖尺寸'
      : n === 1 ? `已載入：${p.name}（${p.img.naturalWidth}×${p.img.naturalHeight}），輸出會保持原圖尺寸`
      : `已載入 ${n} 張；目前第 ${st.cur + 1} 張：${p.name}（${p.img.naturalWidth}×${p.img.naturalHeight}）`;
    photoHint.textContent = extra ? `${base}。${extra}` : base;
  }

  // 一次加入一張或多張（依序載入，免得很多大圖同時解碼）；已有的照片會保留，新的接在後面
  async function addPhotos(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const images = files.filter(isImage);
    const notes = [];
    if (images.length < files.length) notes.push(`略過 ${files.length - images.length} 個不是圖片的檔案`);
    const room = MAX_PHOTOS - st.photos.length;
    if (images.length > room) notes.push(`一次最多 ${MAX_PHOTOS} 張，多出的 ${images.length - room} 張沒有加入`);
    const wasEmpty = st.photos.length === 0;
    let failed = 0;
    for (const file of images.slice(0, Math.max(0, room))) {
      try {
        const { im, url } = await loadImage(file);
        const k = Math.min(1, THUMB / Math.max(im.naturalWidth, im.naturalHeight));
        const small = document.createElement('canvas');      // 縮圖用的小圖，之後重畫縮圖不用每次縮大圖
        small.width = Math.max(1, Math.round(im.naturalWidth * k));
        small.height = Math.max(1, Math.round(im.naturalHeight * k));
        const g = small.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(im, 0, 0, small.width, small.height);
        st.photos.push({ id: st.nextId++, name: file.name, mime: file.type, img: im, url, small, luma: lumaTable(small) });
      } catch (e) { failed++; }
    }
    if (failed) notes.push(`${failed} 張無法開啟（可能是不支援的格式，例如 HEIC，請改用 JPG／PNG）`);
    if (wasEmpty) st.cur = 0;
    updateHint(notes.join('；'));
    schedule();
  }

  async function setLogo(file) {
    if (!isImage(file)) { logoHint.textContent = file ? `無法辨識「${file.name}」為圖片檔` : ''; return; }
    try {
      const { im, url } = await loadImage(file);
      if (st.customUrl) URL.revokeObjectURL(st.customUrl);
      st.custom = im; st.customUrl = url;
      logoThumb.src = url; logoThumb.hidden = false;
      logoText.hidden = true;
      logoHint.textContent = `已載入：${file.name}（${im.naturalWidth}×${im.naturalHeight}）`;
      schedule();
    } catch (e) { logoHint.textContent = `「${file.name}」無法開啟，請改用 PNG／JPG／SVG`; }
  }

  // 點擊／拖曳／貼上上傳區。貼上時：先點過「浮水印圖」上傳框的話貼到 Logo，否則貼到照片
  let pasting = false, pasteToLogo = false;
  document.addEventListener('paste', () => {
    pasting = true; pasteToLogo = document.activeElement === logoDrop && st.logoMode === 'custom';
    setTimeout(() => { pasting = false; }, 0);
  }, true);
  tb.files.bind($('wmPhotoDrop'), { accept: 'image/*', multiple: true, max: MAX_PHOTOS + 1, onFiles: files => { if (!(pasting && pasteToLogo)) addPhotos(files); } });
  tb.files.bind(logoDrop, { accept: 'image/*', multiple: false, onFiles: files => { if (!pasting || pasteToLogo) setLogo(files[0]); } });

  // 把照片拖到預覽區也可以
  const stage = $('wmStage');
  stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drag'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
  stage.addEventListener('drop', e => { e.preventDefault(); stage.classList.remove('drag'); addPhotos(e.dataTransfer.files); });

  // ---- 浮水印圖來源 ---------------------------------------------------------------
  logoToggle.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    st.logoMode = btn.dataset.logo;
    logoToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    logoDrop.hidden = company && st.logoMode !== 'custom';
    schedule();
  }));

  // ---- 位置、滑桿、輸出格式 --------------------------------------------------------
  // 左側的位置鈕＝「全部套用」（四個角＝全部放同一角；自動＝每張各自挑最暗的角）。
  // 如果有照片已經在預覽上單獨拖過，會先問一聲再全部改掉
  $('wmGrid').querySelectorAll('button').forEach(btn => btn.addEventListener('click', async () => {
    const auto = btn.id === 'wmAutoBtn';
    const target = auto ? null : [Number(btn.dataset.px), Number(btn.dataset.py)];
    const own = st.photos.filter(p => p.pos).length;
    if (own > 0 && st.photos.length > 1) {
      const ok = await askConfirm({
        title: '要把全部照片的位置都改掉嗎？',
        message: `有 ${own} 張照片的浮水印位置是在預覽上單獨調整過的。\n繼續的話，全部 ${st.photos.length} 張都會改成${auto ? '「自動（各自放在最暗的角）」' : `「${ANCHOR_NAME[target.join()]}」`}，單獨調整的位置會被蓋掉。`,
        okText: '全部改變'
      });
      if (!ok) return;
    }
    for (const p of st.photos) p.pos = null;
    st.auto = auto;
    if (target) { st.px = target[0]; st.py = target[1]; }
    schedule();
  }));
  for (const [key, el] of Object.entries(sliders)) {
    el.addEventListener('input', () => { st[key] = Number(el.value); schedule(); });
  }
  const fmtToggle = $('wmFormat');
  function syncFormat() { fmtToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.fmt === st.fmt)); }
  fmtToggle.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => { st.fmt = btn.dataset.fmt; syncFormat(); }));

  // ---- 在預覽上拖曳浮水印（只會吸附到 4 個角；只改目前這一張）／滾輪 --------------------------
  let drag = false;
  const toCanvas = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height, scale: canvas.width / r.width };
  };
  // 滑鼠在判定區內就回傳 Logo 的矩形（判定區比 Logo 大，方便快速抓；Logo 本身大小不變）
  function hitLogo(p) {
    const logo = currentLogo();
    if (!logo || !photo()) return null;
    const r = logoRect(canvas.width, canvas.height, logo);
    const z = zoneOf(r, p.scale);
    return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h ? r : null;
  }
  // 滑鼠目前在畫面的哪個位置 → 最近的角
  function nearestAnchor(p) {
    const fx = p.x / canvas.width, fy = p.y / canvas.height;
    let best = ANCHORS[0], bd = Infinity;
    for (const a of ANCHORS) {
      const d = (a[0] - fx) ** 2 + (a[1] - fy) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  canvas.addEventListener('pointerdown', e => {
    const p = toCanvas(e);
    if (!hitLogo(p)) return;
    e.preventDefault();
    zoneScale = p.scale;
    drag = dragging = true;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
    schedule();
  });
  canvas.addEventListener('pointermove', e => {
    const p = toCanvas(e);
    zoneScale = p.scale;
    if (!drag) {
      const over = !!hitLogo(p);
      canvas.classList.toggle('over-logo', over);
      if (over !== hover) { hover = over; schedule(); }
      return;
    }
    const cur = photo();
    const a = nearestAnchor(p);
    const base = basePos(cur);
    const next = a[0] === base[0] && a[1] === base[1] ? null : a;   // 拖回沒單獨設定時的位置（共用或自動挑的角），就不算「單獨設定」
    const same = (cur.pos || null) === next || (cur.pos && next && cur.pos[0] === next[0] && cur.pos[1] === next[1]);
    if (!same) { cur.pos = next; schedule(); }
  });
  const endDrag = e => {
    if (!drag) return;
    drag = dragging = false;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    schedule();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!drag) { canvas.classList.remove('over-logo'); if (hover) { hover = false; schedule(); } } });
  canvas.addEventListener('wheel', e => {
    if (!hitLogo(toCanvas(e))) return;              // 沒有停在浮水印上就照常捲動頁面
    e.preventDefault();
    st.size = Math.min(60, Math.max(5, st.size + (e.deltaY < 0 ? 2 : -2)));
    sliders.size.value = st.size;
    schedule();
  }, { passive: false });

  // ---- 下載／全部清除 --------------------------------------------------------------
  const safeBase = name => (name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60)) || '照片';
  const extFor = p => (st.fmt === 'png' ? 'png' : st.fmt === 'jpeg' ? 'jpg' : (p.mime === 'image/jpeg' ? 'jpg' : 'png'));

  // 回傳 { blob, filename, note }
  async function exportPhoto(p) {
    let W = p.img.naturalWidth, H = p.img.naturalHeight, note = '';
    if (W * H > MAX_EXPORT_PIXELS) {
      const s = Math.sqrt(MAX_EXPORT_PIXELS / (W * H));
      W = Math.round(W * s); H = Math.round(H * s);
      note = `（${p.name} 太大，已縮小成 ${W}×${H}）`;
    }
    const ext = extFor(p);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    drawComposite(c.getContext('2d'), p.img, 0, 0, W, H, ext === 'jpg', posOf(p));
    const blob = await new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('產生圖片失敗'))), ext === 'png' ? 'image/png' : 'image/jpeg', 0.95));
    return { blob, filename: `${safeBase(p.name)}_浮水印.${ext}`, note };
  }
  async function run(fn) {
    if (busy) return;
    busy = true; render();
    try { await fn(); } catch (err) { statusEl.textContent = `下載失敗：${err.message || err}`; }
    finally { busy = false; const keep = statusEl.textContent; render(); statusEl.textContent = keep; }
  }

  downloadBtn.addEventListener('click', () => run(async () => {
    const { blob, filename, note } = await exportPhoto(photo());
    tb.download(blob, filename);
    statusEl.textContent = `已下載：${filename}${note}`;
  }));
  // 全部下載：檔名是「YYMMDDHHMM_第幾張」，例如 2610122312_1。時間只在按下按鈕的那一刻取一次；每張之間隔 0.5～1 秒（tb.download.batch）。
  downloadAllBtn.addEventListener('click', () => run(async () => {
    const list = [...st.photos], notes = [], items = [];
    const now = new Date();
    for (let i = 0; i < list.length; i++) {
      statusEl.textContent = `產生中 ${i + 1}／${list.length}：${list[i].name}`;
      const { blob, note } = await exportPhoto(list[i]);
      if (note) notes.push(note);
      items.push({ blob, name: `${tb.stampName(now, i + 1)}.${extFor(list[i])}` });
    }
    await tb.download.batch(items);
    statusEl.textContent = `已下載 ${list.length} 張（${items[0].name} ～ ${items[items.length - 1].name}）${notes.join('')}`;
  }));

  $('wmResetBtn').addEventListener('click', async () => {
    if (!(await askConfirm())) return;
    for (const p of st.photos) URL.revokeObjectURL(p.url);
    if (st.customUrl) URL.revokeObjectURL(st.customUrl);
    Object.assign(st, { photos: [], cur: 0, fmt: 'auto', custom: null, customUrl: null, logoMode: defaultMode, ...DEFAULTS });
    updateHint();
    logoThumb.hidden = true; logoThumb.removeAttribute('src'); logoText.hidden = false;
    logoHint.textContent = LOGO_HINT_DEFAULT;
    logoDrop.hidden = company;
    logoToggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.logo === defaultMode));
    for (const [k, el] of Object.entries(sliders)) el.value = st[k];
    syncFormat();
    schedule();
  });

  // 測試與除錯用
  window.Watermark = { state: st, logoRect, ANCHORS, posOf, darkestCorner };
  schedule();
})();

