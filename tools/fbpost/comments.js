// 第 2、3 則留言：「＋ 再新增一則留言」最多到第 3 則；每則可選管理頁存的活動留言帶入（帶入後可再改）、
// 距上一則幾分鐘（5 的倍數，預設 5）。不帶連結。
import { $ } from './util.js';
import { createWarnPicker } from '../../ui/warnings.js';

const MAX_EXTRAS = 2;   // 第 1 則以外最多 2 則（共 3 則）
const DELAYS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 90, 120, 180, 240, 360, 720, 1440];
const delayLabel = (m) => (m < 60 ? `${m} 分鐘` : m % 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m / 60} 小時`);

export function createComments({ tb }) {
  let presets = [];
  const box = $('extras');
  const addBtn = $('addComment');

  tb.api.call('/fb/presets').then((list) => { presets = Array.isArray(list) ? list : []; refreshPresets(); }).catch(() => {});

  function fillPresetOptions(sel) {
    const cur = sel.value;
    sel.textContent = '';
    const own = document.createElement('option'); own.value = ''; own.textContent = '自行輸入'; sel.append(own);
    presets.forEach((p, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = '活動：' + p.name; sel.append(o); });
    sel.value = cur && presets[+cur] ? cur : '';
  }
  const refreshPresets = () => box.querySelectorAll('select.preset').forEach(fillPresetOptions);

  function renumber() {
    [...box.children].forEach((el, i) => { el.querySelector('.extra-title').textContent = `第 ${i + 2} 則留言`; });
    addBtn.disabled = box.children.length >= MAX_EXTRAS;
  }

  function add() {
    if (box.children.length >= MAX_EXTRAS) return;
    const el = document.createElement('div'); el.className = 'extra';
    const head = document.createElement('div'); head.className = 'extra-head';
    const title = document.createElement('strong'); title.className = 'extra-title';
    const preset = document.createElement('select'); preset.className = 'preset'; preset.setAttribute('aria-label', '留言內容來源');
    fillPresetOptions(preset);
    const dl = document.createElement('label'); dl.className = 'extra-delay'; dl.textContent = '距上一則 ';
    const delay = document.createElement('select'); delay.className = 'delay'; delay.setAttribute('aria-label', '距上一則留言');
    DELAYS.forEach((m) => { const o = document.createElement('option'); o.value = String(m); o.textContent = delayLabel(m); delay.append(o); });
    dl.append(delay);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'extra-del'; del.textContent = '刪除';
    head.append(title, preset, dl, del);
    const ta = document.createElement('textarea'); ta.rows = 3; ta.placeholder = '輸入留言內容（不帶連結）'; ta.setAttribute('aria-label', '留言內容');
    preset.addEventListener('change', () => { const p = presets[+preset.value]; if (preset.value !== '' && p) ta.value = p.body; });
    del.addEventListener('click', () => { el.remove(); renumber(); });
    el.append(head, ta);
    box.append(el);
    renumber();
    ta.focus();
  }
  addBtn.addEventListener('click', add);
  renumber();
  // 警語留言：獨立一則、與第 1 則同時，不佔第 2、3 則名額
  const warn = createWarnPicker({ button: $('warnBtn'), box: $('warnBox'), textarea: $('warnText'), clear: $('warnDel') });

  return {
    // 回傳 { comments: [{ message, delay }], warn } 或 { error }
    collect() {
      const comments = [];
      for (const [i, el] of [...box.children].entries()) {
        const message = el.querySelector('textarea').value.trim();
        if (!message) return { error: `第 ${i + 2} 則留言沒有內容（不需要就按刪除）。` };
        comments.push({ message, delay: +el.querySelector('select.delay').value });
      }
      return { comments, warn: warn.value() };
    },
    reset() { box.textContent = ''; renumber(); warn.reset(); }
  };
}
