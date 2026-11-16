// 在預覽上點兩下直接改標題：疊一個輸入框在標題位置（DOM，不會輸出），編輯中畫布暫時不畫標題、避免字疊兩層。
// 和右欄的標題欄同一份內容。Esc 或點別處結束。
import { SIZE, BOX_CENTER, LINE_HEIGHT_RATIO } from '../../ui/compose/render.js';

// host：{ canvas, input（右欄標題 textarea）, mode()（'image'|'color'|'text'）, px()（標題字級，畫布 px）, ready(), redraw() }
export function createTitleEditor(host) {
  const wrap = host.canvas.closest('.canvas-wrap');
  const box = document.createElement('textarea');
  box.className = 'cv-title';
  box.hidden = true;
  box.spellcheck = false;
  box.setAttribute('aria-label', '在預覽上改標題');
  wrap.append(box);
  let editing = false;

  function layout() {
    const k = host.canvas.clientWidth / SIZE;
    const lines = Math.max(1, Math.min(4, box.value.split('\n').length));
    const lh = host.px() * LINE_HEIGHT_RATIO;
    const center = host.mode() === 'color' ? SIZE / 2 : (lines > 3 ? BOX_CENTER - (lines - 3) * lh / 2 : BOX_CENTER);
    const h = lines * lh + 24;
    box.style.left = `${60 * k}px`;
    box.style.width = `${(SIZE - 120) * k}px`;
    box.style.top = `${(center - h / 2) * k}px`;
    box.style.height = `${h * k}px`;
    box.style.fontSize = `${host.px() * k}px`;
    box.style.lineHeight = `${lh * k}px`;
    box.classList.toggle('on-light', host.mode() === 'color' && host.light());
  }
  function start() {
    if (!host.ready() || host.mode() === 'text') return;
    editing = true;
    box.value = host.input.value;
    box.hidden = false;
    layout(); host.redraw();
    box.focus();
  }
  function end() {
    if (!editing) return;
    editing = false; box.hidden = true; host.redraw();
  }
  host.canvas.addEventListener('dblclick', start);
  box.addEventListener('input', () => {
    host.input.value = box.value;
    host.input.dispatchEvent(new Event('input', { bubbles: true }));
    layout();
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); } });
  box.addEventListener('blur', end);
  new ResizeObserver(() => { if (editing) layout(); }).observe(host.canvas);

  return { editing: () => editing, start, end };
}
