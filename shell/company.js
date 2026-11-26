// 公司模式：員工編號＋自己的密碼登入（第一次或被重置後用設定碼設密碼），解鎖公司工具；
// 查不到員工編號且後端開放註冊時多一個「註冊」：員工編號＋姓名 → 送出前再輸入一次員工編號確認 → 拿 10 分鐘一次性密碼，馬上設定自己的密碼並登入。
// 登入後右上角「● 公司模式 名字」，點了開帳號彈窗（姓名、權限組、員工編號、分機、解鎖有效、通知、管理頁、變更密碼、登出）。
// 憑證過期時自動跳登入彈窗，已開著的公司窗格保留內容。
import { createApi, COMPANY_KEY, readCompany } from '../sdk/api.js';
import { API_ENV } from './config.js';
import { switchApiEnv } from './apienv.js';
import { createNotices, paintAlert } from './notices.js';
import { busy, idle, fail, shake } from '../ui/fx.js';

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
  const CODE_HINT = fCode.wrap.querySelector('.login-note').textContent;
  // 步驟 reg：註冊（員工編號＋姓名）
  const fRegId = field('員工編號', { type: 'text', name: 'regStaffId', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false });
  const fName = field('姓名', { type: 'text', name: 'regName', autocomplete: 'name', maxLength: 20 });
  // 註冊完成：一次性密碼＋複製＋倒數（顯示在設定密碼步驟上方）
  const otp = mk('div', 'login-otp');
  otp.id = 'login-otp';
  const otpLabel = mk('span', 'login-otp-label', '一次性密碼');
  const otpCode = mk('b', 'login-otp-code');
  const otpCopy = mk('button', 'login-link', '複製');
  otpCopy.type = 'button';
  const otpLeft = mk('span', 'login-otp-left');
  otp.append(otpLabel, otpCode, otpCopy, otpLeft);
  otp.hidden = true;
  const err = mk('p', 'login-err', '');
  err.setAttribute('role', 'alert');
  const actions = mk('div', 'actions');
  const regBtn = mk('button', 'btn btn-secondary login-reg', '註冊');
  regBtn.type = 'button';
  regBtn.hidden = true;
  const cancel = mk('button', 'btn btn-secondary', '取消');
  cancel.type = 'button';
  const submit = mk('button', 'btn btn-primary', '下一步');
  submit.type = 'submit';
  actions.append(regBtn, cancel, submit);
  // 隱藏的帳號欄：讓瀏覽器密碼管理員在密碼步驟也知道是哪個帳號
  const hiddenUser = mk('input');
  Object.assign(hiddenUser, { readOnly: true, type: 'text', name: 'username', autocomplete: 'username', tabIndex: -1 });
  hiddenUser.className = 'login-hidden-user';
  hiddenUser.setAttribute('aria-hidden', 'true');
  form.append(title, fId.wrap, fRegId.wrap, fName.wrap, who, hiddenUser, otp, fPw.wrap, fCode.wrap, fNew.wrap, fNew2.wrap, err, actions);
  dlg.appendChild(form);
  document.body.appendChild(dlg);

  // 註冊送出前：再輸入一次員工編號確認（疊在登入彈窗上）
  const cf = mk('dialog', 'dialog');
  cf.id = 'company-reg-confirm';
  const cfForm = mk('form');
  cfForm.method = 'dialog';
  cfForm.noValidate = true;
  const cfId = field('請再輸入一次員工編號', { type: 'text', name: 'regStaffId2', autocomplete: 'off', autocapitalize: 'characters', spellcheck: false }, '確認無誤才會送出註冊');
  const cfErr = mk('p', 'login-err', '');
  cfErr.setAttribute('role', 'alert');
  const cfActions = mk('div', 'actions');
  const cfCancel = mk('button', 'btn btn-secondary', '取消');
  cfCancel.type = 'button';
  const cfOk = mk('button', 'btn btn-primary', '確定送出');
  cfOk.type = 'submit';
  cfActions.append(cfCancel, cfOk);
  cfForm.append(mk('h2', null, '確認員工編號'), cfId.wrap, cfErr, cfActions);
  cf.appendChild(cfForm);
  document.body.appendChild(cf);
  cfCancel.addEventListener('click', () => cf.close());
  cf.addEventListener('close', () => { if (dlg.open && step === 'reg') fName.input.focus(); });

  let step = 'id', staffId = '', expiredTitle = false, canRegister = false, otpExp = 0, otpTimer = 0;
  // 用 hidden 切換步驟（不重建 DOM）
  function setStep(n) {
    step = n;
    fId.wrap.hidden = n !== 'id';
    fRegId.wrap.hidden = fName.wrap.hidden = n !== 'reg';
    who.hidden = n === 'id' || n === 'reg';
    hiddenUser.hidden = n === 'id' || n === 'reg';
    fPw.wrap.hidden = n !== 'pw';
    for (const f of [fCode, fNew, fNew2]) f.wrap.hidden = n !== 'setup';
    regBtn.hidden = n !== 'id' || !canRegister;
    if (n !== 'setup') stopOtp();
    whoText.textContent = '';
    whoText.append('員工編號 ', mk('b', null, staffId));
    hiddenUser.value = staffId;
    title.textContent = n === 'reg' ? '註冊' : n === 'setup' ? (otpExp ? '註冊完成，請設定密碼' : '第一次登入，請設定密碼') : expiredTitle ? '登入已過期，請重新登入' : '登入公司帳號';
    idle(submit, stepLabel(n));
    err.textContent = '';
    const focus = n === 'id' ? fId.input : n === 'reg' ? (fRegId.input.value ? fName.input : fRegId.input) : n === 'pw' ? fPw.input : otpExp ? fNew.input : fCode.input;
    if (dlg.open) focus.focus();
  }

  const stepLabel = (n) => (n === 'id' ? '下一步' : n === 'reg' ? '送出註冊' : n === 'pw' ? '登入' : '設定並登入');
  // 一次性密碼：顯示、倒數，過期提示
  const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + pad(t % 60); };
  function tickOtp() {
    const ms = otpExp - Date.now();
    otpLeft.textContent = ms > 0 ? `10 分鐘內有效（剩 ${mmss(ms)}）` : '已過期，請找管理者重置密碼';
    otp.classList.toggle('is-expired', ms <= 0);
    if (ms <= 0) { clearInterval(otpTimer); otpTimer = 0; }
  }
  function startOtp(code, exp) {
    otpExp = exp;
    otpCode.textContent = code;
    fCode.input.value = code;
    fCode.wrap.querySelector('.login-note').textContent = '已自動帶入';
    fCode.wrap.querySelector('label').firstChild.nodeValue = '一次性密碼';
    otp.hidden = false;
    clearInterval(otpTimer);
    tickOtp();
    otpTimer = setInterval(tickOtp, 1000);
  }
  function stopOtp() {
    clearInterval(otpTimer); otpTimer = 0; otpExp = 0;
    otp.hidden = true;
    fCode.wrap.querySelector('.login-note').textContent = CODE_HINT;
    fCode.wrap.querySelector('label').firstChild.nodeValue = '設定碼';
  }
  otpCopy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(otpCode.textContent); otpCopy.textContent = '已複製'; }
    catch { otpCopy.textContent = '複製失敗'; }
    setTimeout(() => { otpCopy.textContent = '複製'; }, 1500);
  });
  regBtn.addEventListener('click', () => {
    fRegId.input.value = (fId.input.value || '').trim().toUpperCase();
    fName.input.value = '';
    setStep('reg');
  });
  function openLogin(expired = false) {
    expiredTitle = expired;
    canRegister = false;
    for (const f of [fId, fPw, fCode, fNew, fNew2, fRegId, fName]) f.input.value = '';
    staffId = getId();
    fId.input.value = staffId;
    if (!dlg.open) dlg.showModal();
    setStep(staffId ? 'pw' : 'id');
  }
  cancel.addEventListener('click', () => { if (step === 'reg') setStep('id'); else dlg.close(); });
  dlg.addEventListener('close', () => { stopOtp(); if (cf.open) cf.close(); });
  whoChange.addEventListener('click', () => { fId.input.value = staffId; setStep('id'); fId.input.select(); });

  const MSG = {
    bad_staff: '查不到這個員工編號，或已停用',
    reg_closed: '目前沒有開放註冊，請找管理者幫你加入授權名單',
    setup_expired: '設定碼已過期或還沒發，請找管理者重置密碼拿新的設定碼',
  };
  function showError(ex) {
    if (isNetworkFailure(ex)) { err.textContent = '連不上伺服器，請稍後再試'; return; }
    if (ex.code === 'bad_staff' && canRegister) { err.textContent = '查不到這個員工編號。第一次使用請按「註冊」'; return; }
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
    } else if (step === 'reg') {
      const id = fRegId.input.value.trim().toUpperCase();
      if (!id) { err.textContent = '請輸入員工編號'; fRegId.input.focus(); return; }
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) { err.textContent = '員工編號只能是英數字、- 或 _，最多 20 字'; fRegId.input.focus(); return; }
      if (!fName.input.value.trim()) { err.textContent = '請輸入姓名'; fName.input.focus(); return; }
      fRegId.input.value = id;
      cfId.input.value = '';
      cfErr.textContent = '';
      idle(cfOk, '確定送出');
      cf.showModal();
      cfId.input.focus();
      return;
    } else if (step === 'pw') {
      if (!fPw.input.value) { err.textContent = '請輸入密碼'; fPw.input.focus(); return; }
    } else {
      if (!/^\d{6}$/.test(fCode.input.value.trim()) && fCode.input.value.trim().length < PW_MIN) { err.textContent = '請輸入 6 碼設定碼'; fCode.input.focus(); return; }
      if ([...fNew.input.value].length < PW_MIN) { err.textContent = `新密碼至少 ${PW_MIN} 個字`; fNew.input.focus(); return; }
      if (fNew.input.value !== fNew2.input.value) { err.textContent = '兩次輸入的新密碼不一樣'; fNew2.input.focus(); return; }
    }
    busy(submit, step === 'id' ? '確認中' : step === 'pw' ? '登入中' : '設定中');
    let failed = false;
    try {
      if (step === 'id') {
        const r = await api.call('/auth', { method: 'POST', body: { staffId } });
        canRegister = false;
        setStep(r.next === 'setup' ? 'setup' : 'pw');
      } else if (step === 'pw') {
        done(await api.call('/auth', { method: 'POST', body: { staffId, password: fPw.input.value } }));
      } else {
        done(await api.call('/auth', { method: 'POST', body: { staffId, code: fCode.input.value.trim(), newPassword: fNew.input.value } }));
      }
    } catch (ex) {
      if (ex && ex.code === 'need_setup') { setStep('setup'); return; }
      if (ex && ex.code === 'bad_staff') {
        canRegister = !!(ex.detail && ex.detail.register);
        if (step !== 'id') { setStep('id'); fId.input.value = staffId; } else regBtn.hidden = !canRegister;
      }
      showError(ex);
      failed = true;
      if (step === 'pw') { fPw.input.value = ''; fPw.input.focus(); shake(fPw.input); }
    } finally {
      if (failed) fail(submit, stepLabel(step)); else idle(submit, stepLabel(step));
    }
  });

  // 確認框送出：兩次一致才呼叫註冊；成功切到設定密碼並帶入一次性密碼
  cfForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    cfErr.textContent = '';
    const id = fRegId.input.value.trim().toUpperCase();
    const id2 = cfId.input.value.trim().toUpperCase();
    if (!id2) { cfErr.textContent = '請再輸入一次員工編號'; cfId.input.focus(); return; }
    if (id2 !== id) { cfErr.textContent = '兩次輸入的員工編號不一樣'; cfId.input.select(); shake(cfId.input); return; }
    busy(cfOk, '送出中');
    let bad = false;
    try {
      const r = await api.call('/auth', { method: 'POST', body: { register: true, staffId: id, staffId2: id2, name: fName.input.value.trim() } });
      staffId = r.staffId || id;
      setId(staffId);
      canRegister = false;
      idle(cfOk, '確定送出');
      cf.close();
      for (const f of [fNew, fNew2]) f.input.value = '';
      startOtp(r.code, r.exp);
      setStep('setup');
    } catch (ex) {
      bad = true;
      cfErr.textContent = isNetworkFailure(ex) ? '連不上伺服器，請稍後再試' : (MSG[ex.code] || (ex.message || '註冊失敗').replace(/。$/, ''));
    } finally {
      if (bad) fail(cfOk, '確定送出');
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
    busy(cOk, '儲存中');
    let cFailed = false;
    try {
      const data = await api.call('/staff/me/password', { method: 'POST', body: { password: cOld.input.value, newPassword: cNew.input.value } });
      storage.setItem(COMPANY_KEY, JSON.stringify({ token: data.token, exp: data.exp, ...(data.staff ? { staff: data.staff } : {}) }));
      unlocked(data.exp, data.staff || null, !!data.manage);
      cp.close();
      showToast('密碼已變更，其他裝置已登出');
    } catch (ex) {
      if (ex && ex.code === 'unauthorized') { cp.close(); expire(); return; }
      cErr.textContent = isNetworkFailure(ex) ? '連不上伺服器，請稍後再試' : (ex.message || '變更失敗').replace(/。$/, '');
      cFailed = true;
      if (ex && (ex.code === 'bad_password' || /密碼/.test(ex.message || ''))) shake(cOld.input);
    } finally {
      if (cFailed) fail(cOk, '變更'); else idle(cOk, '變更');
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
  // 留言失敗通知（shell/notices.js，管理頁頁首共用）
  const TOOL_OF = { post: 'fbpost', video: 'fbvideo' };
  const noticeBox = createNotices({ api, openTool: (k) => openTool(TOOL_OF[k] || 'fbpost'), toast: (t) => showToast(t), onChange: () => renderButton() });
  const notice = noticeBox.section;
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
  // ---- 留言失敗通知：開彈窗、登入後、每 30 分鐘各讀一次 ----
  const NOTE_INTERVAL = 30 * 60 * 1000;
  function openTool(id) {
    closePop(false);
    try { history.pushState(null, '', '#' + id); } catch { location.hash = id; return; }
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  function loadNotes() {
    if (!account || !(shell.company().staff || {}).id) return;
    noticeBox.load();
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
    // 有未處理通知：帳號框紅色光暈閃爍（不放紅點）；只有發文者已處理的：黃色外框（notices.js）
    paintAlert(button, noticeBox.items(), noticeBox.msgs());
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
    notesLoaded = false;
    noticeBox.clear();
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
