// 做圖＋帶入：貼文章網址 → 標題、主圖、貼文內容、框自動帶入；作圖框／純文字底圖／自己的圖。
// 畫圖用共用核心 ui/compose（和「圖片套版」同一份，輸出一模一樣）；框的判斷用本工具的 rules.js。
import { $, errText, say, confirmBox, segmented } from './util.js';
import { frameForUrl } from './rules.js';
import { autoLines } from '../../sdk/news-rules.js';
import { parseArticle, formatCopy, mainCaption } from '../../sdk/news-article.js';
import {
  SIZE, PRESET_COLORS, newView, clampView, coverGeometry, MAX_ZOOM, canvaToPx,
  DEFAULT_CANVA_SIZE_IMAGE, DEFAULT_CANVA_SIZE_COLOR, createRenderer, loadTitleGlyphs
} from '../../ui/compose/render.js';
import { createFxKit } from '../../ui/compose/fx.js';

const MAX_IMAGES = 3;

export function createComposer({ tb, assets }) {
  const renderer = createRenderer(assets);
  const kit = createFxKit({ stickerUrls: assets.stickers });
  const canvas = $('cv');
  const ctx = canvas.getContext('2d');
  const st = {
    mode: 'image',                               // image＝作圖框｜color＝純文字底圖｜own＝自己的圖
    frame: assets.company ? 'news' : 'generic',  // 沒有公司素材時只有通用框
    photo: null, view: newView(),
    color: PRESET_COLORS.includes('#c80000') ? '#c80000' : PRESET_COLORS[0],
    own: null,                                   // 自己的圖（File）
    fx: [],                                      // 貼圖／馬賽克清單（作圖框與純文字底圖共用一份）
  };

  const source = () => (st.mode === 'color' ? { type: 'color', color: st.color } : st.photo ? { type: 'image', image: st.photo, view: st.view } : null);
  const ready = () => !!source();

  function draw() {
    const src = source();
    $('cvEmpty').hidden = !!src;
    if (!src) { ctx.clearRect(0, 0, SIZE, SIZE); return; }
    const size = canvaToPx(st.mode === 'color' ? DEFAULT_CANVA_SIZE_COLOR : DEFAULT_CANVA_SIZE_IMAGE);
    renderer.renderComposite(ctx, src, $('title').value, size, st.frame, kit.drawFx(st.fx));
  }

  // ---- 貼圖／馬賽克 ----
  const editor = kit.createEditor({
    // 改了內容：重畫，並讓預覽上的操作方框跟著更新位置與數量
    canvas, items: () => st.fx, ready, changed: () => { draw(); editor.sync(); }, redraw: draw,
    onLayout: (n, gray) => { $('fxCount').textContent = [n ? `已加 ${n} 個` : '', gray ? '抽色' : ''].filter(Boolean).join('・'); }
  });
  const fxRow = kit.buildRow(editor);
  $('fxSlot').append(fxRow.row);
  $('fxHint').textContent = kit.hintText;
  const syncFx = () => { fxRow.tiles.forEach((b) => { b.disabled = !ready(); }); $('fxBar').classList.toggle('off', !ready()); editor.sync(); };

  // ---- 照片拖曳移動、滾輪縮放 ----
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (st.mode !== 'image' || !st.photo || e.button !== 0) return;
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
    if (st.mode !== 'image' || !st.photo) return;
    e.preventDefault();
    const before = coverGeometry(st.photo, st.view).s;
    st.view.zoom = Math.min(MAX_ZOOM, Math.max(1, st.view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const f = coverGeometry(st.photo, st.view).s / before;
    st.view.x *= f; st.view.y *= f;
    clampView(st.photo, st.view); draw();
  }, { passive: false });

  // ---- 模式、框、底色 ----
  function showMode() {
    $('imageOpts').hidden = st.mode !== 'image';
    $('colorOpts').hidden = st.mode !== 'color';
    $('ownOpts').hidden = st.mode !== 'own';
    $('cvWrap').hidden = st.mode === 'own';
    $('fxBar').hidden = st.mode === 'own';
    $('titleBox').hidden = st.mode === 'own';
    $('imgPrev').hidden = st.mode !== 'own' || !st.own;
    draw(); syncFx();
  }
  const setMode = segmented($('modeSeg'), 'mode', (v) => { st.mode = v; showMode(); });
  const setFrame = segmented($('frameSeg'), 'frame', (v) => { st.frame = v; draw(); });
  $('frameSeg').hidden = !assets.company;
  setMode(st.mode);
  if (assets.company) setFrame(st.frame);

  PRESET_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.style.background = c; b.dataset.color = c; b.title = c; b.setAttribute('aria-label', '底色 ' + c);
    $('swatches').append(b);
  });
  const setColor = segmented($('swatches'), 'color', (v) => { st.color = v; draw(); });
  setColor(st.color);

  // 標題改了先畫，缺的字型段載好再重畫一次
  const titleChanged = () => { draw(); loadTitleGlyphs($('title').value).then(draw); };
  $('title').addEventListener('input', titleChanged);

  // ---- 照片／自己的圖 ----
  function loadPhoto(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); st.photo = im; st.view = newView(); draw(); syncFx(); resolve(true); };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      im.src = url;
    });
  }
  $('photo').addEventListener('change', async () => {
    const f = $('photo').files[0]; if (!f) return;
    if (!(await loadPhoto(f))) say('pullHint', '照片讀取失敗', true);
  });
  $('img').addEventListener('change', () => {
    const f = $('img').files[0], pv = $('imgPrev');
    if (pv.dataset.url) { URL.revokeObjectURL(pv.dataset.url); pv.dataset.url = ''; }
    st.own = f || null;
    if (f) { const u = URL.createObjectURL(f); pv.dataset.url = u; pv.src = u; st.mode = 'own'; setMode('own'); }
    showMode();
  });

  // ---- 帶入 ----
  let busy = false;
  async function firstImage(images) {
    for (const im of images.slice(0, MAX_IMAGES)) {
      if (!im || !im.url) continue;
      try {
        const res = await tb.api.call('/fetch/image?url=' + encodeURIComponent(im.url), { raw: true });
        const blob = await res.blob();
        if (blob && blob.size && (await loadPhoto(blob))) return true;
      } catch { /* 換下一張 */ }
    }
    return false;
  }
  async function pull() {
    if (busy) return;
    const url = $('link').value.trim();
    if (!/^https?:\/\//i.test(url)) { say('pullHint', '請貼文章網址（https:// 開頭）', true); return; }
    busy = true; $('pullBtn').disabled = true;
    say('pullHint', '讀取中…');
    try {
      let article;
      try {
        const d = await tb.api.call('/fetch/article?url=' + encodeURIComponent(url));
        article = parseArticle((d && d.html) || '', (d && d.url) || url);
      } catch (e) { say('pullHint', '帶入失敗：' + errText(e), true); return; }
      if (!article.title && !article.images.length) { say('pullHint', '帶入失敗：文章裡找不到標題或圖片', true); return; }
      if (($('title').value.trim() || $('msg').value.trim() || st.photo) &&
          !(await confirmBox('要用文章內容覆蓋嗎？', '目前已有標題、貼文內容或照片，帶入會覆蓋它們（框也會依網址切換）。'))) {
        say('pullHint', '已取消帶入'); return;
      }
      const done = [];
      if (st.mode === 'own') { st.mode = 'image'; setMode('image'); showMode(); }   // 帶入的是要套版的照片，切回作圖框
      if (assets.company) { st.frame = frameForUrl(url); setFrame(st.frame); done.push(st.frame === 'entertainment' ? '娛樂粉框' : '新聞藍框'); }
      if (article.title) { $('title').value = autoLines(article.title).join('\n'); titleChanged(); done.push('標題'); }
      $('msg').value = formatCopy({ title: article.title, caption: st.mode === 'color' ? '' : mainCaption(article), tags: article.tags });
      done.push('貼文內容');
      let imgFail = false;
      if (article.images.length) { if (await firstImage(article.images)) done.push('主圖'); else imgFail = true; } else imgFail = true;
      draw();
      say('pullHint', '已帶入：' + done.join('、') + (imgFail ? '（主圖讀取失敗，請手動選照片）' : ''));
    } finally {
      busy = false; $('pullBtn').disabled = false;
    }
  }
  $('pullBtn').addEventListener('click', pull);
  $('link').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pull(); } });
  $('link').addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\//i.test($('link').value.trim())) pull(); }, 0));

  renderer.ready.then(draw);
  showMode();

  return {
    // 清空：網址、照片、自己的圖、標題、貼文內容、貼圖馬賽克；留言文字回預設；模式與框保留
    reset() {
      $('link').value = ''; $('title').value = ''; $('msg').value = ''; $('lead').value = '看更多新聞內容';
      $('photo').value = ''; $('img').value = '';
      st.photo = null; st.view = newView(); st.own = null; st.fx.length = 0; st.fx.gray = false;
      const pv = $('imgPrev'); if (pv.dataset.url) { URL.revokeObjectURL(pv.dataset.url); pv.dataset.url = ''; }
      if (st.mode === 'own') { st.mode = 'image'; setMode('image'); }
      say('pullHint', '');
      showMode();
    },
    // 送出用的圖：自己的圖原檔；作圖框／純文字底圖輸出 1080 PNG；沒有圖回 null
    async image() {
      if (st.mode === 'own') return st.own;
      if (!ready()) return null;
      await Promise.all([renderer.ready, loadTitleGlyphs($('title').value)]);
      draw();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('產生圖片失敗');
      return new File([blob], 'fbpost.png', { type: 'image/png' });
    }
  };
}
