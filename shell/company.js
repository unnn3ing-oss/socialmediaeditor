// 公司模式：輸入密碼解鎖公司工具；憑證過期時自動跳登入彈窗，已開著的公司窗格保留內容。
import { createApi, COMPANY_KEY, readCompany } from '../sdk/api.js';
import { API_ENV } from './config.js';
import { switchApiEnv } from './apienv.js';

const CHECK_INTERVAL = 10 * 60 * 1000;

const TAB_KEY = 'tbx.loginTab';
const isNetworkFailure = (e) => !e || !e.code || /^http_5/.test(e.code) || e.code === 'bad_response' || e.code === 'misconfigured';

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function initCompany({ shell, button, storage = window.localStorage, api = createApi({ storage }) }) {
  const internal = shell._internal;

  // ---- 登入彈窗 ----
  const dlg = mk('dialog', 'dialog');
  dlg.id = 'company-dialog';
  const form = mk('form');
  form.method = 'dialog';
  const title = mk('h2', null, '登入公司帳號');
  // 兩個分頁用 hidden 切換（不重建 DOM）：員工編號（預設）｜公司密碼
  const tabs = mk('div', 'login-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabStaff = mk('button', null, '員工編號');
  const tabPw = mk('button', null, '公司密碼');
  for (const [b, n] of [[tabStaff, 'staff'], [tabPw, 'password']]) { b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = n; }
  tabs.append(tabStaff, tabPw);
  const staffPane = mk('div');
  const staffLabel = mk('label', 'field', '員工編號');
  const staffInput = mk('input');
  staffInput.type = 'text';
  staffInput.name = 'staffId';
  staffInput.autocomplete = 'username';
  staffInput.autocapitalize = 'characters';
  staffInput.setAttribute('inputmode', 'text');
  staffInput.spellcheck = false;
  staffLabel.appendChild(staffInput);
  staffPane.append(staffLabel, mk('p', 'login-note', '有排程發布權限的同事用員工編號登入；其他工具也會一起解鎖。'));
  const pwPane = mk('div');
  const label = mk('label', 'field', '公司密碼');
  const input = mk('input');
  input.type = 'password';
  input.name = 'password';
  input.autocomplete = 'off';
  label.appendChild(input);
  pwPane.appendChild(label);
  let tab = 'staff';
  try { if (storage.getItem(TAB_KEY) === 'password') tab = 'password'; } catch { /* 靜默 */ }
  function setTab(n, focus = false) {
    tab = n;
    for (const b of [tabStaff, tabPw]) { const on = b.dataset.tab === n; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', String(on)); }
    staffPane.hidden = n !== 'staff';
    pwPane.hidden = n !== 'password';
    staffInput.required = n === 'staff';
    input.required = n === 'password';
    err.textContent = '';
    if (focus) (n === 'staff' ? staffInput : input).focus();
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    setTab(b.dataset.tab, true);
    try { storage.setItem(TAB_KEY, b.dataset.tab); } catch { /* 靜默 */ }
  });
  const err = mk('p', null, '');
  err.setAttribute('role', 'alert');
  err.style.cssText = 'margin:8px 0 0;color:#b42318;font-size:14px;min-height:1.4em';
  const actions = mk('div', 'actions');
  const cancel = mk('button', 'btn btn-secondary', '取消');
  cancel.type = 'button';
  const submit = mk('button', 'btn btn-primary', '解鎖');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(title, tabs, staffPane, pwPane, err, actions);
  setTab(tab);
  dlg.appendChild(form);
  document.body.appendChild(dlg);

  function openLogin(expired = false) {
    title.textContent = expired ? '公司密碼已過期' : '登入公司帳號';
    err.textContent = '';
    input.value = '';
    staffInput.value = '';
    setTab(tab);
    if (!dlg.open) dlg.showModal();
    (tab === 'staff' ? staffInput : input).focus();
  }
  cancel.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      const body = tab === 'staff' ? { staffId: staffInput.value.trim() } : { password: input.value };
      const data = await api.call('/auth', { method: 'POST', body });
      storage.setItem(COMPANY_KEY, JSON.stringify({ token: data.token, exp: data.exp, ...(data.admin ? { admin: true } : {}), ...(data.staff ? { staff: data.staff } : {}) }));
      unlocked(data.exp, !!data.admin, data.staff || null, !!data.manage);
      dlg.close();
    } catch (ex) {
      err.textContent = isNetworkFailure(ex) ? '連不上伺服器，請稍後再試'
        : (ex.code === 'bad_staff' ? '查不到這個員工編號，或已停用' : (tab === 'staff' ? '登入失敗，請再試一次' : '密碼不對，請再試一次'));
    } finally {
      submit.disabled = false;
    }
  });

  // ---- 登出確認 ----
  const out = mk('dialog', 'dialog');
  out.id = 'company-logout-dialog';
  const outForm = mk('div');
  const outCancel = mk('button', 'btn btn-secondary', '取消');
  outCancel.type = 'button';
  const outOk = mk('button', 'btn btn-primary', '登出公司模式');
  outOk.type = 'button';
  // 只有正式後端＋管理員密碼登入才看得到（同事看不到入口）
  const toDev = mk('button', 'btn btn-secondary', '切到測試後端');
  toDev.type = 'button';
  toDev.id = 'to-dev-backend';
  toDev.hidden = true;
  outForm.append(mk('h2', null, '登出公司模式'), mk('p', null, '登出後，公司專屬工具會從櫥窗和工具列隱藏。'), (() => { const a = mk('div', 'actions'); a.append(toDev, outCancel, outOk); return a; })());
  out.appendChild(outForm);
  document.body.appendChild(out);
  outCancel.addEventListener('click', () => out.close());
  outOk.addEventListener('click', () => { out.close(); logout(); });
  toDev.addEventListener('click', () => { out.close(); switchApiEnv('dev', { storage }); });

  // ---- 狀態 ----
  function setLocks(locked) {
    for (const t of internal.getCatalog()) if (t.tier === 'company') internal.panes.setLocked(t.id, locked);
  }

  // admin：前端用管理密碼登入（12 小時、不受暫停排程發布限制），剩餘時間改用小時
  // manage：顯示「管理頁」膠囊（管理員密碼登入，或員工層級在管理頁至少有一張卡片）
  function unlocked(exp, admin = false, staff = null, manage = false) {
    internal.setCompany({ unlocked: true, exp, admin: Boolean(admin), staff: staff || null });
    const left = exp * 1000 - Date.now();
    const text = staff && staff.name ? `${staff.name} 已登入，剩 ${Math.max(0, Math.ceil(left / 86400000))} 天`
      : admin ? `公司素材已解鎖（管理員），剩 ${Math.max(0, Math.ceil(left / 3600000))} 小時`
      : `公司素材已解鎖，剩 ${Math.max(0, Math.ceil(left / 86400000))} 天`;
    shell.setStatus('company', { state: 'ok', text });
    shell.setStatus('manage', manage ? { state: 'ok', text: '管理頁' } : { state: 'hidden', text: '' });
    button.hidden = true;
    setLocks(false);
  }

  function locked() {
    internal.setCompany({ unlocked: false, exp: null, admin: false, staff: null });
    shell.setStatus('company', { state: 'hidden', text: '' });
    shell.setStatus('manage', { state: 'hidden', text: '' });
    button.hidden = false;
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
      unlocked(now ? now.exp : data.exp, !!data.admin, staff, !!data.manage);
    } catch (e) {
      if (isNetworkFailure(e)) {
        if (!shell.company().unlocked) shell.setStatus('company', { state: 'warn', text: '無法確認公司密碼' });
        return;
      }
      expire();
    }
  }

  button.addEventListener('click', () => openLogin(false));
  window.addEventListener('tbx:company-login', (e) => openLogin(!(e.detail && e.detail.fresh)));
  window.addEventListener('tbx:company-logout', () => {
    toDev.hidden = !(API_ENV === 'prod' && shell.company().admin);
    if (!out.open) out.showModal();
  });
  shell.__checkCompany = check;
  setInterval(check, CHECK_INTERVAL);

  // 開站：有憑證就確認；憑證已經過期（本機時間）也算失敗
  if (hasStoredToken()) {
    shell.setStatus('company', { state: 'checking', text: '正在確認公司密碼' });
    return check();
  }
  return Promise.resolve();
}
