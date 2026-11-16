// 新增發文彈出視窗：× 或 Esc 關閉，內容保留（只是隱藏），下次打開還在
import { $ } from './util.js';

export function createDialog({ onOpen } = {}) {
  const veil = $('postDlg');
  const open = () => { veil.hidden = false; document.body.classList.add('no-scroll'); if (onOpen) onOpen(); };
  const close = () => { veil.hidden = true; document.body.classList.remove('no-scroll'); $('newBtn').focus(); };
  $('newBtn').addEventListener('click', open);
  $('dlgClose').addEventListener('click', close);
  // Esc：排程時間小視窗或確認對話開著時由它們自己處理
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || veil.hidden || !$('timePop').hidden || $('cfDlg').open) return;
    close();
  });
  return { open, close, isOpen: () => !veil.hidden };
}
