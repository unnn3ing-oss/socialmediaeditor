// 做圖＋帶入：貼上文章網址就自動帶入標題、主圖、貼文內容、框；[選套版｜純文字圖｜純文字]。
// 畫圖用共用核心 ui/compose（和「圖片套版」同一份畫法）；字級本工具固定：選套版 66px、純文字圖 76px。框的判斷用 rules.js。
import { $, errText, say, confirmBox, segmented, stripLead } from './util.js';
import { frameForUrl } from './rules.js';
import { titleCheck, LINE_MAX, syncTitleLine } from './title.js';
import { createTitleEditor } from './titleedit.js';
import { autoLines } from '../../sdk/news-rules.js';
import { parseArticle, formatCopy, mainCaption } from '../../sdk/news-article.js';
import {
  SIZE, PRESET_COLORS, newView, clampView, coverGeometry, MAX_ZOOM, usesDarkTitle, createRenderer, loadTitleGlyphs
} from '../../ui/compose/render.js';
import { createFxKit } from '../../ui/compose/fx.js';

const MAX_IMAGES = 3;
export const TITLE_PX = { image: 66, color: 76 };      // 使用者指定字級（只用在排程發布）
const ARTICLE_RE = /^https?:\/\/\S+\/\d{6,9}\/?(?:[?#]\S*)?$/i;   // 打完一個新聞網址（結尾是文章編號）就自動帶入

export function createComposer({ tb, assets }) {
  const renderer = createRenderer(assets);
  const kit = createFxKit({ stickerUrls: assets.stickers });
  const canvas = $('cv');
  const ctx = canvas.getContext('2d');
  const st = {
    mode: 'image',                               // image＝選套版｜color＝純文字圖｜text＝純文字（不附圖）
    frame: assets.company ? 'news' : 'generic',  // 沒有公司素材時只有通用框
    photo: null, view: newView(),
    color: PRESET_COLORS.includes('#c80000') ? '#c80000' : PRESET_COLORS[0],
    fx: [],                                      // 貼圖／馬賽克清單（選套版與純文字圖共用一份）
  };

  const source = () => (st.mode === 'color' ? { type: 'color', color: st.color }
    : st.mode === 'image' && st.photo ? { type: 'image', image: st.photo, view: st.view } : null);
  // 有公司素材但公司標題字型沒載入：標題會改用 Noto Sans TC，提示原因
  if (assets.company && !assets.fontLoaded) {
    $('fontWarn').textContent = `公司標題字型沒載入，標題暫用 Noto Sans TC：${assets.fontError || '原因不明'}`;
    $('fontWarn').hidden = false;
  }
  const ready = () => !!source();
  const px = () => (st.mode === 'color' ? TITLE_PX.color : TITLE_PX.image);
  let titleEd = null;

  function draw() {
    const src = source();
    $('cvEmpty').hidden = !!src;
    if (!src) { ctx.clearRect(0, 0, SIZE, SIZE); return; }
    const title = titleEd && titleEd.editing() ? '' : $('title').value;   // 預覽上編輯中：標題由輸入框顯示
    renderer.renderComposite(ctx, src, title, px(), st.frame, kit.drawFx(st.fx), undefined, { titleAnchor: 'bottom' });
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
  // 「T寶／馬賽克」按鈕：點了才展開貼圖列（隱藏切換）
  $('fxBtn').addEventListener('click', () => { const open = $('fxBar').hidden; $('fxBar').hidden = !open; $('fxBtn').setAttribute('aria-expanded', String(open)); if (open) editor.sync(); });
  // 字數只算實際送出的內容（開頭留給小編文的空行沒填，送出時會拿掉）
  const msgCount = () => { $('msgCount').textContent = `${[...stripLead($('msg').value)].length} 字`; };
  $('msg').addEventListener('input', msgCount); msgCount();
  const syncFx = () => { fxRow.tiles.forEach((b) => { b.disabled = !ready(); }); $('fxBar').classList.toggle('off', !ready()); editor.sync(); };

  titleEd = createTitleEditor({ canvas, input: $('title'), renderer, mode: () => st.mode, px, ready, redraw: draw, light: () => usesDarkTitle({ type: 'color', color: st.color }) });

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
    $('imgArea').hidden = st.mode === 'text';
    $('noImg').hidden = st.mode !== 'text';
    $('frameSeg').hidden = st.mode !== 'image' || !assets.company;
    $('swatchBox').hidden = st.mode !== 'color';
    if (st.mode === 'color') requestAnimationFrame(showColor);
    $('cvEmpty').textContent = '貼上文章網址自動帶入，或在這裡按 Ctrl+V 貼上照片';
    draw(); syncFx();
  }
  const setMode = segmented($('modeSeg'), 'mode', (v) => { if (titleEd) titleEd.end(); st.mode = v; showMode(); });
  const setFrame = segmented($('frameSeg'), 'frame', (v) => { st.frame = v; draw(); });
  setMode(st.mode);
  if (assets.company) setFrame(st.frame);

  PRESET_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw'; b.style.background = c; b.dataset.color = c; b.title = c; b.setAttribute('aria-label', '底色 ' + c);
    $('swatches').append(b);
  });
  const setColor = segmented($('swatches'), 'color', (v) => { st.color = v; showColor(); draw(); });
  setColor(st.color);

  // ---- 底色展示窗：一排左右滑（觸控滑、滾輪、兩側鈕），選到的捲到看得見 ----
  const track = $('swatches');
  const syncNav = () => {
    // 逐格對齊會停在第一格的起點（留白 2px），所以容許幾 px
    $('swPrev').disabled = track.scrollLeft <= 4;
    $('swNext').disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  };
  function showColor() {
    $('colorCode').textContent = st.color;
    const on = track.querySelector('.is-on');
    if (on && track.clientWidth) {
      const l = on.offsetLeft - track.offsetLeft, r = l + on.offsetWidth;
      // 看不到就捲到它在最左（和逐格對齊一致，不會被對齊推回去）
      if (l < track.scrollLeft || r > track.scrollLeft + track.clientWidth) track.scrollTo({ left: l, behavior: 'instant' });
    }
    syncNav();
  }
  const page = (dir) => track.scrollBy({ left: dir * Math.max(60, track.clientWidth * 0.8), behavior: 'smooth' });
  $('swPrev').addEventListener('click', () => page(-1));
  $('swNext').addEventListener('click', () => page(1));
  track.addEventListener('scroll', syncNav, { passive: true });
  track.addEventListener('wheel', (e) => {   // 滑鼠滾輪上下 → 左右捲
    if (track.scrollWidth <= track.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault(); track.scrollLeft += e.deltaY;
  }, { passive: false });
  new ResizeObserver(syncNav).observe(track);
  showColor();

  // ---- 標題：改了先畫，缺的字型段載好再重畫；旁邊顯示每行字數（超過只提醒） ----
  function titleChanged() {
    const c = titleCheck($('title').value);
    $('titleCount').textContent = c.text;
    $('titleCount').classList.toggle('bad', !c.ok);
    const box = $('titleLines'); box.textContent = '';   // 每行右側字數（和圖上的行一致）
    c.widths.forEach((w) => { const d = document.createElement('div'); d.textContent = `${w}/${LINE_MAX}`; d.classList.toggle('bad', w > LINE_MAX); box.append(d); });
    alignTitleLines();
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
  function loadPhoto(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); st.photo = im; st.view = newView(); draw(); syncFx(); resolve(true); };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      im.src = url;
    });
  }
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
    if (st.mode !== 'image') { st.mode = 'image'; setMode('image'); showMode(); }   // 貼照片就是要套版
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
        if (blob && blob.size && (await loadPhoto(blob))) return true;
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
      if (assets.company) { st.frame = frameForUrl(url); setFrame(st.frame); done.push(st.frame === 'entertainment' ? '娛樂粉框' : '新聞藍框'); }
      if (article.title) { $('title').value = autoLines(article.title).join('\n'); titleChanged(); done.push('標題'); }
      $('msg').value = '\n' + formatCopy({ title: article.title, caption: st.mode === 'image' ? mainCaption(article) : '', tags: article.tags }); msgCount();
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

  renderer.ready.then(draw);
  titleChanged();
  showMode();

  return {
    // 清空：網址、照片、標題、貼文內容、留言內容、貼圖馬賽克；模式與框保留
    reset() {
      if (titleEd) titleEd.end();
      $('link').value = ''; $('title').value = ''; $('msg').value = ''; $('lead').value = ''; msgCount();
      st.photo = null; st.view = newView(); st.fx.length = 0; st.fx.gray = false; lastPulled = '';
      say('pullHint', '');
      titleChanged(); showMode();
    },
    // 送出用的圖：選套版／純文字圖輸出 1080 PNG；純文字或還沒有照片回 null
    async image() {
      if (!ready()) return null;
      if (titleEd) titleEd.end();
      await Promise.all([renderer.ready, loadTitleGlyphs($('title').value)]);
      draw();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('產生圖片失敗');
      return new File([blob], 'fbpost.png', { type: 'image/png' });
    },
    mode: () => st.mode
  };
}
