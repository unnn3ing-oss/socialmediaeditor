// 外殼進入點：載入工具目錄，串起版面狀態機、櫥窗、工具列、窗格與拖曳。
import * as L from './layout.js';
import { renderSkeleton, renderShowcase } from './showcase.js';
import { createToolbar } from './toolbar.js';
import { createPanes } from './panes.js';
import { initDrag } from './drag.js';
import { initStatus } from './status.js';
import { openInstall } from './install.js';
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

const byId = (id) => catalog.find((t) => t.id === id) || null;
const shownTools = () => catalog.filter((t) => t.tier === 'public' || companyState.unlocked);

const toolbar = createToolbar($('toolbar'), { onOpen: (id) => set(L.openSingle(state, id)) });
const panes = createPanes(workEl, {
  onFocus: (side) => set(L.focus(state, side)),
  onClose: (side) => set(L.closePane(state, side)),
});

function set(next) { state = next; render(); }

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
  render();
}

// ---- 狀態列與安裝教學 ----
const status = initStatus({ root: $('status'), shell: window.tbxShell, openInstall });
initCompany({ shell: window.tbxShell, button: $('company-btn') });
// 偵測不到外掛時不自動跳出教學；使用者按頂列膠囊／「安裝外掛」才開。
status.runAll();

start();
