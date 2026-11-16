// 粉專勾選：每個粉專各自 勾選＋立即／排程＋時間
import { $, MIN_S, MAX_S, toLocalInput, bounds } from './util.js';

const defaultAt = () => toLocalInput(Date.now() + 30 * 60 * 1000);

export function createTargets({ onChange }) {
  let pages = [];
  const sel = new Map();   // pageId -> { on, sched, at }

  function render() {
    const ul = $('pages'); ul.textContent = '';
    const { min, max } = bounds();
    pages.forEach((p, i) => {
      const s = sel.get(p.id) || { on: false, sched: false, at: defaultAt() };
      sel.set(p.id, s);
      const li = document.createElement('li'); li.dataset.page = p.id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = s.on; cb.setAttribute('aria-label', '選取 ' + p.short);
      const no = document.createElement('span'); no.className = 'no'; no.textContent = String(i + 1);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.short;
      const when = document.createElement('span'); when.className = 'when';
      const bNow = document.createElement('button'); bNow.type = 'button'; bNow.textContent = '立即'; bNow.dataset.m = 'now';
      const bSch = document.createElement('button'); bSch.type = 'button'; bSch.textContent = '排程'; bSch.dataset.m = 'sched';
      when.append(bNow, bSch);
      const dtw = document.createElement('div'); dtw.className = 'dt';
      const dt = document.createElement('input'); dt.type = 'datetime-local'; dt.min = min; dt.max = max; dt.value = s.at; dt.setAttribute('aria-label', p.short + ' 排程時間');
      dtw.append(dt);
      const sync = () => { bNow.classList.toggle('is-on', !s.sched); bSch.classList.toggle('is-on', s.sched); dtw.hidden = !s.sched; };
      cb.onchange = () => { s.on = cb.checked; onChange(); };
      bNow.onclick = () => { s.sched = false; sync(); };
      bSch.onclick = () => { s.sched = true; sync(); };
      dt.oninput = () => { s.at = dt.value; };
      sync();
      li.append(cb, no, nm, when, dtw);
      ul.append(li);
    });
    onChange();
  }

  return {
    setPages(list) { pages = list; render(); },
    pages: () => pages,
    shortOf: (id) => { const p = pages.find((x) => x.id === id); return p ? p.short : id; },
    count: () => [...sel.values()].filter((s) => s.on).length,
    // 回傳 { targets } 或 { error }
    collect() {
      const targets = [];
      const nowS = Math.floor(Date.now() / 1000);
      for (const p of pages) {
        const s = sel.get(p.id); if (!s || !s.on) continue;
        if (!s.sched) { targets.push({ page: p.id, at: null }); continue; }
        const at = Math.floor(new Date(s.at).getTime() / 1000);
        if (!Number.isFinite(at) || at < nowS + MIN_S || at > nowS + MAX_S) return { error: `${p.short} 的排程時間必須在 10 分鐘到 30 天之間。` };
        targets.push({ page: p.id, at });
      }
      return { targets };
    }
  };
}
