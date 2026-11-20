// 窗格：每個開過的工具只建立一次 iframe，不可見時隱藏，永不移除。一次只顯示一個（沒有關閉鈕，回櫥窗點品牌）。

export function createPanes(root) {
  const panes = new Map(); // id -> { pane, frame }

  function ensure(tool) {
    let p = panes.get(tool.id);
    if (p) return p;
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.dataset.tool = tool.id;
    pane.hidden = true;
    const frame = document.createElement('iframe');
    frame.title = tool.name;
    frame.dataset.created = String(performance.now());
    frame.src = tool.entry;
    pane.append(frame);
    root.appendChild(pane);
    p = { pane, frame };
    panes.set(tool.id, p);
    return p;
  }

  // 公司憑證過期時蓋一層鎖定提示；iframe 本身不動，內容原封不動。
  function setLocked(id, locked) {
    const p = panes.get(id);
    if (!p) return;
    let lock = p.pane.querySelector('.pane-lock');
    if (locked && !lock) {
      lock = document.createElement('div');
      lock.className = 'pane-lock';
      const msg = document.createElement('p');
      msg.textContent = '登入已過期，重新登入後即可繼續';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = '重新登入';
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
    // 顯示 tool（null＝全部隱藏）
    sync(tool) {
      if (tool) ensure(tool);
      for (const [id, { pane }] of panes) pane.hidden = !tool || id !== tool.id;
    },
  };
}
