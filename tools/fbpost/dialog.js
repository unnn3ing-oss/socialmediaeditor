// 新增發文彈出視窗：× 或 Esc 關閉，內容保留（只是隱藏），下次打開還在
// beforeOpen：第一次開啟前要先等的載入（按鈕顯示「載入中…」）；視窗開著時背景設 inert，Tab 不會跑到背景，焦點落在文章網址
import { $, errText } from './util.js';
import { busy as fxBusy, idle as fxIdle } from '../../ui/fx.js';

export function createDialog({ beforeOpen, onOpen, onClose } = {}) {
  const veil = $('postDlg'), btn = $('newBtn');
  const bg = () => document.querySelectorAll('main.fp, main.off');
  const open = () => {
    veil.hidden = false; document.body.classList.add('no-scroll');
    for (const el of bg()) el.inert = true;
    const link = $('link'); link.focus(); link.scrollIntoView({ block: 'nearest' });
    if (onOpen) onOpen();
  };
  const close = () => {
    veil.hidden = true; document.body.classList.remove('no-scroll');
    for (const el of bg()) el.inert = false;
    btn.focus();
    if (onClose) onClose();
  };
  // 窄版（單欄）文章網址放最上面（預覽圖之前）；電腦版兩欄放回右欄最上面。搬移元素，內容不會不見
  const mq = matchMedia('(max-width: 820px)');
  const placeLink = () => {
    const box = document.querySelector('.link-box'), compose = document.querySelector('.compose');
    const hadFocus = document.activeElement === $('link');   // 搬動 DOM 會失焦，搬完補回
    if (document.documentElement.classList.contains('is-side')) { if (compose.parentElement.firstElementChild !== box) compose.parentElement.prepend(box); }
    else if (mq.matches) { if (box.nextElementSibling !== compose) compose.before(box); }
    else if (box.parentElement !== compose.querySelector('.right')) compose.querySelector('.right').prepend(box);
    if (hadFocus && document.activeElement !== $('link')) $('link').focus();
  };
  placeLink(); mq.addEventListener('change', placeLink);
  // 外掛側邊欄：「＋ 新增發文」搬到「已排程／已發佈」右邊；不能檢視列表（卡片隱藏）時放回標題列
  if (document.documentElement.classList.contains('is-side')) {
    const post = document.querySelector('.post-body');
    post.insertBefore($('modeSeg'), post.firstElementChild.nextSibling);
    $('sideRawMode').hidden = false;
    $('sideImageBar').hidden = false;
    $('sideImageBar').insertBefore($('fxBtn'), $('sideAddPhoto'));
    $('sideImageBar').append($('fxBar'));
    const closeFx = () => {
      $('fxBar').hidden = true;
      $('fxBtn').setAttribute('aria-expanded', 'false');
    };
    document.addEventListener('pointerdown', (event) => {
      if (!$('sideImageBar').contains(event.target)) closeFx();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('fxBar').hidden) {
        event.preventDefault();
        closeFx();
        $('fxBtn').focus();
      }
    });
    $('leadBubbleHead').hidden = false;
    $('leadAvatar').hidden = false;
    $('leadPreviewMeta').hidden = false;
    const actions = $('leadPreviewActions');
    actions.hidden = false;
    actions.append($('addComment'), $('warnBtn').closest('.warn-anchor'), $('npChk'));
    $('npChk').lastChild.textContent = '移除連結預覽';
    $('lead').placeholder = '看更多新聞內容';
    $('leadBubbleUrl').hidden = false;
    $('leadLabel').textContent = '留言預覽';
    const editHint = document.createElement('small');
    editHint.textContent = '可直接編輯';
    $('leadLabel').append(editHint);
    $('warnBtn').textContent = '警語';
    $('addComment').textContent = '＋ 新增留言';
    const app = $('fbpostApp'), row = $('tabsRow'), head = document.querySelector('.fp-head');
    const placeNew = () => {
      const want = app.classList.contains('no-view') ? head : row;
      if (btn.parentElement !== want) want.append(btn);
    };
    placeNew();
    new MutationObserver(placeNew).observe(app, { attributes: true, attributeFilter: ['class'] });
  }
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return;
    if (beforeOpen) {
      busy = true; const label = btn.textContent; fxBusy(btn, '載入中');
      try { await beforeOpen(); }
      catch (e) { fxIdle(btn, label); busy = false; $('pagesState').textContent = '載入新增發文失敗：' + errText(e); return; }
      fxIdle(btn, label); busy = false;
    }
    open();
  });
  $('dlgClose').addEventListener('click', close);
  // Esc：排程時間小視窗或確認對話開著時由它們自己處理
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.key !== 'Escape' || veil.hidden || !$('timePop').hidden || !$('tpMenu').hidden || $('cfDlg').open || $('doneDlg').open || $('dutyDlg').open) return;
    close();
  });
  return { open, close, isOpen: () => !veil.hidden };
}
