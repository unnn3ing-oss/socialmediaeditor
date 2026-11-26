// 警語留言（2026-11-26）：排程發布、影片發布共用。
// 警語是「獨立一則留言」，與第 1 則同時發，不佔第 2、3 則的名額（後端 warn 欄位）。
// createWarnPicker({ button, box, textarea, clear, onChange })：
//   button＝「警語 ▾」、box＝顯示警語框的容器（沒內容時隱藏）、textarea＝警語內容（可再改）、clear＝「移除警語」按鈕
// 選單可多選：點一條＝加到最後一行，已有的再點＝拿掉；方向鍵／Home／End 移動、Esc 關閉並回到按鈕。

export const WARNINGS = [
  { group: '熱線', items: [
    '💬珍愛生命請撥打1925',
    '💬珍愛生命請撥打1925、生命線1995、張老師專線1980',
    '💬拒絕暴力請撥打110',
    '💬拒絕家暴請撥打110',
    '💬尊重身體自主權請撥打113、110'
  ] },
  { group: '《TVBS》提醒您', items: [
    '《TVBS》提醒您：◎珍惜生命拒絕毒品，健康無價不容毒噬',
    '《TVBS》提醒您： ◎尊重身體自主權 請撥打113、110',
    '《TVBS》提醒您： ◎飲酒勿開車！飲酒過量，有害健康，請勿酒駕',
    '《TVBS》提醒您：◎拒絕暴力 請撥打110',
    '◎TVBS提醒您，吸菸有害健康。',
    '◎TVBS提醒您，拒絕暴力。',
    '◎TVBS提醒您，安全不酒駕，酒駕不安全。'
  ] },
  { group: '其他', items: [
    '●民俗說法不代表TVBS立場，僅供參考',
    '▲危險動作，請勿模仿',
    '▲不良行為，請勿模仿',
    '◎珍愛生命，請撥打1995',
    '◎吸菸有礙身體健康，戒菸專線0800-636363'
  ] }
];

const lines = (ta) => ta.value.replace(/\r\n/g, '\n').split('\n');
const has = (ta, w) => lines(ta).some((l) => l.trim() === w);

export function createWarnPicker({ button, box, textarea, clear, onChange = () => {} }) {
  const menu = document.createElement('div');
  menu.className = 'warn-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  menu.setAttribute('aria-label', '選擇警語（可多選）');
  const opts = [];
  for (const g of WARNINGS) {
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
  function open() {
    if (button.disabled) return;
    sync(); menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    (opts.find((b) => b.getAttribute('aria-checked') === 'true') || opts[0]).focus();
  }
  function close(focusBtn) {
    if (menu.hidden) return;
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focusBtn) button.focus();
  }
  button.addEventListener('click', () => (menu.hidden ? open() : close(true)));
  menu.addEventListener('keydown', (e) => {
    const i = opts.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); opts[(n + opts.length) % opts.length].focus(); };
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
