// 圖片套版的排版切換（只管版面，不碰畫圖與輸出）：
//  - 手機（≤820px）：工具內「編輯／預覽」局部切換（ARIA tabs；用 hidden 切換，共用同一份 DOM，不複製、不重建）
//  - 手機：「全部下載」「全部清除」放進底部操作列的「更多」；桌面放進底部浮動工具列
//  - 回到桌面寬度：兩區都顯示、左右並列
(function () {
  const mq = window.matchMedia('(max-width: 820px)');
  const $ = (id) => document.getElementById(id);
  const tabs = $('mTabs'), tabEdit = $('tabEdit'), tabPreview = $('tabPreview');
  const panelEdit = $('panelEdit'), panelPreview = $('panelPreview');
  const moreWrap = $('moreWrap'), moreBtn = $('moreBtn'), moreMenu = $('moreMenu');
  const dlAll = $('batchDownloadAllBtn'), dlReset = $('batchResetBtn'), dlBtn = $('dlBtn');
  let mode = 'edit';

  function setMode(next, { focus = false } = {}) {
    mode = next;
    const mobile = mq.matches;
    tabEdit.setAttribute('aria-selected', String(mode === 'edit'));
    tabPreview.setAttribute('aria-selected', String(mode === 'preview'));
    tabEdit.tabIndex = mode === 'edit' ? 0 : -1;
    tabPreview.tabIndex = mode === 'preview' ? 0 : -1;
    panelEdit.hidden = mobile && mode !== 'edit';
    panelPreview.hidden = mobile && mode !== 'preview';
    if (focus) (mode === 'edit' ? tabEdit : tabPreview).focus();
    if (mobile) window.scrollTo(0, 0);
  }

  function closeMore({ restore = false } = {}) {
    if (moreMenu.hidden) return;
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    if (restore) moreBtn.focus();
  }

  function applyMedia() {
    const mobile = mq.matches;
    tabs.hidden = !mobile;
    moreWrap.hidden = !mobile;
    // 手機是 tabs＋tabpanel；桌面兩區並列，不需要 tab 語意
    for (const [panel, tab] of [[panelEdit, tabEdit], [panelPreview, tabPreview]]) {
      if (mobile) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.removeAttribute('aria-label'); }
      else { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); panel.setAttribute('aria-label', panel === panelEdit ? '設定' : '預覽'); }
    }
    // 全部下載、全部清除：手機在「更多」，桌面在底部工具列「下載這張」左邊（全部清除｜全部下載｜下載這張；同一個按鈕，事件不變）
    if (mobile) { moreMenu.appendChild(dlAll); moreMenu.appendChild(dlReset); }
    else { const row = dlBtn.parentElement; row.insertBefore(dlReset, dlBtn); row.insertBefore(dlAll, dlBtn); }
    if (!mobile) closeMore();
    setMode(mode);
  }

  // tabs
  tabEdit.addEventListener('click', () => setMode('edit'));
  tabPreview.addEventListener('click', () => setMode('preview'));
  tabs.addEventListener('keydown', (e) => {
    const order = ['edit', 'preview'];
    let i = order.indexOf(mode);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (i + 1) % 2;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (i + 1) % 2;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = 1;
    else return;
    e.preventDefault();
    setMode(order[i], { focus: true });
  });

  // 更多
  moreBtn.addEventListener('click', () => {
    const open = moreMenu.hidden;
    moreMenu.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    if (open) { const first = moreMenu.querySelector('button:not(:disabled)'); if (first) first.focus(); }
  });
  moreMenu.addEventListener('click', (e) => { if (e.target.closest('button')) closeMore(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !moreMenu.hidden) { e.stopPropagation(); closeMore({ restore: true }); } }, true);
  document.addEventListener('pointerdown', (e) => { if (!moreMenu.hidden && !moreWrap.contains(e.target)) closeMore(); });

  mq.addEventListener('change', applyMedia);
  applyMedia();
})();
