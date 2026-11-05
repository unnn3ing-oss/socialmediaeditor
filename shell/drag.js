// 拖曳並排：dragstart 顯示放置區；只有放在 .dz 上才會改版面。
// dragend、Esc、或在放置區外放開，一律只隱藏放置區。

export function initDrag({ toolbar, zones, onDrop }) {
  let dragId = null;

  const hide = () => {
    dragId = null;
    zones.hidden = true;
    for (const z of zones.querySelectorAll('.dz')) z.classList.remove('is-over');
  };

  toolbar.addEventListener('dragstart', (e) => {
    const b = e.target.closest && e.target.closest('button[data-tool]');
    if (!b) return;
    dragId = b.dataset.tool;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', dragId);
      e.dataTransfer.effectAllowed = 'move';
    }
    zones.hidden = false;
  });

  for (const z of zones.querySelectorAll('.dz')) {
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('is-over'); });
    z.addEventListener('dragleave', () => z.classList.remove('is-over'));
    z.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || dragId;
      const side = z.dataset.side;
      hide();
      if (id) onDrop(id, side);
    });
  }

  document.addEventListener('dragend', hide);
  document.addEventListener('drop', hide); // 放在放置區外
  document.addEventListener('dragover', (e) => { if (dragId) e.preventDefault(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !zones.hidden) hide(); });
}
