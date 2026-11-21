// 粉專膠囊：沒勾＝外框；已勾＝藍底，左半勾選、右半「立即▾／排程 HH:MM▾」先跳小選單（立即發布／排程發布…）
import { $, hscroll } from './util.js';
import { timeStr, check, plus } from './time.js';

// 預設排程時間：現在＋30 分，進位到下一個 10 分
const defaultAt = () => { const ms = plus(Date.now(), 30); return Math.ceil(ms / 600000) * 600000; };

// defaults()：值班粉專 id（開始、清空時自動勾選）
export function createTargets({ timePop, onChange, defaults = () => [] }) {
  hscroll($('pages'));   // 粉專一列左右滑（滾輪也可以）
  let pages = [];
  const sel = new Map();   // pageId -> { on, sched, at(ms) }
  const nodes = new Map(); // pageId -> { chip, left, right }

  function paint(id) {
    const s = sel.get(id), n = nodes.get(id);
    n.chip.classList.toggle('on', s.on);
    n.left.setAttribute('aria-pressed', String(s.on));
    n.right.hidden = !s.on;
    n.right.textContent = s.sched ? `排程 ${timeStr(s.at)} ▾` : '立即 ▾';
    n.right.classList.toggle('bad', s.sched && !check(s.at).ok);
  }

  function render() {
    const box = $('pages'); box.textContent = ''; nodes.clear();
    pages.forEach((p) => {
      const s = sel.get(p.id) || { on: defaults().includes(p.id), sched: false, at: defaultAt() };
      sel.set(p.id, s);
      const chip = document.createElement('span'); chip.className = 'chip'; chip.dataset.page = p.id;
      const left = document.createElement('button'); left.type = 'button'; left.className = 'chip-l';
      const box2 = document.createElement('span'); box2.className = 'box'; box2.setAttribute('aria-hidden', 'true');
      const nm = document.createElement('span'); nm.textContent = p.short;
      left.append(box2, nm);
      const right = document.createElement('button'); right.type = 'button'; right.className = 'chip-r';
      right.setAttribute('aria-label', p.short + ' 發布時間');
      left.onclick = () => { s.on = !s.on; if (!s.on && timePop.isOpen()) timePop.close(); paint(p.id); onChange(); };
      right.onclick = () => timePop.open(right, s, () => { paint(p.id); onChange(); });
      chip.append(left, right);
      box.append(chip);
      nodes.set(p.id, { chip, left, right });
      paint(p.id);
    });
    onChange();
  }

  return {
    setPages(list) { pages = list; render(); },
    pages: () => pages,
    page: (id) => pages.find((x) => x.id === id) || null,
    shortOf: (id) => { const p = pages.find((x) => x.id === id); return p ? p.short : id; },
    count: () => pages.filter((p) => sel.get(p.id) && sel.get(p.id).on).length,
    // 回傳 { targets: [{ page, at(秒)|null }] } 或 { error }
    collect() {
      const targets = [];
      for (const p of pages) {
        const s = sel.get(p.id); if (!s || !s.on) continue;
        if (!s.sched) { targets.push({ page: p.id, at: null }); continue; }
        const c = check(s.at);
        if (!c.ok) return { error: `${p.short}：${c.msg}` };
        targets.push({ page: p.id, at: Math.floor(s.at / 1000) });
      }
      return { targets };
    },
    reset() { const d = defaults(); for (const [id, s] of sel) { s.on = d.includes(id); s.sched = false; s.at = defaultAt(); } for (const id of nodes.keys()) paint(id); onChange(); },
    // 值班粉專改了：還沒勾任何粉專時才套用（不蓋掉正在編輯的勾選）
    applyDefaults() { if (!pages.some((p) => sel.get(p.id) && sel.get(p.id).on)) this.reset(); }
  };
}
