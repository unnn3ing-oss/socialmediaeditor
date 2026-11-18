// 影片發布（測試版，只給管理員）：多支影片 × 多個粉專。
//   選好粉專與影片就在背景上傳（每支影片只傳一次，後端轉給各粉專，見 server/fb/video.js）；上傳時可以繼續填文案。
//   按「全部送出」把文案交給後端：已傳完的馬上發布，還沒傳完的等最後一段傳完由後端發布。
//   上傳中：取消勾粉專、移除／取消勾影片、切換類型都擋下；關分頁先確認（tb.busy）；可手動「停止上傳」。
// 工具內切換一律用 hidden，不重建畫面。
import { tb } from '../../sdk/toolbox.js';
import { autoKind, rdText } from './rules.js';
import { createEditor, STATE_TEXT } from './editor.js';
import { $, errText, toast, confirmBox, segmented, createWhen, newId, sizeText, dateStr, timeStr, fmt } from './util.js';

tb.init('fbvideo');

const RD_KEY = 'tbx.fbvideo.rd';
const MAX_SIZE = 10 * 1024 * 1024 * 1024;
const BUSY_MSG = '影片上傳中，離開會中斷上傳。';
const S = {
  pages: [], settings: { prefixes: [], suffixes: [], reelsTag: '#焦點新聞影音都在TVBS', tags: [] }, presets: [],
  videos: [], cur: null, pageSel: new Set(), timeMode: 'all', canPost: true
};
const pageName = (id) => (S.pages.find((p) => p.id === id) || {}).short || id;
const wantPages = (v) => (v.checked ? [...S.pageSel] : []);
const isUploading = (v) => v.jobs.some((j) => j.state === 'uploading') && v.upload !== 'stopped' && v.upload !== 'error';
const anyUploading = () => S.videos.some(isUploading);

// ===== 分頁 =====
function showTab(name) {
  for (const t of $('tabs').querySelectorAll('[data-tab]')) {
    const on = t.dataset.tab === name; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on));
    $('tab-' + t.dataset.tab).hidden = !on;
  }
  $('foot').hidden = name !== 'new';
  if (name === 'log' && !logLoaded) loadLog();
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

// ===== 啟動：權限同排程發布 =====
(async () => {
  let st;
  try { st = await tb.api.call('/auth/status'); } catch { return; }
  if (!st || !st.company) return;
  let pages;
  try { pages = await tb.api.call('/fb/pages'); } catch (e) {
    if (e && e.code === 'fb_need_staff') { $('needStaff').hidden = false; $('needStaffBtn').onclick = () => tb.company.login(); return; }
    const why = e && e.code === 'fb_forbidden' ? ((e.detail && e.detail.reason) || '') : errText(e);
    if (why) { $('offReason').textContent = '原因：' + why; $('offReason').hidden = false; }
    return;
  }
  $('offMain').hidden = true;
  $('app').hidden = false;
  S.pages = [...pages].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  $('pagesState').textContent = `已連線 ${S.pages.length} 個粉專`;
  renderChips();
  tb.api.call('/fb/access').then((a) => { if (a && a.mode === 'company') for (const el of document.querySelectorAll('.test-pill')) el.hidden = true; }).catch(() => {});
  tb.api.call('/fb/me').then((me) => {
    if (!me) return;
    const perms = me.admin ? ['view', 'post'] : (me.perms || []);
    S.canPost = perms.includes('post');
    $('sendBtn').hidden = !S.canPost;
    const who = me.admin ? '管理員' : [me.name, me.group].filter(Boolean).join('．');
    if (who) { $('whoAmI').textContent = who; $('whoAmI').hidden = false; }
  }).catch(() => {});
  tb.api.call('/fb/video/settings').then((s) => { if (s) { S.settings = s; S.videos.forEach((v) => v.ed.renderTags()); } }).catch(() => {});
  tb.api.call('/fb/presets').then((l) => { S.presets = Array.isArray(l) ? l : []; S.videos.forEach((v) => v.ed.refreshPresets()); }).catch(() => {});
})();

// ===== 粉專晶片 =====
function renderChips() {
  const box = $('pageChips'); box.textContent = '';
  for (const p of S.pages) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.page = p.id; b.textContent = p.short;
    b.setAttribute('aria-pressed', String(S.pageSel.has(p.id)));
    box.append(b);
  }
  if (!S.pages.length) box.textContent = '沒有可用的粉專';
}
$('pageChips').addEventListener('click', async (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  const id = b.dataset.page;
  if (S.pageSel.has(id)) {
    if (anyUploading()) { toast('影片上傳中，等上傳完成才能取消粉專（或先按「停止上傳」）'); return; }
    S.pageSel.delete(id);
    // 已上傳但還沒送出的：取消那個粉專的工作階段
    for (const v of S.videos) {
      if (v.sent || !v.jobs.some((j) => j.page === id && ['uploaded', 'uploading'].includes(j.state))) continue;
      try { apply(v, await tb.api.call('/fb/video/drop', { method: 'POST', body: { uploadId: v.uploadId, page: id } })); } catch { /* 沒送出就不會發布 */ }
    }
  } else S.pageSel.add(id);
  b.setAttribute('aria-pressed', String(S.pageSel.has(id)));
  sync();
});

// ===== 時間（全部統一／每支各自）＋RD =====
const allWhen = createWhen($('allWhen'), '全部影片的發布時間');
segmented($('timeModeSeg'), 'tm', (m) => {
  S.timeMode = m;
  $('allWhen').hidden = m !== 'all';
  S.videos.forEach((v) => v.ed.showEach(m === 'each'));
});
try { $('rdOn').checked = localStorage.getItem(RD_KEY) === '1'; } catch { /* 無痕等 */ }
$('rdOn').addEventListener('change', () => { try { localStorage.setItem(RD_KEY, $('rdOn').checked ? '1' : '0'); } catch { /* 忽略 */ } syncRd(); });
function syncRd() { for (const v of S.videos) v.ed.el.querySelector('.rd-slug-l').hidden = !$('rdOn').checked; }

// ===== 加影片 =====
$('pickBtn').addEventListener('click', () => $('fileIn').click());
$('fileIn').addEventListener('change', () => { addFiles([...$('fileIn').files]); $('fileIn').value = ''; });
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });

function addFiles(files) {
  const bad = [];
  for (const f of files) {
    if (!/\.(mp4|mov)$/i.test(f.name) && !/^video\/(mp4|quicktime)$/.test(f.type)) { bad.push(f.name + '（只收 mp4／mov）'); continue; }
    if (f.size > MAX_SIZE) { bad.push(f.name + '（超過 10GB）'); continue; }
    const v = { id: newId(), file: f, url: URL.createObjectURL(f), name: f.name, size: f.size, width: 0, height: 0, duration: NaN,
      kind: autoKind(f.name, 0, 0), kindManual: false, checked: true, uploadId: newId(), upload: 'idle', jobs: [], sent: false, rdDone: false, err: '' };
    v.ed = createEditor(v, edCtx);
    v.ed.showEach(S.timeMode === 'each');
    $('editors').append(v.ed.el);
    S.videos.push(v);
    readMeta(v);
    v.ed.kindInfo(); v.ed.renderUpload();
    select(v);
  }
  if (bad.length) toast('沒有加入：' + bad.join('、'));
  syncRd();
  renderQueue();
  sync();
}
// 長寬與長度：讀到後重判類型（只在沒手動改過、還沒開始上傳時）
function readMeta(v) {
  const pv = v.ed.el.querySelector('.pv');
  pv.addEventListener('loadedmetadata', () => {
    v.width = pv.videoWidth; v.height = pv.videoHeight; v.duration = pv.duration;
    const k = autoKind(v.name, v.width, v.height);
    if (!v.kindManual && k !== v.kind && !v.jobs.length) v.kind = k;
    v.ed.setMeta(); v.ed.kindInfo(); renderQueue();
    if (!v.jobs.length) sync();
  }, { once: true });
}

const edCtx = {
  settings: () => S.settings,
  presets: () => S.presets,
  pageName,
  changed: () => renderQueue(),
  // 切換類型：上傳中擋；已開始上傳（還沒送出）就停掉舊的、用新類型重傳
  setKind(v, k) {
    if (v.sent) return false;
    if (isUploading(v)) { toast('影片上傳中，等上傳完成才能切換類型（或先按「停止上傳」）'); return false; }
    v.kind = k; v.kindManual = true;
    restartUpload(v, true);
    v.ed.kindInfo(); renderQueue();
    return true;
  },
  restart: (v) => restartUpload(v, false)
};
async function restartUpload(v, quiet) {
  if (v.jobs.length && !v.sent) { try { await tb.api.call('/fb/video/stop', { method: 'POST', body: { uploadId: v.uploadId } }); } catch { /* 沒 finish 就不會發布 */ } }
  v.uploadId = newId(); v.jobs = []; v.upload = 'idle'; v.err = ''; v.stopReq = false;
  v.ed.renderUpload(); renderQueue();
  if (!quiet) toast('重新上傳：' + v.name);
  sync();
}

// ===== 影片列表（下拉） =====
function select(v) {
  S.cur = v;
  for (const x of S.videos) x.ed.el.hidden = x !== v;
  renderQueue();
}
function renderQueue() {
  const list = $('vqList'); list.textContent = '';
  $('vq').hidden = !S.videos.length;
  $('emptyHint').hidden = !!S.videos.length;
  S.videos.forEach((v, i) => {
    const li = document.createElement('li'); li.className = 'vq-item' + (v === S.cur ? ' is-cur' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = v.checked; cb.disabled = v.sent; cb.setAttribute('aria-label', '送出這支：' + v.name);
    cb.addEventListener('change', () => {
      if (!cb.checked && isUploading(v)) { cb.checked = true; toast('影片上傳中，等上傳完成才能取消勾選（或先按「停止上傳」）'); return; }
      v.checked = cb.checked; v.ed.renderUpload(); renderQueue(); sync();
    });
    const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'vq-pick';
    const nm = document.createElement('span'); nm.className = 'vq-name'; nm.textContent = `${i + 1}. ${v.ed.titleText() || v.name}`;
    const meta = document.createElement('span'); meta.className = 'vq-meta';
    meta.textContent = [v.kind === 'reel' ? 'Reels' : '橫式', sizeText(v.size), queueState(v)].filter(Boolean).join('．');
    pick.append(nm, meta);
    pick.addEventListener('click', () => { select(v); $('vq').open = false; });
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'vq-rm'; rm.textContent = '移除'; rm.setAttribute('aria-label', '移除 ' + v.name);
    rm.addEventListener('click', () => removeVideo(v));
    li.append(cb, pick, rm);
    list.append(li);
  });
  const cur = S.cur ? S.videos.indexOf(S.cur) + 1 : 0;
  $('vqSum').textContent = S.videos.length ? `影片 ${S.videos.length} 支（勾選 ${S.videos.filter((v) => v.checked).length}）・目前第 ${cur} 支：${S.cur ? (S.cur.ed.titleText() || S.cur.name) : ''}` : '影片';
  updateFoot();
}
function queueState(v) {
  if (v.sent) {
    const st = [...new Set(v.jobs.filter((j) => j.sent).map((j) => STATE_TEXT[j.state] || j.state))];
    return st.join('／');
  }
  if (v.upload === 'stopped') return '已停止';
  if (v.upload === 'error') return '上傳失敗';
  if (isUploading(v)) { const j = v.jobs.find((x) => x.state === 'uploading'); return `上傳中 ${Math.floor((j.uploaded / v.size) * 100)}%`; }
  if (v.jobs.some((j) => j.state === 'uploaded')) return '已上傳';
  return '';
}
async function removeVideo(v) {
  if (isUploading(v)) { toast('影片上傳中，等上傳完成才能移除（或先按「停止上傳」）'); return; }
  if (v.jobs.length && !v.sent) { try { await tb.api.call('/fb/video/stop', { method: 'POST', body: { uploadId: v.uploadId } }); } catch { /* 沒送出就不會發布 */ } }
  const i = S.videos.indexOf(v);
  S.videos.splice(i, 1);
  v.ed.el.remove();
  URL.revokeObjectURL(v.url);
  if (S.cur === v) S.cur = null;
  if (!S.cur && S.videos.length) select(S.videos[Math.min(i, S.videos.length - 1)]);
  renderQueue();
  updateBusy();
}

// ===== 上傳 =====
function apply(v, r) {
  if (!r || !Array.isArray(r.jobs)) return r;
  v.jobs = r.jobs;
  v.ed.renderUpload();
  renderQueue();
  updateBusy();
  if (v.sent) maybeRd(v);
  return r;
}
// 開工作階段（便宜，全部影片一起）；分段上傳一次一支
async function ensureStarted(v) {
  const pages = wantPages(v).filter((p) => !v.jobs.some((j) => j.page === p && !['stopped', 'failed', 'canceled'].includes(j.state)));
  if (!pages.length || v.upload === 'stopped' || v.upload === 'error' || v.sent || v.starting) return;
  v.starting = true;
  try {
    const r = await tb.api.call('/fb/video/start', { method: 'POST', body: { uploadId: v.uploadId, name: v.name, size: v.size, kind: v.kind, pages } });
    apply(v, r);
    v.next = r.next;
  } catch (e) {
    v.upload = 'error'; v.err = errText(e); v.ed.renderUpload(); renderQueue();
  } finally { v.starting = false; }
}
let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const v = S.videos.find((x) => x.next && x.upload !== 'stopped' && x.upload !== 'error' && isUploading(x));
      if (!v) break;
      v.upload = 'uploading';
      while (v.next && !v.stopReq) {
        const { start, end } = v.next;
        try {
          const r = await tb.api.call(`/fb/video/chunk?u=${v.uploadId}&start=${start}`, { method: 'POST', body: v.file.slice(start, end), binary: true });
          v.next = r.next;
          apply(v, r);
        } catch (e) {
          v.upload = 'error'; v.err = errText(e); v.next = null; v.ed.renderUpload(); renderQueue();
        }
      }
      if (v.upload === 'uploading') v.upload = 'idle';
    }
  } finally { pumping = false; updateBusy(); }
}
async function sync() {
  await Promise.all(S.videos.filter((v) => v.checked).map(ensureStarted));
  pump();
  updateFoot();
}

// 停止上傳：上傳中的全部停（已送出但還沒傳完的也會停，不會發布）
$('stopBtn').addEventListener('click', async () => {
  const list = S.videos.filter(isUploading);
  if (!list.length) return;
  const sentOnes = list.filter((v) => v.sent).length;
  const ok = await confirmBox('停止上傳？', `會停止 ${list.length} 支影片的上傳${sentOnes ? `（其中 ${sentOnes} 支已按送出，停止後不會發布）` : ''}。影片與文字會留著，可以按「重新上傳」。`, '停止上傳');
  if (!ok) return;
  for (const v of list) {
    v.stopReq = true; v.next = null;
    try { apply(v, await tb.api.call('/fb/video/stop', { method: 'POST', body: { uploadId: v.uploadId } })); } catch { /* 忽略 */ }
    v.upload = 'stopped'; v.ed.renderUpload();
  }
  renderQueue(); updateBusy();
});

function updateBusy() {
  const busy = anyUploading();
  tb.busy(busy ? BUSY_MSG : null);
  $('stopBtn').hidden = !busy;
}

// ===== 送出 =====
function updateFoot() {
  const n = S.videos.filter((v) => v.checked && !v.sent).length;
  $('sendBtn').disabled = !n || !S.pageSel.size;
  $('sendBtn').textContent = n > 1 ? `全部送出（${n} 支）` : '全部送出';
  $('footMsg').textContent = !S.pageSel.size ? '請選粉專' : !n ? '' : `${n} 支影片 × ${S.pageSel.size} 個粉專`;
}
$('sendBtn').addEventListener('click', async () => {
  const list = S.videos.filter((v) => v.checked && !v.sent);
  if (!list.length || !S.pageSel.size) return;
  const forms = [];
  for (const v of list) {
    const c = v.ed.collect();
    const label = `第 ${S.videos.indexOf(v) + 1} 支（${v.ed.titleText() || v.name}）`;
    if (c.error) { select(v); toast(label + '：' + c.error); return; }
    const w = (S.timeMode === 'all' ? allWhen : v.ed.time).get(v.kind);
    if (w.error) { select(v); toast(label + '：' + w.error); return; }
    if (v.upload === 'stopped' || v.upload === 'error') { select(v); toast(label + '：上傳已停止或失敗，請按「重新上傳」'); return; }
    forms.push({ v, body: { uploadId: v.uploadId, title: c.title, description: c.description, at: w.at, comments: c.comments } });
  }
  $('sendBtn').disabled = true;
  await sync();   // 確保每支都開好工作階段
  for (const { v, body } of forms) {
    if (!v.jobs.length) { toast(`「${v.name}」還沒開始上傳，沒有送出`); continue; }
    try {
      const r = await tb.api.call('/fb/video/publish', { method: 'POST', body });
      v.sent = true; v.sentAt = Date.now(); v.at = body.at;
      v.ed.lock();
      apply(v, r);
    } catch (e) { select(v); toast(`「${v.ed.titleText()}」送出失敗：${errText(e)}`); }
  }
  renderQueue();
  poll();
});

// 送出後追蹤：處理中的每 6 秒問一次，最多 15 分鐘
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  const until = Date.now() + 15 * 60000;
  try {
    while (Date.now() < until) {
      const list = S.videos.filter((v) => v.sent && v.jobs.some((j) => j.sent && ['processing', 'finishing'].includes(j.state)));
      if (!list.length && !S.videos.some((v) => v.sent && isUploading(v))) break;
      await new Promise((r) => setTimeout(r, 6000));
      for (const v of list) { try { apply(v, await tb.api.call('/fb/video/status?u=' + v.uploadId)); } catch { /* 下次再問 */ } }
    }
  } finally { polling = false; }
}

// RD：每支影片等所有已送出的粉專都有結果才寫一次；成功（處理中／已排程／已發布）的粉專有 RD 區段才寫
const OK_STATES = ['processing', 'scheduled', 'published'];
async function maybeRd(v) {
  if (v.rdDone || !$('rdOn').checked) return;
  const sent = v.jobs.filter((j) => j.sent);
  if (!sent.length || sent.some((j) => ['uploading', 'uploaded', 'finishing'].includes(j.state))) return;
  v.rdDone = true;
  const slug = v.ed.slugText();
  if (!slug) { toast(`「${v.ed.titleText()}」沒有 SLUG，RD 未寫入`); return; }
  const ms = v.at ? v.at * 1000 : v.sentAt;
  const entries = [];
  for (const j of sent) {
    const p = S.pages.find((x) => x.id === j.page);
    if (!OK_STATES.includes(j.state) || !p || !p.rd) continue;
    const e = { page: p.rd, date: dateStr(ms), time: timeStr(ms), text: rdText(v.kind, slug), style: 'video' };
    if (!entries.some((x) => x.page === e.page)) entries.push(e);
  }
  if (!entries.length) return;
  try {
    const d = await tb.api.call('/rundown', { method: 'POST', body: { entries } });
    const bad = (d.results || []).filter((x) => !x.ok);
    toast(bad.length ? `RD 部分失敗，請手動貼「${rdText(v.kind, slug)}」` : `RD 已寫入：${rdText(v.kind, slug)}`);
  } catch (e) { toast(`RD 寫入失敗（${errText(e)}），請手動貼「${rdText(v.kind, slug)}」`); }
}

// ===== 送出紀錄 =====
let logLoaded = false;
async function loadLog() {
  logLoaded = true;
  const b = $('logReload'); b.disabled = true;
  $('logHint').textContent = '讀取中…';
  try {
    const jobs = await tb.api.call('/fb/video/jobs');
    const groups = new Map();
    for (const j of jobs) { if (!groups.has(j.uploadId)) groups.set(j.uploadId, []); groups.get(j.uploadId).push(j); }
    const ul = $('logList'); ul.textContent = '';
    for (const list of groups.values()) {
      const j0 = list[0];
      const li = document.createElement('li');
      const h = document.createElement('div'); h.className = 'log-title'; h.textContent = j0.title || j0.name;
      const m = document.createElement('div'); m.className = 'hint';
      m.textContent = [j0.kind === 'reel' ? 'Reels' : '橫式影片', '送出 ' + fmt(j0.created), j0.at ? '排程 ' + fmt(j0.at * 1000) : '立即'].join('．');
      const st = document.createElement('div'); st.className = 'log-pages';
      for (const j of list) { const s = document.createElement('span'); s.className = 'job s-' + j.state; s.textContent = `${pageName(j.page)}：${STATE_TEXT[j.state] || j.state}${j.error ? '（' + j.error + '）' : ''}`; st.append(s); }
      li.append(h, m, st);
      ul.append(li);
    }
    $('logHint').textContent = groups.size ? `最近 7 天 ${groups.size} 支影片` : '最近 7 天沒有送出的影片';
  } catch (e) { $('logHint').textContent = '讀取失敗：' + errText(e); }
  finally { b.disabled = false; }
}
$('logReload').addEventListener('click', loadLog);
updateFoot();
