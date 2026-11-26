// 影片發布（測試版，只給管理員）：多支影片，每支各自選粉專與立即／排程。
//   左 1/3 影片列表（縮圖左、標題右），右 2/3 選中影片的內容（editor.js）。
//   影片勾了粉專就在背景上傳（每支只傳一次，後端轉給各粉專，見 server/fb/video.js）；上傳時可以繼續填文案。
//   按「全部送出」把文案交給後端：已傳完的馬上發布，還沒傳完的等最後一段傳完由後端發布。
//   上傳中：取消勾粉專、移除／取消勾影片、切換類型都擋下；關分頁先確認（tb.busy）；可手動「停止上傳」。
// 工具內切換一律用 hidden，不重建畫面。
import { tb } from '../../sdk/toolbox.js';
import { autoKind, rdText, rdTextQ, routeOf } from './rules.js';
import { createEditor, STATE_TEXT, CROSS_TEXT } from './editor.js';
import { pickCover } from './cover.js';
import { $, errText, toast, confirmBox, newId, sizeText, durText, dateStr, timeStr, fmt } from './util.js';
import * as fx from '../../ui/fx.js';
import { fbPostUrl } from '../../shell/notices.js';

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
// 骨架收掉：ok＝能用（顯示內容），否則顯示停用卡片
const booted = (ok) => { $('bootSk').hidden = true; if (!ok) $('offMain').hidden = false; };
(async () => {
  let st;
  try { st = await tb.api.call('/auth/status'); } catch { booted(false); return; }
  if (!st || !st.company) { booted(false); return; }
  let pages;
  try { pages = await tb.api.call('/fb/pages'); } catch (e) {
    if (e && e.code === 'fb_need_staff') { $('needStaff').hidden = false; $('needStaffBtn').onclick = () => tb.company.login(); booted(false); return; }
    const why = e && e.code === 'fb_forbidden' ? ((e.detail && e.detail.reason) || '') : errText(e);
    if (why) { $('offReason').textContent = '原因：' + why; $('offReason').hidden = false; }
    booted(false); return;
  }
  // 權限：影片發布用 vview（檢視）／vpost（上傳發布）；系統管理者（me.admin）＝全部；/fb/me 讀不到先放行，後端仍會擋
  let me0 = null;
  try { me0 = await tb.api.call('/fb/me'); } catch { me0 = null; }
  const perms0 = me0 ? (me0.admin ? ['vview', 'vpost'] : (me0.perms || [])) : null;
  if (perms0 && !perms0.includes('vview')) {
    $('offTitle').textContent = '影片發布 沒有權限'; $('offDesc').textContent = '你的權限組沒有「檢視影片發布」，請找管理者。';
    booted(false); return;
  }
  booted(true);
  $('app').hidden = false;
  S.pages = [...pages].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  $('pagesState').textContent = `已連線 ${S.pages.length} 個粉專`;
  S.videos.forEach((v) => v.ed.renderPages());
  tb.api.call('/fb/access').then((a) => { if (a && a.mode === 'company') for (const el of document.querySelectorAll('.test-pill')) el.hidden = true; }).catch(() => {});
  tb.api.call('/fb/me').then((me) => {
    if (!me) return;
    const perms = me.admin ? ['vview', 'vpost'] : (me.perms || []);
    S.canPost = perms.includes('vpost');
    $('sendBtn').hidden = !S.canPost;
    const who = me.admin ? '管理員' : [me.name, me.group].filter(Boolean).join('．');
    if (who) { $('whoAmI').textContent = who; $('whoAmI').hidden = false; }
    if (me.tokenWarn && me.tokenWarn.text) { const w = $('tokWarn'); w.textContent = me.tokenWarn.text; w.classList.toggle('bad', me.tokenWarn.level === 'bad'); w.hidden = false; }
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
    v.fxIn = true;   // 左側列表第一次畫出來時滑入
    S.videos.push(v);
    v.metaP = readMeta(v);
    v.metaP.finally(() => { v.metaDone = true; renderQueue(); });   // 讀到縮圖前左側縮圖顯示骨架
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
  toast,
  // 多文目標：只列網站顯示的粉專（free＝還能選的）；回陣列，取消回 null
  pickCross(v, src, cur, free) {
    return new Promise((res) => {
      const d = $('crossDlg'), ul = $('crossList');
      $('crossHint').textContent = `${pageName(src)} 發布後，把同一支影片多文到下面勾選的粉專（不重新上傳、不留言）。粉專之間要先在 Meta Business Suite 開好多文權限。`;
      ul.textContent = '';
      const ids = S.pages.map((p) => p.id).filter((id) => free.includes(id) || cur.includes(id));
      for (const id of ids) {
        const li = document.createElement('li'); const lab = document.createElement('label');
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = id; cb.checked = cur.includes(id);
        lab.append(cb, document.createTextNode(pageName(id))); li.append(lab); ul.append(li);
      }
      if (!ids.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = '沒有可以多文的粉專（其他粉專都已經直接上傳）'; ul.append(li); }
      let done = false;
      // close 事件是非同步的：上一次關掉的 close 可能在這次打開後才到，所以 dialog 還開著就不理它
      const onClose = () => { if (!d.open) finish(null); };
      const finish = (val) => { if (done) return; done = true; d.removeEventListener('close', onClose); if (d.open) d.close(); res(val); };
      $('crossOk').onclick = () => finish([...ul.querySelectorAll('input:checked')].map((x) => x.value));
      $('crossCancel').onclick = () => finish(null);
      d.addEventListener('close', onClose);
      d.showModal();
      const first = ul.querySelector('input'); if (first) first.focus();
    });
  },
  changed: () => { renderQueue(); if (S.cur) S.cur.ed.renderUpload(); },
  isCurrent: (v) => S.cur === v,
  indexOf: (v) => S.videos.indexOf(v),
  async pickCover(v) {
    if (v.sent) return;
    const r = await pickCover(v);
    if (r === null) return;
    if (v.cover) URL.revokeObjectURL(v.cover.url);
    v.cover = r === 'auto' ? null : r;
    v.ed.renderCover(); renderQueue();
    fx.flash(v.ed.el.querySelector('.cover-img'));
  },
  // 手動上傳的封面圖
  setCover(v, c) {
    if (v.sent) return;
    if (v.cover) URL.revokeObjectURL(v.cover.url);
    v.cover = c;
    v.ed.renderCover(); renderQueue();
    fx.flash(v.ed.el.querySelector('.cover-img'));
  },
  toast,
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
    toast(skipped.length ? `已套用；上傳中沒套用：${skipped.join('、')}` : '已套用發布方式到全部影片');
    sync();
  },
  restart: (v) => restartUpload(v, false),
  footChanged: () => renderFoot()
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
    const r = await tb.api.call('/fb/video/start', { method: 'POST', body: { uploadId: v.uploadId, name: v.name, size: v.size, kind: routeOf(v.kind, v.duration), pages: body.pages.map((x) => x.page) } });
    v.next = r.next;
    apply(v, r);
    await sendCover(v);
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
  if (v) { v.ed.renderUpload(); v.ed.openPicker(); }
  renderFoot();
}
// 底部只放總進度一行：「上傳中 42%・已上傳 1／3 支」；各粉專細節在每支影片自己的編輯區
function renderFoot() {
  const list = S.videos.filter((v) => (v.checked || v.sent) && v.jobs.some((j) => j.state !== 'canceled'));
  const fill = $('stFill'), text = $('stText');
  let total = 0, done = 0, ok = 0, bad = 0;
  for (const v of list) {
    const jobs = v.jobs.filter((j) => j.state !== 'canceled');
    const live = jobs.filter((j) => !['failed', 'unknown', 'stopped'].includes(j.state));
    total += v.size;
    done += live.length ? Math.min(...live.map((j) => (j.state === 'uploading' ? j.uploaded : j.size))) : 0;
    if (v.upload === 'error' || v.upload === 'stopped' || live.length < jobs.length) bad++;
    else if (!jobs.some((j) => j.state === 'uploading')) ok++;
  }
  const pct = total ? Math.floor((done / total) * 100) : 0;
  const up = S.videos.filter(isUploading).length;
  let msg = '';
  if (up) msg = `上傳中 ${pct}%・已上傳 ${ok}／${list.length} 支`;
  else if (list.length) msg = ok === list.length ? `上傳完成 ${ok}／${list.length} 支` : `已上傳 ${ok}／${list.length} 支`;
  if (bad) msg += `・${bad} 支失敗或停止（看左側列表）`;
  fill.style.width = (list.length ? pct : 0) + '%';
  text.textContent = msg; text.title = msg;
  text.classList.toggle('bad', !!bad);
}
// 封面：先傳到後端暫存（發布成功後由後端換到各粉專的影片）；失敗不擋送出
async function sendCover(v) {
  if (!v.cover) return;
  try { await tb.api.call('/fb/video/cover?u=' + v.uploadId, { method: 'POST', body: v.cover.blob, binary: true }); }
  catch (e) { toast(`「${v.ed.titleText()}」封面沒有送出（${errText(e)}），會用臉書自動封面`); }
}
function renderQueue() {
  const list = $('vqList'); list.textContent = '';
  $('emptyHint').hidden = !!S.videos.length;
  S.videos.forEach((v, i) => {
    if (v.removing && v.li && v.li.classList.contains('fx-gone')) { list.append(v.li); return; }   // 收合中：沿用正在收合的那一列，不重畫成完整高度
    const li = document.createElement('li'); li.className = 'vq-item' + (v === S.cur ? ' is-cur' : '') + (v.fxIn ? ' fx-enter' : '');
    v.fxIn = false; v.li = li;
    const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'vq-pick';
    pick.setAttribute('aria-current', String(v === S.cur));
    const th = document.createElement('span'); th.className = 'vq-thumb' + (v.height > v.width ? ' tall' : '');
    const src = v.cover ? v.cover.url : v.thumb;
    if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; th.append(img); }
    else if (!v.metaDone) th.classList.add('fx-sk');
    if (Number.isFinite(v.duration)) { const d = document.createElement('span'); d.className = 'vq-dur'; d.textContent = durText(v.duration); th.append(d); }
    const tx = document.createElement('span'); tx.className = 'vq-text';
    const nm = document.createElement('span'); nm.className = 'vq-name'; nm.textContent = v.ed.titleText() || v.name;
    const meta = document.createElement('span'); meta.className = 'vq-meta';
    const badge = document.createElement('span'); badge.className = 'badge' + (v.kind === 'reel' ? ' reel' : ''); badge.textContent = v.kind === 'reel' ? 'Reels' : '橫式';
    meta.append(badge, document.createTextNode(queueState(v)));
    const file = document.createElement('span'); file.className = 'vq-file';
    file.textContent = [v.name, sizeText(v.size), v.width ? `${v.width}×${v.height}` : ''].filter(Boolean).join('．');
    tx.append(nm, file, meta);
    const errs = v.jobs.filter((j) => ['failed', 'unknown'].includes(j.state)).map((j) => `${pageName(j.page)}：${j.error || STATE_TEXT[j.state]}`);
    if (v.upload === 'error' && v.err) errs.unshift(v.err);
    if (errs.length) { const er = document.createElement('span'); er.className = 'vq-err'; er.textContent = errs[0] + (errs.length > 1 ? `（另 ${errs.length - 1} 項）` : ''); er.title = errs.join('\n'); tx.append(er); }
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
  if (isUploading(v)) { if (v.li) fx.shake(v.li); toast('影片上傳中，等上傳完成才能移除（或先按「停止上傳」）'); return; }
  if (v.removing) return;
  v.removing = true;
  if (v.li) { const rm = v.li.querySelector('.vq-rm'); if (rm) { rm.disabled = true; rm.textContent = '移除中'; } }
  if (v.jobs.length && !v.sent) { try { await tb.api.call('/fb/video/stop', { method: 'POST', body: { uploadId: v.uploadId } }); } catch { /* 沒送出就不會發布 */ } }
  await fx.collapse(v.li);   // 那一列收合後才拿掉
  const i = S.videos.indexOf(v);
  S.videos.splice(i, 1);
  v.ed.el.remove();
  URL.revokeObjectURL(v.url);
  if (v.cover) URL.revokeObjectURL(v.cover.url);
  if (S.cur === v) S.cur = null;
  if (!S.cur && S.videos.length) select(S.videos[Math.min(i, S.videos.length - 1)]);
  if (!S.videos.length) renderFoot();
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
    const r = await tb.api.call('/fb/video/start', { method: 'POST', body: { uploadId: v.uploadId, name: v.name, size: v.size, kind: routeOf(v.kind, v.duration), pages } });
    apply(v, r);
    v.next = r.next;
  } catch (e) {
    v.upload = 'error'; v.err = errText(e); v.ed.renderUpload(); renderQueue();
  } finally { v.starting = false; }
}
// 同時上傳 PARALLEL 支影片；每支一段一段傳（臉書要依 offset 順序）
// 單段遇到連線／HTTP 錯誤自動重試 CHUNK_RETRY 次（間隔 2、4 秒）；後端回的粉專失敗不在這裡重試（後端已試過）
const PARALLEL = 2, CHUNK_RETRY = 2;
let pumpers = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 已要求停止的不再撿（停止請求還在路上時，最後一段剛好傳完會帶回 next；不擋會在 pump 裡無限撿起又立刻結束，整頁卡死）
const pumpable = (x) => x.next && !x.pumping && !x.stopReq && x.upload !== 'stopped' && x.upload !== 'error' && isUploading(x);
async function sendChunk(v, id, start, end) {
  for (let i = 0; ; i++) {
    try { return await tb.api.call(`/fb/video/chunk?u=${id}&start=${start}`, { method: 'POST', body: v.file.slice(start, end), binary: true }); }
    catch (e) {
      // 權限／驗證類錯誤重試也沒用
      if (i >= CHUNK_RETRY || id !== v.uploadId || v.stopReq || (e && ['unauthorized', 'forbidden', 'bad_request', 'not_found', 'too_large', 'unsupported'].includes(e.code))) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}
async function pumpOne(v) {
  v.pumping = true; v.upload = 'uploading';
  try {
    while (v.next && !v.stopReq) {
      const { start, end } = v.next;
      const id = v.uploadId;
      try {
        const r = await sendChunk(v, id, start, end);
        if (id !== v.uploadId) break;   // 途中重新上傳了
        if (v.stopReq) { v.next = null; break; }   // 傳的時候按了停止：不再接下一段
        v.next = r.next;
        apply(v, r);
      } catch (e) {
        if (id !== v.uploadId) break;   // 舊上傳的錯誤（已重新上傳），不要蓋掉新的狀態
        v.upload = 'error'; v.err = `${Math.floor(start / 1048576)}MB 處上傳失敗：${errText(e)}`; v.next = null; v.ed.renderUpload(); renderQueue();
      }
    }
  } finally {
    v.pumping = false;
    if (v.upload === 'uploading') v.upload = 'idle';
  }
}
function pump() {
  while (pumpers < PARALLEL) {
    const v = S.videos.find(pumpable);
    if (!v) break;
    pumpers++;
    pumpOne(v).finally(() => { pumpers--; updateBusy(); renderQueue(); pump(); });
  }
  updateBusy();
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
  const sb = $('stopBtn');
  fx.busy(sb, '停止中');
  for (const v of list) {
    v.stopReq = true; v.next = null;
    try { apply(v, await tb.api.call('/fb/video/stop', { method: 'POST', body: { uploadId: v.uploadId } })); } catch { /* 忽略 */ }
    v.upload = 'stopped'; v.ed.renderUpload();
  }
  fx.idle(sb, '停止上傳');
  renderQueue(); updateBusy();
  toast(`已停止 ${list.length} 支影片的上傳，可以按「重新上傳」`);
});

function updateBusy() {
  const busy = anyUploading();
  tb.busy(busy ? BUSY_MSG : null);
  $('stopBtn').hidden = !busy;
}

// ===== 送出 =====
let sending = false;
// 送出後還在上傳的影片：按鈕顯示「已送出，等上傳完成 N 支…」，全部傳完打勾、有失敗抖一下
let waitSet = null;
let hold = false;   // 打勾／抖動顯示中（1.5 秒）不要被重畫蓋掉
const failedV = (v) => v.upload === 'error' || v.jobs.some((j) => ['failed', 'unknown'].includes(j.state));
let holdTimer = 0;
function holdFoot() { hold = true; clearTimeout(holdTimer); holdTimer = setTimeout(() => { hold = false; updateFoot(); }, 1600); }
const noReady = () => !S.videos.some((v) => v.checked && !v.sent);
function updateFoot() {
  if (sending) return;   // 送出中由送出流程自己更新按鈕
  const btn = $('sendBtn');
  const ready = S.videos.filter((v) => v.checked && !v.sent);
  const n = ready.length;
  if (waitSet) {
    const live = [...waitSet].filter((v) => S.videos.includes(v) && v.upload !== 'stopped');
    const still = live.filter(isUploading);
    if (!still.length) {
      waitSet = null;
      const bad = live.filter(failedV);
      if (bad.length) { fx.fail(btn, '全部送出', { disabled: !n }); toast(`${bad.length} 支影片上傳失敗（看左側紅字），可以按「重新上傳」`, null, 10000); holdFoot(); }
      else if (live.length) { fx.ok(btn, `全部上傳完成（${live.length} 支）`, '全部送出', null, { disabled: !n }); holdFoot(); }
    } else if (!n && !hold) fx.busy(btn, `已送出，等上傳完成 ${still.length} 支`, { dots: true });
  }
  if (!hold && !(waitSet && !n)) fx.idle(btn, n > 1 ? `全部送出（${n} 支）` : '全部送出', { disabled: !n });
  const parts = [];
  if (n) parts.push(`${n} 支待送出`);
  $('footMsg').textContent = parts.join('・');
  renderFoot();
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
  sending = true;
  const btn = $('sendBtn');
  fx.busy(btn, forms.length > 1 ? `送出中（第 1／${forms.length} 支）` : '送出中');
  const fails = [];
  let okN = 0, waitN = 0;
  try {
    await sync();   // 確保每支都開好工作階段
    for (const [i, { v, body }] of forms.entries()) {
      fx.busy(btn, forms.length > 1 ? `送出中（第 ${i + 1}／${forms.length} 支）` : '送出中');
      const name = v.ed.titleText() || v.name;
      if (!v.jobs.length) { fails.push(`「${name}」還沒開始上傳`); continue; }
      body.uploadId = v.uploadId;
      await sendCover(v);
      try {
        const r = await tb.api.call('/fb/video/publish', { method: 'POST', body });
        v.sent = true; v.sentAt = Date.now(); v.sentBody = body;
        v.ed.lock();
        apply(v, r);
        okN++;
        if (isUploading(v)) waitN++;
      } catch (e) { fails.push(`「${name}」${errText(e)}`); }
    }
  } finally {
    sending = false;
    const waiting = forms.map((f) => f.v).filter((v) => v.sent && isUploading(v));
    if (waiting.length) waitSet = new Set([...(waitSet || []), ...waiting]);
    else if (fails.length) { fx.fail(btn, '全部送出', { disabled: noReady() }); holdFoot(); }
    else if (okN) { fx.ok(btn, `已送出 ${okN} 支`, '全部送出', null, { disabled: noReady() }); holdFoot(); }
    updateFoot();
  }
  renderQueue();
  poll();
  // 結果一次說清楚：幾支送出、幾支傳完後自動發布、哪幾支失敗
  const parts = [];
  if (okN) parts.push(`已送出 ${okN} 支` + (waitN ? `（其中 ${waitN} 支還在上傳，傳完會自動發布）` : ''));
  if (fails.length) parts.push(`${fails.length} 支沒送出：${fails.join('；')}`);
  toast(parts.join('。') || '沒有送出任何影片', null, fails.length ? 12000 : 6000);
});

const crossOpen = (j) => (j.cross || []).some((c) => c.status === 'pending' || c.status === 'posting');
// 送出後追蹤：處理中的每 6 秒問一次，最多 15 分鐘（多文等臉書處理影片，最多再等到 45 分鐘）
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  const t0 = Date.now();
  try {
    for (;;) {
      const crossing = S.videos.some((v) => v.sent && v.jobs.some(crossOpen));
      if (Date.now() - t0 > (crossing ? 45 : 15) * 60000) break;
      const list = S.videos.filter((v) => v.sent && v.jobs.some((j) => j.sent && (['processing', 'finishing'].includes(j.state) || j.cover === 'pending' || crossOpen(j))));
      if (!list.length && !S.videos.some((v) => v.sent && isUploading(v))) break;
      await new Promise((r) => setTimeout(r, 6000));
      for (const v of list) { try { apply(v, await tb.api.call('/fb/video/status?u=' + v.uploadId)); } catch { /* 下次再問 */ } }
    }
  } finally { polling = false; }
}

// RD：每支影片等所有已送出的粉專都有結果才寫一次；成功的粉專有 RD 區段才寫
// 時間：排程的粉專＝排程時間；立即＝按送出當下
// 草稿：slot 'draft'（今天欄右邊「純影已上傳／草稿內／2359」下的預留格）；
// 被多文的粉專：原粉專發布成功就寫，slot 'cross'（「多文／多文內」下的「純影/」），時間＝按送出當下
const OK_STATES = ['processing', 'scheduled', 'published', 'draft'];
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
    // 放待排 2359：時間＝按送出當下（找最接近的時段），不是 23:59
    const e = at && at.q2359
      ? { page: p.rd, date: dateStr(v.sentAt), time: timeStr(v.sentAt), text: rdTextQ(v.name, slug), style: 'video', slot: 'q2359', kind: 'reel' }
      : { page: p.rd, date: dateStr(ms), time: timeStr(ms), text: rdText(v.kind, slug), style: 'video', ...(j.state === 'draft' ? { slot: 'draft', kind: v.kind } : {}) };
    if (!entries.some((x) => x.page === e.page && x.time === e.time && x.date === e.date && x.slot === e.slot)) entries.push(e);
    if (j.state === 'draft') continue;
    for (const c of (at && at.cross) || []) {
      const cp = S.pages.find((x) => x.id === c);
      if (!cp || !cp.rd || entries.some((x) => x.page === cp.rd && x.slot === 'cross')) continue;
      entries.push({ page: cp.rd, date: dateStr(v.sentAt), time: timeStr(v.sentAt), text: rdText('video', slug), style: 'video', slot: 'cross', kind: 'video' });
    }
  }
  if (!entries.length) return;
  // 失敗時複製的文字：第一個失敗粉專那筆的（放待排 2359 可能是 Shorts/）
  const textOf = (bad) => (entries.find((e) => bad.some((x) => x.page === e.page)) || entries[0]).text;
  try {
    const d = await tb.api.call('/rundown', { method: 'POST', body: { entries } });
    const bad = (d.results || []).filter((x) => !x.ok);
    if (bad.length) rdFail(textOf(bad), bad.map((x) => (rdPageName(x.page) ? rdPageName(x.page) + '：' : '') + (x.error || '失敗')).join('；'));
    else toast(`RD 已寫入：${[...new Set(entries.map((e) => e.text))].join('、')}`);
  } catch (e) { rdFail(entries[0].text, errText(e)); }
}
const RD_NAMES = { news: '主粉', ent: '娛樂粉', shaokang: '少康粉', intl: '國際＋粉' };
const rdPageName = (k) => RD_NAMES[k] || '';
// RD 失敗：顯示原因＋一鍵複製，讓使用者手動貼
function rdFail(text, why) {
  toast(`RD 沒有寫入（${why}），請手動貼「${text}」`, {
    label: '複製',
    async onClick(e) { const b = e.currentTarget; try { await navigator.clipboard.writeText(text); b.textContent = '已複製'; } catch { b.textContent = '複製失敗'; } }
  }, 15000);
}

// ===== 送出紀錄 =====
// 有貼文的狀態才給「開啟貼文」連結（另開分頁）；ID 格式不對不顯示
const LINK_STATES = ['published', 'scheduled', 'processing', 'draft'];
function addOpen(el, id, tip) {
  const href = fbPostUrl(id);
  if (!href) return;
  const a = document.createElement('a'); a.className = 'log-open'; a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.textContent = '開啟貼文 ↗';
  if (tip) a.title = tip;
  el.append(' ', a);
}
let logLoaded = false;
async function loadLog() {
  logLoaded = true;
  const b = $('logReload'); fx.busy(b, '刷新中');
  $('logHint').textContent = '讀取中…';
  const ulOld = $('logList'), keep = [...ulOld.childNodes];
  ulOld.textContent = '';
  for (let k = 0; k < 3; k++) { const li = document.createElement('li'); li.className = 'fx-skrow'; li.setAttribute('aria-hidden', 'true'); li.append(document.createElement('span'), document.createElement('span')); ulOld.append(li); }
  let okLoad = false;
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
        if (LINK_STATES.includes(j.state)) addOpen(s, j.videoId, j.state === 'published' ? '' : '草稿、排程或處理中的影片只有粉專管理員看得到');
        st.append(s);
        for (const c of j.cross || []) {
          const x = document.createElement('span'); x.className = 'job s-' + (c.status === 'done' ? 'published' : c.status);
          x.textContent = `${pageName(c.page)}（多文自 ${pageName(j.page)}）：${CROSS_TEXT[c.status] || c.status}${c.error ? '（' + c.error + '）' : ''}`;
          if (c.status === 'done') addOpen(x, c.videoId, '');
          st.append(x);
        }
      }
      li.append(h, m, st);
      ul.append(li);
    }
    $('logHint').textContent = groups.size ? `最近 7 天 ${groups.size} 支影片` : '最近 7 天沒有送出的影片';
    okLoad = true;
  } catch (e) { $('logHint').textContent = '讀取失敗：' + errText(e) + (keep.length ? '（保留上次的內容）' : ''); $('logList').replaceChildren(...keep); }
  finally { if (okLoad) fx.ok(b, '已更新', '刷新'); else fx.fail(b, '刷新'); }
}
$('logReload').addEventListener('click', loadLog);
updateFoot();
