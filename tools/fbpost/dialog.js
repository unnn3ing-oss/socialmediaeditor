// 新增發文彈出視窗：× 或 Esc 關閉，內容保留（只是隱藏），下次打開還在
// beforeOpen：第一次開啟前要先等的載入（按鈕顯示「載入中…」）；視窗開著時背景設 inert，Tab 不會跑到背景，焦點落在文章網址
import { $, errText } from './util.js';

export function createDialog({ beforeOpen } = {}) {
  const veil = $('postDlg'), btn = $('newBtn');
  const bg = () => document.querySelectorAll('main.fp, main.off');
  const open = () => {
    veil.hidden = false; document.body.classList.add('no-scroll');
    for (const el of bg()) el.inert = true;
    const link = $('link'); link.focus(); link.scrollIntoView({ block: 'nearest' });
  };
  const close = () => {
    veil.hidden = true; document.body.classList.remove('no-scroll');
    for (const el of bg()) el.inert = false;
    btn.focus();
  };
  // 窄版（單欄）文章網址放最上面（預覽圖之前）；電腦版兩欄放回右欄最上面。搬移元素，內容不會不見
  const mq = matchMedia('(max-width: 820px)');
  const placeLink = () => {
    const box = document.querySelector('.link-box'), compose = document.querySelector('.compose');
    const hadFocus = document.activeElement === $('link');   // 搬動 DOM 會失焦，搬完補回
    if (mq.matches) { if (box.nextElementSibling !== compose) compose.before(box); }
    else if (box.parentElement !== compose.querySelector('.right')) compose.querySelector('.right').prepend(box);
    if (hadFocus && document.activeElement !== $('link')) $('link').focus();
  };
  placeLink(); mq.addEventListener('change', placeLink);
  // 外掛側邊欄：「＋ 新增發文」搬到「已排程／已發佈」右邊；不能檢視列表（卡片隱藏）時放回標題列
  if (document.documentElement.classList.contains('is-side')) {
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
      busy = true; const label = btn.textContent; btn.disabled = true; btn.textContent = '載入中…';
      try { await beforeOpen(); }
      catch (e) { btn.textContent = label; btn.disabled = false; busy = false; $('pagesState').textContent = '載入新增發文失敗：' + errText(e); return; }
      btn.textContent = label; btn.disabled = false; busy = false;
    }
    open();
  });
  $('dlgClose').addEventListener('click', close);
  // Esc：排程時間小視窗或確認對話開著時由它們自己處理
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || veil.hidden || !$('timePop').hidden || !$('tpMenu').hidden || $('cfDlg').open || $('doneDlg').open) return;
    close();
  });
  return { open, close, isOpen: () => !veil.hidden };
}
