// 排程發布（測試版，只給管理員）：只負責組裝各模組與切換分頁。
//   進入是已排程／已發佈（manage.js）；「＋ 新增發文」開彈出視窗（dialog.js），裡面是 compose.js 做圖＋帶入、
//   targets.js 粉專膠囊＋timepop.js 排程時間、rd.js 排入 RD、send.js 送出；time.js、slug.js、rules.js 是純規則，util.js 共用小工具
// 工具內切換一律用 hidden，不重建畫面。
import { tb } from '../../sdk/toolbox.js';
import { loadComposeAssets } from '../../ui/compose/assets.js';
import { $, errText } from './util.js';
import { createComposer } from './compose.js';
import { createTargets } from './targets.js';
import { createSender } from './send.js';
import { createManage } from './manage.js';
import { createTimePop } from './timepop.js';
import { createDialog } from './dialog.js';
import { createRd } from './rd.js';

tb.init('fbpost');

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  for (const t of $('tabs').querySelectorAll('[data-tab]')) {
    const on = t === b; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on));
    $('tab-' + t.dataset.tab).hidden = !on;
  }
});

// 啟動：只有管理員才顯示、才呼叫 /fb/*
(async () => {
  let st;
  try { st = await tb.api.call('/auth/status'); } catch { return; }
  if (!st || st.admin !== true) return;
  let pages;
  try { pages = await tb.api.call('/fb/pages'); } catch (e) {
    // 權限不足維持單純停用；其他（token 過期、沒設定、沒有粉專）把原因顯示出來
    if (e && e.code !== 'fb_forbidden') { $('offReason').textContent = '原因：' + errText(e); $('offReason').hidden = false; }
    return;
  }
  $('fbpostOff').closest('main').hidden = true;
  $('fbpostApp').hidden = false;
  createDialog();   // 彈出視窗打開時，貼圖方框由 ResizeObserver 重新量尺寸
  const composer = createComposer({ tb, assets: await loadComposeAssets(tb) });
  let sender;
  const targets = createTargets({ timePop: createTimePop(), onChange: () => sender && sender.updateButton() });
  sender = createSender({ tb, composer, targets, rd: createRd({ tb }) });
  const manage = createManage({ tb });
  targets.setPages(pages);
  manage.setPages(pages);
})();
