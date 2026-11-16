// 圖片套版：先用 tb 取得素材與字型，再依序載入 app.js、stickers.js（兩支是一般腳本，共用全域變數）。
// 素材結果放在 window.PATTERN：
//   company     有公司素材（緞帶任一取得）→ 才有新聞藍框／娛樂粉框／Logo
//   ribbonEnt / ribbonNews / logo   公司素材的網址（沒有就是 null）
//   stickers    { smile: url, ... }
//   fontLoaded  公司標題字型（WHZ-Heavy）載入成功；否則畫布用 Noto Sans TC 粗體
//   tb          SDK（下載、檔名）
//   parseArticle／autoLines／frameForUrl   新聞規則（快速填入）
//   compose／renderer   共用畫圖核心（ui/compose/render.js）與這次素材建好的畫圖器
import { tb } from '../../sdk/toolbox.js';
import { autoLines, frameForUrl } from '../../sdk/news-rules.js';
import { parseArticle } from '../../sdk/news-article.js';
import * as compose from '../../ui/compose/render.js';
import { createFxKit } from '../../ui/compose/fx.js';
import { loadComposeAssets } from '../../ui/compose/assets.js';

tb.init('pattern');

const { company, ribbonEnt, ribbonNews, logo, fontLoaded, stickers } = await loadComposeAssets(tb);

window.PATTERN = {
  company,
  ribbonEnt, ribbonNews, logo, stickers, fontLoaded, tb,
  compose,                                                           // 共用畫圖核心（ui/compose/render.js）
  renderer: compose.createRenderer({ ribbonEnt, ribbonNews, logo, fontLoaded }),
  fxKit: createFxKit({ stickerUrls: stickers }),                      // 共用貼圖／馬賽克（ui/compose/fx.js）
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
