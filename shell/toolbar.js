// 上方工具列：圖示＋文字，可點擊也可拖曳。

export function createToolbar(root, { onOpen }) {
  return {
    render(tools) {
      root.textContent = '';
      for (const t of tools) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tool = t.id;
        b.draggable = true;
        b.setAttribute('aria-pressed', 'false');
        const ico = document.createElement('span');
        ico.className = 'ico';
        ico.setAttribute('aria-hidden', 'true');
        ico.style.setProperty('--ico', `url("${t.icon}")`);
        const label = document.createElement('span');
        label.textContent = t.name;
        b.append(ico, label);
        b.addEventListener('click', () => onOpen(t.id));
        root.appendChild(b);
      }
    },
    setPressed(ids) {
      for (const b of root.querySelectorAll('button[data-tool]')) {
        b.setAttribute('aria-pressed', ids.includes(b.dataset.tool) ? 'true' : 'false');
      }
    },
  };
}
