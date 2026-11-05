// 範例工具：示範「工具內切換功能」的寫法。
// 規則：切換模式只改 hidden，不重建 DOM，每個模式的內容才會保留；「清空」才會刪除。
import { tb } from '../../sdk/toolbox.js';

tb.init('sample');

const sw = document.getElementById('mode-switch');
const panels = [document.getElementById('panel-1'), document.getElementById('panel-2')];
const labels = [document.getElementById('lbl-1'), document.getElementById('lbl-2')];
const texts = [document.getElementById('text-1'), document.getElementById('text-2')];

function showMode(i) {
  panels.forEach((p, k) => { p.hidden = k !== i; });
  labels.forEach((l, k) => l.classList.toggle('is-on', k === i));
  sw.setAttribute('aria-checked', String(i === 1));
  sw.setAttribute('aria-label', i === 0 ? '切換到模式二' : '切換到模式一');
}

sw.addEventListener('click', () => showMode(sw.getAttribute('aria-checked') === 'true' ? 0 : 1));

document.getElementById('clear').addEventListener('click', () => {
  texts.forEach((t) => { t.value = ''; });
  texts[sw.getAttribute('aria-checked') === 'true' ? 1 : 0].focus();
});
