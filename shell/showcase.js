// 櫥窗：依 group 分區的卡片網格。

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function shell(root) {
  root.textContent = '';
  const inner = el('div', 'showcase-inner');
  inner.appendChild(el('h1', null, '今天要做什麼？'));
  root.appendChild(inner);
  return inner;
}

export function renderSkeleton(root) {
  const inner = shell(root);
  const grid = el('div', 'grid');
  for (let i = 0; i < 3; i++) {
    const c = el('div', 'card sk-card');
    c.setAttribute('aria-hidden', 'true');
    c.appendChild(el('div', 'thumb sk'));
    const m = el('div', 'meta');
    for (const w of ['60%', '90%']) { const s = el('span', 'sk'); s.style.cssText = `display:block;height:16px;width:${w}`; m.appendChild(s); }
    c.appendChild(m);
    grid.appendChild(c);
  }
  inner.appendChild(grid);
  root.setAttribute('aria-busy', 'true');
}

export function renderShowcase(root, tools, { onOpen }) {
  const inner = shell(root);
  const groups = new Map();
  for (const t of tools) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  let n = 0;
  for (const [name, list] of groups) {
    const sec = el('section', 'group');
    const h = el('h2', null, name);
    h.id = `g-${n++}`;
    sec.setAttribute('aria-labelledby', h.id);
    sec.appendChild(h);
    const grid = el('div', 'grid');
    for (const t of list) {
      const card = el('button', 'card');
      card.type = 'button';
      card.dataset.tool = t.id;
      const thumb = el('div', 'thumb');
      const img = el('img');
      img.alt = '';
      img.src = t.thumb;
      thumb.appendChild(img);
      const meta = el('div', 'meta');
      meta.append(el('span', 'name', t.name), el('span', 'desc', t.desc));
      card.append(thumb, meta);
      card.addEventListener('click', () => onOpen(t.id));
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    inner.appendChild(sec);
  }
  root.removeAttribute('aria-busy');
}
