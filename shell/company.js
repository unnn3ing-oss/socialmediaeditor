// 公司模式：員工編號＋自己的密碼登入（第一次或被重置後用設定碼設密碼），解鎖公司工具；
// 登入後右上角「● 公司模式 名字」，點了開帳號彈窗（姓名、權限組、員工編號、分機、解鎖有效、通知、管理頁、變更密碼、登出）。
// 憑證過期時自動跳登入彈窗，已開著的公司窗格保留內容。
import { createApi, COMPANY_KEY, readCompany } from '../sdk/api.js';
import { API_ENV } from './config.js';
import { switchApiEnv } from './apienv.js';

const CHECK_INTERVAL = 10 * 60 * 1000;
const ID_KEY = 'tbx.staffId';   // 記住上次登入的員工編號（這台瀏覽器）
const PW_MIN = 8;
const isNetworkFailure = (e) => !e || !e.code || /^http_5/.test(e.code) || e.code === 'bad_response' || e.code === 'misconfigured';

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
function field(labelText, attrs, hint) {
  const label = mk('label', 'field', labelText);
  const input = mk('input');
  Object.assign(input, attrs);
  label.appendChild(input);
  const wrap = mk('div', 'login-field');
  wrap.appendChild(label);
  if (hint) wrap.appendChild(mk('p', 'login-note', hint));
  return { wrap, input };
}
const pad = (n) => String(n).padStart(2, '0');
const fmtExp = (exp) => { const d = new Date(exp * 1000); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const leftText = (exp) => { const ms = exp * 1000 - Date.now(); return ms < 86400000 ? `剩 ${Math.max(0, Math.ceil(ms / 3600000))} 小時` : `剩 ${Math.ceil(ms / 86400000)} 天`; };

// account：true＝首頁（按鈕變「● 公司模式 名字」＋帳號彈窗）；false＝外掛側邊欄（按鈕只用來開登入）
export function initCompany({ shell, button, storage = window.localStorage, api = createApi({ storage }), account = true }) {
  const internal = shell._internal;
  const getId = () => { try { return storage.getItem(ID_KEY) || ''; } catch { return ''; } };
  const setId = (v) => { try { if (v) storage.setItem(ID_KEY, v); else storage.removeItem(ID_KEY); } catch { /* 靜默 */ } };

  // ---- 登入彈窗：同一個區塊，先員工編號，再自動判斷「輸入密碼」或「設定碼＋設定新密碼」 ----
  const dlg = mk('dialog', 'dialog');
  dlg.id = 'company-dialog';
  const form = mk('form');
  form.method = 'dialog';
  form.noValidate = true;
  const title = mk('h2', null, '登入公司帳號');
  // 步驟 id：員工編號
  const fId = field('員工編號', { type: 'text', name: 'staffId', autocomplete: 'username', autocapitalize: 'characters', spellcheck: false });
  // 步驟 pw／setup 上方：目前的員工編號＋「換一個」
  const who = mk('div', 'login-who');
  const whoText = mk('span');
  const whoChange = mk('button', 'login-link', '換一個');
  whoChange.type = 'button';
  who.append(whoText, whoChange);
  // 步驟 pw：密碼
  const fPw = field('密碼', { type: 'password', name: 'password', autocomplete: 'current-password' }, '忘記密碼請找管理者重置');
  // 步驟 setup：設定碼＋新密碼×2
  const fCode = field('設定碼', { type: 'text', name: 'code', autocomplete: 'one-time-code', inputMode: 'numeric', spellcheck: false }, '管理者新增你或重置密碼時給你的 6 碼，24 小時內有效');
  const fNew = field('新密碼', { type: 'password', name: 'newPassword', autocomplete: 'new-password' }, `至少 ${PW_MIN} 個字`);
  const fNew2 = field('再輸入一次', { type: 'password', name: 'newPassword2', autocomplete: 'new-password' });
  const err = mk('p', 'login-err', '');
  err.setAttribute('role', 'alert');
  const actions = mk('div', 'actions');
  const cancel = mk('button', 'btn btn-secondary', '取消');
  cancel.type = 'button';
  const submit = mk('button', 'btn btn-primary', '下一步');
  submit.type = 'submit';
  actions.append(cancel, submit);
  // 隱藏的帳號欄：讓瀏覽器密碼管理員在密碼步驟也知道是哪個帳號
  const hiddenUser = mk('input');
  Object.assign(hiddenUser, { readOnly: true, type: 'text', name: 'username', autocomplete: 'username', tabIndex: -1 });
  hiddenUser.className = 'login-hidden-user';
  hiddenUser.setAttribute('aria-hidden', 'true');
  form.append(title, fId.wrap, who, hiddenUser, fPw.wrap, fCode.wrap, fNew.wrap, fNew2.wrap, err, actions);
  dlg.appendChild(form);
  document.body.appendChild(dlg);

  let step = 'id', staffId = '', expiredTitle = false;
  // 用 hidden 切換步驟（不重建 DOM）
  function setStep(n) {
    step = n;
    fId.wrap.hidden = n !== 'id';
    who.hidden = n === 'id';
    hiddenUser.hidden = n === 'id';
    fPw.wrap.hidden = n !== 'pw';
    for (const f of [fCode, fNew, fNew2]) f.wrap.hidden = n !== 'setup';
    whoText.textContent = '';
    whoText.append('員工編號 ', mk('b', null, staffId));
    hiddenUser.value = staffId;
    title.textContent = n === 'setup' ? '第一次登入，請設定密碼' : expiredTitle ? '登入已過期，請重新登入' : '登入公司帳號';
    submit.textContent = n === 'id' ? '下一步' : n === 'pw' ? '登入' : '設定並登入';
    err.textContent = '';
    const focus = n === 'id' ? fId.input : n === 'pw' ? fPw.input : fCode.input;
    if (dlg.open) focus.focus();
  }

  function openLogin(expired = false) {
    expiredTitle = expired;
    for (const f of [fId, fPw, fCode, fNew, fNew2]) f.input.value = '';
    staffId = getId();
    fId.input.value = staffId;
    if (!dlg.open) dlg.showModal();
    setStep(staffId ? 'pw' : 'id');
  }
  cancel.addEventListener('click', () => dlg.close());
  whoChange.addEventListener('click', () => { fId.input.value = staffId; setStep('id'); fId.input.select(); });

  const MSG = {
    bad_staff: '查不到這個員工編號，或已停用',
    setup_expired: '設定碼已過期或還沒發，請找管理者重置密碼拿新的設定碼',
  };
  function showError(ex) {
    if (isNetworkFailure(ex)) { err.textContent = '連不上伺服器，請稍後再試'; return; }
    err.textContent = MSG[ex.code] || (ex.message && ex.message !== '呼叫失敗' ? ex.message.replace(/。$/, '') : '登入失敗，請再試一次');
  }
  function done(data) {
    storage.setItem(COMPANY_KEY, JSON.stringify({ token: data.token, exp: data.exp, ...(data.staff ? { staff: data.staff } : {}) }));
    setId(data.staff ? data.staff.id : staffId);
    unlocked(data.exp, data.staff || null, !!data.manage);
    dlg.close();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (step === 'id') {
      staffId = fId.input.value.trim().toUpperCase();
      if (!staffId) { err.textContent = '請輸入員工編號'; fId.input.focus(); return; }
    } else if (step === 'pw') {
      if (!fPw.input.value) { err.textContent = '請輸入密碼'; fPw.input.focus(); return; }
    } else {
      if (!/^\d{6}$/.test(fCode.input.value.trim()) && fCode.input.value.trim().length < PW_MIN) { err.textContent = '請輸入 6 碼設定碼'; fCode.input.focus(); return; }
      if ([...fNew.input.value].length < PW_MIN) { err.textContent = `新密碼至少 ${PW_MIN} 個字`; fNew.input.focus(); return; }
      if (fNew.input.value !== fNew2.input.value) { err.textContent = '兩次輸入的新密碼不一樣'; fNew2.input.focus(); return; }
    }
    submit.disabled = true;
    try {
      if (step === 'id') {
        const r = await api.call('/auth', { method: 'POST', body: { staffId } });
        setStep(r.next === 'setup' ? 'setup' : 'pw');
      } else if (step === 'pw') {
        done(await api.call('/auth', { method: 'POST', body: { staffId, password: fPw.input.value } }));
      } else {
        done(await api.call('/auth', { method: 'POST', body: { staffId, code: fCode.input.value.trim(), newPassword: fNew.input.value } }));
      }
    } catch (ex) {
      if (ex && ex.code === 'need_setup') { setStep('setup'); return; }
      if (ex && ex.code === 'bad_staff' && step !== 'id') { setStep('id'); fId.input.value = staffId; }
      showError(ex);
      if (step === 'pw') { fPw.input.value = ''; fPw.input.focus(); }
    } finally {
      submit.disabled = false;
    }
  });

  // ---- 變更密碼 ----
  const cp = mk('dialog', 'dialog');
  cp.id = 'company-password-dialog';
  const cpForm = mk('form');
  cpForm.method = 'dialog';
  cpForm.noValidate = true;
  const cpUser = mk('input');
  Object.assign(cpUser, { readOnly: true, type: 'text', name: 'username', autocomplete: 'username', tabIndex: -1 });
  cpUser.className = 'login-hidden-user';
  cpUser.setAttribute('aria-hidden', 'true');
  const cOld = field('目前密碼', { type: 'password', name: 'password', autocomplete: 'current-password' });
  const cNew = field('新密碼', { type: 'password', name: 'newPassword', autocomplete: 'new-password' }, `至少 ${PW_MIN} 個字。改好後，其他裝置會被登出`);
  const cNew2 = field('再輸入一次', { type: 'password', name: 'newPassword2', autocomplete: 'new-password' });
  const cErr = mk('p', 'login-err', '');
  cErr.setAttribute('role', 'alert');
  const cActions = mk('div', 'actions');
  const cCancel = mk('button', 'btn btn-secondary', '取消');
  cCancel.type = 'button';
  const cOk = mk('button', 'btn btn-primary', '變更');
  cOk.type = 'submit';
  cActions.append(cCancel, cOk);
  cpForm.append(mk('h2', null, '變更密碼'), cpUser, cOld.wrap, cNew.wrap, cNew2.wrap, cErr, cActions);
  cp.appendChild(cpForm);
  document.body.appendChild(cp);
  cCancel.addEventListener('click', () => cp.close());
  cp.addEventListener('close', () => button.focus());
  function openChangePassword() {
    for (const f of [cOld, cNew, cNew2]) f.input.value = '';
    cErr.textContent = '';
    const s = shell.company().staff;
    cpUser.value = s ? s.id : '';
    cp.showModal();
    cOld.input.focus();
  }
  cpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    cErr.textContent = '';
    if (!cOld.input.value) { cErr.textContent = '請輸入目前密碼'; cOld.input.focus(); return; }
    if ([...cNew.input.value].length < PW_MIN) { cErr.textContent = `新密碼至少 ${PW_MIN} 個字`; cNew.input.focus(); return; }
    if (cNew.input.value !== cNew2.input.value) { cErr.textContent = '兩次輸入的新密碼不一樣'; cNew2.input.focus(); return; }
    cOk.disabled = true;
    try {
      const data = await api.call('/staff/me/password', { method: 'POST', body: { password: cOld.input.value, newPassword: cNew.input.value } });
      storage.setItem(COMPANY_KEY, JSON.stringify({ token: data.token, exp: data.exp, ...(data.staff ? { staff: data.staff } : {}) }));
      unlocked(data.exp, data.staff || null, !!data.manage);
      cp.close();
      showToast('密碼已變更，其他裝置已登出');
    } catch (ex) {
      if (ex && ex.code === 'unauthorized') { cp.close(); expire(); return; }
      cErr.textContent = isNetworkFailure(ex) ? '連不上伺服器，請稍後再試' : (ex.message || '變更失敗').replace(/。$/, '');
    } finally {
      cOk.disabled = false;
    }
  });

  // 小提示（變更密碼成功）
  function showToast(text) {
    const t = mk('div', 'acct-toast', text);
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ---- 帳號彈窗（非模態，點外面或 Esc 關閉，焦點回按鈕）----
  const pop = mk('div', 'acct-pop');
  pop.id = 'acct-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '帳號');
  pop.hidden = true;
  const head = mk('div', 'acct-head');
  const av = mk('div', 'acct-av');
  av.setAttribute('aria-hidden', 'true');
  const nameBox = mk('div');
  const nameEl = mk('b', 'acct-name');
  const lvEl = mk('span', 'acct-lv');
  nameBox.append(nameEl, lvEl);
  head.append(av, nameBox);
  const dl = mk('dl', 'acct-dl');
  const dd = {};
  for (const [k, label] of [['id', '員工編號'], ['contact', '分機'], ['exp', '解鎖有效']]) {
    dl.append(mk('dt', null, label));
    dd[k] = mk('dd');
    dd[k].dataset.k = k;
    dl.append(dd[k]);
  }
  const notice = mk('div', 'acct-sec');
  const noticeEmpty = mk('div', 'acct-empty', '目前沒有通知');
  const noticeList = mk('ul', 'acct-notes');
  noticeList.hidden = true;
  notice.append(mk('h3', null, '通知'), noticeEmpty, noticeList);
  const act = mk('div', 'acct-act');
  const manageBtn = mk('a', 'btn btn-primary acct-manage', '管理頁');
  manageBtn.href = new URL('admin/', document.baseURI).href;
  const cpBtn = mk('button', 'btn btn-secondary', '變更密碼');
  cpBtn.type = 'button';
  const outBtn = mk('button', 'btn btn-secondary', '登出');
  outBtn.type = 'button';
  outBtn.id = 'company-logout';
  act.append(manageBtn, cpBtn, outBtn);
  // 只有正式後端的系統管理者看得到（同事看不到入口）
  const toDev = mk('button', 'acct-dev', '切到測試後端');
  toDev.type = 'button';
  toDev.id = 'to-dev-backend';
  pop.append(head, dl, notice, act, toDev);
  document.body.appendChild(pop);

  let manage = false;
  let contactReq = 0;
  function renderPop() {
    const c = shell.company();
    const s = c.staff || {};
    const name = s.name || (c.admin ? '管理員' : '');
    av.textContent = [...name][0] || '';
    nameEl.textContent = name;
    const level = s.level || (c.admin ? 'sys' : '');
    lvEl.textContent = level === 'sys' ? '系統管理者' : (s.group || '');
    lvEl.hidden = !lvEl.textContent;
    dd.id.textContent = s.id || '—';
    dd.exp.textContent = '';
    if (c.exp) dd.exp.append(fmtExp(c.exp), ' ', mk('small', null, `（${leftText(c.exp)}）`));
    manageBtn.hidden = !manage;
    cpBtn.hidden = !s.id;
    toDev.hidden = !(API_ENV === 'prod' && level === 'sys');
  }
  // 分機每次開彈窗讀一次（直播需求單可能改過）；讀不到顯示「—」
  async function loadContact() {
    const my = ++contactReq;
    dd.contact.textContent = '…';
    if (!(shell.company().staff || {}).id) { dd.contact.textContent = '—'; return; }
    try {
      const p = await api.call('/staff/me');
      if (my === contactReq) dd.contact.textContent = (p && p.contact) || '未填';
    } catch { if (my === contactReq) dd.contact.textContent = '—'; }
  }
  // ---- 留言失敗通知（/staff/me/notices，權限組有 notify 才有；只查 D1）：開彈窗、登入後、每 30 分鐘各讀一次 ----
  let notes = [];
  let noteReq = 0;
  const NOTE_INTERVAL = 30 * 60 * 1000;
  const TOOL_OF = { post: 'fbpost', video: 'fbvideo' };
  function fmtNoteTime(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function openTool(id) {
    closePop(false);
    try { history.pushState(null, '', '#' + id); } catch { location.hash = id; return; }
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  function renderNotes() {
    noticeList.textContent = '';
    noticeEmpty.hidden = notes.length > 0;
    noticeList.hidden = !notes.length;
    for (const n of notes) {
      const li = mk('li', 'acct-note');
      const top = mk('div', 'acct-note-top');
      top.append(mk('b', null, `${n.pageName}｜第 ${n.seq} 則留言${n.failed ? '失敗' : '重試中'}`), mk('small', null, fmtNoteTime(n.at)));
      li.append(top);
      if (n.error) { const er = mk('div', 'acct-note-err', n.error); er.title = n.error; li.append(er); }
      const acts = mk('div', 'acct-note-act');
      if (n.canRetry) {
        const rb = mk('button', 'btn btn-secondary btn-sm', '重新留言');
        rb.type = 'button';
        rb.addEventListener('click', async () => {
          rb.disabled = true;
          try {
            await api.call('/fb/comment/retry', { method: 'POST', body: { postId: n.postId, page: n.page } });
            notes = notes.filter((x) => x !== n);
            renderNotes(); renderButton();
            showToast('已要求重新留言，稍後會再試一次');
          } catch (ex) { rb.disabled = false; showToast((ex && ex.message) || '重新留言失敗'); }
        });
        acts.append(rb);
      }
      const go = mk('button', 'btn btn-secondary btn-sm', n.kind === 'video' ? '開影片發布' : '開排程發布');
      go.type = 'button';
      go.addEventListener('click', () => openTool(TOOL_OF[n.kind] || 'fbpost'));
      acts.append(go);
      li.append(acts);
      noticeList.append(li);
    }
  }
  async function loadNotes() {
    if (!account || !(shell.company().staff || {}).id) return;
    const my = ++noteReq;
    try {
      const d = await api.call('/staff/me/notices');
      if (my !== noteReq) return;
      notes = (d && d.enabled && Array.isArray(d.items)) ? d.items : [];
    } catch { return; /* 讀不到維持原本 */ }
    renderNotes();
    renderButton();
  }
  setInterval(() => { if (shell.company().unlocked) loadNotes(); }, NOTE_INTERVAL);

  // 貼在按鈕下方、右緣對齊；窄螢幕左右撐滿（CSS）
  function place() {
    const r = button.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.right = Math.max(16, Math.round(window.innerWidth - r.right)) + 'px';
  }
  function openPop() {
    if (!account) return;
    renderPop();
    place();
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    loadContact();
    loadNotes();
    (manageBtn.hidden ? cpBtn.hidden ? outBtn : cpBtn : manageBtn).focus();
  }
  function closePop(focusBack = true) {
    if (pop.hidden) return;
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focusBack) button.focus();
  }
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !button.contains(e.target)) closePop(false); });
  cpBtn.addEventListener('click', () => { closePop(false); openChangePassword(); });
  outBtn.addEventListener('click', () => { closePop(false); logout(); button.focus(); });
  toDev.addEventListener('click', () => { closePop(false); switchApiEnv('dev', { storage }); });
  manageBtn.addEventListener('click', () => closePop(false));

  // ---- 右上角按鈕：未登入「登入」；已登入「● 公司模式 名字」 ----
  function renderButton() {
    if (!account) return;
    const c = shell.company();
    button.textContent = '';
    if (!c.unlocked) {
      button.className = 'btn btn-secondary btn-sm';
      button.textContent = '登入';
      button.removeAttribute('aria-haspopup');
      button.removeAttribute('aria-expanded');
      return;
    }
    const s = c.staff || {};
    button.className = 'acct-pill';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', String(!pop.hidden));
    const dot = mk('span', 'acct-dot');
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot, mk('span', 'acct-mode', '公司模式'), mk('span', 'acct-nm', s.name || (c.admin ? '管理員' : '')));
    // 有通知：名字右上紅點，讀屏念「有 N 則通知」
    if (notes.length) {
      const nd = mk('span', 'acct-ndot');
      nd.setAttribute('aria-hidden', 'true');
      button.append(nd, mk('span', 'sr-only', `，有 ${notes.length} 則通知`));
    }
  }
  button.addEventListener('click', () => {
    if (!shell.company().unlocked) { openLogin(false); return; }
    if (pop.hidden) openPop(); else closePop();
  });

  // ---- 狀態 ----
  function setLocks(locked) {
    for (const t of internal.getCatalog()) if (t.tier === 'company') internal.panes.setLocked(t.id, locked);
  }

  // staff：員工資料 { id, name, group, level }；admin：舊版首頁管理員憑證（已不再發出，到期前仍可用）
  let notesLoaded = false;
  function unlocked(exp, staff = null, mg = false, admin = false) {
    if (!notesLoaded && staff && staff.id) { notesLoaded = true; setTimeout(loadNotes, 0); }
    internal.setCompany({ unlocked: true, exp, admin: Boolean(admin || (staff && staff.level === 'sys')), staff: staff || null });
    manage = mg;
    shell.setStatus('company', { state: 'hidden', text: '' });
    renderButton();
    if (!pop.hidden) renderPop();
    setLocks(false);
  }

  function locked() {
    notes = []; notesLoaded = false; noteReq++;
    renderNotes();
    internal.setCompany({ unlocked: false, exp: null, admin: false, staff: null });
    manage = false;
    shell.setStatus('company', { state: 'hidden', text: '' });
    closePop(false);
    renderButton();
  }

  function logout() {
    try { storage.removeItem(COMPANY_KEY); } catch { /* 靜默 */ }
    locked();
    setLocks(true);
  }

  function expire() {
    try { storage.removeItem(COMPANY_KEY); } catch { /* 靜默 */ }
    locked();
    setLocks(true);
    openLogin(true);
  }

  const hasStoredToken = () => {
    try { return Boolean(storage.getItem(COMPANY_KEY)); } catch { return false; }
  };

  // 立即檢查一次憑證（定時檢查與 e2e 都呼叫它）
  async function check() {
    if (!hasStoredToken()) {
      if (shell.company().unlocked) expire();
      return;
    }
    const cred = readCompany(storage);
    if (!cred) { expire(); return; }
    try {
      const data = await api.call('/auth/status');
      const now = readCompany(storage); // api.call 若收到 renew 會已更新
      const staff = data.staff || null;
      if (staff) { try { const c = readCompany(storage); if (c) storage.setItem(COMPANY_KEY, JSON.stringify({ ...c, staff })); } catch { /* 靜默 */ } }
      unlocked(now ? now.exp : data.exp, staff, !!data.manage, !!data.admin);
    } catch (e) {
      if (isNetworkFailure(e)) {
        if (!shell.company().unlocked) shell.setStatus('company', { state: 'warn', text: '無法確認登入狀態' });
        return;
      }
      expire();
    }
  }

  window.addEventListener('tbx:company-login', (e) => openLogin(!(e.detail && e.detail.fresh)));
  window.addEventListener('tbx:company-logout', () => { if (shell.company().unlocked) openPop(); });
  shell.__checkCompany = check;
  setInterval(check, CHECK_INTERVAL);
  renderButton();

  // 開站：有憑證就確認；憑證已經過期（本機時間）也算失敗
  if (hasStoredToken()) {
    shell.setStatus('company', { state: 'checking', text: '正在確認登入狀態' });
    return check();
  }
  return Promise.resolve();
}
