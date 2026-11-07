// 排入 Rundown（純函式）：照網新快速排程（-schedulenewnet web/rundown.js）搬過來。
// 送出成功後把「文章ID/圖文/SLUG」或「文章ID/文字/SLUG」寫進 FB RUNDOWN 試算表；寫入由後端 /rundown 轉給 Apps Script。
// 粉專依 /fb/pages 的 code 對到 Rundown A 欄區段；其他粉專（擠看看、氣象）沒有區段，略過。
export const PAGES = { news: '主粉（新聞粉）', ent: '娛樂粉', shaokang: '少康粉', intl: '國際＋粉' };
const pad = (n) => String(n).padStart(2, '0');

// 類型：純文字底圖＋「無底色」或「臉書原生背景」＝文字；其他＝圖文
export const typeOf = (mode, textStyle) => (mode === 'text' && (textStyle === 'plain' || textStyle === 'native') ? '文字' : '圖文');

// 標題第一行有「/」（半形或全形）就只抓第一個斜線後面的字；斜線後面沒字就照舊。
// 第一行只有「快訊」「最新」「新」這種標籤（後面可帶斜線）時，改抓下一個有字的行。
// SLUG 只留文字和數字，取前 4 字。
const TAG_ONLY = /^\s*(?:最新|快訊|新)\s*[\/／]?\s*$/;
export const cleanSlug = (x) => String(x == null ? '' : x).replace(/[\p{P}\p{S}\p{Z}\p{C}]+/gu, '');
export function defaultSlug(lines) {
  const rows = (Array.isArray(lines) ? lines : String(lines || '').split('\n')).filter((l) => String(l || '').trim());
  let first = String(rows.find((l) => !TAG_ONLY.test(l)) || rows[0] || '');
  const cut = first.search(/[\/／]/);
  if (cut >= 0 && cleanSlug(first.slice(cut + 1))) first = first.slice(cut + 1);
  return Array.from(cleanSlug(first)).slice(0, 4).join('');
}
export const entryText = (articleId, type, slug) => `${articleId || ''}/${type}/${slug}`;

// 秒數（排程）或 Date（立即＝送出當下）→ { date, time }（本機時區）
export function whenOf(at) {
  const d = typeof at === 'number' ? new Date(at * 1000) : at;
  if (!(d instanceof Date) || isNaN(d)) return null;
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

// info：{ articleId, slug, lines, type }；sent：[{ code, at }] → { entries, skipped:[code] }
export function entries(info, sent) {
  const slug = cleanSlug(info.slug) || defaultSlug(info.lines);
  const text = entryText(info.articleId, info.type || '圖文', slug), out = [], skipped = [];
  for (const s of sent) {
    const w = whenOf(s.at);
    if (!PAGES[s.code] || !w) { skipped.push(s.code); continue; }
    out.push({ page: s.code, date: w.date, time: w.time, text });
  }
  return { entries: out, skipped };
}

// Apps Script 回的單筆結果 → 給人看的一句
export function describe(r, label) {
  if (!r) return `${label}：沒有回應`;
  if (!r.ok) return `${label}：${r.error || '失敗'}`;
  const cell = String(r.cell || '').replace(/^.*!/, '');
  if (r.status === 'exists') return `${label}：已在 ${cell}（不重複寫）`;
  return `${label} ${r.time || ''} → ${cell}${r.status === 'insert' ? '（插入）' : ''}${r.addedRow ? '（新增一列）' : ''}`;
}

// 關閉只保留在瀏覽器工作階段；不讀取舊的永久 localStorage 偏好。
export const SESSION_COOKIE = 'tbx.fbpost.rd-off.v1';
const browserDocument = () => { try { return globalThis.document || null; } catch { return null; } };
export function createRundownSession(doc = browserDocument(), protocol = doc?.location?.protocol || 'https:') {
  let memoryOn = true, persistent = !!doc;
  const attributes = '; Path=/' + (protocol === 'https:' ? '; Secure; SameSite=None; Partitioned' : '; SameSite=Lax');
  const cookieOff = () => String(doc.cookie || '').split(';').some((part) => part.trim() === SESSION_COOKIE + '=1');
  return {
    get persistent() { return persistent; },
    on() {
      if (!persistent) return memoryOn;
      try { memoryOn = !cookieOff(); return memoryOn; } catch { persistent = false; return memoryOn; }
    },
    set(on) {
      memoryOn = !!on;
      try {
        if (!doc) throw new Error('Cookie unavailable');
        doc.cookie = SESSION_COOKIE + (memoryOn ? '=; Max-Age=0' : '=1') + attributes;
        persistent = cookieOff() === !memoryOn;
      } catch { persistent = false; }
      return persistent;
    }
  };
}
const preference = createRundownSession();
export const rundownOn = () => preference.on();
export const setRundownOn = (on) => preference.set(on);
export const rundownPreferencePersistent = () => preference.persistent;
