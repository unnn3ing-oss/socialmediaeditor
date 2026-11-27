// 排程發布（測試版，只給管理員）：只負責組裝各模組與切換分頁。
//   做圖相關模組第一次開視窗才動態載入（開頁請求數少）。
//   進入是已排程／已發佈（manage.js）；「＋ 新增發文」開彈出視窗（dialog.js），裡面是 compose.js 做圖＋帶入、
//   targets.js 粉專膠囊＋timepop.js 排程時間、rd.js 排入 RD、send.js 送出；time.js、slug.js、rules.js 是純規則，util.js 共用小工具
// 工具內切換一律用 hidden，不重建畫面。
import { tb } from '../../sdk/toolbox.js';
import { $, errText, confirmBox, say } from './util.js';
import { busy, ok, fail } from '../../ui/fx.js';
import * as fx from '../../ui/fx.js';
import { createManage } from './manage.js';
import { createDialog } from './dialog.js';
import { createDuty } from './duty.js';
import { createHistory } from './history.js';
import { createLive } from './live.js';

tb.init('fbpost');

function showTab(name) {
  for (const t of $('tabs').querySelectorAll('[data-tab]')) {
    const on = t.dataset.tab === name; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on));
    $('tab-' + t.dataset.tab).hidden = !on; $('ctl-' + t.dataset.tab).hidden = !on;
  }
}
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab);
});

// 啟動：有公司憑證才問 /fb/pages；開放／關閉由後端決定（管理頁切換，關閉＝只有管理員密碼能用），403 就維持停用並顯示關閉原因
// 骨架收掉：ok＝能用（顯示列表），否則顯示停用卡片
const booted = (ok) => { $('bootSk').hidden = true; if (!ok) $('offMain').hidden = false; };
(async () => {
  let st;
  try { st = await tb.api.call('/auth/status'); } catch { booted(false); return; }
  if (!st || !st.company) { booted(false); return; }
  let pages;
  try { pages = await tb.api.call('/fb/pages'); } catch (e) {
    // 關閉中：有填關閉原因才顯示；其他（token 過期、沒設定、沒有粉專）把錯誤原因顯示出來
    // 自行註冊、還沒指派權限組：專屬頁面「尚未開通」（不顯示功能停用）
    if (e && e.code === 'fb_self_pending') {
      document.querySelector('#offMain .off-box:not(#selfPend)').hidden = true;
      $('selfPend').hidden = false;
      $('selfPendBtn').onclick = () => location.reload();
      booted(false); return;
    }
    if (e && e.code === 'fb_need_staff') {   // 舊版憑證沒有員工編號：請重新用員工編號登入
      $('needStaff').hidden = false;
      $('needStaffBtn').onclick = () => tb.company.login();
      booted(false); return;
    }
    const why = e && e.code === 'fb_forbidden' ? ((e.detail && e.detail.reason) || '') : errText(e);
    if (why) { $('offReason').textContent = '原因：' + why; $('offReason').hidden = false; }
    booted(false); return;
  }
  // 已開放給公司帳號就不顯示「測試模式」標籤（讀不到維持顯示）
  tb.api.call('/fb/access').then((a) => {
    if (a && a.mode === 'company') for (const el of document.querySelectorAll('.test-pill')) el.hidden = true;
  }).catch(() => {});
  // 依權限顯示：讀不到 /fb/me 就當全部都有（後端仍會擋）；之後才問值班粉專（沒有發文權限不問）
  let canPost = true;
  tb.api.call('/fb/me').then((me) => {
    if (!me) return;
    const perms = me.admin ? ['view', 'post', 'edit', 'delete'] : (me.perms || []);
    canPost = perms.includes('post');
    const app = $('fbpostApp');
    for (const k of ['view', 'post', 'edit', 'delete']) app.classList.toggle('no-' + k, !perms.includes(k));
    $('noView').hidden = perms.includes('view');
    const who = me.admin ? '管理員' : [me.name, me.group].filter(Boolean).join('．');
    if (who) { $('whoAmI').textContent = who; $('whoAmI').hidden = false; }
    // 實驗功能「第一則留言移除連結預覽」：管理頁開啟且這個人適用才顯示（勾選只對這一次送出有效）
    $('npChk').hidden = !me.noPreview;
    if (me.tokenWarn && me.tokenWarn.text) { const w = $('tokWarn'); w.textContent = me.tokenWarn.text; w.classList.toggle('bad', me.tokenWarn.level === 'bad'); w.hidden = false; }
  }).catch(() => {}).then(() => {
    $('dutyBtn').hidden = !canPost; duty.check();
    // 有檢視權限才自動讀列表；還得先選值班粉專（值班視窗開著）就等選完再讀
    manage.allowView(!$('fbpostApp').classList.contains('no-view'), $('dutyDlg').open);
  });
  booted(true);
  $('fbpostApp').hidden = false;
  $('noPreview').addEventListener('change', () => { $('npNote').hidden = !$('noPreview').checked; });
  // 列表頁只載 manage／dialog；做圖、粉專膠囊、送出、素材、活動留言等到第一次按「＋ 新增發文」才載入（只載一次，之後內容保留）
  let currentPages = pages, targets = null, loading = null, composer = null, sender = null;
  const history = createHistory();
  const duty = createDuty({ pages: () => currentPages, canAsk: () => canPost, onChange: () => { if (targets) targets.applyDefaults(); manage.dutyChanged(); } });
  const ensureCompose = () => loading || (loading = (async () => {
    const [{ loadComposeAssets }, { createComposer }, { createTargets }, { createSender }, { createTimePop }, { createRd }, { createComments }] =
      await Promise.all([import('../../ui/compose/assets.js'), import('./compose.js'), import('./targets.js'), import('./send.js'),
        import('./timepop.js'), import('./rd.js'), import('./comments.js')]);
    composer = createComposer({ tb, assets: await loadComposeAssets(tb), onState: () => sender && sender.updateButton() });
    targets = createTargets({ timePop: createTimePop(), onChange: () => sender && sender.updateButton(), defaults: () => duty.ids() });
    sender = createSender({ tb, composer, targets, rd: createRd({ tb }), comments: createComments({ tb }), history,
      onBack: () => { dialog.close(); showTab('sched'); } });   // 返回列表：不自動查詢
    targets.setPages(currentPages);
  })().catch((e) => { loading = null; throw e; }));
  // 留言失敗：回到列表就切到「已發佈」並讀出錯誤（最新一則失敗的粉專）；外掛側邊欄另有即時狀態燈
  const goFailed = (items) => { if (!items.length || !$('tab-pub')) return; showTab('pub'); manage.showPub(items[0].page); };
  const live = createLive({ tb, onClick: () => dialog.close() });
  const dialog = createDialog({ beforeOpen: ensureCompose, onOpen: () => live.refresh(),
    onClose: () => { live.refresh().then(goFailed); } });   // 彈出視窗打開時，貼圖方框由 ResizeObserver 重新量尺寸
  // 再發一次：開新增發文、清空後帶回網址／照片／標題（粉專照值班粉專預勾）；正在編輯的內容先問
  async function resend(rec) {
    try { await ensureCompose(); } catch (e) { $('pagesState').textContent = '載入新增發文失敗：' + errText(e); return; }
    const busy = $('link').value.trim() || $('title').value.trim() || $('msg').value.trim() || composer.snapshot().photo;
    if (busy && !(await confirmBox('要用這則貼文覆蓋嗎？', '新增發文裡已經有內容，再發一次會清空它（網址、照片、標題、貼文內容、粉專勾選）。'))) return;
    sender.clearAll();
    await composer.restore(rec);
    dialog.open();
  }
  // 幫直出：讀這則已發佈貼文的文字、圖片、文章連結（後端去 utm），開新增發文帶入；粉專全部不勾
  async function direct(it, page, btn) {
    try { await ensureCompose(); } catch (e) { $('pagesState').textContent = '載入新增發文失敗：' + errText(e); return; }
    const busy = $('link').value.trim() || $('title').value.trim() || $('msg').value.trim() || composer.snapshot().photo;
    if (busy && !(await confirmBox('要用這則貼文覆蓋嗎？', '新增發文裡已經有內容，幫直出會清空它（網址、照片、標題、貼文內容、粉專勾選）。'))) return;
    fx.busy(btn, '讀取中');
    let d;
    try { d = await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/source?page=${encodeURIComponent(page)}`); }
    catch (e) { fx.fail(btn, '幫直出'); $('pubHint').textContent = '幫直出失敗：' + errText(e); return; }
    fx.idle(btn, '幫直出');
    let photo = null;
    if (d.image && d.image.data) {
      const bin = atob(d.image.data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      photo = new Blob([u8], { type: d.image.type || 'image/jpeg' });
    }
    const message = String(d.message || '');
    const tl = message.split('\n').map((l) => l.trim()).find((l) => /^【.+】$/.test(l));
    sender.clearAll();
    targets.none();
    const photoOk = await composer.direct({ message, title: tl ? tl.slice(1, -1) : '', link: d.link || '', photo });
    const miss = [];
    if (!d.link) miss.push('找不到文章連結，請自己貼上');
    if (d.imageFailed || (photo && !photoOk)) miss.push('圖片讀取失敗，請自己貼上照片');
    say('pullHint', '已帶入已發佈貼文的' + ['貼文內容', photo && photoOk ? '圖片' : '', d.link ? '連結' : ''].filter(Boolean).join('、') + '；請勾選要發的粉專' + (miss.length ? '（' + miss.join('；') + '）' : ''), miss.length > 0);
    dialog.open();
  }
  const manage = createManage({ tb, history, onResend: resend, onDirect: direct, getDuty: () => duty.ids() });
  const showPages = (list) => { currentPages = list; $('pagesState').textContent = `已連線 ${list.length} 個粉專`; if (targets) targets.setPages(list); manage.setPages(list); duty.paint(); };
  showPages(pages);
  $('pagesRefresh').addEventListener('click', async () => {
    const b = $('pagesRefresh'), back = '重新整理粉專'; busy(b, '刷新中');
    try { showPages(await tb.api.call('/fb/pages')); ok(b, '已更新', back); } catch (e) { $('pagesState').textContent = '讀取粉專失敗：' + errText(e); fail(b, back); }
  });
})();
