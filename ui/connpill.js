// 「● 已連線」膠囊（排程發布、影片發布頂端）：只顯示狀態，游標移上／鍵盤選到／點一下才跳小視窗看細節
//   小視窗內容：#pagesState（已連線 N 個粉專，或錯誤訊息）＋ #whoAmI（身分）
//   #pagesState 文字不是「已連線…」＝出錯：膠囊變紅（連線失敗／載入失敗），小視窗自動打開
export function initConnPill({ pill, tip, label, state }) {
  let pinned = false, bad = false;
  const show = (on) => { tip.hidden = !on; pill.setAttribute('aria-expanded', String(on)); };
  pill.addEventListener('mouseenter', () => show(true));
  pill.parentElement.addEventListener('mouseleave', () => { if (!pinned) show(false); });
  pill.addEventListener('focus', () => show(true));
  pill.addEventListener('blur', () => { if (!pinned) show(false); });
  pill.addEventListener('click', () => { pinned = !pinned || tip.hidden; show(pinned); });
  document.addEventListener('pointerdown', (e) => { if (!pill.parentElement.contains(e.target)) { pinned = false; show(false); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tip.hidden) { pinned = false; show(false); } });
  const sync = () => {
    const t = state.textContent.trim(), ok = /^已連線/.test(t);
    pill.classList.toggle('ok', ok); pill.classList.toggle('bad', !ok);
    label.textContent = ok ? '已連線' : /^載入新增發文/.test(t) ? '載入失敗' : '連線失敗';
    if (!ok) { pinned = true; show(true); bad = true; }
    else if (bad) { bad = false; pinned = false; show(false); }   // 恢復正常：收起錯誤時自動打開的小視窗
  };
  new MutationObserver(sync).observe(state, { childList: true, characterData: true, subtree: true });
  sync();
}
