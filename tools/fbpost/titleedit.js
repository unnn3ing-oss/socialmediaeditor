// 在預覽上點一下標題直接改：疊一個輸入框在標題位置（DOM，不會輸出），編輯中畫布暫時不畫標題、避免字疊兩層。
// 輸入框用畫布當下的字型、縮過的字級、每行位置排（render.js 的 titleLayout），不折行，所以框裡點哪個字游標就在哪。
// 和右欄的標題欄同一份內容。Esc 或點別處結束。
import { SIZE } from '../../ui/compose/render.js';

const HIT_PAD = 24;   // 標題文字外圍多少畫布 px 內算點到標題

// host：{ canvas, input（右欄標題 textarea）, renderer, mode()（'image'|'color'|'text'）, px()（標題字級，畫布 px）, ready(), redraw(), light() }
export function createTitleEditor(host) {
  const wrap = host.canvas.closest('.canvas-wrap');
  const box = document.createElement('textarea');
  box.className = 'cv-title';
  box.hidden = true;
  box.spellcheck = false;
  box.wrap = 'off';
  box.setAttribute('aria-label', '在預覽上改標題');
  wrap.append(box);
  let editing = false;

  const anchor = () => (host.mode() === 'color' ? 'center' : 'bottom');
  const layoutOf = (text) => host.renderer.titleLayout(text, host.px(), anchor());
  const scale = () => host.canvas.clientWidth / SIZE;

  function layout() {
    const L = layoutOf(box.value);
    const k = scale();
    const rows = Math.max(1, box.value.split('\n').length);
    // 第一個有字的行（lead）要落在畫布第一行的位置；前面的空行往上排
    const top = L.firstY - L.lineHeight / 2 - L.lead * L.lineHeight + L.shift;
    const cvTop = host.canvas.offsetTop, cvLeft = host.canvas.offsetLeft;
    box.style.left = `${cvLeft}px`;
    box.style.width = `${SIZE * k}px`;
    box.style.top = `${cvTop + top * k}px`;
    box.style.height = `${rows * L.lineHeight * k}px`;
    box.style.font = L.font.replace(/(\d+(?:\.\d+)?)px/, (_, n) => `${n * k}px`);
    box.style.lineHeight = `${L.lineHeight * k}px`;
    box.classList.toggle('on-light', host.mode() === 'color' && host.light());
  }

  // 畫布座標 → 標題輸入框裡的字元位置；沒點到標題回 -1
  function hitIndex(cx, cy) {
    const text = host.input.value;
    const L = layoutOf(text);
    const rows = text.replace(/\r/g, '').split('\n');
    const n = Math.max(1, L.lines.length);
    const i = Math.floor((cy - (L.firstY - L.lineHeight / 2)) / L.lineHeight);
    const top = L.firstY - L.lineHeight / 2 - HIT_PAD, bottom = L.firstY + (n - 0.5) * L.lineHeight + HIT_PAD;
    if (cy < top || cy > bottom) return -1;
    if (!L.lines.length) {   // 還沒有標題：點在標題那一帶就進入，游標放最後
      return Math.abs(cx - SIZE / 2) <= L.maxWidth / 2 ? text.length : -1;
    }
    const li = Math.max(0, Math.min(L.lines.length - 1, i));
    const line = L.lines[li], w = L.widths[li];
    const x0 = SIZE / 2 - w / 2;
    if (cx < x0 - HIT_PAD || cx > x0 + w + HIT_PAD) return -1;
    // 這一行在輸入框裡是第幾行（前面可能有空行）
    const row = L.lead + li;
    let offset = 0;
    for (let r = 0; r < row; r++) offset += rows[r].length + 1;
    // 找最接近點擊位置的字與字之間
    const chars = [...line];
    let best = 0, bestD = Infinity, acc = '';
    for (let c = 0; c <= chars.length; c++) {
      const d = Math.abs(x0 + host.renderer.measureTitle(acc, L.fontSize) - cx);
      if (d < bestD) { bestD = d; best = acc.length; }
      if (c < chars.length) acc += chars[c];
    }
    return offset + best;
  }

  function start(caret) {
    if (!host.ready() || host.mode() === 'text') return;
    editing = true;
    box.value = host.input.value;
    box.hidden = false;
    layout(); host.redraw();
    box.focus({ preventScroll: true });
    const at = caret == null || caret < 0 ? box.value.length : caret;
    box.setSelectionRange(at, at);
  }
  function end() {
    if (!editing) return;
    editing = false; box.hidden = true; host.redraw();
  }

  // 點一下標題進入編輯；點標題以外的地方照舊（拖曳照片、貼圖）
  let pending = -1;
  const toCanvas = (e) => {
    const r = host.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * SIZE / r.width, (e.clientY - r.top) * SIZE / r.height];
  };
  host.canvas.addEventListener('pointerdown', (e) => {
    pending = -1;
    if (editing || e.button !== 0 || !host.ready() || host.mode() === 'text') return;
    const at = hitIndex(...toCanvas(e));
    if (at < 0) return;
    pending = at;
    e.preventDefault(); e.stopImmediatePropagation();   // 不要開始拖曳照片
  }, true);
  host.canvas.addEventListener('click', (e) => {
    if (pending < 0) return;
    const at = pending; pending = -1;
    e.stopImmediatePropagation();
    start(at);
  }, true);
  host.canvas.addEventListener('dblclick', (e) => { if (!editing) start(hitIndex(...toCanvas(e))); });

  box.addEventListener('input', () => {
    host.input.value = box.value;
    host.input.dispatchEvent(new Event('input', { bubbles: true }));
    layout();
  });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); } });
  box.addEventListener('blur', end);
  new ResizeObserver(() => { if (editing) layout(); }).observe(host.canvas);

  return { editing: () => editing, start, end, hitIndex, layout };
}
