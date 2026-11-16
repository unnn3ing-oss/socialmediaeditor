// 排入 RD 的文字（純函式）：`文章ID/圖文/SLUG`
const LABELS = ['快訊', '最新', '新'];          // 第一行只有這類標籤時改從下一行取
const clean = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '');   // 只留文字和數字

// manual：手填的 SLUG（只留文字數字）；空白時依標題（規則 A）：
//   第一個有字的行；有「/」或「／」取第一個斜線後面（後面沒字就用整行）；
//   去掉標點後若只剩「快訊／最新／新」這類標籤，改用下一個有字的行；最後取前 4 字
export function slugOf(manual, title) {
  const m = clean(manual);
  if (m) return m;
  const lines = String(title || '').replace(/\r/g, '').split('\n');
  for (const raw of lines) {
    let line = raw.trim();
    if (!clean(line)) continue;
    const at = line.search(/[/／]/);
    if (at >= 0 && clean(line.slice(at + 1))) line = line.slice(at + 1);
    const c = clean(line);
    if (LABELS.includes(c)) continue;
    return [...c].slice(0, 4).join('');
  }
  return '';
}

// 新聞網址最後一段數字（6～9 碼）
export function articleId(url) {
  let path = '';
  try { path = new URL(String(url || '').trim()).pathname; } catch { return ''; }
  const m = /\/(\d{6,9})\/?$/.exec(path);
  return m ? m[1] : '';
}

export const rdText = (id, slug) => `${id}/圖文/${slug}`;
