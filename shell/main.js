// 外殼進入點：載入工具目錄，串起版面狀態機、櫥窗、工具列、窗格與拖曳。
import * as L from './layout.js';
import { renderSkeleton, renderShowcase } from './showcase.js';
import { createToolbar } from './toolbar.js';
import { createPanes } from './panes.js';
import { initStatus } from './status.js';
import { initCompany } from './company.js';

const $ = (id) => document.getElementById(id);
const showcaseEl = $('showcase');
const workEl = $('work');

let state = L.initial();
let catalog = [];           // 目錄裡全部的工具
let loaded = false;

// ---- 狀態列資料（SDK 與狀態列共用） ----
const statuses = new Map();
const statusSubs = new Set();
// ---- 公司模式資料（Task 10 的 company.js 會更新） ----
let companyState = { unlocked: false, exp: null, admin: false, staff: null };
const companySubs = new Set();

// 安裝教學（程式與樣式約 74KB）按了才載入，首頁不先下載。
let installMod = null;
let installCss = null;
function openInstall() {
  // 樣式先到位再開，避免閃一下沒樣式的畫面；樣式載入失敗也照開。
  installCss ||= new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'shell/install.css';
    link.onload = link.onerror = resolve;
    document.head.appendChild(link);
  });
  installMod ||= import('./install.js');
  return Promise.all([installMod, installCss]).then(([m]) => m.openInstall());
}

const byId = (id) => catalog.find((t) => t.id === id) || null;
const shownTools = () => catalog.filter((t) => t.tier === 'public' || companyState.unlocked);

const toolbar = createToolbar($('toolbar'), {
  // 從選單選工具：開工具後把焦點移到工具內容（不留在已收起的選單）
  onOpen: (id) => { set(L.open(state, id)); focusTool(); },
  onHome: () => { set(L.home(state)); $('stage').focus(); },
  statusEl: $('status'),
});
const panes = createPanes(workEl);

function set(next) { state = next; render(); syncHash(); }

// ---- 網址記住目前開著的工具（#pattern）：重新整理留在原工具，上一頁／下一頁可用。舊的並排網址 #甲+乙 只開甲 ----
const hashOf = (s) => { const ids = L.visible(s); return ids.length ? `#${ids.join('+')}` : ''; };
function syncHash() {
  const want = hashOf(state);
  if (want === location.hash) return;
  try { history.pushState(null, '', want || location.pathname + location.search); } catch { /* 不支援就不記 */ }
}
function stateFromHash() {
  let raw = '';
  try { raw = decodeURIComponent(location.hash.slice(1)); } catch { raw = ''; }
  const id = raw.split('+').find((x) => byId(x));
  return id ? L.open(state, id) : L.home(state);
}
function applyHash() {
  if (hashOf(state) === location.hash) return;
  state = stateFromHash();
  render();
  const want = hashOf(state);
  if (want && want !== location.hash) { try { history.replaceState(null, '', want); } catch { /* 不支援就不改 */ } }
}
window.addEventListener('popstate', applyHash);

function render() {
  const showing = state.view === 'work';
  showcaseEl.hidden = showing;
  workEl.hidden = !showing;
  panes.sync(showing ? byId(state.tool) : null);
  toolbar.setPressed(L.visible(state));
}

function renderCatalog() {
  const tools = shownTools();
  renderShowcase(showcaseEl, tools, { onOpen: (id) => set(L.open(state, id)) });
  toolbar.render(tools);
  toolbar.setPressed(L.visible(state));
}

$('brand').addEventListener('click', () => set(L.home(state)));

function focusTool() {
  const frame = state.view === 'work' && panes.get(state.tool)?.frame;
  if (frame) frame.focus(); else $('stage').focus();
}

// 跳至主要內容：不改網址（網址記的是工具），直接把焦點移到目前的工具或櫥窗
document.querySelector('.skip').addEventListener('click', (e) => {
  e.preventDefault();
  focusTool();
});

// 工具回報「忙碌中」（tb.busy）：有任何工具忙碌時，關分頁／重新整理／離開網站先確認
const busyTools = new Map();
window.addEventListener('beforeunload', (e) => {
  if (!busyTools.size) return;
  e.preventDefault();
  e.returnValue = [...busyTools.values()][0];
});

window.tbxShell = {
  getStatus: (id) => statuses.get(id) || { state: 'checking', text: '' },
  setStatus(id, value) {
    statuses.set(id, value);
    for (const fn of statusSubs) fn(id, value);
  },
  onStatus(fn) { statusSubs.add(fn); return () => statusSubs.delete(fn); },
  company: () => ({ ...companyState }),
  onCompany(fn) { companySubs.add(fn); return () => companySubs.delete(fn); },
  focusTool: (id) => { if (byId(id)) set(L.open(state, id)); },
  openInstall: () => openInstall(),
  setBusy(id, msg) { if (msg) busyTools.set(String(id), String(msg)); else busyTools.delete(String(id)); },
  // 內部掛點：給 company.js 等外殼模組使用，不屬於 SDK。
  _internal: {
    panes,
    getCatalog: () => catalog,
    setCompany(next) {
      companyState = { ...next };
      if (loaded) renderCatalog();
      for (const fn of companySubs) fn({ ...companyState });
    },
    rerender: render,
  },
};

async function start() {
  renderSkeleton(showcaseEl);
  render();
  try {
    const res = await fetch('shell/catalog.json');
    catalog = (await res.json()).tools || [];
  } catch {
    catalog = [];
  }
  loaded = true;
  renderCatalog();
  applyHash();
  render();
}

// ---- 狀態列與安裝教學 ----
const status = initStatus({ root: $('status'), shell: window.tbxShell, openInstall });
// 手機狀態收在「工具」面板裡：有需要注意的狀態時在「工具」鈕上加提示點
window.tbxShell.onStatus(() => toolbar.setAlert(statuses.get('company')?.state === 'warn'));
initCompany({ shell: window.tbxShell, button: $('company-btn') });
// 偵測不到外掛時不自動跳出教學；使用者按頂列膠囊／「安裝外掛」才開。
status.runAll();

start();
