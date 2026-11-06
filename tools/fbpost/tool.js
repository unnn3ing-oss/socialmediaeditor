// 排程發布（公司專屬）：多粉專發文／排程、已排程（取消）、成效。
// 新增發文是彈窗（介面參照網新排程），**關閉彈窗不清內容**，只有「清空」會清（工具箱內容保留規則）。
// 後端：/fb/pages、/fb/post（multipart）、/fb/scheduled、/fb/cancel、/fb/posts、/fb/insights、/fetch、/fetch/image。
import { tb } from '../../sdk/toolbox.js';
import { createPhotoEditor } from './editor.js';
import { TEXT_SWATCHES, drawTextCard, swatchCss } from './textcard.js';

tb.init('fbpost');

const $ = (id) => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(n.dataset, dataset);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const MIN_AHEAD = 10 * 60, MAX_AHEAD = 30 * 86400;
const TITLE_MAX = 15, TITLE_LINES = 3, NATIVE_MAX = 130;
const FRAME_NAMES = { news: '新聞（藍框）', ent: '娛樂（粉框）', generic: '通用框', none: '無框' };
const errText = (e) => (e && e.message) || '發生錯誤';
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (sec) => { const d = new Date(sec * 1000); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtIso = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? '' : fmtTime(Math.floor(t / 1000)); };

// ---------- 確認框 ----------
function confirmBox(title, body, yes = '確定') {
  const dlg = $('confirmDlg');
  $('cfTitle').textContent = title;
  $('cfBody').textContent = body;
  $('cfYes').textContent = yes;
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); $('cfYes').onclick = $('cfNo').onclick = null; dlg.oncancel = null; resolve(v); };
    $('cfYes').onclick = () => done(true);
    $('cfNo').onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

// ---------- 分頁（隱藏切換，不重建） ----------
function segment(root, attr, onPick) {
  const btns = [...root.querySelectorAll('button')];
  const set = (v) => {
    for (const b of btns) { const on = b.dataset[attr] === v; b.classList.toggle('is-on', on); if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', String(on)); else b.setAttribute('aria-pressed', String(on)); }
    onPick(v);
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && root.contains(b) && b.dataset[attr]) set(b.dataset[attr]); });
  return { set, get: () => (btns.find((b) => b.classList.contains('is-on')) || btns[0]).dataset[attr] };
}

segment($('tabs'), 'tab', (t) => {
  $('tab-sched').hidden = t !== 'sched';
  $('tab-stats').hidden = t !== 'stats';
  if (t === 'stats' && !statsLoaded) loadStats(true);
});

// ---------- 粉專 ----------
let pages = [];
async function loadPages(refresh = false) {
  const st = $('pagesState');
  st.className = 'pill';
  st.textContent = '讀取粉專中…';
  try {
    pages = await tb.api.call('/fb/pages' + (refresh ? '?refresh=1' : ''));
    st.className = 'pill ' + (pages.length ? 'pill-ok' : 'pill-warn');
    st.textContent = pages.length ? `已連線 ${pages.length} 個粉專` : '沒有可用的粉專';
  } catch (e) {
    pages = [];
    st.className = 'pill pill-warn';
    st.textContent = e.code === 'unauthorized' ? '請先輸入公司密碼' : e.code === 'fb_not_configured' ? '後端還沒設定臉書 token' : '粉專讀取失敗：' + errText(e);
  }
  renderPageChecks();
  for (const sel of [$('schedPage'), $('statsPage')]) {
    const keep = sel.value;
    sel.replaceChildren(...(sel.id === 'schedPage' ? [el('option', { value: '', textContent: '全部粉專' })] : []),
      ...pages.map((p) => el('option', { value: p.id, textContent: p.name })));
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
  loadSched();
  statsLoaded = false;
  if (!$('tab-stats').hidden) loadStats(true);
}
$('pagesRefresh').addEventListener('click', () => loadPages(true));
const pageName = (id) => (pages.find((p) => p.id === id) || {}).name || id;

// ---------- 已排程 ----------
async function loadSched() {
  const list = $('schedList'), hint = $('schedHint');
  const ids = $('schedPage').value ? [$('schedPage').value] : pages.map((p) => p.id);
  list.replaceChildren();
  if (!ids.length) { hint.textContent = '沒有粉專'; return; }
  hint.textContent = '讀取中…';
  const items = [], errs = [];
  await Promise.all(ids.map(async (id) => {
    try { for (const it of (await tb.api.call('/fb/scheduled?page=' + id)).items) items.push({ ...it, page: id }); }
    catch (e) { errs.push(`${pageName(id)}：${errText(e)}`); }
  }));
  items.sort((a, b) => (a.at || 0) - (b.at || 0));
  hint.textContent = (items.length ? `共 ${items.length} 篇` : '目前沒有排程') + (errs.length ? `；${errs.join('；')}` : '');
  list.replaceChildren(...items.map((it) => {
    const btn = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: '取消排程' });
    btn.addEventListener('click', async () => {
      if (!(await confirmBox('取消這篇排程？', `${pageName(it.page)}｜${it.at ? fmtTime(it.at) : ''}\n取消後臉書上這篇排程會被刪除，無法復原。`, '取消排程'))) return;
      btn.disabled = true;
      try { await tb.api.call('/fb/cancel', { method: 'POST', body: { post: it.id } }); li.remove(); hint.textContent = '已取消一篇排程'; }
      catch (e) { btn.disabled = false; hint.textContent = '取消失敗：' + errText(e); }
    });
    const li = el('li', { className: 'item' },
      it.picture ? el('img', { className: 'thumb', src: it.picture, alt: '', loading: 'lazy' }) : el('div', { className: 'thumb ph' }),
      el('div', { className: 'body' },
        el('div', { className: 'meta' }, el('b', { textContent: it.at ? fmtTime(it.at) : '—' }), el('span', { className: 'muted', textContent: pageName(it.page) })),
        el('p', { className: 'msg', textContent: it.message || '（沒有文字）' })),
      el('div', { className: 'act' }, btn));
    return li;
  }));
}
$('schedPage').addEventListener('change', loadSched);
$('schedReload').addEventListener('click', loadSched);

// ---------- 成效 ----------
let statsLoaded = false, statsNext = null;
const METRIC_NAMES = { post_media_view: '瀏覽', post_total_media_view_unique: '觸及人數', post_clicks: '點擊' };
async function loadStats(reset) {
  const page = $('statsPage').value;
  const list = $('statsList'), hint = $('statsHint');
  if (reset) { list.replaceChildren(); statsNext = null; }
  if (!page) { hint.textContent = '沒有粉專'; return; }
  statsLoaded = true;
  hint.textContent = '讀取中…';
  try {
    const r = await tb.api.call(`/fb/posts?page=${page}&limit=10` + (statsNext ? '&after=' + encodeURIComponent(statsNext) : ''));
    statsNext = r.next;
    $('statsMore').hidden = !statsNext;
    hint.textContent = '';
    list.append(...r.items.map(statRow));
    if (!list.children.length) hint.textContent = '沒有貼文';
  } catch (e) { hint.textContent = '讀取失敗：' + errText(e); }
}
function statRow(p) {
  const out = el('div', { className: 'ins', hidden: true });
  const btn = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: '看成效' });
  btn.addEventListener('click', async () => {
    if (!out.hidden) { out.hidden = true; return; }
    out.hidden = false;
    if (out.dataset.done) return;
    out.textContent = '讀取中…';
    try {
      const r = await tb.api.call('/fb/insights?post=' + encodeURIComponent(p.id));
      const m = r.metrics || {};
      const parts = Object.entries(METRIC_NAMES).filter(([k]) => m[k] != null).map(([k, n]) => `${n} ${Number(m[k]).toLocaleString()}`);
      const rx = m.post_reactions_by_type_total;
      if (rx && typeof rx === 'object') parts.push('心情 ' + Object.values(rx).reduce((a, b) => a + Number(b || 0), 0).toLocaleString());
      out.textContent = parts.length ? parts.join('｜') : '臉書沒有回傳成效（可能太新或權限不足）';
      out.dataset.done = '1';
    } catch (e) { out.textContent = '讀取失敗：' + errText(e); }
  });
  return el('li', { className: 'item' },
    p.picture ? el('img', { className: 'thumb', src: p.picture, alt: '', loading: 'lazy' }) : el('div', { className: 'thumb ph' }),
    el('div', { className: 'body' },
      el('div', { className: 'meta' }, el('b', { textContent: fmtIso(p.created) }),
        el('span', { className: 'muted', textContent: `讚 ${p.reactions}｜留言 ${p.comments}｜分享 ${p.shares}` })),
      el('p', { className: 'msg', textContent: p.message || '（沒有文字）' }), out),
    el('div', { className: 'act' }, btn,
      p.url && /^https:\/\//.test(p.url) ? el('a', { className: 'btn btn-secondary btn-sm', href: p.url, target: '_blank', rel: 'noopener', textContent: '開啟' }) : null));
}
$('statsPage').addEventListener('change', () => loadStats(true));
$('statsReload').addEventListener('click', () => loadStats(true));
$('statsMore').addEventListener('click', () => loadStats(false));

// ---------- 素材（同圖片套版）----------
const STICKER_IDS = ['smile', 'shock', 'cry', 'angry', 'kiss', 'laugh', 'meh'];
async function urlOf(key) { try { return (await tb.assets.get(key))?.url || null; } catch { return null; } }
async function loadAssets() {
  const [ribbonEnt, ribbonNews, logo, fontUrl, ...st] = await Promise.all([
    urlOf('frame.ent.ribbon'), urlOf('frame.news.ribbon'), urlOf('frame.logo'), urlOf('font.title'),
    ...STICKER_IDS.map((id) => urlOf('sticker.' + id))]);
  let fontLoaded = false;
  if (fontUrl) { try { const f = new FontFace('WHZ-Heavy', `url(${fontUrl})`); await f.load(); document.fonts.add(f); fontLoaded = true; } catch { /* 用系統字 */ } }
  const stickers = {};
  STICKER_IDS.forEach((id, i) => { if (st[i]) stickers[id] = st[i]; });
  return { company: Boolean(ribbonEnt || ribbonNews), ribbonEnt, ribbonNews, logo, fontLoaded, stickers };
}

// ---------- 新增發文彈窗 ----------
const modal = $('modal');
$('newPost').addEventListener('click', () => { modal.showModal(); });
$('mClose').addEventListener('click', () => modal.close());   // 只關閉，內容保留

let editor = null, frameCtl = null;
const editorReady = loadAssets().then((assets) => {
  editor = createPhotoEditor({ canvas: $('editorCanvas'), wrap: $('canvasWrap'), fxBar: $('fxBar'), assets });
  const frameSeg = $('frameSeg');
  frameSeg.replaceChildren(...editor.frames().map((k) => el('button', { type: 'button', textContent: FRAME_NAMES[k] || k, dataset: { frame: k } })));
  frameCtl = segment(frameSeg, 'frame', (k) => editor.setFrame(k));
  frameCtl.set(editor.getFrame());
  editor.onChange(() => { $('clearImg').hidden = !editor.hasImage(); });
  editor.setTitle($('title').value);
}).catch(() => { tb.log.error('fbpost-editor-failed'); });

let mode = 'frame', textStyle = 'card', when = 'now';
const modeSeg = segment($('modeSeg'), 'mode', (m) => {
  mode = m;
  $('framePane').hidden = m !== 'frame';
  $('textPane').hidden = m !== 'text';
  $('titleBlock').hidden = m !== 'frame';
  updateCount();
});
const textSeg = segment($('textSeg'), 'text', (t) => {
  textStyle = t;
  $('cardPane').hidden = t !== 'card';
  $('nativePane').hidden = t !== 'native';
  $('plainPane').hidden = t !== 'plain';
  updateCount();
});

// 照片：選檔按鈕、拖曳、貼上（點畫布本身是拿來拖曳照片，不開選檔）
async function takeImage(file) {
  await editorReady;
  if (!editor) return;
  try { await editor.loadFile(file); } catch (e) { $('urlHint').textContent = errText(e); }
}
$('pickImg').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', () => { const f = $('fileInput').files[0]; $('fileInput').value = ''; if (f) takeImage(f); });
$('canvasWrap').addEventListener('dragover', (e) => e.preventDefault());
$('canvasWrap').addEventListener('drop', (e) => { e.preventDefault(); const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (f) takeImage(f); });
document.addEventListener('paste', (e) => {
  if (!modal.open || mode !== 'frame') return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) { e.preventDefault(); takeImage(f); }
});
$('clearImg').addEventListener('click', () => editor && editor.clearImage());

// 標題：每行字數
function titleLines() { return $('title').value.replace(/\s+$/, '').split('\n'); }   // 尾端多的換行不算一行
function renderTitleCounts() {
  const lines = titleLines();
  $('titleCnts').replaceChildren(...lines.map((l, i) => el('span', { className: [...l].length > TITLE_MAX || i >= TITLE_LINES ? 'bad' : '', textContent: `${[...l].length}/${TITLE_MAX}` })));
}
$('title').addEventListener('input', () => { renderTitleCounts(); if (editor) editor.setTitle($('title').value); });
renderTitleCounts();

// 純文字底圖
let swatch = TEXT_SWATCHES[0];
function renderCard() { drawTextCard($('textCanvas'), { text: $('cardText').value, swatch, hint: true }); }
$('swatches').replaceChildren(...TEXT_SWATCHES.map((s, i) => {
  const b = el('button', { type: 'button', className: 'sw' + (i === 0 ? ' is-on' : ''), title: s.name, ariaLabel: s.name });
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(i === 0));
  b.style.background = swatchCss(s);
  b.addEventListener('click', () => {
    swatch = s;
    for (const x of $('swatches').children) { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', String(x === b)); }
    renderCard();
  });
  return b;
}));
$('cardText').addEventListener('input', renderCard);
document.fonts.load('700 72px "Noto Sans TC"', '字').catch(() => {}).then(renderCard);

// 小編文字數（原生背景提醒 130 字）
function updateCount() {
  const n = [...$('caption').value].length;
  const native = mode === 'text' && textStyle === 'native';
  $('capCount').textContent = native ? `${n}/${NATIVE_MAX}` : (n ? `${n} 字` : '');
  $('capCount').classList.toggle('bad', native && n > NATIVE_MAX);
}
$('caption').addEventListener('input', updateCount);

// 文章網址帶入：標題（空的才填）、主圖（作圖框沒照片才放）、網址（小編文沒有才加）
$('fillBtn').addEventListener('click', async () => {
  const url = $('url').value.trim(), hint = $('urlHint');
  if (!/^https:\/\//.test(url)) { hint.textContent = '請貼 https 開頭的文章網址'; return; }
  hint.textContent = '讀取中…';
  try {
    const d = await tb.api.call('/fetch?url=' + encodeURIComponent(url));
    const done = [];
    if (d.title && !$('title').value.trim()) { $('title').value = d.title; $('title').dispatchEvent(new Event('input')); done.push('標題'); }
    if (d.title && !$('cardText').value.trim()) { $('cardText').value = d.title; renderCard(); }
    if (!$('caption').value.includes(url)) {
      const head = d.title && !$('caption').value.trim() ? `【${d.title}】\n` : '';
      $('caption').value = ($('caption').value.trim() ? $('caption').value.replace(/\s+$/, '') + '\n\n' : head) + url;
      updateCount();
      done.push('網址');
    }
    if (d.image) {
      await editorReady;
      if (editor && !editor.hasImage()) {
        try {
          const res = await tb.api.call('/fetch/image?url=' + encodeURIComponent(d.image), { raw: true });
          await editor.loadFile(await res.blob());
          done.push('主圖');
        } catch { hint.textContent = '主圖讀取失敗，請手動放照片'; }
      }
    }
    if (!hint.textContent.startsWith('主圖')) hint.textContent = done.length ? '已帶入：' + done.join('、') : '沒有可帶入的內容（已填的欄位不會覆蓋）';
  } catch (e) { hint.textContent = '帶入失敗：' + errText(e); }
});

// 發布時間
function defaultTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 10) * 10, 0, 0);
  setTime(d);
}
function setTime(d) {
  $('tpDate').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  $('tpTime').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  checkTime();
}
function readTime() {
  const m = /^(\d{1,2}):?(\d{2})$/.exec($('tpTime').value.trim());
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec($('tpDate').value);
  if (!m || !dm || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(m[1]), Number(m[2]));
}
function checkTime() {
  const d = readTime(), hint = $('tpHint');
  if (!d) { hint.textContent = '時間格式：4 碼，例如 2130'; return null; }
  const ahead = (d.getTime() - Date.now()) / 1000;
  if (ahead < MIN_AHEAD) { hint.textContent = '排程要在 10 分鐘以後'; return null; }
  if (ahead > MAX_AHEAD) { hint.textContent = '排程最多 30 天內'; return null; }
  hint.textContent = '將於 ' + fmtTime(Math.floor(d.getTime() / 1000)) + ' 發布';
  return Math.floor(d.getTime() / 1000);
}
$('tpTime').addEventListener('input', () => {
  const v = $('tpTime').value.replace(/\D/g, '');
  if (v.length === 4) $('tpTime').value = v.slice(0, 2) + ':' + v.slice(2);
  checkTime();
});
$('tpDate').addEventListener('change', checkTime);
$('timeRow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  const base = readTime() || new Date();
  setTime(new Date(base.getTime() + Number(b.dataset.add) * 60000));
});
const whenSeg = segment($('whenSeg'), 'when', (w) => {
  when = w;
  $('timeRow').hidden = w !== 'sched';
  if (w === 'sched' && !readTime()) defaultTime();
  $('sendBtn').textContent = w === 'sched' ? '全部排程' : '全部送出';
});

// 粉專勾選
const picked = new Set();
function renderPageChecks() {
  for (const id of [...picked]) if (!pages.some((p) => p.id === id)) picked.delete(id);
  $('pages').replaceChildren(...(pages.length ? pages.map((p) => {
    const cb = el('input', { type: 'checkbox', checked: picked.has(p.id) });
    cb.addEventListener('change', () => { if (cb.checked) picked.add(p.id); else picked.delete(p.id); });
    return el('label', { className: 'pg' }, cb, el('span', { textContent: p.name }));
  }) : [el('span', { className: 'hint', textContent: '沒有可發的粉專' })]));
}

// 送出：先組好「要送的內容」（同一張圖給每個粉專），再逐一送
async function buildPayload() {
  const caption = $('caption').value;
  const p = { message: caption, image: null, textPreset: '', at: null };
  if (when === 'sched') { p.at = checkTime(); if (!p.at) throw new Error('排程時間不正確：' + $('tpHint').textContent); }
  if (mode === 'frame') {
    await editorReady;
    if (!editor || !editor.hasImage()) throw new Error('請先放照片');
    const lines = titleLines();
    if (lines.length > TITLE_LINES || lines.some((l) => [...l].length > TITLE_MAX)) throw new Error(`標題每行最多 ${TITLE_MAX} 字、最多 ${TITLE_LINES} 行`);
    p.image = await editor.exportBlob('image/jpeg', 0.92);
  } else if (textStyle === 'card') {
    if (!$('cardText').value.trim()) throw new Error('請輸入底圖文字');
    drawTextCard($('textCanvas'), { text: $('cardText').value, swatch });
    p.image = await new Promise((r) => $('textCanvas').toBlob(r, 'image/jpeg', 0.92));
    renderCard();
  } else {
    if (!caption.trim()) throw new Error('請輸入小編文');
    if (textStyle === 'native') {
      p.textPreset = $('presetId').value.trim();
      if (!/^\d{5,20}$/.test(p.textPreset)) throw new Error('請輸入背景代碼（數字）');
    }
  }
  return p;
}
async function sendOne(pageId, p) {
  const fd = new FormData();
  fd.append('page', pageId);
  fd.append('message', p.message);
  if (p.image) fd.append('image', p.image, 'post.jpg');
  if (p.textPreset) fd.append('textPreset', p.textPreset);
  if (p.at) fd.append('scheduledAt', String(p.at));
  return tb.api.call('/fb/post', { method: 'POST', body: fd });
}

let sending = false;
function resultRow(pageId) {
  let li = $('results').querySelector(`[data-page="${pageId}"]`);
  if (!li) { li = el('li', { dataset: { page: pageId } }); $('results').append(li); }
  return li;
}
function showResult(pageId, state, text, retry) {
  const li = resultRow(pageId);
  li.className = 'r-' + state;
  li.replaceChildren(el('b', { textContent: pageName(pageId) }), el('span', { textContent: text }));
  if (retry) {
    const b = el('button', { type: 'button', className: 'btn btn-secondary btn-sm', textContent: '重送' });
    b.addEventListener('click', () => send([pageId]));
    li.append(b);
  }
}
async function send(ids) {
  if (sending) return;
  const msg = $('sendMsg');
  if (!ids.length) { msg.textContent = '請先勾選要發的粉專'; return; }
  sending = true;   // 在任何 await 之前就鎖上，避免連點兩下重複發文
  $('sendBtn').disabled = true;
  try {
    let p;
    try { p = await buildPayload(); } catch (e) { msg.textContent = errText(e); return; }
    if (ids.length > 1 || !$('results').querySelector(`[data-page="${ids[0]}"]`)) $('results').replaceChildren();
    let okN = 0;
    for (const [i, id] of ids.entries()) {
      msg.textContent = `送出中 ${i + 1}/${ids.length}…`;
      showResult(id, 'wait', '送出中…');
      try {
        await sendOne(id, p);
        okN++;
        showResult(id, 'ok', p.at ? '已排程 ' + fmtTime(p.at) : '已發布');
      } catch (e) { showResult(id, 'bad', errText(e), true); }
    }
    msg.textContent = okN === ids.length ? `完成：${okN} 個粉專都成功` : `成功 ${okN}、失敗 ${ids.length - okN}（失敗的可按「重送」）`;
    if (okN && p.at) loadSched();
  } finally {
    sending = false;
    $('sendBtn').disabled = false;
  }
}
$('sendBtn').addEventListener('click', () => send(pages.filter((x) => picked.has(x.id)).map((x) => x.id)));

// 清空：唯一會刪內容的地方
$('clearBtn').addEventListener('click', async () => {
  if (!(await confirmBox('清空新增發文？', '照片、標題、小編文、底圖文字和送出結果都會清掉。', '清空'))) return;
  for (const id of ['url', 'title', 'caption', 'cardText', 'presetId']) $(id).value = '';
  $('urlHint').textContent = $('sendMsg').textContent = '';
  $('results').replaceChildren();
  if (editor) { editor.clearAll(); frameCtl.set(editor.getFrame()); }
  modeSeg.set('frame'); textSeg.set('card'); whenSeg.set('now');
  picked.clear(); renderPageChecks();
  renderTitleCounts(); renderCard(); updateCount();
});

loadPages();
