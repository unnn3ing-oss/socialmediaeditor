// 窗格：每個開過的工具只建立一次 iframe，不可見時隱藏，永不移除。

export function createPanes(root, { onFocus, onClose }) {
  const panes = new Map(); // id -> { pane, frame }

  function ensure(tool) {
    let p = panes.get(tool.id);
    if (p) return p;
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.dataset.tool = tool.id;
    pane.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'pane-bar';
    const title = document.createElement('span');
    title.textContent = tool.name;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pane-close';
    close.setAttribute('aria-label', `關閉${tool.name}`);
    close.textContent = '×';
    bar.append(title, close);
    const frame = document.createElement('iframe');
    frame.title = tool.name;
    frame.dataset.created = String(performance.now());
    frame.src = tool.entry;
    pane.append(bar, frame);
    root.appendChild(pane);
    pane.addEventListener('pointerdown', () => { const s = pane.dataset.side; if (s) onFocus(s); });
    close.addEventListener('click', () => { const s = pane.dataset.side; if (s) onClose(s); });
    p = { pane, frame };
    panes.set(tool.id, p);
    return p;
  }

  // 點進 iframe 時，父視窗會失焦；用 activeElement 判斷是哪一格。
  window.addEventListener('blur', () => {
    setTimeout(() => {
      for (const { pane, frame } of panes.values()) {
        if (document.activeElement === frame && pane.dataset.side) onFocus(pane.dataset.side);
      }
    }, 0);
  });

  // 公司憑證過期時蓋一層鎖定提示；iframe 本身不動，內容原封不動。
  function setLocked(id, locked) {
    const p = panes.get(id);
    if (!p) return;
    let lock = p.pane.querySelector('.pane-lock');
    if (locked && !lock) {
      lock = document.createElement('div');
      lock.className = 'pane-lock';
      const msg = document.createElement('p');
      msg.textContent = '公司密碼已過期，重新輸入後即可繼續';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = '重新輸入';
      btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('tbx:company-login')));
      lock.append(msg, btn);
      p.pane.appendChild(lock);
    } else if (!locked && lock) {
      lock.remove();
    }
  }

  return {
    ensure,
    setLocked,
    get: (id) => panes.get(id),
    // sides: { left: toolOrNull, right: toolOrNull }
    sync({ split, left, right, last }) {
      const want = new Map();
      if (left) want.set(left.id, 'left');
      if (right) want.set(right.id, 'right');
      root.classList.toggle('split', split);
      for (const t of [left, right]) if (t) ensure(t);
      for (const [id, { pane }] of panes) {
        const side = want.get(id);
        pane.hidden = !side;
        if (side) pane.dataset.side = side; else delete pane.dataset.side;
        pane.classList.toggle('is-last', Boolean(side) && split && side === last);
      }
    },
  };
}
