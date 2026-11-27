// 做圖＋帶入：貼上文章網址就自動帶入標題、主圖、貼文內容、框；[照片套圖｜純文字圖｜純文字]，照片套圖的框可選 新聞｜娛樂｜照片（不套框、1～10 張原樣送出）。
// 畫圖用共用核心 ui/compose（和「圖片套版」同一份畫法）；字級本工具固定：照片套圖 66px、純文字圖 76px。框的判斷用 rules.js。
import { $, errText, say, confirmBox, segmented, stripLead, hscroll } from './util.js';
import { frameForUrl } from './rules.js';
import { titleCheck, LINE_MAX, syncTitleLine, textCheck, TEXT_LINE_MAX } from './title.js';
import { createTitleEditor } from './titleedit.js';
import { autoLines } from '../../sdk/news-rules.js';
import { parseArticle, formatCopy, mainCaption } from '../../sdk/news-article.js';
import {
  SIZE, PRESET_COLORS, newView, clampView, coverGeometry, MAX_ZOOM, usesDarkTitle, createRenderer, loadTitleGlyphs
} from '../../ui/compose/render.js';
import { createFxKit } from '../../ui/compose/fx.js';

const MAX_IMAGES = 3;
const RAW_MAX = 8 * 1024 * 1024;   // 照片框每張送出上限（和後端 MAX_IMAGE 相同）
const RAW_TOTAL = 25 * 1024 * 1024;   // 照片框合計上限（和後端 MAX_IMAGES_TOTAL 相同）
export const MAX_PHOTOS = 10;
export const BG_MAX = 130;                          // 臉書文字背景貼文字數上限
export const BG_FONT = { max: 30, min: 14 };          // 文字背景預覽字級：塞得下的最大字級（不自動換行）
export const TITLE_PX = { image: 66, color: 76 };      // 使用者指定字級（只用在排程發布）
const ARTICLE_RE = /^https?:\/\/\S+\/\d{6,9}\/?(?:[?#]\S*)?$/i;   // 打完一個新聞網址（結尾是文章編號）就自動帶入

export function createComposer({ tb, assets, onState = () => {} }) {   // onState：模式／照片改變（送出鈕要重算能不能送）
  const renderer = createRenderer(assets);
  const kit = createFxKit({ stickerUrls: assets.stickers });
  const canvas = $('cv');
  const ctx = canvas.getContext('2d');
  const st = {
    mode: 'image',                               // image＝照片套圖｜color＝純文字圖｜text＝純文字（不附圖）
    frame: assets.company ? 'news' : 'generic',  // 沒有公司素材時只有通用框；photo＝照片（不套框、可多張）
    photos: [], cur: 0,                          // 照片清單 [{ img, blob }]；套版只用第 1 張，照片框全部送出；cur＝照片框預覽中的那張
    photo: null, view: newView(),
    color: PRESET_COLORS.includes('#c80000') ? '#c80000' : PRESET_COLORS[0],
    fx: [],                                      // 貼圖／馬賽克清單（選套版與純文字圖共用一份）
  };

  const source = () => (st.mode === 'color' ? { type: 'color', color: st.color }
    : st.mode === 'image' && st.photo ? (isRaw() ? { type: 'raw' } : { type: 'image', image: st.photo, view: st.view }) : null);
  const isRaw = () => st.mode === 'image' && st.frame === 'photo';   // 照片框：不套框、不畫標題、原樣送出
  const usesPhoto = () => st.mode === 'image';
  // 有公司素材但公司標題字型沒載入：標題會改用 Noto Sans TC，提示原因
  if (assets.company && !assets.fontLoaded) {
    $('fontWarn').textContent = `公司標題字型沒載入，標題暫用 Noto Sans TC：${assets.fontError || '原因不明'}`;
    $('fontWarn').hidden = false;
  }
  const ready = () => !!source();
  const fxReady = () => ready() && !isRaw();   // 照片框不加貼圖／馬賽克（原樣送出）
  // 實際送出的貼文內容：純文字＝標題框；其他＝貼文內容（開頭留給小編文的空行沒填就拿掉）
  const postText = () => (st.mode === 'text' ? $('title').value.trim() : stripLead($('msg').value));
  const px = () => (st.mode === 'color' ? TITLE_PX.color : TITLE_PX.image);
  let titleEd = null;

  // 沒照片時的預覽底圖：淡藍灰往下漸深＋目前的框（角落緞帶），只在預覽、不進輸出
  const blank = document.createElement('canvas');
  blank.width = blank.height = SIZE;
  { const b = blank.getContext('2d'), g = b.createLinearGradient(0, 0, 0, SIZE);
    g.addColorStop(0, '#dbe4f3'); g.addColorStop(0.55, '#b9c3d2'); g.addColorStop(1, '#8e98a8');
    b.fillStyle = g; b.fillRect(0, 0, SIZE, SIZE); }
  // 標題照樣畫上去，沒照片也能在預覽上點標題直接改
  function drawBlank(title) {
    renderer.renderComposite(ctx, { type: 'image', image: blank, view: newView() }, title, px(), st.frame, null, undefined, { titleAnchor: 'bottom' });
    canvas.classList.remove('pannable');
  }

  // 照片框預覽：選中的那張整張放進方框（不裁切），四周淡灰；送出的是原始檔，不是這張預覽
  function drawRaw() {
    const im = (st.photos[st.cur] || st.photos[0]).img, k = Math.min(SIZE / im.naturalWidth, SIZE / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    ctx.fillStyle = '#eef1f5'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(im, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    canvas.classList.remove('pannable');
  }
  function draw() {
    const src = source();
    $('cvEmpty').hidden = !!src;
    $('cvWrap').classList.toggle('is-blank', !src);
    const title = titleEd && titleEd.editing() ? '' : $('title').value;   // 預覽上編輯中：標題由輸入框顯示
    if (!src) { if (isRaw()) { ctx.drawImage(blank, 0, 0); return; } drawBlank(st.mode === 'image' ? title : ''); return; }
    if (src.type === 'raw') { drawRaw(); return; }
    renderer.renderComposite(ctx, src, title, px(), st.frame, kit.drawFx(st.fx), undefined, { titleAnchor: 'bottom' });
  }

  // ---- 貼圖／馬賽克 ----
  const editor = kit.createEditor({
    // 改了內容：重畫，並讓預覽上的操作方框跟著更新位置與數量
    canvas, items: () => st.fx, ready: fxReady, changed: () => { draw(); editor.sync(); }, redraw: draw,
    onLayout: (n, gray) => { $('fxCount').textContent = [n ? `已加 ${n} 個` : '', gray ? '抽色' : ''].filter(Boolean).join('・'); }
  });
  const fxRow = kit.buildRow(editor);
  $('fxSlot').append(fxRow.row);
  $('fxHint').textContent = kit.hintText;
  // 「T寶／馬賽克」按鈕：點了才展開貼圖列（隱藏切換）
  $('fxBtn').addEventListener('click', () => { const open = $('fxBar').hidden; $('fxBar').hidden = !open; $('fxBtn').setAttribute('aria-expanded', String(open)); if (open) editor.sync(); });
  // 標題、貼文內容：最少 4 行，內容多就往下長（不出現框內捲軸）
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + ta.offsetHeight - ta.clientHeight}px`; };
  // ---- 純文字的臉書文字背景（清單由後端 /fb/backgrounds 給；讀不到就不顯示）----
  let bgs = [];
  let bgRow = null;   // 文字背景一列（無｜圖樣｜純色｜漸層）的左右滑
  const bgImgUrl = {};   // 圖樣代號 → 已載入的圖片網址（ObjectURL）
  st.bg = '';
  const bgOn = () => (st.mode === 'text' && bgs.some((b) => b.id === st.bg) ? st.bg : '');
  // 預設背景：從管理頁「列入隨機」的背景裡隨機一個（舊後端沒回 rnd：純色／漸層列入、圖樣不列入）；都沒勾＝「無」；「無」仍可手動選
  const inRandom = (b) => (typeof b.rnd === 'boolean' ? b.rnd : b.type !== 'image');
  const randomBg = () => { const l = bgs.filter(inRandom); return l.length ? l[Math.floor(Math.random() * l.length)].id : ''; };
  // 字級自適應：不自動換行，最長那行與總行數都塞得進預覽框的最大字級
  function fitBg() {
    const box = $('bgPrev'), p = $('bgText');
    if (box.hidden || !box.offsetParent) return;
    const cs = getComputedStyle(box);
    const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    let s = BG_FONT.max;
    for (; s > BG_FONT.min; s--) { p.style.fontSize = s + 'px'; if (p.scrollWidth <= w + 0.5 && p.scrollHeight <= h + 0.5) break; }
    p.style.fontSize = s + 'px';
  }
  function bgShow() {
    const b = bgs.find((x) => x.id === st.bg);
    $('bgPrev').hidden = !b; $('noImgTxt').hidden = !!b;
    $('bgName').textContent = b ? b.name : '無';
    if (b) {
      $('bgPrev').style.background = b.css;
      if (bgImgUrl[b.id]) $('bgPrev').style.background = `${b.css} url("${bgImgUrl[b.id]}") center / cover no-repeat`;
      $('bgPrev').style.color = b.text || '#fff';
      const ed = $('bgText'), v = $('title').value + ($('title').value.endsWith('\n') ? '\n' : '');   // 預覽上編輯中不覆蓋（游標會跑掉）
      if (document.activeElement !== ed && ed.textContent !== v) ed.textContent = v;
      fitBg();
    }
    for (const el of $('bgBox').querySelectorAll('.sw')) { const on = el.dataset.bg === st.bg; el.classList.toggle('is-on', on); el.setAttribute('aria-pressed', String(on)); }
    if (bgRow) bgRow.reveal($('bgSws').querySelector('.sw.is-on'));   // 選到的捲到看得見
  }
  function bgButton(id, name, css) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'sw' + (id ? '' : ' bg-none'); el.dataset.bg = id; el.title = name; el.setAttribute('aria-label', '文字背景 ' + name);
    if (css) el.style.background = css;
    return el;
  }
  // 預覽上直接編輯：和標題（貼文內容）框雙向同步
  $('bgText').addEventListener('input', () => {
    const v = $('bgText').textContent.replace(/\n$/, '');   // 結尾換行時瀏覽器會多放一個 \n 才顯示得出空行
    if ($('title').value === v) return;
    $('title').value = v; $('title').dispatchEvent(new Event('input'));
  });
  $('bgText').addEventListener('blur', () => bgShow());
  new ResizeObserver(fitBg).observe($('bgPrev'));
  const bgPick = (e) => { const el = e.target.closest('.sw'); if (!el) return; st.bg = el.dataset.bg; msgCount(); };
  bgRow = hscroll($('bgSws'));
  $('bgSws').addEventListener('click', bgPick);
  // 圖樣：按鈕跟著清單一起建（骨架），第一次切到純文字才帶登入讀圖（同時最多 6 張）
  let bgImgEls = [], bgImgsLoading = false;
  function bgLoadImgs() {
    if (bgImgsLoading || !bgImgEls.length) return;
    bgImgsLoading = true;
    const list = bgs.filter((b) => b.type === 'image'), els = bgImgEls;
    let i = 0;
    const next = () => {
      if (i >= list.length) return Promise.resolve();
      const k = i++, b = list[k], el = els[k];
      return Promise.resolve().then(() => tb.api.call(b.img, { raw: true })).then((r) => r.blob()).then((blob) => {
        bgImgUrl[b.id] = URL.createObjectURL(blob);
        el.style.background = `${b.css} url("${bgImgUrl[b.id]}") center / cover no-repeat`;
        if (st.bg === b.id) bgShow();
      }).catch(() => { el.style.background = b.css; }).then(() => { el.classList.remove('sk'); return next(); });
    };
    for (let n = 0; n < 6; n++) next();
  }
  Promise.resolve().then(() => tb.api.call('/fb/backgrounds')).then((list) => {
    bgs = (Array.isArray(list) ? list : []).filter((b) => b && /^\d+$/.test(b.id) && b.name && b.css && /^#[0-9a-f]{6}$/i.test(b.text || '')
      && (b.type !== 'image' || /^\/fb\/bg\/\d+$/.test(b.img || '')));
    if (!bgs.length) return;
    // 「無」→ 圖樣 → 純色 → 漸層（同一列左右滑），組與組之間一條分隔線；圖樣先放骨架，切到純文字才讀圖
    const sep = () => { const el = document.createElement('span'); el.className = 'bg-sep'; el.setAttribute('aria-hidden', 'true'); return el; };
    const els = [bgButton('', '無', '')];
    const order = ['image', 'solid', 'gradient'];
    let type = '';
    for (const b of [...bgs].sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type))) {
      if (b.type !== type) { type = b.type; els.push(sep()); }
      const el = bgButton(b.id, b.name, b.type === 'image' ? '' : b.css);
      if (b.type === 'image') { el.classList.add('sk', 'bg-img'); bgImgEls.push(el); }
      els.push(el);
    }
    $('bgSws').append(...els);
    if (!st.bg) st.bg = randomBg();
    $('bgBox').hidden = false; msgCount();
    if (st.mode === 'text') bgLoadImgs();
    requestAnimationFrame(() => bgRow.sync());
  }).catch(() => {});

  // 字數只算實際送出的內容（開頭留給小編文的空行沒填，送出時會拿掉）；選了背景顯示「N／130 字」，超過變紅
  // 純文字：只用標題框（＝貼文內容，貼文內容框隱藏、不送出）；字數顯示在標題旁
  const msgCount = () => {
    const n = [...postText()].length, bg = bgOn();
    const el = st.mode === 'text' ? $('titleCount') : $('msgCount');
    let warn = '';
    if (st.mode === 'text') {
      // 有背景：不自動換行，右側每行 N/11（和輸入框的行對齊）；選「無」：自動換行、不顯示
      const ta = $('title'), box = $('titleLines');
      ta.setAttribute('wrap', bg ? 'off' : 'soft');
      box.hidden = !bg; box.textContent = '';
      if (bg) {
        const c = textCheck(ta.value); warn = c.text;
        c.widths.forEach((w) => { const d = document.createElement('div'); d.textContent = w ? `${w}/${TEXT_LINE_MAX}` : ''; d.classList.toggle('bad', w > TEXT_LINE_MAX); box.append(d); });
        alignTitleLines();
      }
    }
    el.textContent = warn ? `${warn}・${n}／${BG_MAX} 字` : bg ? `${n}／${BG_MAX} 字（文字背景）` : `${n} 字`;
    el.classList.toggle('bad', (!!bg && n > BG_MAX) || !!warn);
    bgShow();
    if ($('msg').offsetParent) grow($('msg'));
  };
  // 視窗原本隱藏量不到高度：打開（尺寸改變）時再算一次；程式填值走 msgCount／titleChanged
  for (const id of ['title', 'msg']) { $(id).addEventListener('input', () => grow($(id))); new ResizeObserver(() => { if ($(id).offsetParent) grow($(id)); }).observe($(id)); }
  $('msg').addEventListener('input', msgCount); msgCount();
  const syncFx = () => { fxRow.tiles.forEach((b) => { b.disabled = !fxReady(); }); $('fxBar').classList.toggle('off', !fxReady()); $('fxBtn').hidden = isRaw(); if (isRaw()) $('fxBar').hidden = true; editor.sync(); onState(); };

  titleEd = createTitleEditor({ canvas, input: $('title'), renderer, mode: () => st.mode, px, ready: () => st.mode !== 'text' && !isRaw(), redraw: draw, light: () => usesDarkTitle({ type: 'color', color: st.color }) });

  // ---- 照片拖曳移動、滾輪縮放 ----
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (st.mode !== 'image' || isRaw() || !st.photo || e.button !== 0) return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: st.view.x, y: st.view.y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = SIZE / canvas.clientWidth;
    st.view.x = drag.x + (e.clientX - drag.sx) * k;
    st.view.y = drag.y + (e.clientY - drag.sy) * k;
    clampView(st.photo, st.view); draw();
  });
  const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (st.mode !== 'image' || isRaw() || !st.photo) return;
    e.preventDefault();
    const before = coverGeometry(st.photo, st.view).s;
    st.view.zoom = Math.min(MAX_ZOOM, Math.max(1, st.view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const f = coverGeometry(st.photo, st.view).s / before;
    st.view.x *= f; st.view.y *= f;
    clampView(st.photo, st.view); draw();
  }, { passive: false });

  // ---- 模式、框、底色 ----
  function showMode() {
    $('imgArea').hidden = st.mode === 'text';
    $('noImg').hidden = st.mode !== 'text';
    $('frameRow').hidden = st.mode !== 'image';
    $('swatchBox').hidden = st.mode !== 'color';
    const text = st.mode === 'text';
    $('msg').hidden = text; $('msgLbl').hidden = text;
    $('titleName').textContent = text ? '標題（貼文內容）' : '標題';
    if (!text) { $('titleLines').hidden = isRaw(); $('title').setAttribute('wrap', 'off'); }   // 純文字的換行與每行字數由 msgCount 依有無背景設定
    if (isRaw()) $('titleName').textContent = '標題（不畫在圖上）';
    $('title').placeholder = text ? '純文字貼文只發這一欄的內容' : isRaw() ? '用在 RD 與貼文內容的【標題】' : '帶入時自動換行';
    $('cvEmpty').querySelector('strong').textContent = isRaw() ? '連點兩下選照片（可多張，原樣送出）' : '連點兩下選照片';
    renderStrip();
    if (!text) $('msgCount').classList.remove('bad');
    titleChanged();
    if (st.mode === 'color') requestAnimationFrame(showColor);
    if (st.mode === 'text') { bgLoadImgs(); if (bgRow) requestAnimationFrame(() => bgRow.sync()); }
    draw(); syncFx(); msgCount();
  }
  const setMode = segmented($('modeSeg'), 'mode', (v) => { if (titleEd) titleEd.end(); st.mode = v; showMode(); });
  // 「新聞｜娛樂」一組切換＋右邊獨立的「圖片」按鈕（同一組 data-frame，一次只亮一個）
  const setFrame = segmented($('frameRow'), 'frame', (v) => {
    const wasRaw = isRaw();
    if (titleEd) titleEd.end();
    st.frame = v;
    if (wasRaw !== isRaw()) showMode(); else draw();
    if (!isRaw() && st.photos.length > 1) say('pullHint', `套版只會用第 1 張（其他 ${st.photos.length - 1} 張先保留，切回「圖片」還在，送出時不會送）`);
  });
  // 沒有公司素材：只有「套版｜照片」
  $('frameSeg').querySelector('[data-frame=generic]').hidden = !!assets.company;
  for (const b of $('frameSeg').querySelectorAll('[data-frame=news],[data-frame=entertainment]')) b.hidden = !assets.company;
  setMode(st.mode);
  setFrame(st.frame);

  PRESET_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.style.background = c; b.dataset.color = c; b.title = c; b.setAttribute('aria-label', '底色 ' + c);
    $('swatches').append(b);
  });
  const setColor = segmented($('swatches'), 'color', (v) => { st.color = v; showColor(); draw(); });
  setColor(st.color);

  // ---- 底色：一列左右滑（觸控滑、滾輪），選到的捲到看得見 ----
  const colorRow = hscroll($('swatches'));
  function showColor() {
    $('colorCode').textContent = st.color;
    colorRow.reveal($('swatches').querySelector('.is-on'));
  }
  showColor();

  // ---- 標題：改了先畫，缺的字型段載好再重畫；旁邊顯示每行字數（超過只提醒） ----
  function titleChanged() {
    if (st.mode === 'text') {   // 純文字：沒有圖上的標題；每行字數（有背景時 N/11）在 msgCount
      msgCount();
      if ($('title').offsetParent) grow($('title'));
      return;
    }
    if (isRaw()) {   // 照片框：標題不畫在圖上，不算每行字數
      $('titleCount').textContent = ''; $('titleCount').classList.remove('bad'); $('titleLines').textContent = '';
      if ($('title').offsetParent) grow($('title'));
      return;
    }
    const c = titleCheck($('title').value);
    $('titleCount').textContent = c.text;
    $('titleCount').classList.toggle('bad', !c.ok);
    const box = $('titleLines'); box.textContent = '';   // 每行右側字數（和圖上的行一致）
    c.widths.forEach((w) => { const d = document.createElement('div'); d.textContent = `${w}/${LINE_MAX}`; d.classList.toggle('bad', w > LINE_MAX); box.append(d); });
    alignTitleLines();
    if ($('title').offsetParent) grow($('title'));
    draw(); loadTitleGlyphs($('title').value).then(draw);
  }
  $('title').addEventListener('input', titleChanged);
  // 使用者改標題（標題欄或預覽上直接改）→ 貼文內容的【標題】那一行跟著換；程式帶入時不經這裡
  $('title').addEventListener('input', () => {
    const m = $('msg'), next = syncTitleLine(m.value, $('title').value);
    if (next !== m.value) { m.value = next; msgCount(); }
  });
  // 右側字數和輸入框的行對齊：用輸入框實際的行高、上邊距，捲動也跟著走
  function alignTitleLines() {
    const ta = $('title'), box = $('titleLines'), cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    box.style.paddingTop = `${parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)}px`;
    box.style.height = `${ta.offsetHeight}px`;
    box.style.setProperty('--lh', `${lh}px`);
    box.scrollTop = ta.scrollTop;
  }
  $('title').addEventListener('scroll', () => { $('titleLines').scrollTop = $('title').scrollTop; });
  new ResizeObserver(alignTitleLines).observe($('title'));

  // ---- 照片：帶入的主圖，或在新增發文視窗裡按 Ctrl+V 貼上 ----
  // 照片清單改了：第 1 張給套版用（換了第 1 張才重設位置）
  function syncPhotos() {
    const first = st.photos[0] || null;
    if (!first || first.img !== st.photo) st.view = newView();
    st.photo = first ? first.img : null; st.photoBlob = first ? first.blob : null;
    st.cur = Math.min(Math.max(st.cur, 0), Math.max(st.photos.length - 1, 0));
    renderStrip(); draw(); syncFx();
  }
  // add＝加一張（照片框）；不然換掉第 1 張（套版）
  function loadPhoto(blob, add = isRaw()) {
    return new Promise((resolve) => {
      if (add && st.photos.length >= MAX_PHOTOS) { say('pullHint', `最多 ${MAX_PHOTOS} 張`, true); resolve(false); return; }
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => {
        URL.revokeObjectURL(url);
        const item = { img: im, blob };
        if (add) { st.photos.push(item); st.cur = st.photos.length - 1; } else st.photos[0] = item;
        syncPhotos(); resolve(true);
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      im.src = url;
    });
  }
  // 沒照片時：連點兩下選照片、拖曳照片進來（點一下只聚焦預覽框，方便 Ctrl+V）
  async function usePhoto(file, how) {
    if (!file || !/^image\//.test(file.type)) { say('pullHint', '請選擇圖片檔', true); return; }
    if (!usesPhoto()) { st.mode = 'image'; setMode('image'); showMode(); }
    if (await loadPhoto(file)) say('pullHint', how); else say('pullHint', '照片讀取失敗', true);
  }
  canvas.addEventListener('pointerdown', () => { if (!source()) $('cvWrap').focus({ preventScroll: true }); });
  // 沒照片時連點兩下＝選照片（搶在標題編輯器的「點兩下改標題」之前）；點在標題上第一下已進入改標題，就不開
  canvas.addEventListener('dblclick', (e) => { if (!source() && !titleEd.editing()) { e.stopImmediatePropagation(); $('photoFile').click(); } }, true);
  $('cvWrap').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !source() && e.target === $('cvWrap')) { e.preventDefault(); $('photoFile').click(); } });
  $('photoFile').addEventListener('change', async () => {
    const fs = [...$('photoFile').files]; $('photoFile').value = '';
    if (!fs.length) return;
    if (!isRaw()) { usePhoto(fs[0], '已選擇照片'); return; }   // 套版只用一張
    let n = 0;
    for (const f of fs) { if (st.photos.length >= MAX_PHOTOS) break; if (/^image\//.test(f.type) && await loadPhoto(f, true)) n++; }
    say('pullHint', `已加入 ${n} 張照片` + (n < fs.length ? `（最多 ${MAX_PHOTOS} 張，或有檔案不是圖片）` : ''), n < fs.length);
  });
  $('cvWrap').addEventListener('dragover', (e) => { if (st.mode === 'text') return; e.preventDefault(); $('cvWrap').classList.add('is-drop'); });
  $('cvWrap').addEventListener('dragleave', () => $('cvWrap').classList.remove('is-drop'));
  $('cvWrap').addEventListener('drop', (e) => {
    $('cvWrap').classList.remove('is-drop');
    if (st.mode === 'text') return;
    e.preventDefault();   // 不論是不是圖片都攔下，免得瀏覽器把頁面換成那個檔案
    const fs = [...(e.dataTransfer?.files || [])].filter((x) => /^image\//.test(x.type));
    if (!fs.length) { say('pullHint', '請拖曳圖片檔', true); return; }
    if (isRaw()) { (async () => { let n = 0; for (const f of fs) { if (st.photos.length >= MAX_PHOTOS) break; if (await loadPhoto(f, true)) n++; } say('pullHint', `已加入 ${n} 張照片`); })(); return; }
    usePhoto(fs[0], '已放入照片');
  });

  document.addEventListener('paste', async (e) => {
    if ($('postDlg').hidden) return;
    if ($('cfDlg').open) return;
    const cd = e.clipboardData;
    const file = [...((cd && cd.files) || [])].find((f) => /^image\//.test(f.type));
    if (!file) return;               // 不是圖片：照常貼文字
    // 從 Excel／Word 複製會同時帶文字和圖片：貼在文字欄位時照常貼文字
    const t = e.target;
    if (cd.getData('text/plain') && t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && !t.classList.contains('cv-title')) return;
    e.preventDefault();
    if (!usesPhoto()) { st.mode = 'image'; setMode('image'); showMode(); }   // 貼照片就是要套版（照片框＝加一張）
    if (await loadPhoto(file)) say('pullHint', '已貼上照片'); else say('pullHint', '照片讀取失敗', true);
  });

  // ---- 帶入：貼上或打完新聞網址就自動帶入；Enter 也可以重新帶入 ----
  let busy = false, pending = false, lastPulled = '', typingTimer = 0;
  async function firstImage(images) {
    for (const im of images.slice(0, MAX_IMAGES)) {
      if (!im || !im.url) continue;
      try {
        const res = await tb.api.call('/fetch/image?url=' + encodeURIComponent(im.url), { raw: true });
        const blob = await res.blob();
        if (blob && blob.size && (await loadPhoto(blob, false))) return true;   // 帶入：換掉第 1 張
      } catch { /* 換下一張 */ }
    }
    return false;
  }
  async function pull() {
    clearTimeout(typingTimer);
    const url = $('link').value.trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (busy) { pending = true; return; }          // 讀取中又換了網址：讀完再帶入一次
    busy = true; lastPulled = url;
    if (titleEd) titleEd.end();                    // 預覽上編輯中：先收起，免得舊內容蓋掉帶入的標題
    say('pullHint', '讀取中…');
    const skel = (on) => { $('cvSkel').hidden = !on; $('cvWrap').setAttribute('aria-busy', on ? 'true' : 'false'); };
    skel(true);
    try {
      let article;
      try {
        const d = await tb.api.call('/fetch/article?url=' + encodeURIComponent(url));
        article = parseArticle((d && d.html) || '', (d && d.url) || url);
      } catch (e) { say('pullHint', '帶入失敗：' + errText(e), true); return; }
      if (!article.title && !article.images.length) { say('pullHint', '帶入失敗：文章裡找不到標題或圖片', true); return; }
      skel(false);
      if (($('title').value.trim() || $('msg').value.trim() || st.photo) &&
          !(await confirmBox('要用文章內容覆蓋嗎？', '目前已有標題、貼文內容或照片，帶入會覆蓋它們（框也會依網址切換）。'))) {
        say('pullHint', '已取消帶入'); return;
      }
      const done = [];
      if (assets.company && st.frame !== 'photo') { st.frame = frameForUrl(url); setFrame(st.frame); done.push(st.frame === 'entertainment' ? '娛樂粉框' : '新聞藍框'); }
      if (article.title) { $('title').value = autoLines(article.title).join('\n'); titleChanged(); done.push('標題'); }
      $('msg').value = '\n' + formatCopy({ title: article.title, caption: usesPhoto() ? mainCaption(article) : '', tags: article.tags });
      if (st.mode !== 'text' && article.title) $('msg').value = syncTitleLine($('msg').value, $('title').value);   // 【標題】照預覽的分行補空格
      msgCount();
      done.push('貼文內容');
      let imgFail = false;
      skel(true);
      if (article.images.length) { if (await firstImage(article.images)) done.push('主圖'); else imgFail = true; } else imgFail = true;
      draw();
      say('pullHint', '已帶入：' + done.join('、') + (imgFail ? '（主圖讀取失敗，請在預覽按 Ctrl+V 貼上照片）' : ''));
    } finally {
      skel(false);
      busy = false;
      const now = $('link').value.trim();
      if (pending && now !== lastPulled) { pending = false; pull(); } else pending = false;
    }
  }
  $('link').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pull(); } });
  $('link').addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\//i.test($('link').value.trim())) pull(); }, 0));
  $('link').addEventListener('input', () => {
    clearTimeout(typingTimer);
    const url = $('link').value.trim();
    if (ARTICLE_RE.test(url) && url !== lastPulled) typingTimer = setTimeout(() => { if ($('link').value.trim() !== lastPulled) pull(); }, 700);
  });

  // 照片框送出用的檔案：JPG／PNG 且 ≤ 8MB 原樣送；其他格式或太大轉 JPG（長邊最多 4096）
  async function rawFile({ img: im, blob: b }, n) {
    const name = (ext) => `photo${n}.${ext}`;
    if (b && ['image/jpeg', 'image/png'].includes(b.type) && b.size <= RAW_MAX) return new File([b], name(b.type === 'image/png' ? 'png' : 'jpg'), { type: b.type });
    const k = Math.min(1, 4096 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    for (const q of [0.92, 0.85, 0.75]) {
      const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      if (out && out.size <= RAW_MAX) return new File([out], name('jpg'), { type: 'image/jpeg' });
    }
    throw new Error(`第 ${n} 張照片太大，請換一張小一點的照片`);
  }

  // ---- 照片框：縮圖列（點縮圖預覽、‹ › 調順序、× 移除、＋ 加照片） ----
  function renderStrip() {
    const box = $('photoStrip'), raw = isRaw();
    box.hidden = !raw;
    if (!raw) return;
    const list = $('psList'); list.textContent = '';
    st.photos.forEach((p, i) => {
      const li = document.createElement('li'); li.className = 'ps-item' + (i === st.cur ? ' is-on' : '');
      const t = document.createElement('button'); t.type = 'button'; t.className = 'ps-thumb'; t.setAttribute('aria-label', `預覽第 ${i + 1} 張`); t.setAttribute('aria-pressed', String(i === st.cur));
      // 縮圖用小畫布畫（照片的物件網址載完就回收了，不能再當 img src）
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const k = Math.max(128 / p.img.naturalWidth, 128 / p.img.naturalHeight), w = p.img.naturalWidth * k, h = p.img.naturalHeight * k;
      c.getContext('2d').drawImage(p.img, (128 - w) / 2, (128 - h) / 2, w, h); t.append(c);
      t.onclick = () => { st.cur = i; renderStrip(); draw(); };
      const mk = (txt, label, fn, dis) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ps-btn'; b.textContent = txt; b.setAttribute('aria-label', label); b.title = label; b.disabled = !!dis; b.onclick = fn; return b; };
      const move = (d) => { const j = i + d; [st.photos[i], st.photos[j]] = [st.photos[j], st.photos[i]]; st.cur = j; syncPhotos(); };
      const bar = document.createElement('div'); bar.className = 'ps-bar';
      bar.append(mk('‹', `第 ${i + 1} 張往前`, () => move(-1), i === 0), mk('×', `移除第 ${i + 1} 張`, () => { st.photos.splice(i, 1); if (st.cur >= i && st.cur > 0) st.cur--; syncPhotos(); }), mk('›', `第 ${i + 1} 張往後`, () => move(1), i === st.photos.length - 1));
      li.append(t, bar); list.append(li);
    });
    if (st.photos.length < MAX_PHOTOS) {
      const li = document.createElement('li'); li.className = 'ps-item';
      const add = document.createElement('button'); add.type = 'button'; add.className = 'ps-add'; add.textContent = '＋'; add.setAttribute('aria-label', '加照片'); add.title = '加照片（也可以 Ctrl+V 或拖曳）';
      add.onclick = () => $('photoFile').click();
      li.append(add); list.append(li);
    }
    $('psCount').textContent = st.photos.length ? `共 ${st.photos.length} 張（最多 ${MAX_PHOTOS} 張）` : `最多 ${MAX_PHOTOS} 張`;
  }
  // 照片清單整批換掉（幫直出、再發一次）；回成功張數
  async function setPhotos(blobs) {
    st.photos = []; st.cur = 0; syncPhotos();
    let n = 0;
    for (const b of blobs.slice(0, MAX_PHOTOS)) if (b instanceof Blob && await loadPhoto(b, true)) n++;
    st.cur = 0; syncPhotos();
    return n;
  }

  renderer.ready.then(draw);
  titleChanged();
  showMode();

  return {
    // 清空：網址、照片、標題、貼文內容、留言內容、貼圖馬賽克；模式與框保留
    reset() {
      if (titleEd) titleEd.end();
      $('link').value = ''; $('title').value = ''; $('msg').value = ''; $('lead').value = ''; msgCount();
      st.photos = []; st.cur = 0; st.photo = null; st.photoBlob = null; st.view = newView(); st.fx.length = 0; st.fx.gray = false; lastPulled = ''; st.bg = randomBg();
      say('pullHint', '');
      titleChanged(); showMode();
    },
    // 送出用的圖（陣列）：照片框＝全部照片原樣（JPG／PNG ≤ 8MB，否則轉 JPG）；套版／純文字圖＝輸出 1080 PNG 一張；純文字或沒有照片＝[]
    async images() {
      if (!ready()) return [];
      if (isRaw()) {
        const out = [];
        for (let i = 0; i < st.photos.length; i++) out.push(await rawFile(st.photos[i], i + 1));
        if (out.reduce((a, f) => a + f.size, 0) > RAW_TOTAL) throw new Error('照片合計超過 25MB，請減少張數或換小一點的照片');
        return out;
      }
      if (titleEd) titleEd.end();
      await Promise.all([renderer.ready, loadTitleGlyphs($('title').value)]);
      draw();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('產生圖片失敗');
      return [new File([blob], 'fbpost.png', { type: 'image/png' })];
    },
    raw: isRaw,   // 照片框（操作紀錄記「照片」）
    // 幫直出：清空後帶入已發佈貼文的文字、照片、連結（有照片→照片套圖的「照片」框；沒照片→純文字）；不帶文字背景
    async direct({ message = '', title = '', link = '', photos = [] }) {
      this.reset();
      st.bg = '';
      const has = photos.length > 0;
      st.mode = has ? 'image' : 'text'; setMode(st.mode);
      if (has) { st.frame = 'photo'; setFrame('photo'); }
      $('link').value = link; lastPulled = link;
      if (has) { $('title').value = title; $('msg').value = message; }
      else $('title').value = message;
      showMode();
      const n = has ? await setPhotos(photos) : 0;
      draw(); msgCount(); titleChanged();
      return n;
    },
    // 送出記錄用（再發一次）：文章網址、發出時的標題、模式、框、底色、原始照片（照片框存全部，套版只存第 1 張）
    snapshot: () => ({ link: $('link').value.trim(), title: $('title').value, mode: st.mode, frame: st.frame, color: st.color, bg: st.bg,
      photo: st.photo ? st.photoBlob || null : null, photos: isRaw() ? st.photos.map((p) => p.blob) : undefined }),
    // 再發一次：清空後帶回（不自動重新帶入文章、不帶貼文內容）
    async restore(rec) {
      this.reset();
      if (rec.mode === 'photo') rec = { ...rec, mode: 'image', frame: 'photo' };   // 舊記錄的「原圖」＝現在的照片框
      if (['image', 'color', 'text'].includes(rec.mode)) { st.mode = rec.mode; setMode(rec.mode); }
      if ((assets.company && (rec.frame === 'news' || rec.frame === 'entertainment')) || rec.frame === 'photo') { st.frame = rec.frame; setFrame(rec.frame); }
      if (typeof rec.color === 'string' && PRESET_COLORS.includes(rec.color)) { st.color = rec.color; setColor(rec.color); }
      $('link').value = rec.link || ''; lastPulled = $('link').value.trim();
      $('title').value = rec.title || '';
      if (typeof rec.bg === 'string' && (rec.bg === '' || bgs.some((b) => b.id === rec.bg))) st.bg = rec.bg;   // 文字背景用當時的（含「無」）
      showMode();
      const blobs = Array.isArray(rec.photos) && rec.photos.length ? rec.photos : rec.photo instanceof Blob ? [rec.photo] : [];
      const n = blobs.length ? await setPhotos(blobs) : 0;
      draw();
      say('pullHint', '已帶回上次送出的網址、標題' + (blobs.length ? (n === blobs.length ? '、照片' : '（照片讀取失敗）') : '') + '；貼文內容請重新填寫');
    },
    mode: () => st.mode,
    needsPhoto: () => usesPhoto() && !st.photo,   // 照片套圖沒有照片：不能送出
    text: postText,   // 送出用的貼文內容
    bg: bgOn   // 送出用的文字背景代號（只有純文字模式；沒選＝''）
  };
}
