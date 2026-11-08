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
  {
    // 公司素材：由 company.js 自己更新狀態；未解鎖時不顯示（state 'hidden'）
    id: 'company',
    label: '正在確認公司密碼',
    passive: true,
    onClick: () => window.dispatchEvent(new CustomEvent('tbx:company-logout')),
  },
];

export function initStatus({ root, shell, openInstall, checks = CHECKS }) {
  const byId = new Map(checks.map((c) => [c.id, c]));

  function render() {
    root.textContent = '';
    for (const c of checks) {
      const v = shell.getStatus(c.id);
      if (v.state === 'hidden') continue;
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
      const clickable = Boolean(c.onClick) || (v.state === 'warn' && c.onWarnClick);
      const pill = document.createElement(clickable ? 'button' : 'span');
      pill.className = `pill pill-${v.state}`;
      pill.dataset.status = c.id;
      pill.textContent = v.text;
      if (clickable) {
        pill.type = 'button';
        pill.addEventListener('click', () => (c.onClick ? c.onClick() : c.onWarnClick({ openInstall })));
      }
      root.appendChild(pill);
    }
  }

  shell.onStatus(render);
  for (const c of checks) shell.setStatus(c.id, { state: c.passive ? 'hidden' : 'checking', text: c.label });
  render();

  return {
    async runAll() {
      await Promise.all(checks.filter((c) => !c.passive).map(async (c) => shell.setStatus(c.id, await c.run())));
    },
    byId,
  };
}
