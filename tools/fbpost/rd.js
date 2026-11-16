// 排入 RD：開關（記在瀏覽器，預設關）＋SLUG；臉書成功且粉專有 RD 區段才寫
import { $ } from './util.js';
import { dateStr, timeStr } from './time.js';
import { slugOf, articleId, rdText, rdBatches } from './slug.js';

const KEY = 'tbx.fbpost.rd';
const LABEL = { news: '主粉', ent: '娛樂粉', shaokang: '少康粉', intl: '國際＋粉' };

export function createRd({ tb }) {
  const sw = $('rdOn');
  try { sw.checked = localStorage.getItem(KEY) === '1'; } catch { sw.checked = false; }
  const sync = () => { $('rdSlug').disabled = !sw.checked; };
  sw.addEventListener('change', () => { try { localStorage.setItem(KEY, sw.checked ? '1' : '0'); } catch { /* 無痕視窗等，忽略 */ } sync(); });
  sync();

  // results：/fb/post 的結果；pageOf(id) -> { rd, short }；回傳要顯示的文字陣列（空＝沒開或沒有要寫的）
  async function write({ results, pageOf, link, title, sentAt }) {
    if (!sw.checked) return [];
    const id = articleId(link);
    if (!id) return ['RD：沒有文章 ID（網址最後要是新聞編號），未寫入'];
    const slug = slugOf($('rdSlug').value, title);
    if (!slug) return ['RD：沒有 SLUG（請填 SLUG 或標題），未寫入'];
    const entries = [];
    for (const r of results) {
      const p = pageOf(r.page);
      if (!r.ok || !p || !p.rd) continue;
      const ms = r.scheduled && r.at ? r.at * 1000 : sentAt;
      entries.push({ page: p.rd, date: dateStr(ms), time: timeStr(ms), text: rdText(id, slug) });
    }
    if (!entries.length) return ['RD：成功的粉專都沒有設定 RD 區段，未寫入'];
    const lines = [];
    for (const batch of rdBatches(entries)) {   // 去重；一次最多 10 筆，超過分批
      try {
        const d = await tb.api.call('/rundown', { method: 'POST', body: { entries: batch } });
        lines.push(...(d.results || []).map(line));
      } catch (e) {
        lines.push('RD：寫入失敗（' + ((e && e.message) || '失敗') + '）');
      }
    }
    return lines;
  }
  // Apps Script 回傳的一筆 → 顯示文字，例：RD 主粉 15:13 → AE255（插入）
  function line(x) {
    const label = LABEL[x.page] || x.page;
    if (!x.ok) return `RD ${label}：失敗（${x.error || '未知原因'}）`;
    const cell = String(x.cell || '').replace(/^.*!/, '');
    return `RD ${label} ${x.time || ''} → ${cell}${x.status === 'insert' ? '（插入）' : ''}${x.addedRow ? '（新增一列）' : ''}`;
  }
  return { write, reset() { $('rdSlug').value = ''; } };
}
