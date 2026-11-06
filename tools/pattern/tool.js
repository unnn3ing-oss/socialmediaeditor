// 圖片套版：先用 tb 取得素材與字型，再依序載入 app.js、stickers.js（兩支是一般腳本，共用全域變數）。
// 素材結果放在 window.PATTERN：
//   company     有公司素材（緞帶任一取得）→ 才有新聞藍框／娛樂粉框／Logo
//   ribbonEnt / ribbonNews / logo   公司素材的網址（沒有就是 null）
//   stickers    { smile: url, ... }
//   fontLoaded  公司標題字型（WHZ-Heavy）載入成功；否則畫布用 Noto Sans TC 粗體
//   tb          SDK（下載、檔名）
//   parseArticle／autoLines／frameForUrl   新聞規則（快速填入）
import { tb } from '../../sdk/toolbox.js';
import { autoLines, frameForUrl } from '../../sdk/news-rules.js';
import { parseArticle } from '../../sdk/news-article.js';

tb.init('pattern');

const STICKER_IDS = ['smile', 'shock', 'cry', 'angry', 'kiss', 'laugh', 'meh'];

async function urlOf(key) {
  try { return (await tb.assets.get(key))?.url || null; } catch { return null; }
}

async function loadTitleFont(url) {
  if (!url) return false;
  try {
    const face = new FontFace('WHZ-Heavy', `url(${url})`);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch { return false; }
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

const [ribbonEnt, ribbonNews, logo, fontUrl, ...stickerUrls] = await Promise.all([
  urlOf('frame.ent.ribbon'),
  urlOf('frame.news.ribbon'),
  urlOf('frame.logo'),
  urlOf('font.title'),
  ...STICKER_IDS.map((id) => urlOf('sticker.' + id)),
]);

const fontLoaded = await loadTitleFont(fontUrl);
if (!fontLoaded) {
  // Canvas 畫字不會等字型，先明確載入；離線時最多等 3 秒，之後退回系統字型
  await withTimeout(Promise.all([
    document.fonts.load('900 72px "Noto Sans TC"', '快訊標題'),
    document.fonts.load('500 50px "Noto Sans TC"', '快訊標題'),
  ]).catch(() => {}), 3000);
}

const stickers = {};
STICKER_IDS.forEach((id, i) => { if (stickerUrls[i]) stickers[id] = stickerUrls[i]; });

window.PATTERN = {
  company: Boolean(ribbonEnt || ribbonNews),
  ribbonEnt, ribbonNews, logo, stickers, fontLoaded, tb,
  parseArticle, autoLines, frameForUrl,   // 快速填入（quickfill.js）用
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('載入失敗：' + src));
    document.body.appendChild(s);
  });
}

try {
  await loadScript('app.js');
  await loadScript('stickers.js');
  await loadScript('quickfill.js');
} catch (e) {
  tb.log.error('pattern-load-failed');
  throw e;
}
