// 已排程／已發佈：選粉專＋刷新才查；改時間、取消、刪除
import { $, fmt, errText, bounds, inRange, toLocalInput, commentState, say, confirmBox } from './util.js';

function thumb(url) {
  if (url) { const i = document.createElement('img'); i.className = 'thumb'; i.src = url; i.alt = ''; return i; }
  const d = document.createElement('div'); d.className = 'noimg'; d.textContent = '無圖'; return d;
}
function rowBase(it, whenMs) {
  const li = document.createElement('li'); li.dataset.id = it.id;
  const body = document.createElement('div'); body.className = 'body';
  const m = document.createElement('div'); m.textContent = (it.message || '').slice(0, 60);
  const c = commentState(it.comment);
  const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = fmt(whenMs) + (c ? '　' + c : '');
  body.append(m, meta);
  li.append(thumb(it.picture), body);
  return li;
}
// 排序：near＝時間由近到遠、far＝由遠到近；缺時間一律放最後
function byAt(x, y, order) {
  const a = Number(x) || 0, b = Number(y) || 0;
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  return order === 'far' ? b - a : a - b;
}
function btn(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm ' + cls; b.textContent = text; b.onclick = fn; return b; }

export function createManage({ tb }) {
  // 排序只重排畫面上的列，不重查臉書
  function sortSched() {
    const ul = $('schedList');
    [...ul.children].sort((a, b) => byAt(a.dataset.at, b.dataset.at, $('schedSort').value)).forEach((li) => ul.append(li));
  }
  let schedSeq = 0, pubSeq = 0;   // 換粉專或再查一次時，晚到的舊回應丟掉
  async function loadSched() {
    const page = $('schedPage').value; if (!page) return;
    const my = ++schedSeq;
    say('schedHint', '查詢中…');
    try {
      const items = (await tb.api.call('/fb/scheduled?page=' + encodeURIComponent(page))).slice();
      if (my !== schedSeq) return;
      items.sort((a, b) => byAt(a.at, b.at, $('schedSort').value));
      const ul = $('schedList'); ul.textContent = '';
      for (const it of items) {
        const li = rowBase(it, it.at * 1000); li.dataset.at = String(it.at || '');
        const acts = document.createElement('div'); acts.className = 'acts';
        const edit = document.createElement('div'); edit.className = 'edit'; edit.hidden = true;
        const dt = document.createElement('input'); dt.type = 'datetime-local';
        const ok = btn('確認改時間', 'btn-primary', async () => {
          const at = Math.floor(new Date(dt.value).getTime() / 1000);
          if (!inRange(at)) { say('schedHint', '排程時間必須在 10 分鐘到 30 天之間。', true); return; }
          try {
            await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/reschedule`, { method: 'POST', body: { page, at } });
            // 成功：直接更新這一列的時間並重排，不整份重查臉書
            it.at = at; li.dataset.at = String(at); edit.hidden = true;
            const c2 = commentState(it.comment); li.querySelector('.meta').textContent = fmt(at * 1000) + (c2 ? '　' + c2 : '');
            sortSched(); say('schedHint', `共 ${$('schedList').children.length} 則，已改時間`);
          }
          catch (e) { say('schedHint', errText(e), true); }
        });
        edit.append(dt, ok);
        const bEdit = btn('改時間', 'btn-secondary', () => {
          const { min, max } = bounds(); dt.min = min; dt.max = max; dt.value = toLocalInput(it.at * 1000); edit.hidden = !edit.hidden;
        });
        const bCancel = btn('取消', 'btn-secondary', async () => {
          if (!await confirmBox('取消排程', '確定要取消這則排程貼文嗎？')) return;
          try {
            await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/cancel`, { method: 'POST', body: { page } });
            li.remove(); const n = $('schedList').children.length; say('schedHint', n ? `共 ${n} 則` : '沒有排程貼文');   // 直接移除這一列，不重查
          }
          catch (e) { say('schedHint', errText(e), true); }
        });
        acts.append(bEdit, bCancel);
        li.append(acts, edit); ul.append(li);
      }
      say('schedHint', items.length ? `共 ${items.length} 則` : '沒有排程貼文');
    } catch (e) { if (my === schedSeq) say('schedHint', errText(e), true); }
  }

  let pubNext = null;
  async function loadPub(more) {
    const page = $('pubPage').value; if (!page) return;
    const my = ++pubSeq;
    say('pubHint', '查詢中…');
    try {
      const d = await tb.api.call('/fb/published?page=' + encodeURIComponent(page) + (more && pubNext ? '&after=' + encodeURIComponent(pubNext) : ''));
      if (my !== pubSeq) return;
      const ul = $('pubList'); if (!more) ul.textContent = '';
      for (const it of d.items || []) {
        const li = rowBase(it, new Date(it.time).getTime());
        const acts = document.createElement('div'); acts.className = 'acts';
        if (it.url) { const a = document.createElement('a'); a.className = 'btn btn-sm btn-secondary'; a.href = it.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '開啟'; acts.append(a); }
        acts.append(btn('刪除', 'btn-secondary', async () => {
          if (!await confirmBox('刪除貼文', '確定要刪除這則已發佈的貼文嗎？無法復原。')) return;
          try { await tb.api.call(`/fb/posts/${encodeURIComponent(it.id)}/delete`, { method: 'POST', body: { page } }); li.remove(); const n = ul.children.length; say('pubHint', n ? `共 ${n} 則` : '沒有已發佈貼文'); }
          catch (e) { say('pubHint', errText(e), true); }
        }));
        li.append(acts); ul.append(li);
      }
      pubNext = d.next || null; $('pubMore').hidden = !pubNext;
      say('pubHint', ul.children.length ? `共 ${ul.children.length} 則` : '沒有已發佈貼文');
    } catch (e) { if (my === pubSeq) say('pubHint', errText(e), true); }
  }

  $('schedReload').onclick = loadSched;
  // 排序只重排畫面上的列，不重查臉書
  $('schedSort').onchange = sortSched;
  // 換粉專：清掉舊粉專的列表，等按「刷新」才查（不自動查詢）
  $('schedPage').onchange = () => { schedSeq++; $('schedList').textContent = ''; say('schedHint', '按「刷新」讀取 Facebook 排程'); };
  $('pubPage').onchange = () => { pubSeq++; $('pubList').textContent = ''; pubNext = null; $('pubMore').hidden = true; say('pubHint', '按「刷新」讀取 Facebook 已發佈貼文'); };
  $('pubReload').onclick = () => loadPub(false);
  $('pubMore').onclick = () => loadPub(true);

  return {
    setPages(pages) {
      for (const id of ['schedPage', 'pubPage']) {
        const el = $(id), keep = el.value; el.textContent = '';
        for (const p of pages) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.short; el.append(o); }
        if (keep && pages.some((p) => p.id === keep)) el.value = keep;   // 重新整理粉專不動目前選的粉專與列表
      }
    }
  };
}
