// 上方工具列：圖示＋文字，可點擊也可拖曳。放不下時自動改成只顯示圖示（目前開著的工具保留文字）。

export function createToolbar(root, { onOpen }) {
  const narrow = window.matchMedia ? window.matchMedia('(max-width: 820px)') : { matches: false };
  // 先用完整文字量一次，超出寬度才收成圖示；手機版工具列自己一列可左右滑，不收。
  function fit() {
    root.classList.remove('compact');
    if (!narrow.matches && root.scrollWidth > root.clientWidth + 1) root.classList.add('compact');
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(root);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  return {
    render(tools) {
      root.textContent = '';
      for (const t of tools) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tool = t.id;
        b.draggable = true;
        b.setAttribute('aria-pressed', 'false');
        b.title = t.name;
        b.setAttribute('aria-label', t.name);
        const ico = document.createElement('span');
        ico.className = 'ico';
        ico.setAttribute('aria-hidden', 'true');
        // CSS 變數裡的相對網址會以樣式表位置解析，所以先轉成絕對網址
        ico.style.setProperty('--ico', `url("${new URL(t.icon, document.baseURI).href}")`);
        const label = document.createElement('span');
        label.className = 'lbl';
        label.textContent = t.name;
        b.append(ico, label);
        b.addEventListener('click', () => onOpen(t.id));
        root.appendChild(b);
      }
      fit();
    },
    setPressed(ids) {
      for (const b of root.querySelectorAll('button[data-tool]')) {
        b.setAttribute('aria-pressed', ids.includes(b.dataset.tool) ? 'true' : 'false');
      }
      fit();
    },
  };
}
