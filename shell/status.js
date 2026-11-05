// 狀態列：用「檢查項目清單」產生膠囊。P0 只有 extension；P2 加 login:tvbs、helper 只需在 CHECKS 加一項。
import { createExt } from '../sdk/bridge.js';

const ext = createExt();

export const CHECKS = [
  {
    id: 'extension',
    label: '正在檢查外掛',
    async run() {
      try {
        await ext.call('ping', {});
        return { state: 'ok', text: '外掛已連線' };
      } catch (e) {
        if (e && e.code === 'no_extension') return { state: 'warn', text: '未安裝外掛' };
        return { state: 'warn', text: '外掛連線異常' };
      }
    },
    // warn 時按下的動作
    onWarnClick: ({ openInstall }) => openInstall(),
  },
];

export function initStatus({ root, shell, openInstall, checks = CHECKS }) {
  const byId = new Map(checks.map((c) => [c.id, c]));

  function render() {
    root.textContent = '';
    for (const c of checks) {
      const v = shell.getStatus(c.id);
      if (v.state === 'checking') {
        const sk = document.createElement('span');
        sk.className = 'sk';
        sk.dataset.status = c.id;
        sk.setAttribute('aria-busy', 'true');
        sk.setAttribute('aria-label', c.label);
        sk.style.cssText = 'width:132px;height:29px;border-radius:99px';
        root.appendChild(sk);
        continue;
      }
      const clickable = v.state === 'warn' && c.onWarnClick;
      const pill = document.createElement(clickable ? 'button' : 'span');
      pill.className = `pill pill-${v.state}`;
      pill.dataset.status = c.id;
      pill.textContent = v.text;
      if (clickable) {
        pill.type = 'button';
        pill.addEventListener('click', () => c.onWarnClick({ openInstall }));
      }
      root.appendChild(pill);
    }
  }

  shell.onStatus(render);
  for (const c of checks) shell.setStatus(c.id, { state: 'checking', text: c.label });
  render();

  return {
    async runAll() {
      await Promise.all(checks.map(async (c) => shell.setStatus(c.id, await c.run())));
    },
    byId,
  };
}

// 電腦版（滑鼠＋寬螢幕）偵測不到外掛時自動開教學；同一個分頁只開一次。
export function shouldAutoOpenInstall({ win = window, storage = safeSession() } = {}) {
  const desktop = win.matchMedia('(pointer: fine)').matches && win.innerWidth > 820;
  if (!desktop) return false;
  try { if (storage && storage.getItem('tbx.installShown')) return false; } catch { /* 沒有 sessionStorage 就照開 */ }
  return true;
}

export function markInstallShown(storage = safeSession()) {
  try { storage && storage.setItem('tbx.installShown', '1'); } catch { /* 靜默 */ }
}

function safeSession() {
  try { return window.sessionStorage; } catch { return null; }
}
