// 排程發布自己的規則（不放進共用模組）。
// 框：公司新聞網址 news.tvbs.com.tw/<類別>/<文章ID>，類別是 sports 或 entertainment → 娛樂粉框，其他一律新聞藍框
export function frameForUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return 'news'; }
  const cat = (u.pathname.split('/')[1] || '').toLowerCase();
  return cat === 'sports' || cat === 'entertainment' ? 'entertainment' : 'news';
}
