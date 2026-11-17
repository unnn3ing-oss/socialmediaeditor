// 新增發文彈出視窗：× 或 Esc 關閉，內容保留（只是隱藏），下次打開還在
// beforeOpen：第一次開啟前要先等的載入（按鈕顯示「載入中…」）；視窗開著時背景設 inert，Tab 不會跑到背景，焦點落在文章網址
import { $, errText } from './util.js';

export function createDialog({ beforeOpen } = {}) {
  const veil = $('postDlg'), btn = $('newBtn');
  const bg = () => document.querySelectorAll('main.fp, main.off');
  const open = () => {
    veil.hidden = false; document.body.classList.add('no-scroll');
    for (const el of bg()) el.inert = true;
    $('link').focus();
  };
  const close = () => {
    veil.hidden = true; document.body.classList.remove('no-scroll');
    for (const el of bg()) el.inert = false;
    btn.focus();
  };
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
    if (e.key !== 'Escape' || veil.hidden || !$('timePop').hidden || $('cfDlg').open || $('doneDlg').open) return;
    close();
  });
  return { open, close, isOpen: () => !veil.hidden };
}
