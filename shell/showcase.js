// 工具首頁（2026-11-18 UI 規範 §6）：依 group 分區，桌面 3 欄／平板 2 欄／手機 1 欄的橫式卡片。
// 工具清單一律來自 catalog；使用條件標籤來自 tool.json 的 requires／badges。

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const REQUIRE_LABEL = { extension: '需要外掛', helper: '需要下載助手' };

// gate（tool.json）：依後端開放狀態顯示標籤。check → true（開放）／false（關閉或查不到）；每頁只查一次
const gateOpen = new Map();
const gateAsked = new Set();
const isOpen = (t) => !!(t.gate && gateOpen.get(t.gate.check) === true);
const descOf = (t) => (t.gate && !isOpen(t) && t.gate.desc) || t.desc;

function shell(root) {
  root.textContent = '';
  const inner = el('div', 'showcase-inner');
  const head = el('div', 'showcase-head');
  head.append(el('h1', null, '今天要完成什麼？'));
  inner.appendChild(head);
  root.appendChild(inner);
  return inner;
}

export function renderSkeleton(root) {
  const inner = shell(root);
  const grid = el('div', 'grid');
  for (let i = 0; i < 3; i++) {
    const c = el('div', 'card sk-card');
    c.setAttribute('aria-hidden', 'true');
    const m = el('div', 'meta');
    for (const w of ['50%', '85%']) { const s = el('span', 'sk'); s.style.cssText = `display:block;height:16px;width:${w}`; m.appendChild(s); }
    c.appendChild(m);
    grid.appendChild(c);
  }
  inner.appendChild(grid);
  root.setAttribute('aria-busy', 'true');
}

export function badgesOf(t) {
  const out = [...(t.badges || [])];
  if (t.gate && !isOpen(t)) out.push(t.gate.badge);
  for (const r of t.requires || []) if (REQUIRE_LABEL[r]) out.push(REQUIRE_LABEL[r]);
  return out;
}

// 卡片內容（說明＋標籤），gate 結果回來時原地更新
function fillCard(card, t) {
  card.title = descOf(t) || t.name;
  card.querySelector('.desc').textContent = descOf(t);
  const old = card.querySelector('.badges');
  if (old) old.remove();
  const badges = badgesOf(t);
  if (badges.length) {
    const row = el('span', 'badges');
    for (const b of badges) row.appendChild(el('span', 'badge', b));
    card.querySelector('.meta').appendChild(row);
  }
}

function askGates(root, tools, apiBase, fetchFn) {
  for (const t of tools) {
    const c = t.gate && t.gate.check;
    if (!c || gateAsked.has(c)) continue;
    gateAsked.add(c);
    fetchFn(apiBase + c, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { gateOpen.set(c, !!(j && j.ok && j.data && j.data.open === true)); })
      .catch(() => { gateOpen.set(c, false); })
      .then(() => {
        for (const x of tools) {
          if (!x.gate || x.gate.check !== c) continue;
          const card = root.querySelector(`.card[data-tool="${x.id}"]`);
          if (card) fillCard(card, x);
        }
      });
  }
}

export function renderShowcase(root, tools, { onOpen, apiBase = '', fetchFn = (...a) => globalThis.fetch(...a) }) {
  const inner = shell(root);
  const groups = new Map();
  for (const t of tools) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  let n = 0;
  for (const [name, list] of groups) {
    const sec = el('section', 'group');
    const h = el('h2', null, name);
    h.id = `g-${n++}`;
    sec.setAttribute('aria-labelledby', h.id);
    sec.appendChild(h);
    const grid = el('div', 'grid');
    for (const t of list) {
      const card = el('button', 'card');
      card.type = 'button';
      card.dataset.tool = t.id;
      const meta = el('div', 'meta');
      const title = el('span', 'name');
      const ico = el('span', 'ico');
      ico.setAttribute('aria-hidden', 'true');
      ico.style.setProperty('--ico', `url("${new URL(t.icon, document.baseURI).href}")`);
      title.append(ico, el('span', null, t.name));
      meta.append(title, el('span', 'desc', ''));
      const thumb = el('span', 'thumb');
      const img = el('img');
      img.alt = '';
      img.src = t.thumb;
      thumb.appendChild(img);
      card.append(meta, thumb);
      fillCard(card, t);
      card.addEventListener('click', () => onOpen(t.id));
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    inner.appendChild(sec);
  }
  // 頁尾：隱私權政策／資料刪除說明（臉書應用程式上線模式要求公開可讀）
  const foot = el('footer', 'site-foot');
  for (const [href, text] of [['privacy/', '隱私權政策'], ['data-deletion/', '資料刪除說明']]) {
    const a = el('a', null, text);
    a.href = href;
    foot.appendChild(a);
  }
  inner.appendChild(foot);
  root.removeAttribute('aria-busy');
  if (apiBase) askGates(root, tools, apiBase, fetchFn);
}
