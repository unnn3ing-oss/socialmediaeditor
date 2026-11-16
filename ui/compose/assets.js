// 共用套版素材與字型載入（「圖片套版」「排程發布」共用，兩邊輸出才會一樣）。
// 公司素材（緞帶、Logo、公司標題字型、T寶貼圖）只寫後端代號，在工具的 tool.json assets 裡；拿不到就是 null。
export const STICKER_IDS = ['smile', 'shock', 'cry', 'angry', 'kiss', 'laugh', 'meh'];

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

async function urlOf(tb, key) {
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

// 回傳 { company, ribbonEnt, ribbonNews, logo, fontLoaded, stickers: { id: url } }
export async function loadComposeAssets(tb) {
  const [ribbonEnt, ribbonNews, logo, fontUrl, ...stickerUrls] = await Promise.all([
    urlOf(tb, 'frame.ent.ribbon'),
    urlOf(tb, 'frame.news.ribbon'),
    urlOf(tb, 'frame.logo'),
    urlOf(tb, 'font.title'),
    ...STICKER_IDS.map((id) => urlOf(tb, 'sticker.' + id)),
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
  return { company: Boolean(ribbonEnt || ribbonNews), ribbonEnt, ribbonNews, logo, fontLoaded, stickers };
}
