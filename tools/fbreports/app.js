// 數據報表（測試版，權限同排程發布）：選粉專、類型、期間 → 按「查詢」才讀 /fb/reports/posts
//   依貼文發布日統計、成效是讀取當下的累計值；同一輪跨粉專共用 asOf 與範圍代碼
//   查詢一輪最多 ROUND_MAX 批，到了保留游標顯示「繼續讀取」；停止、限流、失敗都可續查
//   請求序號 S.seq：換查詢後舊回應一律丟掉；範圍變更（report_scope）→ 停止、清除、重新讀取粉專
//   分頁、類型篩選、排序、下鑽只用已載入結果；工具內切換一律 hidden
import { tb } from '../../sdk/toolbox.js';
import * as fx from '../../ui/fx.js';
import { COMPANY_KEY } from '../../sdk/api.js';
import {
  TYPES, TYPE_NAME, METRICS, METRIC_NAME, METRIC_NOTE, summarize, byDate, groupBy, typeRows, sortItems, mergeItems,
  metricValue, fmtAgg, aggParts, fmtCell, fmtNum, fmtRate, presetRange, dayCount, taipeiDate
} from './calc.js';

tb.init('fbreports');

export const ROUND_MAX = 40;    // 一次查詢最多讀幾批（每批最多 5 篇）
const MAX_DAYS = 31;
const PAGE_SIZE = 20;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ISSUE_TEXT = {
  expand_fallback: '這個粉專改用逐篇查成效（每批讀得比較少）。',
  insights_empty: '部分貼文臉書沒有回成效（常見原因：權杖缺 read_insights 或沒有粉專分析權限）。',
  no_permission: '權杖沒有讀取成效的權限（read_insights／粉專分析任務）。',
  busy_throttle: '臉書最近限流，已暫停讀取，稍後按「繼續讀取」。',
  busy_app: '臉書 App 用量已達 90%，已暫停讀取，稍後按「繼續讀取」。',
  busy_page: '這個粉專的臉書用量已達 90%，已暫停讀取，稍後按「繼續讀取」。',
  throttled: '臉書限流，這批沒讀到，稍後按「繼續讀取」。'
};
const REASON_TEXT = { unverified: '觸及來源尚未驗證', no_permission: '沒有權限', no_data: '臉書沒有回資料', unsupported: '臉書不支援', error: '讀取失敗', budget: '本批未讀' };

const S = {
  pages: [], selPages: new Set(), selTypes: new Set(TYPES.map(([k]) => k)),
  seq: 0, running: false, stopReq: false,
  q: null,            // 這一輪：{ key, from, to, pages:[{id,next,started,done}], asOf, scope, issues:Set, batches }
  items: new Map(), last: null,
  tab: 'overview', trendMetric: 'views', rankMetric: 'views',
  sort: { pages: ['views', 'desc'], posts: ['time', 'desc'] }, page: 1, drill: null
};
const pageName = (id) => (S.pages.find((p) => p.id === id) || {}).short || id;
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000); };
const todayStr = () => taipeiDate(Date.now() / 1000);
const fmtTime = (sec) => new Date(sec * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const errText = (e) => (e && e.message) || '讀取失敗';

// ===== 啟動 =====
const booted = (ok) => { $('bootSk').hidden = true; if (!ok) $('offMain').hidden = false; };
async function loadPages() {
  const pages = await tb.api.call('/fb/pages');
  S.pages = [...pages].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  for (const id of [...S.selPages]) if (!S.pages.some((p) => p.id === id)) S.selPages.delete(id);
  if (!S.selPages.size && S.pages.length) S.selPages.add(S.pages[0].id);   // 首次預設第一個粉專
  renderPageChips();
}
(async () => {
  let st;
  try { st = await tb.api.call('/auth/status'); } catch { booted(false); return; }
  if (!st || !st.company) { booted(false); return; }
  try { await loadPages(); } catch (e) {
    if (e && e.code === 'fb_need_staff') { $('needStaff').hidden = false; $('needStaffBtn').onclick = () => tb.company.login(); booted(false); return; }
    const why = e && e.code === 'fb_forbidden' ? ((e.detail && e.detail.reason) || '') : errText(e);
    if (why) { $('offReason').textContent = '原因：' + why; $('offReason').hidden = false; }
    booted(false); return;
  }
  // 權限：數據報表需要 report；系統管理者（me.admin）＝全部；/fb/me 讀不到先放行，後端仍會擋
  let me0 = null;
  try { me0 = await tb.api.call('/fb/me'); } catch { me0 = null; }
  if (me0 && !me0.admin && !(me0.perms || []).includes('report')) {
    $('offTitle').textContent = '數據報表 沒有權限'; $('offDesc').textContent = '你的權限組沒有「檢視數據報表」，請找管理者。';
    booted(false); return;
  }
  booted(true);
  $('app').hidden = false;
  tb.api.call('/fb/access').then((a) => { if (a && a.mode === 'company') for (const el of document.querySelectorAll('.test-pill')) el.hidden = true; }).catch(() => {});
  tb.api.call('/fb/me').then((me) => {
    if (!me) return;
    const who = me.admin ? '管理員' : [me.name, me.group].filter(Boolean).join('．');
    if (who) { $('whoAmI').textContent = who; $('whoAmI').hidden = false; }
    $('probeBtn').hidden = !me.admin;
    if (me.tokenWarn && me.tokenWarn.text) { const w = $('tokWarn'); w.textContent = me.tokenWarn.text; w.classList.toggle('bad', me.tokenWarn.level === 'bad'); w.hidden = false; }
  }).catch(() => {});
})();

// 登出或換帳號（外殼改 localStorage）→ 清掉畫面與記憶體中的報表
window.addEventListener('storage', (e) => { if (e.key === null || e.key === COMPANY_KEY) clearAll('登入狀態已變更，報表已清除。'); });

// ===== 條件 =====
function chip(name, value, checked, label, cls = '') {
  return `<label class="opt ${cls}"><input type="checkbox" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''}>${esc(label)}</label>`;
}
// 下拉按鈕文字：1～2 個列名稱、3 個以上「X 等 N 個」、全選「全部…」、沒選「未選擇」
export function pickText(names, total, allText) {
  if (!names.length) return '未選擇';
  if (total > 1 && names.length === total) return allText;
  return names.length <= 2 ? names.join('、') : `${names[0]}等 ${names.length} 個`;
}
function renderPageChips() {
  const all = S.pages.length && S.pages.every((p) => S.selPages.has(p.id));
  $('pageChips').innerHTML = (S.pages.length > 1 ? chip('pageAll', '*', all, '全選', 'all') : '') + S.pages.map((p) => chip('page', p.id, S.selPages.has(p.id), p.short)).join('')
    || '<span class="hint">沒有可查詢的粉專</span>';
  $('pageSum').textContent = S.pages.length ? pickText(S.pages.filter((p) => S.selPages.has(p.id)).map((p) => p.short), S.pages.length, '全部粉專') : '沒有粉專';
}
function renderTypeChips() {
  const all = S.selTypes.size === TYPES.length;
  $('typeChips').innerHTML = chip('typeAll', '*', all, '全部', 'all') + TYPES.map(([k, n]) => chip('type', k, S.selTypes.has(k), n)).join('');
  $('typeSum').textContent = pickText(TYPES.filter(([k]) => S.selTypes.has(k)).map(([, n]) => n), TYPES.length, '全部類型');
}
// 下拉：同時只開一個；點外面、Esc 關閉（焦點回按鈕）；↑↓ 在選項間移動、空白鍵勾選
const dds = [$('pageDd'), $('typeDd')];
for (const d of dds) {
  d.addEventListener('toggle', () => { if (d.open) { for (const o of dds) if (o !== d) o.open = false; } });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && d.open) { e.preventDefault(); e.stopPropagation(); d.open = false; d.querySelector('summary').focus(); return; }
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); return; }   // 選項上按 Enter 不送出查詢表單
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const ins = [...d.querySelectorAll('.dd-list input')];
    if (!ins.length) return;
    e.preventDefault();
    if (!d.open) d.open = true;
    const i = ins.indexOf(document.activeElement);
    const j = i < 0 ? 0 : e.key === 'ArrowDown' ? Math.min(ins.length - 1, i + 1) : Math.max(0, i - 1);
    ins[j].focus();
  });
}
document.addEventListener('click', (e) => { for (const d of dds) if (d.open && !d.contains(e.target)) d.open = false; });
renderTypeChips();
$('pageChips').addEventListener('change', (e) => {
  const i = e.target;
  if (i.name === 'pageAll') { S.selPages = new Set(i.checked ? S.pages.map((p) => p.id) : []); }
  else if (i.checked) S.selPages.add(i.value); else S.selPages.delete(i.value);
  renderPageChips();
  $('pageChips').querySelector(`input[value="${CSS.escape(i.value)}"]`)?.focus();
});
// 類型只篩已載入的結果，不重新查詢
$('typeChips').addEventListener('change', (e) => {
  const i = e.target;
  if (i.name === 'typeAll') S.selTypes = new Set(i.checked ? TYPES.map(([k]) => k) : []);
  else if (i.checked) S.selTypes.add(i.value); else S.selTypes.delete(i.value);
  renderTypeChips();
  $('typeChips').querySelector(`input[value="${CSS.escape(i.value)}"]`)?.focus();
  S.page = 1; render();
});
function syncRange() {
  const custom = $('range').value === 'custom';
  $('fromL').hidden = !custom; $('toL').hidden = !custom;
  const t = todayStr();
  $('from').max = t; $('to').max = t;
  if (custom && !$('from').value) { const r = presetRange(7, t); $('from').value = r.from; $('to').value = r.to; }
}
$('range').addEventListener('change', syncRange);
syncRange();
function readRange() {
  const t = todayStr();
  if ($('range').value !== 'custom') return presetRange(Number($('range').value), t);
  const from = $('from').value, to = $('to').value;
  if (!from || !to) return { error: '請選起日與迄日。' };
  if (from > to) return { error: '起日不能晚於迄日。' };
  if (to > t) return { error: '日期不能在未來。' };
  if (dayCount(from, to) > MAX_DAYS) return { error: `單次最多查 ${MAX_DAYS} 天。` };
  return { from, to };
}

// ===== 查詢 =====
$('form').addEventListener('submit', (e) => { e.preventDefault(); startQuery(); });
$('stopBtn').addEventListener('click', () => { S.stopReq = true; $('stopBtn').disabled = true; });
$('moreBtn').addEventListener('click', () => { if (S.q && !S.running) pump(S.seq, true); });

function startQuery() {
  const r = readRange();
  const err = r.error || (!S.selPages.size ? '請至少選一個粉專。' : '');
  $('formErr').hidden = !err; $('formErr').textContent = err;
  if (err) return;
  const pages = S.pages.filter((p) => S.selPages.has(p.id)).map((p) => p.id);
  const key = [pages.join(','), r.from, r.to].join('|');
  // 重查失敗時要能還原：保留上一份完整（或部分）結果
  if (S.q && S.items.size) S.last = { key: S.q.key, items: S.items, q: S.q };
  S.seq++;
  S.items = new Map();
  S.q = { key, from: r.from, to: r.to, pages: pages.map((id) => ({ id, next: null, started: false, done: false })), asOf: null, scope: null, issues: new Set(), batches: 0, err: '' };
  S.page = 1; S.drill = null;
  $('report').hidden = true;
  pump(S.seq, false);
}

async function pump(my, resume) {
  const q = S.q;
  S.running = true; S.stopReq = false; q.err = ''; q.paused = '';
  if (resume) q.batches = 0;
  renderState();
  try {
    for (const p of q.pages) {
      while (!p.done) {
        if (my !== S.seq) return;
        if (S.stopReq) { q.paused = 'stopped'; return; }
        if (q.batches >= ROUND_MAX) { q.paused = 'limit'; return; }
        let path;
        if (p.started) path = '/fb/reports/posts?cursor=' + encodeURIComponent(p.next);
        else {
          const sp = new URLSearchParams({ page: p.id, from: q.from, to: q.to });
          if (q.asOf) sp.set('asOf', String(q.asOf));
          if (q.scope) sp.set('scope', q.scope);
          path = '/fb/reports/posts?' + sp;
        }
        let r;
        try { r = await tb.api.call(path); } catch (e) {
          if (my !== S.seq) return;   // 已換查詢：舊回應不覆蓋畫面
          if (e && (e.code === 'report_scope' || e.code === 'fb_forbidden' || e.code === 'fb_no_perm' || e.code === 'unauthorized' || e.code === 'fb_need_staff')) {
            await scopeChanged(e.code === 'report_scope' ? '粉專、權杖組別或權限已變更，已停止並清除報表，請重新查詢。' : errText(e));
            return;
          }
          q.err = errText(e);
          return;
        }
        if (my !== S.seq) return;
        q.batches++;
        if (!q.asOf) q.asOf = r.asOf;
        if (!q.scope) q.scope = r.scope;
        for (const i of r.issues || []) q.issues.add(i);
        mergeItems(S.items, (r.items || []).filter((it) => it.page === p.id));
        if (r.status !== 'ok') { p.next = r.next; p.started = !!r.next || p.started; q.paused = r.status; break; }
        p.started = true;
        p.next = r.next;
        if (!r.next) p.done = true;
        render();
        renderState();
      }
      if (q.paused) return;
    }
  } finally {
    if (my === S.seq) {
      S.running = false;
      // 重查第一批就失敗、什麼都沒讀到：同條件有上次結果就還原
      if ((q.err || q.paused) && !S.items.size && S.last && S.last.key === q.key) {
        S.items = S.last.items; q.restored = S.last.q.asOf;
      }
      render(); renderState();
    }
  }
}

async function scopeChanged(msg) {
  clearAll(msg);
  try { await loadPages(); } catch { /* 停用頁由重新整理處理 */ }
}
function clearAll(msg) {
  S.seq++; S.running = false; S.q = null; S.items = new Map(); S.last = null; S.drill = null;
  fx.idle($('queryBtn'), '查詢');
  $('report').hidden = true; $('qstate').hidden = true;
  for (const id of ['kpis', 'trend', 'rank', 'trafficTrends', 'trafficPages', 'clickRank', 'pageTable', 'typeTable', 'postTable', 'pager']) $(id).innerHTML = '';
  if (msg) toast(msg);
}

function coverage() {
  const q = S.q;
  const done = q.pages.filter((p) => p.done).length;
  return { done, total: q.pages.length, complete: done === q.pages.length, n: S.items.size };
}
function renderState() {
  const q = S.q;
  if (!q) { $('qstate').hidden = true; return; }
  $('qstate').hidden = false;
  const c = coverage();
  let text;
  if (S.running) text = `讀取中… 已完成 ${c.done}／${c.total} 個粉專，已讀取 ${c.n} 篇`;
  else if (c.complete) text = `已完成 ${c.total} 個粉專，共 ${c.n} 篇`;
  else if (q.paused === 'limit') text = `已讀取 ${c.n} 篇（${c.done}／${c.total} 個粉專完成），這次先讀到這裡`;
  else if (q.paused === 'stopped') text = `已停止：讀取 ${c.n} 篇（${c.done}／${c.total} 個粉專完成）`;
  else if (q.paused) text = `已暫停：讀取 ${c.n} 篇（${c.done}／${c.total} 個粉專完成）`;
  else if (q.err) text = `讀取失敗：${q.err}`;
  else text = `已讀取 ${c.n} 篇`;
  $('qsText').textContent = text;
  $('stopBtn').hidden = !S.running; $('stopBtn').disabled = false;
  $('moreBtn').hidden = S.running || c.complete;
  // 查詢鈕回饋（ui/fx.js）：讀取中轉圈（查詢與繼續讀取都算，仍可按）；讀完打勾、失敗抖動、暫停／停止直接恢復
  const qb = $('queryBtn');
  if (S.running) { fx.busy(qb, '讀取中'); qb.disabled = false; }   // 讀取中仍可改條件重查（原本行為）
  else if (qb.classList.contains('fx-busy')) {
    if (q.err) fx.fail(qb, '查詢'); else if (c.complete) fx.ok(qb, '已完成', '查詢'); else fx.idle(qb, '查詢');
  } else if (!qb.classList.contains('fx-ok')) qb.disabled = false;
  const span = `${q.from.replaceAll('-', '/')}～${q.to.replaceAll('-', '/')}`;
  const asOf = q.restored || q.asOf;
  $('qsMeta').textContent = `依貼文發布日統計（${span}，台北時間）· 累計成效 · ` + (asOf ? `資料讀取時間 ${fmtTime(asOf)}` : '尚未讀到資料') + (q.restored ? '（重查失敗，顯示上次結果）' : '');
  const warns = [...q.issues].map((i) => ISSUE_TEXT[i]).filter(Boolean);
  if (!c.complete && c.n) warns.unshift('清單未載完：數字與排行只涵蓋已讀取的貼文。');
  $('qsWarn').hidden = !warns.length; $('qsWarn').textContent = [...new Set(warns)].join(' ');
}

// ===== 報表 =====
const visible = () => [...S.items.values()].filter((it) => S.selTypes.has(it.type || 'unknown'));
function render() {
  // 讀第一批前不顯示；讀完（含 0 篇）才顯示
  $('report').hidden = !S.q || (S.running && !S.items.size);
  if ($('report').hidden) return;
  const items = visible();
  renderOverview(items); renderTraffic(items); renderPages(items); renderTypes(items); renderPosts(items);
}

function metricSelect(sel, cur, keys) {
  if (!sel.options.length) sel.innerHTML = keys.map((k) => `<option value="${k}">${METRIC_NAME[k]}</option>`).join('');
  sel.value = cur;
}
function renderOverview(items) {
  const s = summarize(items);
  $('kpis').innerHTML = METRICS.map(([k, n]) => {
    const { value, note } = aggParts(k, s[k]);
    const sub = [note, k === 'reach' ? '各篇觸及加總' : k === 'clicks' ? '貼文總點擊' : ''].filter(Boolean).join('．');
    return `<div class="kpi" title="${esc(METRIC_NOTE[k] || '')}"><b>${n}</b><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  }).join('');
  metricSelect($('trendMetric'), S.trendMetric, METRICS.map(([k]) => k));
  $('trend').innerHTML = trendChart(items, S.trendMetric);
  metricSelect($('rankMetric'), S.rankMetric, ['views', 'engagement', 'rate', 'clicks', 'reactions', 'reach']);
  $('rank').innerHTML = rankList(items, S.rankMetric, 10);
}
$('trendMetric').addEventListener('change', (e) => { S.trendMetric = e.target.value; $('trend').innerHTML = trendChart(visible(), S.trendMetric); });
$('rankMetric').addEventListener('change', (e) => { S.rankMetric = e.target.value; $('rank').innerHTML = rankList(visible(), S.rankMetric, 10); });
$('rankMore').addEventListener('click', () => { S.sort.posts = [S.rankMetric, 'desc']; S.page = 1; renderPosts(visible()); showTab('posts'); });

function trendChart(items, key, title = '') {
  const rows = byDate(items, S.q.from, S.q.to);
  // 當天沒貼文：加總型 0、互動率未知；有貼文但都沒資料：未知（斜線）
  const val = (r) => {
    if (key === 'posts') return r.items.length;
    if (!r.items.length) return key === 'rate' ? null : 0;
    return r.summary[key].known ? r.summary[key].value : null;
  };
  const vals = rows.map(val);
  const max = Math.max(1, ...vals.filter((v) => typeof v === 'number'));
  const label = title || METRIC_NAME[key];
  const bars = rows.map((r, i) => {
    const v = vals[i];
    const txt = `${r.date}：${v === null ? '—' : fmtAgg(key, r.summary[key])}`;
    return `<div class="bar${v === null ? ' unk' : ''}" title="${esc(txt)}"><i style="height:${v === null ? 100 : Math.max(0, (v / max) * 100)}%"></i></div>`;
  }).join('');
  const step = Math.ceil(rows.length / 8);
  const axis = rows.map((r, i) => `<span>${i % step === 0 ? r.date.slice(5).replace('-', '/') : ''}</span>`).join('');
  const table = `<details class="vals"><summary>數值表</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">發布日</th><th scope="col">發文數</th><th scope="col">${esc(label)}</th></tr></thead><tbody>`
    + rows.map((r) => `<tr><td>${r.date}</td><td>${r.items.length}</td><td>${esc(fmtAgg(key, r.summary[key]))}</td></tr>`).join('') + '</tbody></table></div></details>';
  return `${title ? `<div class="c-head"><h2>${esc(title)}</h2></div>` : ''}<div class="chart" role="img" aria-label="${esc(label)}每日趨勢，詳見數值表">${bars}</div><div class="axis" aria-hidden="true">${axis}</div>${table}`;
}
function rankList(items, key, n) {
  const list = sortItems(items, key, 'desc').filter((it) => typeof metricValue(it, key) === 'number').slice(0, n);
  if (!list.length) return '<li class="hint">沒有可排行的資料</li>';
  return list.map((it) => `<li><div class="r-line"><span class="r-text">${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.text || '（無文字）')}</a>` : esc(it.text || '（無文字）')}</span><span class="r-val">${esc(fmtCell(key, metricValue(it, key)))}</span></div><div class="r-meta">${esc(pageName(it.page))}．${esc(TYPE_NAME[it.type] || '未分類')}．${esc(fmtTime(Date.parse(it.time) / 1000))}</div></li>`).join('');
}

function renderTraffic(items) {
  $('trafficTrends').innerHTML = ['views', 'reach', 'clicks'].map((k) => `<div class="box">${trendChart(items, k, METRIC_NAME[k])}</div>`).join('');
  const g = groupBy(items, (it) => it.page);
  const rows = S.q.pages.map((p) => [p.id, summarize(g.get(p.id) || [])]);
  $('trafficPages').innerHTML = `<table class="tbl"><thead><tr><th scope="col">粉專</th><th scope="col">發文數</th><th scope="col">瀏覽數</th><th scope="col">觸及數</th><th scope="col">點擊數</th></tr></thead><tbody>`
    + rows.map(([id, s]) => `<tr><td>${esc(pageName(id))}</td><td>${fmtNum(s.posts.value)}</td><td>${esc(fmtAgg('views', s.views))}</td><td>${esc(fmtAgg('reach', s.reach))}</td><td>${esc(fmtAgg('clicks', s.clicks))}</td></tr>`).join('') + '</tbody></table>';
  $('clickRank').innerHTML = rankList(items, 'clicks', 10);
}

function sortHead(table, key, label, cls = '') {
  const [k, d] = S.sort[table];
  const on = k === key;
  return `<th scope="col" class="${cls}" ${on ? `aria-sort="${d === 'asc' ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${table}:${key}">${esc(label)}${on ? (d === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  const [table, key] = b.dataset.sort.split(':');
  const [k, d] = S.sort[table];
  S.sort[table] = [key, k === key && d === 'desc' ? 'asc' : 'desc'];
  S.page = 1;
  if (table === 'pages') renderPages(visible()); else renderPosts(visible());
  document.querySelector(`[data-sort="${table}:${key}"]`)?.focus();
});

function renderPages(items) {
  const g = groupBy(items, (it) => it.page);
  const [k, d] = S.sort.pages;
  const rows = S.q.pages.map((p) => ({ id: p.id, s: summarize(g.get(p.id) || []) }));
  const v = (r) => (r.s[k] ? r.s[k].value : null);
  rows.sort((a, b) => { const x = v(a), y = v(b); if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; return (x - y) * (d === 'asc' ? 1 : -1); });
  $('pageTable').innerHTML = '<table class="tbl"><thead><tr><th scope="col">粉專</th>' + METRICS.map(([mk, n]) => sortHead('pages', mk, n)).join('') + '</tr></thead><tbody>'
    + rows.map((r) => `<tr><td><button type="button" class="link-btn" data-drill="${esc(r.id)}">${esc(pageName(r.id))}</button></td>` + METRICS.map(([mk]) => `<td>${esc(fmtAgg(mk, r.s[mk]))}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
}
$('pageTable').addEventListener('click', (e) => {
  const b = e.target.closest('[data-drill]');
  if (!b) return;
  S.drill = { page: b.dataset.drill }; S.page = 1;
  renderPosts(visible()); showTab('posts');
});
$('drillClear').addEventListener('click', () => { S.drill = null; S.page = 1; renderPosts(visible()); });

function renderTypes(items) {
  const rows = typeRows(items);
  $('typeTable').innerHTML = '<table class="tbl"><thead><tr><th scope="col">類型</th>' + METRICS.map(([, n]) => `<th scope="col">${n}</th>`).join('')
    + '<th scope="col">發文占比</th><th scope="col">每篇平均互動</th><th scope="col">每篇平均觸及</th><th scope="col">有效樣本</th></tr></thead><tbody>'
    + (rows.length ? rows.map((r) => `<tr><td>${esc(r.name)}</td>` + METRICS.map(([mk]) => `<td>${esc(fmtAgg(mk, r.summary[mk]))}</td>`).join('')
      + `<td>${fmtRate(r.share)}</td><td>${r.avgEngagement === null ? '—' : r.avgEngagement.toFixed(1)}</td><td>${r.avgReach === null ? '—' : fmtNum(r.avgReach)}</td>`
      + `<td title="互動／觸及有資料的篇數">${r.summary.engagement.known}／${r.summary.reach.known}（${r.items.length} 篇）</td></tr>`).join('')
      : `<tr><td colspan="${METRICS.length + 5}" class="l">沒有貼文</td></tr>`) + '</tbody></table>';
}

function cellWithReason(it, key) {
  const v = metricValue(it, key);
  if (typeof v === 'number') return esc(fmtCell(key, v));
  const why = (it.missing || {})[key === 'engagement' || key === 'rate' ? (it.reach === null && key === 'rate' ? 'reach' : 'reactions') : key];
  return `<span class="u" title="${esc(REASON_TEXT[why] || '未知')}">—</span>`;
}
function renderPosts(items) {
  let list = S.drill ? items.filter((it) => it.page === S.drill.page) : items;
  $('drill').hidden = !S.drill;
  if (S.drill) $('drillText').textContent = '只看：' + pageName(S.drill.page);
  const [k, d] = S.sort.posts;
  list = sortItems(list, k, d);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  S.page = Math.min(S.page, pages);
  const slice = list.slice((S.page - 1) * PAGE_SIZE, S.page * PAGE_SIZE);
  $('postCount').textContent = `共 ${list.length} 篇`;
  const cols = [['time', '發布時間', 'l'], ['views', '瀏覽'], ['engagement', '互動'], ['rate', '互動率'], ['clicks', '點擊'], ['reactions', '心情'], ['reach', '觸及']];
  $('postTable').innerHTML = '<table class="tbl"><thead><tr>' + sortHead('posts', 'time', '發布時間', 'l') + '<th scope="col" class="l">粉專</th><th scope="col" class="l">類型</th><th scope="col" class="l">摘要</th>'
    + cols.slice(1).map(([ck, n]) => sortHead('posts', ck, n)).join('') + '<th scope="col">原文</th></tr></thead><tbody>'
    + (slice.length ? slice.map((it) => `<tr><td class="l">${esc(fmtTime(Date.parse(it.time) / 1000))}</td><td class="l">${esc(pageName(it.page))}</td><td class="l">${esc(TYPE_NAME[it.type] || '未分類')}</td><td class="txt">${esc(it.text || '（無文字）')}</td>`
      + cols.slice(1).map(([ck]) => `<td>${cellWithReason(it, ck)}</td>`).join('')
      + `<td>${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">開啟</a>` : '—'}</td></tr>`).join('')
      : `<tr><td colspan="11" class="l">沒有貼文</td></tr>`) + '</tbody></table>';
  $('pager').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button type="button" data-pg="${i + 1}" ${i + 1 === S.page ? 'aria-current="page"' : ''} aria-label="第 ${i + 1} 頁">${i + 1}</button>`).join('') : '';
}
$('pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pg]');
  if (!b) return;
  S.page = Number(b.dataset.pg); renderPosts(visible());
  $('pager').querySelector(`[data-pg="${S.page}"]`)?.focus();
});

// ===== 分頁（hidden 切換，方向鍵可切） =====
function showTab(name) {
  S.tab = name;
  for (const t of $('tabs').querySelectorAll('[data-tab]')) {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    $('p-' + t.dataset.tab).hidden = !on;
  }
}
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
$('tabs').addEventListener('keydown', (e) => {
  const tabs = [...$('tabs').querySelectorAll('[data-tab]')];
  const i = tabs.findIndex((t) => t.dataset.tab === S.tab);
  const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
  if (j < 0) return;
  e.preventDefault(); showTab(tabs[j].dataset.tab); tabs[j].focus();
});

// ===== 欄位檢查（只有系統管理者） =====
$('probeBtn').addEventListener('click', () => {
  $('probePage').innerHTML = S.pages.map((p) => `<option value="${esc(p.id)}">${esc(p.short)}</option>`).join('');
  $('probeDlg').showModal();
});
$('probeClose').addEventListener('click', () => $('probeDlg').close());
$('probeRun').addEventListener('click', async () => {
  const b = $('probeRun'); fx.busy(b, '檢查中'); $('probeOut').textContent = '檢查中…'; $('probeCopy').disabled = true;
  try {
    const r = await tb.api.call('/fb/reports/probe?page=' + encodeURIComponent($('probePage').value));
    $('probeOut').textContent = JSON.stringify(r, null, 2); $('probeCopy').disabled = false;
    fx.ok(b, '完成', '開始檢查');
  } catch (e) { $('probeOut').textContent = '失敗：' + errText(e); fx.fail(b, '開始檢查'); }
});
$('probeCopy').addEventListener('click', () => navigator.clipboard.writeText($('probeOut').textContent).then(() => toast('已複製'), () => toast('複製失敗')));
