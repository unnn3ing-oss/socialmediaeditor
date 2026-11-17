// 外殼進入點：載入工具目錄，串起版面狀態機、櫥窗、工具列、窗格與拖曳。
import * as L from './layout.js';
import { renderSkeleton, renderShowcase } from './showcase.js';
import { createToolbar } from './toolbar.js';
import { createPanes } from './panes.js';
import { initDrag } from './drag.js';
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
let companyState = { unlocked: false, exp: null };
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

const toolbar = createToolbar($('toolbar'), { onOpen: (id) => set(L.openSingle(state, id)) });
const panes = createPanes(workEl, {
  onFocus: (side) => set(L.focus(state, side)),
  onClose: (side) => set(L.closePane(state, side)),
});

function set(next) { state = next; render(); syncHash(); }

// ---- 網址記住目前開著的工具（#pattern、並排 #pattern+linepush）：重新整理留在原工具，上一頁／下一頁可用 ----
const hashOf = (s) => { const ids = L.visible(s); return ids.length ? `#${ids.join('+')}` : ''; };
function syncHash() {
  const want = hashOf(state);
  if (want === location.hash) return;
  try { history.pushState(null, '', want || location.pathname + location.search); } catch { /* 不支援就不記 */ }
}
function stateFromHash() {
  let raw = '';
  try { raw = decodeURIComponent(location.hash.slice(1)); } catch { raw = ''; }
  const ids = [...new Set(raw.split('+'))].filter((id) => byId(id)).slice(0, 2);
  if (!ids.length) return L.home(state);
  const one = L.openSingle(L.initial(), ids[0]);
  return ids[1] ? L.dropOnSide(one, ids[1], 'right') : one;
}
function applyHash() {
  if (hashOf(state) === location.hash) return;
  state = stateFromHash();
  render();
}
window.addEventListener('popstate', applyHash);

function render() {
  const showing = state.view === 'work';
  showcaseEl.hidden = showing;
  workEl.hidden = !showing;
  panes.sync({
    split: state.mode === 'split',
    left: showing ? byId(state.left) : null,
    right: showing && state.mode === 'split' ? byId(state.right) : null,
    last: state.last,
  });
  toolbar.setPressed(L.visible(state));
}

function renderCatalog() {
  const tools = shownTools();
  renderShowcase(showcaseEl, tools, { onOpen: (id) => set(L.openSingle(state, id)) });
  toolbar.render(tools);
  toolbar.setPressed(L.visible(state));
}

$('brand').addEventListener('click', () => set(L.home(state)));

initDrag({
  toolbar: $('toolbar'),
  zones: $('dropzones'),
  onDrop: (id, side) => set(L.dropOnSide(state, id, side)),
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
  focusTool: (id) => { if (byId(id)) set(L.openSingle(state, id)); },
  openInstall: () => openInstall(),
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
initCompany({ shell: window.tbxShell, button: $('company-btn') });
// 偵測不到外掛時不自動跳出教學；使用者按頂列膠囊／「安裝外掛」才開。
status.runAll();

start();
