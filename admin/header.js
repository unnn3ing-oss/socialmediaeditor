// 管理頁頁首右上：「外掛已連線」＋「● 公司模式 名字」（和首頁相同），切到後台也看得到留言失敗通知
//   公司模式只在用首頁登入的員工憑證進來時顯示（管理員密碼登入沒有員工身分，不顯示）。
//   帳號框：有未處理通知＝紅色光暈閃爍、只有發文者已處理的＝黃色外框；點了開通知清單（shell/notices.js）。
import { createApi, readCompany } from '../sdk/api.js';
import { createExt } from '../sdk/bridge.js';
import { createNotices, paintAlert } from '../shell/notices.js';

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const NOTE_INTERVAL = 30 * 60 * 1000;

// 外掛狀態：和首頁 shell/status.js 同樣 ping；0.4 秒沒回先顯示「未安裝外掛」
async function checkExt(pill) {
  const set = (ok, text) => { pill.className = 'pill ' + (ok ? 'pill-ok' : 'pill-warn'); pill.textContent = text; pill.hidden = false; };
  const early = setTimeout(() => set(false, '未安裝外掛'), 400);
  try { await createExt().call('ping', {}); set(true, '外掛已連線'); }
  catch (e) { set(false, e && e.code === 'no_extension' ? '未安裝外掛' : '外掛連線異常'); }
  finally { clearTimeout(early); }
}

function toast(text) {
  const t = mk('div', 'acct-toast', text);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

export function initHeader({ storage = window.localStorage } = {}) {
  const ext = $('hdExt'), btn = $('hdAcct');
  if (!ext || !btn) return;
  checkExt(ext);
  if (!readCompany(storage, Date.now())) return;   // 沒有首頁登入的員工憑證
  const api = createApi({ storage });
  const pop = mk('div', 'acct-pop');
  pop.id = 'hdPop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '通知');
  pop.hidden = true;
  const TOOL_OF = { post: 'fbpost', video: 'fbvideo' };
  const box = createNotices({ api, toast, openTool: (k) => { location.href = '../#' + (TOOL_OF[k] || 'fbpost'); }, onChange: (items) => paintAlert(btn, items) });
  pop.append(box.section);
  document.body.append(pop);
  function place() {
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.right = Math.max(16, Math.round(window.innerWidth - r.right)) + 'px';
  }
  const close = (focus = true) => { if (pop.hidden) return; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focus) btn.focus(); };
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    place(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); box.load();
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(false); });
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
  api.call('/auth/status').then((d) => {
    const s = (d && d.staff) || null;
    if (!s) return;
    btn.textContent = '';
    const dot = mk('span', 'acct-dot'); dot.setAttribute('aria-hidden', 'true');
    btn.append(dot, mk('span', 'acct-mode', '公司模式'), mk('span', 'acct-nm', s.name || ''));
    btn.hidden = false;
    box.load();
    setInterval(() => box.load(), NOTE_INTERVAL);
  }).catch(() => { /* 憑證失效：不顯示 */ });
}
initHeader();
