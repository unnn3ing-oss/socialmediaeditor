// 公司模式：輸入密碼解鎖公司工具；憑證過期時自動跳登入彈窗，已開著的公司窗格保留內容。
import { createApi, COMPANY_KEY, readCompany } from '../sdk/api.js';

const CHECK_INTERVAL = 10 * 60 * 1000;

const isNetworkFailure = (e) => !e || !e.code || /^http_5/.test(e.code) || e.code === 'bad_response';

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
  const title = mk('h2', null, '公司素材');
  const label = mk('label', 'field', '公司密碼');
  const input = mk('input');
  input.type = 'password';
  input.name = 'password';
  input.autocomplete = 'off';
  input.required = true;
  label.appendChild(input);
  const err = mk('p', null, '');
  err.setAttribute('role', 'alert');
  err.style.cssText = 'margin:8px 0 0;color:#b42318;font-size:14px;min-height:1.4em';
  const actions = mk('div', 'actions');
  const cancel = mk('button', 'btn btn-secondary', '取消');
  cancel.type = 'button';
  const submit = mk('button', 'btn btn-primary', '解鎖');
  submit.type = 'submit';
  actions.append(cancel, submit);
  form.append(title, label, err, actions);
  dlg.appendChild(form);
  document.body.appendChild(dlg);

  function openLogin(expired = false) {
    title.textContent = expired ? '公司密碼已過期' : '公司素材';
    err.textContent = '';
    input.value = '';
    if (!dlg.open) dlg.showModal();
    input.focus();
  }
  cancel.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      const data = await api.call('/auth', { method: 'POST', body: { password: input.value } });
      storage.setItem(COMPANY_KEY, JSON.stringify({ token: data.token, exp: data.exp }));
      unlocked(data.exp);
      dlg.close();
    } catch (ex) {
      err.textContent = isNetworkFailure(ex) ? '連不上伺服器，請稍後再試' : '密碼不對，請再試一次';
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
  outForm.append(mk('h2', null, '登出公司模式'), mk('p', null, '登出後，公司專屬工具會從櫥窗和工具列隱藏。'), (() => { const a = mk('div', 'actions'); a.append(outCancel, outOk); return a; })());
  out.appendChild(outForm);
  document.body.appendChild(out);
  outCancel.addEventListener('click', () => out.close());
  outOk.addEventListener('click', () => { out.close(); logout(); });

  // ---- 狀態 ----
  function setLocks(locked) {
    for (const t of internal.getCatalog()) if (t.tier === 'company') internal.panes.setLocked(t.id, locked);
  }

  function unlocked(exp) {
    internal.setCompany({ unlocked: true, exp });
    const days = Math.max(0, Math.ceil((exp * 1000 - Date.now()) / 86400000));
    shell.setStatus('company', { state: 'ok', text: `公司素材已解鎖，剩 ${days} 天` });
    button.hidden = true;
    setLocks(false);
  }

  function locked() {
    internal.setCompany({ unlocked: false, exp: null });
    shell.setStatus('company', { state: 'hidden', text: '' });
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
      unlocked(now ? now.exp : data.exp);
    } catch (e) {
      if (isNetworkFailure(e)) {
        if (!shell.company().unlocked) shell.setStatus('company', { state: 'warn', text: '無法確認公司密碼' });
        return;
      }
      expire();
    }
  }

  button.addEventListener('click', () => openLogin(false));
  window.addEventListener('tbx:company-login', () => openLogin(true));
  window.addEventListener('tbx:company-logout', () => { if (!out.open) out.showModal(); });
  shell.__checkCompany = check;
  setInterval(check, CHECK_INTERVAL);

  // 開站：有憑證就確認；憑證已經過期（本機時間）也算失敗
  if (hasStoredToken()) {
    shell.setStatus('company', { state: 'checking', text: '正在確認公司密碼' });
    return check();
  }
  return Promise.resolve();
}
