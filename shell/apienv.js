// 測試後端切換（只有正式後端的系統管理者，帳號彈窗才有「切到測試後端」；見 company.js）。
// 測試模式時頂列一直顯示「測試後端」膠囊，點了確認後切回正式。
import { API_ENV, API_ENV_KEY } from './config.js';

export function switchApiEnv(env, { storage = window.localStorage, reload = () => window.location.reload() } = {}) {
  try {
    if (env === 'dev') storage.setItem(API_ENV_KEY, 'dev');
    else storage.removeItem(API_ENV_KEY);
  } catch { /* 存不進去就維持原樣 */ }
  reload();
}

export function initApiEnv({ shell, env = API_ENV, storage = window.localStorage, reload } = {}) {
  if (env !== 'dev') return;
  shell.setStatus('apienv', { state: 'warn', text: '測試後端' });

  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  dlg.id = 'apienv-dialog';
  const h = document.createElement('h2');
  h.textContent = '切回正式後端';
  const p = document.createElement('p');
  p.textContent = '目前連的是測試後端（toolbox-api-dev）。切回後重新載入頁面，正式後端的登入狀態會保留。';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary';
  cancel.textContent = '取消';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-primary';
  ok.textContent = '切回正式後端';
  actions.append(cancel, ok);
  dlg.append(h, p, actions);
  document.body.appendChild(dlg);
  cancel.addEventListener('click', () => dlg.close());
  ok.addEventListener('click', () => { dlg.close(); switchApiEnv('prod', { storage, reload }); });
  window.addEventListener('tbx:api-prod', () => { if (!dlg.open) dlg.showModal(); });
}
