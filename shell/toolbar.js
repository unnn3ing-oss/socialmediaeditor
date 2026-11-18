// 單列全域導覽（2026-11-18 UI 規範 §5、手機規範 §2）。
// 桌面：工具首頁＋各分類 disclosure 下拉（有滑鼠時 hover 150ms 開、離開 200ms 關；觸控／鍵盤用點擊）。
// ≤820px：只剩一顆「工具」，點開非模態面板（工具首頁＋各分類＋完整狀態）。
// 同一份 DOM：工具按鈕只建一次，桌面在下拉、手機在面板，用 CSS 切換。

const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });

export function createToolbar(root, { onOpen, onHome, statusEl = null }) {
  const narrow = mq('(max-width: 820px)');
  const hoverable = mq('(hover: hover) and (pointer: fine)');

  const panelBtn = mk('button', 'nav-tools');
  panelBtn.type = 'button';
  panelBtn.id = 'tools-btn';
  panelBtn.setAttribute('aria-expanded', 'false');
  panelBtn.setAttribute('aria-controls', 'tools-panel');
  panelBtn.append(mk('span', 'nav-tools-lbl', '工具'), chevron());
  const panel = mk('div', 'nav-panel');
  panel.id = 'tools-panel';
  const home = mk('button', 'nav-home', '工具首頁');
  home.type = 'button';
  home.dataset.home = '';
  const groupsEl = mk('div', 'nav-groups');
  const statusSlot = mk('div', 'nav-status');
  panel.append(home, groupsEl, statusSlot);
  root.textContent = '';
  root.append(panelBtn, panel);

  let groups = [];        // { el, trigger, menu }
  let openGroup = null;   // 目前展開的分類
  let openedByHover = false;
  let openTimer = 0;
  let closeTimer = 0;
  let current = null;     // 目前工具 id；null＝首頁

  const clearTimers = () => { clearTimeout(openTimer); clearTimeout(closeTimer); openTimer = closeTimer = 0; };

  function setGroup(g, byHover = false) {
    clearTimers();
    for (const x of groups) {
      const on = x === g;
      x.el.classList.toggle('open', on);
      x.trigger.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    openGroup = g;
    openedByHover = Boolean(g) && byHover;
  }
  function setPanel(on) {
    root.classList.toggle('open', on);
    panelBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function closeAll() { setGroup(null); setPanel(false); }

  // 手機面板放完整狀態；桌面放回頁首
  let statusHome = null;
  function placeStatus() {
    if (!statusEl) return;
    if (!statusHome) statusHome = { parent: statusEl.parentNode, next: statusEl.nextSibling };
    if (narrow.matches) { if (statusEl.parentNode !== statusSlot) statusSlot.appendChild(statusEl); }
    else if (statusEl.parentNode !== statusHome.parent) statusHome.parent.insertBefore(statusEl, statusHome.next);
  }
  narrow.addEventListener?.('change', () => { closeAll(); placeStatus(); });
  placeStatus();

  // ---- 手機「工具」面板 ----
  panelBtn.addEventListener('click', () => setPanel(!root.classList.contains('open')));

  home.addEventListener('click', () => { closeAll(); onHome(); });

  // ---- 外部點擊、iframe 取得焦點（window blur）、焦點離開整組 → 收起 ----
  document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) closeAll(); });
  window.addEventListener('blur', () => closeAll());
  root.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !root.contains(e.relatedTarget)) closeAll();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openGroup) { const t = openGroup.trigger; setGroup(null); t.focus(); e.preventDefault(); }
    else if (root.classList.contains('open')) { setPanel(false); panelBtn.focus(); e.preventDefault(); }
  });

  function bindGroup(g) {
    const { el, trigger, menu } = g;
    trigger.addEventListener('click', () => {
      // hover 剛打開時再點一下：保持打開（不要開了又馬上關）
      if (openGroup === g && openedByHover) { openedByHover = false; clearTimers(); return; }
      setGroup(openGroup === g ? null : g);
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      setGroup(g);
      menu.querySelector('button')?.focus();
    });
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || !hoverable.matches || narrow.matches) return;
      clearTimers();
      if (openGroup === g) return;
      openTimer = setTimeout(() => setGroup(g, true), OPEN_DELAY);
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || !hoverable.matches || narrow.matches) return;
      clearTimeout(openTimer);
      if (openGroup !== g) return;
      if (el.contains(document.activeElement) && !openedByHover) return; // 鍵盤焦點還在選單裡就不關
      closeTimer = setTimeout(() => { if (openGroup === g) setGroup(null); }, CLOSE_DELAY);
    });
  }

  function markCurrent() {
    if (current == null) home.setAttribute('aria-current', 'page'); else home.removeAttribute('aria-current');
    for (const g of groups) {
      let has = false;
      for (const b of g.menu.querySelectorAll('button[data-tool]')) {
        const on = b.dataset.tool === current;
        if (on) { b.setAttribute('aria-current', 'page'); has = true; } else b.removeAttribute('aria-current');
      }
      g.trigger.classList.toggle('has-current', has);
    }
  }

  return {
    render(tools) {
      closeAll();
      groupsEl.textContent = '';
      groups = [];
      const byGroup = new Map();
      for (const t of tools) {
        if (!byGroup.has(t.group)) byGroup.set(t.group, []);
        byGroup.get(t.group).push(t);
      }
      let n = 0;
      for (const [name, list] of byGroup) {
        const el = mk('div', 'nav-group');
        const menuId = `nav-menu-${n}`;
        const labelId = `nav-label-${n++}`;
        const trigger = mk('button', 'nav-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', menuId);
        trigger.append(mk('span', null, name), chevron());
        const label = mk('p', 'nav-label', name);
        label.id = labelId;
        const menu = mk('div', 'nav-menu');
        menu.id = menuId;
        menu.setAttribute('role', 'group');
        menu.setAttribute('aria-labelledby', labelId);
        for (const t of list) {
          const b = mk('button', 'nav-item');
          b.type = 'button';
          b.dataset.tool = t.id;
          const ico = mk('span', 'ico');
          ico.setAttribute('aria-hidden', 'true');
          // CSS 變數裡的相對網址會以樣式表位置解析，所以先轉成絕對網址
          ico.style.setProperty('--ico', `url("${new URL(t.icon, document.baseURI).href}")`);
          const check = mk('span', 'nav-check');
          check.setAttribute('aria-hidden', 'true');
          b.append(ico, mk('span', 'lbl', t.name), check);
          b.addEventListener('click', () => { closeAll(); onOpen(t.id); });
          menu.appendChild(b);
        }
        el.append(trigger, label, menu);
        groupsEl.appendChild(el);
        const g = { el, trigger, menu };
        groups.push(g);
        bindGroup(g);
      }
      markCurrent();
    },
    setCurrent(id) { current = id || null; markCurrent(); },
    // 舊介面相容：傳入目前可見工具 id 陣列
    setPressed(ids) { current = ids && ids[0] ? ids[0] : null; markCurrent(); },
    close: closeAll,
    // 手機：狀態收在面板裡，有需要注意的狀態時在「工具」鈕上加提示點
    setAlert(on) { panelBtn.classList.toggle('alert', Boolean(on)); },
  };
}

function chevron() {
  const c = document.createElement('span');
  c.className = 'nav-chev';
  c.setAttribute('aria-hidden', 'true');
  return c;
}
