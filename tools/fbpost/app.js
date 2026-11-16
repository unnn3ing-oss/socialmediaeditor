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
import { createComments } from './comments.js';

tb.init('fbpost');

function showTab(name) {
  for (const t of $('tabs').querySelectorAll('[data-tab]')) {
    const on = t.dataset.tab === name; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on));
    $('tab-' + t.dataset.tab).hidden = !on;
  }
}
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab);
});

// 啟動：有公司憑證才問 /fb/pages；開放範圍由後端決定（管理頁切換「只開放管理員／開放給公司帳號」），403 就維持停用
(async () => {
  let st;
  try { st = await tb.api.call('/auth/status'); } catch { return; }
  if (!st || !st.company) return;
  let pages;
  try { pages = await tb.api.call('/fb/pages'); } catch (e) {
    // 權限不足維持單純停用；其他（token 過期、沒設定、沒有粉專）把原因顯示出來
    if (e && e.code !== 'fb_forbidden') { $('offReason').textContent = '原因：' + errText(e); $('offReason').hidden = false; }
    return;
  }
  // 已開放給公司帳號就不顯示「測試模式」標籤（讀不到維持顯示）
  tb.api.call('/fb/access').then((a) => {
    if (a && a.mode === 'company') for (const el of document.querySelectorAll('.test-pill')) el.hidden = true;
  }).catch(() => {});
  $('fbpostOff').closest('main').hidden = true;
  $('fbpostApp').hidden = false;
  const dialog = createDialog();   // 彈出視窗打開時，貼圖方框由 ResizeObserver 重新量尺寸
  const composer = createComposer({ tb, assets: await loadComposeAssets(tb) });
  let sender;
  const targets = createTargets({ timePop: createTimePop(), onChange: () => sender && sender.updateButton() });
  sender = createSender({ tb, composer, targets, rd: createRd({ tb }), comments: createComments({ tb }),
    onBack: () => { dialog.close(); showTab('sched'); } });   // 返回列表：不自動查詢
  const manage = createManage({ tb });
  const showPages = (list) => { $('pagesState').textContent = `已連線 ${list.length} 個粉專`; targets.setPages(list); manage.setPages(list); };
  showPages(pages);
  $('pagesRefresh').addEventListener('click', async () => {
    const b = $('pagesRefresh'); b.disabled = true;
    try { showPages(await tb.api.call('/fb/pages')); } catch (e) { $('pagesState').textContent = '讀取粉專失敗：' + errText(e); }
    finally { b.disabled = false; }
  });
})();
