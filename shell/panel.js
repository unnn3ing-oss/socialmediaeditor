// 單一工具外殼（panel.html?tool=<id>）：外掛側邊欄「發文」分頁嵌入這頁。
// 提供和 main.js 相同的 tbxShell（狀態、公司模式），公司工具要解鎖後才載入（素材在載入時決定）。
// 也回覆側邊欄的「一鍵檢測」：只接受固定外掛 ID 的側邊欄（EXT_ORIGIN）。
import { initCompany } from './company.js';
import { createApi, readCompany } from '../sdk/api.js';
import { createExt } from '../sdk/bridge.js';
import { API_BASE, EXT_ORIGIN } from './config.js';

const $ = (id) => document.getElementById(id);
const toolId = new URLSearchParams(location.search).get('tool') || 'fbpost';
const api = createApi();
const ext = createExt();

let catalog = [];
let tool = null;
let frame = null;
let companyState = { unlocked: false, exp: null };
const statuses = new Map();
const statusSubs = new Set();
const companySubs = new Set();

// 父視窗是外掛側邊欄才回報（ancestorOrigins 是 Chrome 提供的上層來源）
const parentOrigin = (() => {
  try { return window.parent !== window ? (location.ancestorOrigins && location.ancestorOrigins[0]) || '' : ''; } catch { return ''; }
})();
const toSidepanel = (msg) => { if (parentOrigin === EXT_ORIGIN) window.parent.postMessage({ source: 'tbx-panel', ...msg }, EXT_ORIGIN); };

const needsUnlock = () => Boolean(tool && tool.tier === 'company' && !companyState.unlocked);

function mountTool() {
  if (frame || !tool) return;
  frame = document.createElement('iframe');
  frame.title = tool.name;
  frame.src = tool.entry;
  frame.allow = 'clipboard-read; clipboard-write';
  $('panelHost').appendChild(frame);
}

// 憑證過期：蓋一層鎖定提示（不重建工具，內容保留）
function setLocked(id, locked) {
  if (!frame || id !== toolId) return;
  let lock = document.querySelector('.panel-lock');
  if (locked && !lock) {
    lock = document.createElement('div');
    lock.className = 'panel-lock';
    const p = document.createElement('p');
    p.textContent = '公司密碼已過期，重新輸入後即可繼續';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = '重新輸入';
    b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('tbx:company-login')));
    lock.append(p, b);
    $('panel').appendChild(lock);
  } else if (!locked && lock) lock.remove();
}

function render() {
  if (!tool) return;
  $('panelSk').hidden = true;
  $('panel').setAttribute('aria-busy', 'false');
  if (!frame) {
    $('panelLock').hidden = !needsUnlock();
    if (!needsUnlock()) mountTool();
  }
}

window.tbxShell = {
  getStatus: (id) => statuses.get(id) || { state: 'checking', text: '' },
  setStatus(id, value) { statuses.set(id, value); for (const fn of statusSubs) fn(id, value); },
  onStatus(fn) { statusSubs.add(fn); return () => statusSubs.delete(fn); },
  company: () => ({ ...companyState }),
  onCompany(fn) { companySubs.add(fn); return () => companySubs.delete(fn); },
  focusTool: () => {},
  _internal: {
    panes: { setLocked },
    getCatalog: () => catalog,
    setCompany(next) {
      companyState = { ...next };
      render();
      for (const fn of companySubs) fn({ ...companyState });
      toSidepanel({ type: 'company', unlocked: companyState.unlocked, exp: companyState.exp });
    },
    rerender: render,
  },
};

// ---- 一鍵檢測（側邊欄要求時才跑）----
const item = (id, label, state, text) => ({ id, label, state, text });
async function runChecks() {
  const out = [];
  try {
    const res = await fetch(API_BASE + '/auth/status');
    out.push(res.status < 500 ? item('api', '後端連線', 'ok', '正常') : item('api', '後端連線', 'warn', `伺服器錯誤（${res.status}）`));
  } catch { out.push(item('api', '後端連線', 'warn', '連不上伺服器')); }

  const cred = readCompany(window.localStorage);
  let company = false;
  if (!cred) out.push(item('company', '公司憑證', 'warn', '尚未輸入公司密碼'));
  else {
    try {
      await api.call('/auth/status');
      const now = readCompany(window.localStorage) || cred;
      const days = Math.max(0, Math.ceil((now.exp * 1000 - Date.now()) / 86400000));
      out.push(item('company', '公司憑證', 'ok', `有效，剩 ${days} 天`));
      company = true;
    } catch (e) { out.push(item('company', '公司憑證', 'warn', e && e.code === 'unauthorized' ? '已過期，請重新輸入' : '無法確認')); }
  }

  if (!company) out.push(item('fb', '臉書粉專', 'skip', '需要公司憑證'));
  else {
    try {
      const pages = await api.call('/fb/pages');
      out.push(pages.length ? item('fb', '臉書粉專', 'ok', `已連線 ${pages.length} 個粉專`) : item('fb', '臉書粉專', 'warn', '沒有可用的粉專'));
    } catch (e) { out.push(item('fb', '臉書粉專', 'warn', e && e.code === 'fb_not_configured' ? '後端還沒設定臉書 token' : '讀取失敗')); }
  }

  try { const r = await ext.call('ping', {}); out.push(item('ext', '外掛橋接', 'ok', `正常（v${r.version}）`)); }
  catch { out.push(item('ext', '外掛橋接', 'warn', '網頁收不到外掛回應')); }
  return out;
}

window.addEventListener('message', async (e) => {
  if (e.source !== window.parent || e.origin !== EXT_ORIGIN || parentOrigin !== EXT_ORIGIN) return;
  const m = e.data;
  if (!m || m.source !== 'tbx-sidepanel') return;
  if (m.type === 'check') toSidepanel({ type: 'check', id: m.id, items: await runChecks() });
  else if (m.type === 'hello') toSidepanel({ type: 'company', unlocked: companyState.unlocked, exp: companyState.exp });
});

async function start() {
  try { catalog = (await (await fetch('shell/catalog.json')).json()).tools || []; } catch { catalog = []; }
  tool = catalog.find((t) => t.id === toolId) || null;
  if (!tool) {
    $('panelSk').hidden = true; $('panelErr').hidden = false; $('panel').setAttribute('aria-busy', 'false');
    return;
  }
  document.title = `${tool.name}｜小編工具箱`;
  await initCompany({ shell: window.tbxShell, button: $('company-btn') });
  render();
  toSidepanel({ type: 'company', unlocked: companyState.unlocked, exp: companyState.exp });
}

start();
