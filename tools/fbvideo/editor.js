// 每支影片一個內容區（從 <template> 複製；切換影片只隱藏，內容保留）
// 由上而下：上傳狀態、類型、影片標題、影片內文、標籤（按鈕＋自訂）、授權、發布粉專（各自立即／排程）、留言、RD SLUG
import { titleFromName, isReelsName, defaultText, setTitle, toggleTag, tagsIn, setLicense, stripLead, slugOf, REEL_MAX_SEC } from './rules.js';
import { segmented, sizeText, durText, fmt, toLocalInput, MIN_S, MAX_S, rangeText } from './util.js';

const MAX_COMMENTS = 3;
const FIRST_DELAYS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440];
const DELAYS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 90, 120, 180, 240, 360, 720, 1440];
const minText = (m) => (m < 60 ? `${m} 分鐘` : m % 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m / 60} 小時`);

export const STATE_TEXT = {
  uploading: '上傳中', uploaded: '已上傳，等送出', finishing: '送出中', processing: '臉書處理中', scheduled: '已排程',
  published: '已發布', failed: '失敗', unknown: '待確認（結果不明，請到臉書確認，不會自動重送）', stopped: '已停止', canceled: '已取消'
};
export const jobText = (j) => {
  let t = STATE_TEXT[j.state] || j.state;
  if (j.state === 'uploaded' && j.sent) t = '已上傳';
  if (j.state === 'uploading') t += ' ' + Math.floor((j.uploaded / Math.max(1, j.size)) * 100) + '%' + (j.sent ? '（已送出，傳完自動發布）' : '');
  if (j.state === 'scheduled' && j.at) t += ' ' + fmt(j.at * 1000);
  if (j.error) t += '：' + j.error;
  return t;
};
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
    const d = v.duration;
    const bad = v.kind === 'reel' && Number.isFinite(d) && (d > REEL_MAX_SEC || d < 3);
    kwarn.hidden = !bad;
    kwarn.textContent = bad ? `Reels 只能 3～90 秒（這支 ${durText(d)}），請改成橫式影片` : '';
  }

  // ===== 發布粉專：條列、勾選＋立即／排程（排程才出時間） =====
  const pgList = q('.pg-list'), pgSum = q('.pg-sum');
  const rows = new Map();   // page id -> { li, cb, mode, dt }
  function renderPages() {
    pgList.textContent = '';
    rows.clear();
    for (const p of ctx.pages()) {
      const li = document.createElement('li'); li.className = 'pg';
      const lab = document.createElement('label'); lab.className = 'pg-nm';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.page = p.id;
      lab.append(cb, document.createTextNode(p.short));
      const mode = document.createElement('select'); mode.className = 'pg-mode'; mode.hidden = true; mode.setAttribute('aria-label', p.short + ' 發布方式');
      mode.innerHTML = '<option value="now">立即</option><option value="sched">排程</option>';
      const dt = document.createElement('input'); dt.type = 'datetime-local'; dt.className = 'pg-dt'; dt.hidden = true; dt.setAttribute('aria-label', p.short + ' 排程時間');
      cb.addEventListener('change', () => {
        if (!cb.checked && !ctx.canUncheck(v, p.id)) { cb.checked = true; return; }
        sync1(p.id); ctx.pagesChanged(v, p.id, cb.checked);
      });
      mode.addEventListener('change', () => {
        if (mode.value === 'sched' && !dt.value) dt.value = toLocalInput(Math.ceil((Date.now() + 30 * 60000) / 600000) * 600000);
        sync1(p.id);
      });
      dt.addEventListener('input', summary);
      li.append(lab, mode, dt);
      pgList.append(li);
      rows.set(p.id, { li, cb, mode, dt });
    }
    summary();
  }
  function sync1(id) {
    const r = rows.get(id);
    r.mode.hidden = !r.cb.checked;
    r.dt.hidden = !r.cb.checked || r.mode.value !== 'sched';
    r.li.classList.toggle('on', r.cb.checked);
    summary();
  }
  function summary() {
    const on = [...rows.entries()].filter(([, r]) => r.cb.checked);
    const name = (id) => (ctx.pages().find((p) => p.id === id) || {}).short || id;
    pgSum.textContent = on.length
      ? `已選 ${on.length} 個粉專：` + on.map(([id, r]) => `${name(id)}（${r.mode.value === 'sched' && r.dt.value ? '排程 ' + fmt(Date.parse(r.dt.value)) : '立即'}）`).join('、')
      : '尚未選粉專（點這裡選）';
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
  function renderUpload() {
    if (!ctx.isCurrent(v)) return;
    const fill = document.getElementById('stFill'), upText = document.getElementById('stText'), restart = document.getElementById('restartBtn');
    const jobs = v.jobs.filter((j) => j.state !== 'canceled');
    const up = jobs.filter((j) => j.state === 'uploading');
    const done = jobs.length ? Math.min(...jobs.map((j) => (j.state === 'uploading' ? j.uploaded : j.size))) : 0;
    const pct = jobs.length ? Math.floor((done / Math.max(1, v.size)) * 100) : 0;
    fill.style.width = pct + '%';
    let text;
    if (v.upload === 'stopped') text = '已停止上傳' + (v.sent ? '（已送出的不會發布，可按「重新上傳」）' : '');
    else if (v.upload === 'error') text = '上傳失敗：' + (v.err || '') + (v.sent ? '（按「重新上傳」，傳完會用已送出的內容自動發布）' : '');
    else if (!jobs.length) text = v.checked ? '勾選發布粉專後開始上傳' : '沒有勾選，不會上傳';
    else if (up.length) text = `上傳中 ${pct}%（${sizeText(done)}／${sizeText(v.size)}）`;
    else text = '上傳完成';
    const name = v.ed ? (title.value.trim() || v.name) : v.name;
    const pages = v.jobs.filter((j) => j.state !== 'canceled').map((j) => ctx.pageName(j.page) + ' ' + jobText(j) + (j.cover === 'failed' ? '（封面未套用' + (j.coverError ? '：' + j.coverError : '') + '）' : ''));
    const full = `第 ${ctx.indexOf(v) + 1} 支「${name}」${text}` + (pages.length ? '．' + pages.join('．') : '');
    upText.textContent = full;
    upText.title = full;
    upText.classList.toggle('bad', v.upload === 'error' || v.jobs.some((j) => ['failed', 'unknown'].includes(j.state)));
    restart.hidden = !(v.upload === 'stopped' || v.upload === 'error');
  }

  // ===== 封面：類型右側小圖＋從影片選封面 =====
  const coverImg = q('.cover-img'), coverBtn = q('.cover-btn');
  function renderCover() {
    coverImg.textContent = '';
    coverImg.classList.toggle('tall', v.height > v.width);
    if (v.cover) { const img = document.createElement('img'); img.src = v.cover.url; img.alt = ''; coverImg.append(img); }
    else { const t = document.createElement('span'); t.textContent = '臉書自動'; coverImg.append(t); }
    coverBtn.textContent = v.cover ? '更換封面' : '從影片選封面';
  }
  coverBtn.addEventListener('click', () => ctx.pickCover(v));
  renderCover();

  return {
    el,
    kindInfo, renderTags, renderUpload, renderPages, renderCover,
    setMeta() { renderCover(); },
    refreshPresets() { cmList.querySelectorAll('select.preset').forEach(presetOptions); },
    titleText: () => title.value.trim(),
    slugText: () => slugOf(slug.value, title.value),
    selected: () => [...rows.entries()].filter(([, r]) => r.cb.checked).map(([id]) => id),
    // 套用到全部影片用：[{ page, mode, dt }]
    getPages: () => [...rows.entries()].filter(([, r]) => r.cb.checked).map(([page, r]) => ({ page, mode: r.mode.value, dt: r.dt.value })),
    setPages(list) {
      for (const [id, r] of rows) {
        const x = list.find((y) => y.page === id);
        r.cb.checked = !!x;
        if (x) { r.mode.value = x.mode; r.dt.value = x.dt; }
        sync1(id);
      }
    },
    // 送出用：[{ page, at }] 或 { error }
    pagesForSend() {
      const out = [];
      const now = Math.floor(Date.now() / 1000);
      for (const [page, r] of rows) {
        if (!r.cb.checked) continue;
        if (r.mode.value !== 'sched') { out.push({ page, at: null }); continue; }
        const ms = Date.parse(r.dt.value);
        if (!Number.isFinite(ms)) return { error: `${ctx.pageName(page)} 請選排程時間` };
        const at = Math.floor(ms / 1000);
        if (at < now + MIN_S || at > now + MAX_S[v.kind]) return { error: `${ctx.pageName(page)}：${rangeText(v.kind)}` };
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
      if (!kwarn.hidden) return { error: kwarn.textContent };
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
