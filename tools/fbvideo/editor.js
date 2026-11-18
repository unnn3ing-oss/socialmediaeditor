// 每支影片一個編輯區（從 <template> 複製；切換影片只隱藏，內容保留）
import { titleFromName, isReelsName, defaultText, setTitle, toggleTag, tagsIn, setLicense, stripLead, slugOf, REEL_MAX_SEC } from './rules.js';
import { createWhen, segmented, sizeText, durText, fmt } from './util.js';

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

export function createEditor(v, ctx) {
  const el = document.getElementById('edTpl').content.firstElementChild.cloneNode(true);
  const q = (s) => el.querySelector(s);
  const pv = q('.pv'), title = q('.title'), msg = q('.msg'), lic = q('.lic'), slug = q('.slug');
  pv.src = v.url;
  pv.setAttribute('aria-label', '影片預覽：' + v.name);

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

  // hashtag 按鈕：Reels 自動那個＋管理頁設定的
  const tagBox = q('.tags');
  function renderTags() {
    const s = ctx.settings();
    const list = [...new Set([s.reelsTag, ...s.tags].filter(Boolean))];
    tagBox.textContent = '';
    tagBox.hidden = !list.length;
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
  tagBox.addEventListener('click', (e) => {
    const b = e.target.closest('.tag'); if (!b || b.disabled) return;
    const r = toggleTag(msg.value, b.dataset.tag);
    msg.value = r.text; fallback(r.fallback); syncTags();
  });
  msg.addEventListener('input', () => { syncTags(); fallback(false); });
  lic.addEventListener('input', () => {
    const r = setLicense(msg.value, lic.value, prevLic);
    msg.value = r.text; prevLic = lic.value.replace(/[\r\n]+/g, ' ').trim(); fallback(r.fallback);
  });
  renderTags();

  // 類型
  const why = q('.kind-why'), kwarn = q('.kind-warn');
  const setKindBtn = segmented(q('.kind'), 'kind', (k) => (k === v.kind ? false : ctx.setKind(v, k)));
  function kindInfo() {
    setKindBtn(v.kind);
    why.textContent = v.kindManual ? '手動選擇' : /^(reels|shorts)_/i.test(v.name) ? '依檔名判斷' : v.width ? `依長寬判斷（${v.height > v.width ? '直式' : '橫式'}）` : '';
    const d = v.duration;
    const bad = v.kind === 'reel' && Number.isFinite(d) && (d > REEL_MAX_SEC || d < 3);
    kwarn.hidden = !bad;
    kwarn.textContent = bad ? `Reels 只能 3～90 秒（這支 ${durText(d)}），請改成橫式影片` : '';
  }

  // 每支各自的時間
  const whenEach = createWhen(q('.when-each .when'), '這支影片的發布時間');

  // 留言
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

  // 上傳進度與各粉專狀態
  const fill = q('.bar-fill'), upText = q('.up-text'), jobsEl = q('.jobs'), restart = q('.restart');
  restart.addEventListener('click', () => ctx.restart(v));
  function renderUpload() {
    const jobs = v.jobs.filter((j) => j.state !== 'canceled');
    const up = jobs.filter((j) => j.state === 'uploading');
    const done = v.size ? Math.min(...(jobs.length ? jobs.map((j) => (j.state === 'uploading' ? j.uploaded : j.size)) : [0])) : 0;
    const pct = jobs.length ? Math.floor((done / v.size) * 100) : 0;
    fill.style.width = pct + '%';
    let text;
    if (v.upload === 'stopped') text = '已停止上傳';
    else if (v.upload === 'error') text = '上傳失敗：' + (v.err || '');
    else if (!jobs.length) text = v.checked ? '勾選粉專後開始上傳' : '沒有勾選，不會上傳';
    else if (up.length) text = `上傳中 ${pct}%（${sizeText(done)}／${sizeText(v.size)}）`;
    else text = '上傳完成';
    upText.textContent = text;
    restart.hidden = !(v.upload === 'stopped' || v.upload === 'error') || v.sent;
    jobsEl.textContent = '';
    for (const j of v.jobs) {
      const li = document.createElement('li');
      li.className = 'job s-' + j.state;
      li.textContent = ctx.pageName(j.page) + '：' + jobText(j);
      jobsEl.append(li);
    }
  }

  q('.meta').textContent = [v.name, sizeText(v.size)].join('．');
  function setMeta() { q('.meta').textContent = [v.name, sizeText(v.size), v.width ? `${v.width}×${v.height}` : '', durText(v.duration)].filter(Boolean).join('．'); }

  return {
    el,
    kindInfo,
    setMeta,
    renderTags,
    renderUpload,
    refreshPresets() { cmList.querySelectorAll('select.preset').forEach(presetOptions); },
    showEach(on) { q('.when-each').hidden = !on; },
    time: whenEach,
    titleText: () => title.value.trim(),
    slugText: () => slugOf(slug.value, title.value),
    // 送出前收集；不合法回 { error }
    collect() {
      const t = title.value.trim();
      if (!t) return { error: '沒有臉書標題' };
      const description = stripLead(msg.value).replace(/\s+$/, '');
      if (!description) return { error: '沒有貼文內容' };
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
      q('.ed-right').disabled = true;
      whenEach.disable(true);
    }
  };
}
