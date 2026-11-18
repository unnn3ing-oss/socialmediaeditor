// 影片發布（測試版，只給管理員）：多支影片，每支各自選粉專與立即／排程。
//   左 1/3 影片列表（縮圖左、標題右），右 2/3 選中影片的內容（editor.js）。
//   影片勾了粉專就在背景上傳（每支只傳一次，後端轉給各粉專，見 server/fb/video.js）；上傳時可以繼續填文案。
//   按「全部送出」把文案交給後端：已傳完的馬上發布，還沒傳完的等最後一段傳完由後端發布。
//   上傳中：取消勾粉專、移除／取消勾影片、切換類型都擋下；關分頁先確認（tb.busy）；可手動「停止上傳」。
// 工具內切換一律用 hidden，不重建畫面。
import { tb } from '../../sdk/toolbox.js';
import { autoKind, rdText } from './rules.js';
import { createEditor, STATE_TEXT } from './editor.js';
import { $, errText, toast, confirmBox, newId, sizeText, durText, dateStr, timeStr, fmt } from './util.js';

tb.init('fbvideo');

const RD_KEY = 'tbx.fbvideo.rd';
const MAX_SIZE = 10 * 1024 * 1024 * 1024;
const BUSY_MSG = '影片上傳中，離開會中斷上傳。';
const S = {
  pages: [], settings: { prefixes: [], suffixes: [], reelsTag: '#焦點新聞影音都在TVBS', tags: [] }, presets: [],
  videos: [], cur: null, canPost: true
};
const pageName = (id) => (S.pages.find((p) => p.id === id) || {}).short || id;
const wantPages = (v) => (v.checked ? v.ed.selected() : []);
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
  S.videos.forEach((v) => v.ed.renderPages());
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

// ===== RD 開關 =====
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
    const v = { id: newId(), file: f, url: URL.createObjectURL(f), name: f.name, size: f.size, width: 0, height: 0, duration: NaN, thumb: '',
      kind: autoKind(f.name, 0, 0), kindManual: false, checked: true, uploadId: newId(), upload: 'idle', jobs: [], sent: false, rdDone: false, err: '' };
    v.ed = createEditor(v, edCtx);
    v.ed.renderPages();
    $('editors').append(v.ed.el);
    S.videos.push(v);
    v.metaP = readMeta(v);
    v.ed.kindInfo(); v.ed.renderUpload();
    select(v);
  }
  if (bad.length) toast('沒有加入：' + bad.join('、'));
  syncRd();
  renderQueue();
}

// 長寬、長度、縮圖：用不放進畫面的 <video> 讀；讀到後重判類型（沒手動改過、還沒開始上傳時）
// 回傳 Promise：讀到（或讀不到、逾時 4 秒）才 resolve；開始上傳前要等它，類型才不會在上傳後才被改判
function readMeta(v) {
  const pv = document.createElement('video');
  pv.muted = true; pv.preload = 'metadata'; pv.playsInline = true; pv.src = v.url;
  const settled = new Promise((res) => { pv.addEventListener('loadedmetadata', res, { once: true }); pv.addEventListener('error', res, { once: true }); setTimeout(res, 4000); });
  pv.addEventListener('loadedmetadata', () => {
    v.width = pv.videoWidth; v.height = pv.videoHeight; v.duration = pv.duration;
    const k = autoKind(v.name, v.width, v.height);
    if (!v.kindManual && k !== v.kind && !v.jobs.length) v.kind = k;
    v.ed.setMeta(); v.ed.kindInfo(); renderQueue();
    try { pv.currentTime = Math.min(1, (pv.duration || 0) / 3); } catch { /* 不能跳就用第一格 */ }
  }, { once: true });
  pv.addEventListener('seeked', () => {
    try {
      const w = 224, h = Math.max(1, Math.round((w * (pv.videoHeight || 9)) / (pv.videoWidth || 16)));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(pv, 0, 0, w, h);
      v.thumb = c.toDataURL('image/jpeg', 0.7);
    } catch { v.thumb = ''; }
    pv.removeAttribute('src'); pv.load();
    renderQueue();
  }, { once: true });
  return settled;
}

const edCtx = {
  settings: () => S.settings,
  presets: () => S.presets,
  pages: () => S.pages,
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
  canUncheck(v) {
    if (isUploading(v)) { toast('影片上傳中，等上傳完成才能取消粉專（或先按「停止上傳」）'); return false; }
    return true;
  },
  async pagesChanged(v, page, on) {
    if (!on) await dropPage(v, page);
    sync();
  },
  applyAll(v) {
    const list = v.ed.getPages();
    const want = new Set(list.map((x) => x.page));
    const skipped = [];
    for (const o of S.videos) {
      if (o === v || o.sent) continue;
      const removing = o.ed.selected().filter((p) => !want.has(p));
      if (removing.length && isUploading(o)) { skipped.push(o.ed.titleText() || o.name); continue; }
      o.ed.setPages(list);
      for (const p of removing) dropPage(o, p);
    }
    toast(skipped.length ? `已套用；上傳中沒套用：${skipped.join('、')}` : '已套用到全部影片');
    sync();
  },
  restart: (v) => restartUpload(v, false)
};
// 已上傳但還沒送出的粉專：取消它的工作階段
async function dropPage(v, page) {
  if (v.sent || !v.jobs.some((j) => j.page === page && ['uploaded', 'uploading'].includes(j.state))) return;
  try { apply(v, await tb.api.call('/fb/video/drop', { method: 'POST', body: { uploadId: v.uploadId, page } })); } catch { /* 沒送出就不會發布 */ }
}
// 重新上傳：停掉舊的、換新的 uploadId；已送出的，開好工作階段後自動用已送出的內容發布
async function restartUpload(v, quiet) {
  if (v.jobs.length) { try { await tb.api.call('/fb/video/stop', { method: 'POST', body: { uploadId: v.uploadId } }); } catch { /* 沒 finish 就不會發布 */ } }
  v.uploadId = newId(); v.jobs = []; v.upload = 'idle'; v.err = ''; v.stopReq = false; v.next = null;
  v.ed.renderUpload(); renderQueue();
  if (!quiet) toast('重新上傳：' + (v.ed.titleText() || v.name));
  if (!v.sent) { sync(); return; }
  try {
    const body = { ...v.sentBody, uploadId: v.uploadId };
    const r = await tb.api.call('/fb/video/start', { method: 'POST', body: { uploadId: v.uploadId, name: v.name, size: v.size, kind: v.kind, pages: body.pages.map((x) => x.page) } });
    v.next = r.next;
    apply(v, r);
    apply(v, await tb.api.call('/fb/video/publish', { method: 'POST', body }));
    v.sentBody = body; v.rdDone = false;
    pump(); poll();
  } catch (e) { v.upload = 'error'; v.err = errText(e); v.next = null; v.ed.renderUpload(); renderQueue(); }
}

// ===== 左欄影片列表 =====
function select(v) {
  S.cur = v;
  for (const x of S.videos) x.ed.el.hidden = x !== v;
  renderQueue();
}
function renderQueue() {
  const list = $('vqList'); list.textContent = '';
  $('emptyHint').hidden = !!S.videos.length;
  S.videos.forEach((v, i) => {
    const li = document.createElement('li'); li.className = 'vq-item' + (v === S.cur ? ' is-cur' : '');
    const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'vq-pick';
    pick.setAttribute('aria-current', String(v === S.cur));
    const th = document.createElement('span'); th.className = 'vq-thumb' + (v.height > v.width ? ' tall' : '');
    if (v.thumb) { const img = document.createElement('img'); img.src = v.thumb; img.alt = ''; th.append(img); }
    if (Number.isFinite(v.duration)) { const d = document.createElement('span'); d.className = 'vq-dur'; d.textContent = durText(v.duration); th.append(d); }
    const tx = document.createElement('span'); tx.className = 'vq-text';
    const nm = document.createElement('span'); nm.className = 'vq-name'; nm.textContent = v.ed.titleText() || v.name;
    const meta = document.createElement('span'); meta.className = 'vq-meta';
    const badge = document.createElement('span'); badge.className = 'badge' + (v.kind === 'reel' ? ' reel' : ''); badge.textContent = v.kind === 'reel' ? 'Reels' : '橫式';
    meta.append(badge, document.createTextNode(queueState(v)));
    tx.append(nm, meta);
    const pct = uploadPct(v);
    if (pct !== null) { const bar = document.createElement('span'); bar.className = 'vq-bar'; const f = document.createElement('i'); f.style.width = pct + '%'; bar.append(f); tx.append(bar); }
    pick.append(th, tx);
    pick.addEventListener('click', () => select(v));
    const side = document.createElement('span'); side.className = 'vq-side';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = v.checked; cb.disabled = v.sent; cb.setAttribute('aria-label', `送出第 ${i + 1} 支：${v.name}`);
    cb.addEventListener('change', () => {
      if (!cb.checked && isUploading(v)) { cb.checked = true; toast('影片上傳中，等上傳完成才能取消勾選（或先按「停止上傳」）'); return; }
      v.checked = cb.checked; v.ed.renderUpload(); renderQueue(); sync();
    });
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'vq-rm'; rm.textContent = '移除'; rm.setAttribute('aria-label', '移除 ' + v.name);
    rm.addEventListener('click', () => removeVideo(v));
    side.append(cb, rm);
    li.append(pick, side);
    list.append(li);
  });
  $('vqSum').textContent = `影片 ${S.videos.length} 支` + (S.videos.length ? `（勾選 ${S.videos.filter((v) => v.checked).length}）` : '');
  updateFoot();
}
function uploadPct(v) {
  const jobs = v.jobs.filter((j) => j.state !== 'canceled');
  if (!jobs.length) return null;
  return Math.floor((Math.min(...jobs.map((j) => (j.state === 'uploading' ? j.uploaded : j.size))) / Math.max(1, v.size)) * 100);
}
function queueState(v) {
  if (!v.checked && !v.sent) return '未勾選';
  if (v.upload === 'stopped') return '已停止';
  if (v.upload === 'error') return '上傳失敗';
  if (v.sent) return [...new Set(v.jobs.filter((j) => j.sent).map((j) => STATE_TEXT[j.state] || j.state))].join('／') || '已送出';
  if (isUploading(v)) return `上傳中 ${uploadPct(v)}%`;
  if (v.jobs.some((j) => j.state === 'uploaded')) return '已上傳';
  return v.ed.selected().length ? '' : '未選粉專';
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
    if (v.metaP) { await v.metaP; v.metaP = null; }
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
        const id = v.uploadId;
        try {
          const r = await tb.api.call(`/fb/video/chunk?u=${id}&start=${start}`, { method: 'POST', body: v.file.slice(start, end), binary: true });
          if (id !== v.uploadId) break;   // 途中重新上傳了
          v.next = r.next;
          apply(v, r);
        } catch (e) {
          if (id !== v.uploadId) break;   // 舊上傳的錯誤（已重新上傳），不要蓋掉新的狀態
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
  const ready = S.videos.filter((v) => v.checked && !v.sent);
  const n = ready.length;
  $('sendBtn').disabled = !n;
  $('sendBtn').textContent = n > 1 ? `全部送出（${n} 支）` : '全部送出';
  const up = S.videos.filter(isUploading);
  const parts = [];
  if (n) parts.push(`${n} 支影片待送出`);
  if (up.length) parts.push(`上傳中 ${up.length} 支`);
  $('footMsg').textContent = parts.join('・');
}
$('sendBtn').addEventListener('click', async () => {
  const list = S.videos.filter((v) => v.checked && !v.sent);
  if (!list.length) return;
  const forms = [];
  for (const v of list) {
    const label = `第 ${S.videos.indexOf(v) + 1} 支（${v.ed.titleText() || v.name}）`;
    const c = v.ed.collect();
    if (c.error) { select(v); toast(label + '：' + c.error); return; }
    const p = v.ed.pagesForSend();
    if (p.error) { select(v); v.ed.el.querySelector('.pg-dd').open = true; toast(label + '：' + p.error); return; }
    if (v.upload === 'stopped' || v.upload === 'error') { select(v); toast(label + '：上傳已停止或失敗，請按「重新上傳」'); return; }
    forms.push({ v, body: { uploadId: v.uploadId, title: c.title, description: c.description, comments: c.comments, pages: p.pages } });
  }
  $('sendBtn').disabled = true;
  await sync();   // 確保每支都開好工作階段
  for (const { v, body } of forms) {
    if (!v.jobs.length) { toast(`「${v.name}」還沒開始上傳，沒有送出`); continue; }
    body.uploadId = v.uploadId;
    try {
      const r = await tb.api.call('/fb/video/publish', { method: 'POST', body });
      v.sent = true; v.sentAt = Date.now(); v.sentBody = body;
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

// RD：每支影片等所有已送出的粉專都有結果才寫一次；成功的粉專有 RD 區段才寫
// 時間：排程的粉專＝排程時間；立即＝按送出當下
const OK_STATES = ['processing', 'scheduled', 'published'];
async function maybeRd(v) {
  if (v.rdDone || !$('rdOn').checked) return;
  const sent = v.jobs.filter((j) => j.sent);
  if (!sent.length || sent.some((j) => ['uploading', 'uploaded', 'finishing'].includes(j.state))) return;
  v.rdDone = true;
  const slug = v.ed.slugText();
  if (!slug) { toast(`「${v.ed.titleText()}」沒有 SLUG，RD 未寫入`); return; }
  const entries = [];
  for (const j of sent) {
    const p = S.pages.find((x) => x.id === j.page);
    if (!OK_STATES.includes(j.state) || !p || !p.rd) continue;
    const at = ((v.sentBody && v.sentBody.pages) || []).find((x) => x.page === j.page);
    const ms = at && at.at ? at.at * 1000 : v.sentAt;
    const e = { page: p.rd, date: dateStr(ms), time: timeStr(ms), text: rdText(v.kind, slug), style: 'video' };
    if (!entries.some((x) => x.page === e.page && x.time === e.time && x.date === e.date)) entries.push(e);
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
      m.textContent = [j0.kind === 'reel' ? 'Reels' : '橫式影片', '送出 ' + fmt(j0.created), sizeText(j0.size)].join('．');
      const st = document.createElement('div'); st.className = 'log-pages';
      for (const j of list) {
        const s = document.createElement('span'); s.className = 'job s-' + j.state;
        s.textContent = `${pageName(j.page)}：${STATE_TEXT[j.state] || j.state}${j.at ? ' ' + fmt(j.at * 1000) : ''}${j.error ? '（' + j.error + '）' : ''}`;
        st.append(s);
      }
      li.append(h, m, st);
      ul.append(li);
    }
    $('logHint').textContent = groups.size ? `最近 7 天 ${groups.size} 支影片` : '最近 7 天沒有送出的影片';
  } catch (e) { $('logHint').textContent = '讀取失敗：' + errText(e); }
  finally { b.disabled = false; }
}
$('logReload').addEventListener('click', loadLog);
updateFoot();
