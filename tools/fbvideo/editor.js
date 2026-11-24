// 每支影片一個內容區（從 <template> 複製；切換影片只隱藏，內容保留）
// 由上而下：上傳狀態、類型、影片標題、影片內文、標籤（按鈕＋自訂）、授權、發布粉專（各自立即／排程）、留言、RD SLUG
import { titleFromName, isReelsName, defaultText, setTitle, toggleTag, tagsIn, setLicense, stripLead, slugOf, q2359At, routeOf, routeText } from './rules.js';
import { segmented, sizeText, fmt, toLocalInput, MIN_S, MAX_S, rangeText } from './util.js';

const MAX_COMMENTS = 3;
const FIRST_DELAYS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440];
const DELAYS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 90, 120, 180, 240, 360, 720, 1440];
const minText = (m) => (m < 60 ? `${m} 分鐘` : m % 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m / 60} 小時`);

export const STATE_TEXT = {
  uploading: '上傳中', uploaded: '已上傳，等送出', finishing: '送出中', processing: '臉書處理中', scheduled: '已排程',
  published: '已發布', draft: '已存草稿', failed: '失敗', unknown: '待確認（結果不明，請到臉書確認，不會自動重送）', stopped: '已停止', canceled: '已取消'
};
export const jobText = (j) => {
  let t = STATE_TEXT[j.state] || j.state;
  if (j.state === 'uploaded' && j.sent) t = '已上傳';
  if (j.state === 'uploading') t += ' ' + Math.floor((j.uploaded / Math.max(1, j.size)) * 100) + '%' + (j.sent ? '（已送出，傳完自動發布）' : '');
  if (j.state === 'scheduled' && j.at) t += ' ' + fmt(j.at * 1000);
  if (j.error) t += '：' + j.error;
  return t;
};
export const CROSS_TEXT = { pending: '等待多文', posting: '多文中', done: '已多文', failed: '多文失敗', unknown: '多文結果不明（請到臉書確認）', canceled: '多文已取消' };
// 發布方式：立即／排程／草稿／多文發佈（只限橫式）
export const MODES = [['now', '立即'], ['sched', '排程'], ['draft', '草稿'], ['cross', '多文發佈'], ['q2359', '放待排 2359']];
const Q_TEXT = '放待排 2359';
const COVER_MAX = 10 * 1024 * 1024;
// 自訂 hashtag：去空白、補 #
export const normTag = (s) => { const t = String(s || '').replace(/\s+/g, '').replace(/^#+/, ''); return t ? '#' + t : ''; };

export function createEditor(v, ctx) {
  const el = document.getElementById('edTpl').content.firstElementChild.cloneNode(true);
  const q = (s) => el.querySelector(s);
  const title = q('.title'), msg = q('.msg'), lic = q('.lic'), slug = q('.slug');

  const st = ctx.settings();
  const t0 = titleFromName(v.name, st);
  title.value = t0;
  msg.value = defaultText(t0, isReelsName(v.name) && st.reelsTag ? st.reelsTag : '');
  slug.placeholder = slugOf('', t0) || '依標題自動';
  let prevLic = '';

  const warn = q('.msg-warn');
  const fallback = (on) => { warn.hidden = !on; warn.textContent = on ? '找不到【標題】行，hashtag／授權改放第 3／4 行' : ''; };

  title.addEventListener('input', () => {
    const t = title.value.replace(/[\r\n]+/g, ' ');
    if (t !== title.value) title.value = t;
    msg.value = setTitle(msg.value, t.trim());
    slug.placeholder = slugOf('', t) || '依標題自動';
    ctx.changed(v);
  });

  // ===== 標籤：Reels 自動那個＋管理頁設定的＋這支影片自訂的 =====
  const tagBox = q('.tags'), tagIn = q('.tag-in');
  const custom = [];
  function renderTags() {
    const s = ctx.settings();
    const list = [...new Set([s.reelsTag, ...s.tags, ...custom].filter(Boolean))];
    tagBox.textContent = '';
    for (const tg of list) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tag'; b.textContent = tg; b.dataset.tag = tg;
      tagBox.append(b);
    }
    syncTags();
  }
  function syncTags() {
    const on = new Set(tagsIn(msg.value));
    for (const b of tagBox.querySelectorAll('.tag')) b.setAttribute('aria-pressed', String(on.has(b.dataset.tag)));
  }
  function flip(tag) { const r = toggleTag(msg.value, tag); msg.value = r.text; fallback(r.fallback); syncTags(); }
  tagBox.addEventListener('click', (e) => { const b = e.target.closest('.tag'); if (b && !b.disabled) flip(b.dataset.tag); });
  function addCustom() {
    const tag = normTag(tagIn.value);
    if (!tag) return;
    if (![...tagBox.querySelectorAll('.tag')].some((b) => b.dataset.tag === tag)) { custom.push(tag); renderTags(); }
    if (!tagsIn(msg.value).includes(tag)) flip(tag);
    tagIn.value = '';
    tagIn.focus();
  }
  q('.tag-add-btn').addEventListener('click', addCustom);
  tagIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addCustom(); } });
  msg.addEventListener('input', () => { syncTags(); fallback(false); });
  lic.addEventListener('input', () => {
    const r = setLicense(msg.value, lic.value, prevLic);
    msg.value = r.text; prevLic = lic.value.replace(/[\r\n]+/g, ' ').trim(); fallback(r.fallback);
  });
  renderTags();

  // ===== 類型 =====
  const why = q('.kind-why'), kwarn = q('.kind-warn');
  const setKindBtn = segmented(q('.kind'), 'kind', (k) => (k === v.kind ? false : ctx.setKind(v, k)));
  function kindInfo() {
    setKindBtn(v.kind);
    why.textContent = v.kindManual ? '手動選擇' : /^(reels|shorts)_/i.test(v.name) ? '自動判斷：檔名' : v.width ? `自動判斷：${v.height > v.width ? '直式' : '橫式'}畫面` : '';
    // 不再擋 90 秒：超過就自動改走一般影片上傳（臉書後台不分直橫），這裡只說明用哪種上傳方式
    kwarn.hidden = false;
    kwarn.className = 'kind-warn hint';
    kwarn.textContent = routeText(v.kind, v.duration);
  }

  // ===== 發布粉專：條列、勾選＋立即／排程（排程才出時間） =====
  const pgList = q('.pg-list'), pgSum = q('.pg-sum');
  const rows = new Map();   // page id -> { li, cb, mode, dt, xbtn, cross: [目標粉專], prev }
  function renderPages() {
    pgList.textContent = '';
    rows.clear();
    for (const p of ctx.pages()) {
      const li = document.createElement('li'); li.className = 'pg';
      const lab = document.createElement('label'); lab.className = 'pg-nm';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.page = p.id;
      lab.append(cb, document.createTextNode(p.short));
      const mode = document.createElement('select'); mode.className = 'pg-mode'; mode.hidden = true; mode.setAttribute('aria-label', p.short + ' 發布方式');
      for (const [val, txt] of MODES) { const o = document.createElement('option'); o.value = val; o.textContent = txt; mode.append(o); }
      const dt = document.createElement('input'); dt.type = 'datetime-local'; dt.className = 'pg-dt'; dt.hidden = true; dt.setAttribute('aria-label', p.short + ' 排程時間');
      const xbtn = document.createElement('button'); xbtn.type = 'button'; xbtn.className = 'btn btn-secondary btn-sm pg-x'; xbtn.hidden = true;
      cb.addEventListener('change', () => {
        if (!cb.checked && !ctx.canUncheck(v, p.id)) { cb.checked = true; return; }
        if (cb.checked) markPicked();
        if (cb.checked) dropTarget(p.id);
        sync1(p.id); ctx.pagesChanged(v, p.id, cb.checked);
      });
      // 放待排 2359：每次打開選單前重新判斷是不是已過 23:49
      mode.addEventListener('focus', syncQ);
      mode.addEventListener('pointerdown', syncQ);
      mode.addEventListener('change', async () => {
        const r = rows.get(p.id);
        if (mode.value === 'sched' && !dt.value) dt.value = toLocalInput(Math.ceil((Date.now() + 30 * 60000) / 600000) * 600000);
        if (mode.value === 'cross') {
          const free = crossFree(p.id);
          const got = await ctx.pickCross(v, p.id, r.cross.filter((x) => free.includes(x)), free);
          if (got === null || !got.length) { mode.value = r.prev; if (got && !got.length) r.cross = []; sync1(p.id); return; }
          r.cross = got;
        }
        if (mode.value !== 'cross') r.cross = [];   // 離開多文就清掉目標，免得之後預勾已被別的粉專拿走的
        r.prev = mode.value;
        sync1(p.id);
      });
      xbtn.addEventListener('click', async () => {
        const r = rows.get(p.id);
        const free = crossFree(p.id);
        const got = await ctx.pickCross(v, p.id, r.cross.filter((x) => free.includes(x)), free);
        if (got === null) return;
        if (!got.length) { r.cross = []; mode.value = 'now'; r.prev = 'now'; } else r.cross = got;
        sync1(p.id);
      });
      dt.addEventListener('input', summary);
      li.append(lab, mode, dt, xbtn);
      pgList.append(li);
      rows.set(p.id, { li, cb, mode, dt, xbtn, cross: [], prev: 'now' });
    }
    syncKind();
    summary();
  }
  const name = (id) => (ctx.pages().find((p) => p.id === id) || {}).short || id;
  // 可以當多文目標的粉專：沒勾上傳、也沒被這支影片其他粉專拿去多文
  function crossFree(src) {
    const used = new Set();
    for (const [id, r] of rows) { if (id !== src && r.cb.checked && r.mode.value === 'cross') r.cross.forEach((x) => used.add(x)); }
    return ctx.pages().map((p) => p.id).filter((id) => id !== src && !(rows.get(id) && rows.get(id).cb.checked) && !used.has(id));
  }
  // 粉專改成上傳：從所有多文目標拿掉
  function dropTarget(id) {
    for (const [src, r] of rows) {
      if (!r.cross.includes(id)) continue;
      r.cross = r.cross.filter((x) => x !== id);
      if (!r.cross.length && r.mode.value === 'cross') { r.mode.value = 'now'; r.prev = 'now'; ctx.toast(`${name(src)} 的多文粉專都改成直接上傳了，改回「立即」`); }
      sync1(src, true);
    }
  }
  // 還沒選過粉專：自動展開選擇區（藍框＋提示＋焦點第一個）；勾過任一粉專或被全套用過就不再自動跳出
  const pgDd = q('.pg-dd'), pgTip = q('.pg-tip');
  function markPicked() {
    v.pagesPicked = true;
    pgDd.classList.remove('need-pick'); pgTip.hidden = true;
  }
  function openPicker() {
    if (v.sent || v.pagesPicked || [...rows.values()].some((r) => r.cb.checked)) return false;
    pgDd.open = true; pgDd.classList.add('need-pick'); pgTip.hidden = false;
    const first = pgList.querySelector('input[type=checkbox]:not(:disabled)');
    pgDd.scrollIntoView({ block: 'nearest' });
    // 正在其他欄位打字（例如加入／移除影片時）不搶焦點，只展開
    const ae = document.activeElement;
    const typing = ae && ae !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable) && ae.type !== 'file' && ae.type !== 'checkbox';
    if (first && !typing) first.focus({ preventScroll: true });
    return true;
  }
  function sync1(id, quiet) {
    const r = rows.get(id);
    r.mode.hidden = !r.cb.checked;
    r.dt.hidden = !r.cb.checked || r.mode.value !== 'sched';
    r.xbtn.hidden = !r.cb.checked || r.mode.value !== 'cross';
    r.xbtn.textContent = '多文到：' + (r.cross.map(name).join('、') || '（選粉專）');
    r.xbtn.setAttribute('aria-label', `${name(id)} 多文到哪些粉專：${r.cross.map(name).join('、') || '未選'}（點一下修改）`);
    r.li.classList.toggle('on', r.cb.checked);
    if (!quiet) summary();
  }
  // Reels 不能多文：選項停用，已選的改回立即；放待排 2359 只有直式：橫式停用，已選的改回立即
  function syncKind() {
    const reel = v.kind === 'reel';
    for (const [id, r] of rows) {
      const o = r.mode.querySelector('option[value="cross"]');
      o.disabled = reel; o.hidden = reel;
      if (reel && r.mode.value === 'cross') { r.mode.value = 'now'; r.prev = 'now'; r.cross = []; sync1(id, true); }
      if (!reel && r.mode.value === 'q2359') { r.mode.value = 'now'; r.prev = 'now'; sync1(id, true); }
    }
    syncQ();
  }
  // 放待排 2359：橫式隱藏；23:49 之後停用並標「已過 23:49」（已選的不改，送出時擋）
  function syncQ() {
    const reel = v.kind === 'reel', late = q2359At(Date.now(), MIN_S) === null;
    for (const [, r] of rows) {
      const o = r.mode.querySelector('option[value="q2359"]');
      o.hidden = !reel; o.disabled = !reel || late;
      o.textContent = reel && late ? Q_TEXT + '（已過 23:49）' : Q_TEXT;
    }
  }
  const modeText = (r) => r.mode.value === 'sched' && r.dt.value ? '排程 ' + fmt(Date.parse(r.dt.value))
    : r.mode.value === 'q2359' ? '放待排 2359（今天 23:59）'
    : r.mode.value === 'draft' ? '草稿' : r.mode.value === 'cross' ? '立即＋多文到 ' + r.cross.map(name).join('、') : '立即';
  function summary() {
    const on = [...rows.entries()].filter(([, r]) => r.cb.checked);
    pgSum.textContent = on.length
      ? `已選 ${on.length} 個粉專：` + on.map(([id, r]) => `${name(id)}（${modeText(r)}）`).join('、')
      : '尚未選粉專（點這裡選）';
    const drafts = on.filter(([, r]) => r.mode.value === 'draft').map(([id]) => name(id));
    const note = q('.cm-note');
    note.hidden = !drafts.length;
    note.textContent = drafts.length ? `存草稿的粉專（${drafts.join('、')}）不會留言；被多文的粉專也不會留言。` : '';
    ctx.changed(v);
  }
  q('.apply-all').addEventListener('click', () => ctx.applyAll(v));

  // ===== 留言 =====
  const cmList = q('.cm-list'), cmAdd = q('.cm-add');
  function presetOptions(sel) {
    const cur = sel.value;
    sel.textContent = '';
    const own = document.createElement('option'); own.value = ''; own.textContent = '自行輸入'; sel.append(own);
    ctx.presets().forEach((p, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = '活動：' + p.name; sel.append(o); });
    sel.value = cur && ctx.presets()[+cur] ? cur : '';
  }
  function renumber() {
    [...cmList.children].forEach((row, i) => {
      row.querySelector('.cm-title').textContent = `第 ${i + 1} 則留言`;
      const d = row.querySelector('select.delay');
      const first = i === 0, was = d.dataset.first === '1';
      if (first !== was) {
        const keep = +d.value;
        d.textContent = '';
        for (const m of first ? FIRST_DELAYS : DELAYS) { const o = document.createElement('option'); o.value = String(m); o.textContent = (first ? '發布後 ' : '距上一則 ') + minText(m); d.append(o); }
        d.dataset.first = first ? '1' : '0';
        d.value = String((first ? FIRST_DELAYS : DELAYS).includes(keep) ? keep : (first ? 0 : 5));
        d.setAttribute('aria-label', first ? '發布後幾分鐘留言' : '距上一則留言幾分鐘');
      }
    });
    cmAdd.disabled = cmList.children.length >= MAX_COMMENTS || el.classList.contains('locked');
  }
  cmAdd.addEventListener('click', () => {
    if (cmList.children.length >= MAX_COMMENTS) return;
    const row = document.createElement('div'); row.className = 'cm-row';
    const head = document.createElement('div'); head.className = 'cm-head';
    const t = document.createElement('strong'); t.className = 'cm-title';
    const preset = document.createElement('select'); preset.className = 'preset'; preset.setAttribute('aria-label', '留言內容來源');
    presetOptions(preset);
    const delay = document.createElement('select'); delay.className = 'delay'; delay.dataset.first = '';
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-secondary btn-sm cm-del'; del.textContent = '刪除';
    head.append(t, preset, delay, del);
    const ta = document.createElement('textarea'); ta.rows = 3; ta.placeholder = '輸入留言內容'; ta.setAttribute('aria-label', '留言內容');
    preset.addEventListener('change', () => { const p = ctx.presets()[+preset.value]; if (preset.value !== '' && p) ta.value = p.body; });
    del.addEventListener('click', () => { row.remove(); renumber(); });
    row.append(head, ta);
    cmList.append(row);
    renumber();
    ta.focus();
  });
  renumber();

  // ===== 上傳進度與各粉專狀態：畫在底部工具列（只畫目前選中的影片） =====
  // 這支影片的上傳狀態（編輯區「發布粉專」下方）：一行總結＋每個粉專一行
  const upBox = q('.up-box'), upMsg = q('.up-msg'), upList = q('.up-list'), upRestart = q('.up-restart');
  upRestart.addEventListener('click', () => ctx.restart(v));
  function renderUpload() {
    const jobs = v.jobs.filter((j) => j.state !== 'canceled');
    const up = jobs.filter((j) => j.state === 'uploading');
    const done = jobs.length ? Math.min(...jobs.map((j) => (j.state === 'uploading' ? j.uploaded : j.size))) : 0;
    const pct = jobs.length ? Math.floor((done / Math.max(1, v.size)) * 100) : 0;
    let text;
    if (v.upload === 'stopped') text = '已停止上傳' + (v.sent ? '（已送出的不會發布，可按「重新上傳」）' : '');
    else if (v.upload === 'error') text = '上傳失敗：' + (v.err || '') + (v.sent ? '（按「重新上傳」，傳完會用已送出的內容自動發布）' : '');
    else if (!jobs.length) text = '';
    else if (up.length) text = `上傳中 ${pct}%（${sizeText(done)}／${sizeText(v.size)}）`;
    else text = '上傳完成';
    upMsg.textContent = text;
    const bad = v.upload === 'error' || jobs.some((j) => ['failed', 'unknown'].includes(j.state) || (j.cross || []).some((c) => ['failed', 'unknown'].includes(c.status)));
    upMsg.classList.toggle('bad', bad);
    upList.textContent = '';
    for (const j of jobs) {
      const li = document.createElement('li');
      li.className = ['failed', 'unknown'].includes(j.state) ? 'bad' : '';
      li.textContent = ctx.pageName(j.page) + '：' + jobText(j) + (j.cover === 'failed' ? '（封面未套用' + (j.coverError ? '：' + j.coverError : '') + '）' : '')
        + (j.cross || []).map((c) => `．${ctx.pageName(c.page)} ${CROSS_TEXT[c.status] || c.status}${c.error ? '：' + c.error : ''}`).join('');
      upList.append(li);
    }
    upBox.hidden = !text && !jobs.length;
    upRestart.hidden = !(v.upload === 'stopped' || v.upload === 'error');
    ctx.footChanged();
  }

  // ===== 封面：類型右側小圖＋從影片選封面 =====
  const coverImg = q('.cover-img'), coverBtn = q('.cover-btn'), coverUp = q('.cover-up'), coverFile = q('.cover-file'), coverNote = q('.cover-note');
  function renderCover() {
    coverImg.textContent = '';
    if (v.cover) { const img = document.createElement('img'); img.src = v.cover.url; img.alt = ''; coverImg.append(img); }
    else { const t = document.createElement('span'); t.textContent = '自動'; coverImg.append(t); }
    const uploaded = !!(v.cover && v.cover.file);
    coverBtn.textContent = v.cover && !uploaded ? '更換封面' : '從影片選封面';
    coverUp.textContent = uploaded ? '換一張圖片' : '上傳圖片';
    coverNote.hidden = !uploaded;
    coverNote.textContent = uploaded ? `已上傳 ${v.cover.file}（JPG／PNG，最大 10MB）` : '';
  }
  coverBtn.addEventListener('click', () => ctx.pickCover(v));
  // 手動上傳封面圖：JPG／PNG、最大 10MB（臉書封面上限；後端也會再檢查檔頭）
  coverUp.addEventListener('click', () => coverFile.click());
  coverFile.addEventListener('change', () => {
    const f = coverFile.files && coverFile.files[0];
    coverFile.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png)$/.test(f.type) && !/\.(jpe?g|png)$/i.test(f.name)) { ctx.toast('封面只收 JPG 或 PNG'); return; }
    if (f.size > COVER_MAX) { ctx.toast(`封面圖片超過 10MB（這張 ${sizeText(f.size)}）`); return; }
    ctx.setCover(v, { blob: f, url: URL.createObjectURL(f), t: null, file: f.name });
  });
  renderCover();

  return {
    el,
    kindInfo() { kindInfo(); syncKind(); summary(); }, renderTags, renderUpload, renderPages, renderCover,
    setMeta() { renderCover(); },
    refreshPresets() { cmList.querySelectorAll('select.preset').forEach(presetOptions); },
    titleText: () => title.value.trim(),
    slugText: () => slugOf(slug.value, title.value),
    selected: () => [...rows.entries()].filter(([, r]) => r.cb.checked).map(([id]) => id),
    // 發布方式全套用：[{ page, mode, dt, cross }]
    getPages: () => [...rows.entries()].filter(([, r]) => r.cb.checked).map(([page, r]) => ({ page, mode: r.mode.value, dt: r.dt.value, cross: [...r.cross] })),
    openPicker,
    setPages(list) {
      if (list.length) markPicked();
      const own = new Set(list.map((y) => y.page));
      for (const [id, r] of rows) {
        const x = list.find((y) => y.page === id);
        r.cb.checked = !!x;
        if (x) {
          r.cross = x.mode === 'cross' ? x.cross.filter((c) => !own.has(c) && rows.has(c)) : [];
          r.mode.value = (x.mode === 'cross' && (!r.cross.length || v.kind === 'reel')) || (x.mode === 'q2359' && v.kind !== 'reel') ? 'now' : x.mode;
          if (r.mode.value !== 'cross') r.cross = [];
          r.prev = r.mode.value; r.dt.value = x.dt;
        }
        sync1(id, true);
      }
      summary();
    },
    // 送出用：[{ page, at, draft?, cross?, q2359? }] 或 { error }（q2359 後端不看，前端寫 RD 用）
    pagesForSend() {
      const out = [];
      const now = Math.floor(Date.now() / 1000);
      for (const [page, r] of rows) {
        if (!r.cb.checked) continue;
        if (r.mode.value === 'draft') { out.push({ page, at: null, draft: true }); continue; }
        if (r.mode.value === 'cross') {
          if (v.kind === 'reel') return { error: 'Reels 不能多文發佈' };
          const cross = r.cross.filter((c) => !(rows.get(c) && rows.get(c).cb.checked));
          if (!cross.length) return { error: `${ctx.pageName(page)} 請選要多文到哪些粉專` };
          out.push({ page, at: null, cross });
          continue;
        }
        if (r.mode.value === 'q2359') {
          if (v.kind !== 'reel') return { error: `${ctx.pageName(page)}：放待排 2359 只能用在直式影片` };
          const at = q2359At(Date.now(), MIN_S);
          if (at === null) return { error: `${ctx.pageName(page)}：已過 23:49，不能放待排 2359（臉書排程至少要提前 10 分鐘）` };
          out.push({ page, at, q2359: true });
          continue;
        }
        if (r.mode.value !== 'sched') { out.push({ page, at: null }); continue; }
        const ms = Date.parse(r.dt.value);
        if (!Number.isFinite(ms)) return { error: `${ctx.pageName(page)} 請選排程時間` };
        const at = Math.floor(ms / 1000);
        const route = routeOf(v.kind, v.duration);
        if (at < now + MIN_S || at > now + MAX_S[route]) return { error: `${ctx.pageName(page)}：${rangeText(route)}` };
        out.push({ page, at });
      }
      if (!out.length) return { error: '請勾選發布粉專' };
      return { pages: out };
    },
    // 送出前收集；不合法回 { error }
    collect() {
      const t = title.value.trim();
      if (!t) return { error: '沒有影片標題' };
      const description = stripLead(msg.value).replace(/\s+$/, '');
      if (!description) return { error: '沒有影片內文' };
      const comments = [];
      for (const [i, row] of [...cmList.children].entries()) {
        const m = row.querySelector('textarea').value.trim();
        if (!m) return { error: `第 ${i + 1} 則留言沒有內容（不需要就按刪除）` };
        comments.push({ message: m, delay: +row.querySelector('select.delay').value });
      }
      return { title: t, description, comments };
    },
    lock() {
      el.classList.add('locked');
      q('.ed-body').disabled = true;
    }
  };
}
