// 排程發布（測試版，只給管理員）：新增發文、已排程、已發佈。
// 工具內切換一律用 hidden，不重建畫面。後端錯誤顯示後端給的文字。
import { tb } from '../../sdk/toolbox.js';
tb.init('fbpost');

const $ = (id) => document.getElementById(id);
const MIN_S = 10 * 60, MAX_S = 30 * 24 * 3600;
const COMMENT = { done: '已留言', armed: '排程後補留言', none: '不留言', failed: '留言失敗' };
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmt = (ms) => { if (!Number.isFinite(ms)) return '時間不明'; const d = new Date(ms); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const errText = (e) => (e && e.message) || '失敗';
const commentText = (c) => {
  if (!c) return '';
  if (typeof c === 'string') return '留言：' + (COMMENT[c] || c);
  return '留言：' + (COMMENT[c.status] || c.status || '') + (c.error ? '（' + c.error + '）' : '');
};

let pages = [];
const sel = new Map(); // pageId -> { on, sched, at }

// ---- 確認對話 ----
function confirmBox(title, body) {
  return new Promise((res) => {
    const d = $('cfDlg');
    $('cfTitle').textContent = title; $('cfBody').textContent = body;
    const done = (v) => { d.close(); res(v); };
    $('cfYes').onclick = () => done(true);
    $('cfNo').onclick = () => done(false);
    d.addEventListener('cancel', () => res(false), { once: true });
    d.showModal();
  });
}

// ---- 分頁 ----
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  for (const t of $('tabs').querySelectorAll('[data-tab]')) {
    const on = t === b; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on));
    $('tab-' + t.dataset.tab).hidden = !on;
  }
});

// ---- 新增發文 ----
const defaultAt = () => toLocalInput(Date.now() + 30 * 60 * 1000);
const bounds = () => { const n = Date.now(); return { min: toLocalInput(n + MIN_S * 1000), max: toLocalInput(n + MAX_S * 1000) }; };

function renderPages() {
  const ul = $('pages'); ul.textContent = '';
  const { min, max } = bounds();
  pages.forEach((p, i) => {
    const s = sel.get(p.id) || { on: false, sched: false, at: defaultAt() };
    sel.set(p.id, s);
    const li = document.createElement('li'); li.dataset.page = p.id;
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = s.on; cb.setAttribute('aria-label', '選取 ' + p.short);
    const no = document.createElement('span'); no.className = 'no'; no.textContent = String(i + 1);
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.short;
    const when = document.createElement('span'); when.className = 'when';
    const bNow = document.createElement('button'); bNow.type = 'button'; bNow.textContent = '立即'; bNow.dataset.m = 'now';
    const bSch = document.createElement('button'); bSch.type = 'button'; bSch.textContent = '排程'; bSch.dataset.m = 'sched';
    when.append(bNow, bSch);
    const dtw = document.createElement('div'); dtw.className = 'dt';
    const dt = document.createElement('input'); dt.type = 'datetime-local'; dt.min = min; dt.max = max; dt.value = s.at; dt.setAttribute('aria-label', p.short + ' 排程時間');
    dtw.append(dt);
    const sync = () => { bNow.classList.toggle('is-on', !s.sched); bSch.classList.toggle('is-on', s.sched); dtw.hidden = !s.sched; };
    cb.onchange = () => { s.on = cb.checked; updateSend(); };
    bNow.onclick = () => { s.sched = false; sync(); };
    bSch.onclick = () => { s.sched = true; sync(); };
    dt.oninput = () => { s.at = dt.value; };
    sync();
    li.append(cb, no, nm, when, dtw);
    ul.append(li);
  });
  updateSend();
}
function updateSend() {
  const n = [...sel.values()].filter((s) => s.on).length;
  $('sendBtn').textContent = `全部送出（${n} 個粉專）`;
  $('sendBtn').disabled = n === 0;
}

$('img').addEventListener('change', () => {
  const f = $('img').files[0], pv = $('imgPrev');
  if (pv.dataset.url) { URL.revokeObjectURL(pv.dataset.url); pv.dataset.url = ''; }
  if (!f) { pv.hidden = true; return; }
  const u = URL.createObjectURL(f); pv.dataset.url = u; pv.src = u; pv.hidden = false;
});

$('sendBtn').addEventListener('click', async () => {
  const err = $('sendErr'); err.textContent = '';
  const targets = [];
  const nowS = Math.floor(Date.now() / 1000);
  for (const p of pages) {
    const s = sel.get(p.id); if (!s || !s.on) continue;
    if (!s.sched) { targets.push({ page: p.id, at: null }); continue; }
    const at = Math.floor(new Date(s.at).getTime() / 1000);
    if (!Number.isFinite(at) || at < nowS + MIN_S || at > nowS + MAX_S) { err.textContent = `${p.short} 的排程時間必須在 10 分鐘到 30 天之間。`; return; }
    targets.push({ page: p.id, at });
  }
  if (!targets.length) return;
  const msg = $('msg').value;
  if (!msg.trim() && !$('img').files[0]) { err.textContent = '請輸入貼文內容或選圖片。'; return; }
  const fd = new FormData();
  fd.append('message', msg);
  if ($('link').value.trim()) fd.append('link', $('link').value.trim());
  if ($('img').files[0]) fd.append('image', $('img').files[0]);
  fd.append('targets', JSON.stringify(targets));
  const btn = $('sendBtn'); btn.disabled = true; btn.textContent = '送出中…';
  try {
    const data = await tb.api.call('/fb/post', { method: 'POST', body: fd });
    renderResults(data.results || []);
  } catch (e) {
    err.textContent = errText(e);
  }
  btn.disabled = false; updateSend();
});

const shortOf = (id) => { const p = pages.find((x) => x.id === id); return p ? p.short : id; };
function renderResults(rs) {
  const ul = $('results'); ul.textContent = '';
  for (const r of rs) {
    const li = document.createElement('li'); li.className = r.ok ? 'ok' : 'err';
    let t = shortOf(r.page) + '：';
    if (r.ok) {
      t += r.scheduled ? '排程成功' : '發布成功';
      if (r.scheduled && r.at) t += '（' + fmt(r.at * 1000) + '）';
      t += '；' + (COMMENT[r.comment] || '') + (r.comment === 'failed' && r.commentError ? '（' + r.commentError + '）' : '');
    } else t += '失敗（' + (r.error || '未知原因') + '）';
    li.textContent = t; ul.append(li);
  }
}

// ---- 已排程／已發佈 ----
function fillSelect(el) {
  el.textContent = '';
  for (const p of pages) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.short; el.append(o); }
}
function thumb(url) {
  if (url) { const i = document.createElement('img'); i.className = 'thumb'; i.src = url; i.alt = ''; return i; }
  const d = document.createElement('div'); d.className = 'noimg'; d.textContent = '無圖'; return d;
}
function rowBase(it, whenMs) {
  const li = document.createElement('li'); li.dataset.id = it.id;
  const body = document.createElement('div'); body.className = 'body';
  const m = document.createElement('div'); m.textContent = (it.message || '').slice(0, 60);
  const c = commentText(it.comment);
  const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = fmt(whenMs) + (c ? '　' + c : '');
  body.append(m, meta);
  li.append(thumb(it.picture), body);
  return li;
}
function btn(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = text; b.onclick = fn; return b; }
function say(id, text, bad) { $(id).textContent = text; $(id).classList.toggle('bad', !!bad); }

async function loadSched() {
  const page = $('schedPage').value; if (!page) return;
  say('schedHint', '查詢中…');
  try {
    const items = await tb.api.call('/fb/scheduled?page=' + encodeURIComponent(page));
    const ul = $('schedList'); ul.textContent = '';
    for (const it of items) {
      const li = rowBase(it, it.at * 1000);
      const acts = document.createElement('div'); acts.className = 'acts';
      const edit = document.createElement('div'); edit.className = 'edit'; edit.hidden = true;
      const dt = document.createElement('input'); dt.type = 'datetime-local';
      const ok = btn('確認改時間', 'btn-primary', async () => {
        const at = Math.floor(new Date(dt.value).getTime() / 1000);
        const n = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(at) || at < n + MIN_S || at > n + MAX_S) { say('schedHint', '排程時間必須在 10 分鐘到 30 天之間。', true); return; }
        try { await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/reschedule`, { method: 'POST', body: { page, at } }); await loadSched(); }
        catch (e) { say('schedHint', errText(e), true); }
      });
      edit.append(dt, ok);
      const bEdit = btn('改時間', 'btn-secondary', () => {
        const { min, max } = bounds(); dt.min = min; dt.max = max; dt.value = toLocalInput(it.at * 1000); edit.hidden = !edit.hidden;
      });
      const bCancel = btn('取消', 'btn-secondary', async () => {
        if (!await confirmBox('取消排程', '確定要取消這則排程貼文嗎？')) return;
        try { await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/cancel`, { method: 'POST', body: { page } }); await loadSched(); }
        catch (e) { say('schedHint', errText(e), true); }
      });
      acts.append(bEdit, bCancel);
      li.append(acts, edit); ul.append(li);
    }
    say('schedHint', items.length ? `共 ${items.length} 則` : '沒有排程貼文');
  } catch (e) { say('schedHint', errText(e), true); }
}

let pubNext = null;
async function loadPub(more) {
  const page = $('pubPage').value; if (!page) return;
  say('pubHint', '查詢中…');
  try {
    const d = await tb.api.call('/fb/published?page=' + encodeURIComponent(page) + (more && pubNext ? '&after=' + encodeURIComponent(pubNext) : ''));
    const ul = $('pubList'); if (!more) ul.textContent = '';
    for (const it of d.items || []) {
      const li = rowBase(it, new Date(it.time).getTime());
      const acts = document.createElement('div'); acts.className = 'acts';
      if (it.url) { const a = document.createElement('a'); a.className = 'btn btn-sm btn-secondary'; a.href = it.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '開啟'; acts.append(a); }
      acts.append(btn('刪除', 'btn-secondary', async () => {
        if (!await confirmBox('刪除貼文', '確定要刪除這則已發佈的貼文嗎？無法復原。')) return;
        try { await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/delete`, { method: 'POST', body: { page } }); li.remove(); }
        catch (e) { say('pubHint', errText(e), true); }
      }));
      li.append(acts); ul.append(li);
    }
    pubNext = d.next || null; $('pubMore').hidden = !pubNext;
    say('pubHint', ul.children.length ? `共 ${ul.children.length} 則` : '沒有已發佈貼文');
  } catch (e) { say('pubHint', errText(e), true); }
}
$('schedReload').onclick = loadSched;
$('pubReload').onclick = () => loadPub(false);
$('pubMore').onclick = () => loadPub(true);

// ---- 啟動：只有管理員才顯示、才呼叫 /fb/* ----
(async () => {
  let st;
  try { st = await tb.api.call('/auth/status'); } catch { return; }
  if (!st || st.admin !== true) return;
  try { pages = await tb.api.call('/fb/pages'); } catch (e) { return; }
  $('fbpostOff').closest('main').hidden = true;
  $('fbpostApp').hidden = false;
  fillSelect($('schedPage')); fillSelect($('pubPage'));
  renderPages();
})();
