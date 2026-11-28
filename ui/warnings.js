// 警語留言（2026-11-26）：排程發布、影片發布共用。
// 警語是「獨立一則留言」，與第 1 則同時發，不佔第 2、3 則的名額（後端 warn 欄位）。
// createWarnPicker({ button, box, textarea, clear, load, onChange })：
//   button＝「警語 ▾」、box＝顯示警語框的容器（沒內容時隱藏）、textarea＝警語內容（可再改）、clear＝「移除警語」按鈕
// 選單可多選：點一條＝加到最後一行，已有的再點＝拿掉；方向鍵／Home／End 移動、Esc 關閉並回到按鈕。

import { WARNINGS } from './warning-presets.js';
export { WARNINGS };

const lines = (ta) => ta.value.replace(/\r\n/g, '\n').split('\n');
const has = (ta, w) => lines(ta).some((l) => l.trim() === w);

export function createWarnPicker({ button, box, textarea, clear, load, onChange = () => {} }) {
  const menu = document.createElement('div');
  menu.className = 'warn-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  menu.setAttribute('aria-label', '選擇警語（可多選）');
  const opts = [];
  function render(groups) {
    opts.length = 0;
    menu.replaceChildren();
    for (const g of groups) {
      const h = document.createElement('div'); h.className = 'warn-group'; h.textContent = g.group; h.setAttribute('role', 'presentation');
      menu.append(h);
      for (const w of g.items) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'warn-opt';
        b.setAttribute('role', 'menuitemcheckbox'); b.tabIndex = -1; b.dataset.w = w;
        const ck = document.createElement('span'); ck.className = 'warn-ck'; ck.setAttribute('aria-hidden', 'true');
        const t = document.createElement('span'); t.textContent = w;
        b.append(ck, t);
        b.addEventListener('click', () => { toggle(w); b.focus(); });
        opts.push(b); menu.append(b);
      }
    }
    if (!opts.length) {
      const empty = document.createElement('div');
      empty.className = 'warn-group'; empty.textContent = '目前沒有預設警語';
      empty.tabIndex = -1; menu.append(empty);
    }
  }
  let groups = WARNINGS, opening = 0;
  render(groups);
  button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
  (button.parentElement || document.body).append(menu);

  function sync() {
    const any = textarea.value.trim() !== '';
    box.hidden = !any;
    button.classList.toggle('on', any);
    for (const b of opts) b.setAttribute('aria-checked', has(textarea, b.dataset.w) ? 'true' : 'false');
  }
  function toggle(w) {
    if (has(textarea, w)) textarea.value = lines(textarea).filter((l) => l.trim() !== w).join('\n').trim();
    else textarea.value = (textarea.value.trim() ? textarea.value.replace(/\s+$/, '') + '\n' : '') + w;
    sync(); onChange();
  }
  async function open() {
    if (button.disabled) return;
    const current = ++opening;
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    if (load) {
      render([]);
      const status = menu.lastElementChild;
      status.textContent = '讀取警語中…';
      status.focus();
      try {
        const latest = await load();
        if (Array.isArray(latest) && current === opening) groups = latest;
      } catch {}
      if (current !== opening || menu.hidden) return;
      const focused = menu.contains(document.activeElement);
      render(groups);
      sync();
      if (focused) focusFirst();
      return;
    }
    sync();
    focusFirst();
  }
  function focusFirst() {
    (opts.find((b) => b.getAttribute('aria-checked') === 'true') || opts[0] || menu.lastElementChild)?.focus();
  }
  function close(focusBtn) {
    if (menu.hidden) return;
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focusBtn) button.focus();
  }
  button.addEventListener('click', () => (menu.hidden ? open() : close(true)));
  menu.addEventListener('keydown', (e) => {
    const i = opts.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); if (opts.length) opts[(n + opts.length) % opts.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(opts.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== button && !button.contains(e.target)) close(false); });
  textarea.addEventListener('input', () => { sync(); onChange(); });
  if (clear) clear.addEventListener('click', () => { textarea.value = ''; sync(); onChange(); button.focus(); });
  sync();

  return {
    value: () => textarea.value.trim(),
    set(v) { textarea.value = v || ''; sync(); },
    reset() { textarea.value = ''; close(false); sync(); },
    close
  };
}
