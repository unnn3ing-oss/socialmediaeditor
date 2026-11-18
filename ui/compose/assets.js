// 共用套版素材與字型載入（「圖片套版」「排程發布」共用，兩邊輸出才會一樣）。
// 公司素材（緞帶、Logo、公司標題字型、T寶貼圖）只寫後端代號，在工具的 tool.json assets 裡；拿不到就是 null。
export const STICKER_IDS = ['smile', 'shock', 'cry', 'angry', 'kiss', 'laugh', 'meh'];

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

async function urlOf(tb, key) {
  try { return (await tb.assets.get(key))?.url || null; } catch { return null; }
}
async function publicUrlOf(tb, key) {
  try { return (await tb.assets.getPublic(key))?.url || null; } catch { return null; }
}
// 管理員登入：貼圖公司版與通用版都列（通用版的 id 加 PUBLIC_SUFFIX）
export const PUBLIC_SUFFIX = '-p';

// 回傳 { ok, error }：error 是載入失敗的原因（給工具顯示，方便查字型檔問題）
async function loadTitleFont(url) {
  if (!url) return { ok: false, error: '拿不到字型檔' };
  try {
    const face = new FontFace('WHZ-Heavy', `url(${url})`);
    await face.load();
    document.fonts.add(face);
    return { ok: true, error: '' };
  } catch (e) { return { ok: false, error: '字型檔無法載入' + (e && e.message ? '（' + e.message + '）' : '') }; }
}

// 回傳 { company, ribbonEnt, ribbonNews, logo, fontLoaded, fontError, stickers: { id: url } }
// 選填 { waitFont: false }：素材網址拿到就回傳，字型改在背景載入；
//   多回 fontReady（promise，resolve 成 { fontLoaded, fontError }），此時 fontLoaded 為 false 僅表示「還沒載好」。
export async function loadComposeAssets(tb, { waitFont = true } = {}) {
  const [ribbonEnt, ribbonNews, logo, fontUrl, ...stickerUrls] = await Promise.all([
    urlOf(tb, 'frame.ent.ribbon'),
    urlOf(tb, 'frame.news.ribbon'),
    urlOf(tb, 'frame.logo'),
    urlOf(tb, 'font.title'),
    ...STICKER_IDS.map((id) => urlOf(tb, 'sticker.' + id)),
  ]);
  const loadFonts = async () => {
    const font = await loadTitleFont(fontUrl);
    if (!font.ok) {
      // Canvas 畫字不會等字型，先明確載入；離線時最多等 3 秒，之後退回系統字型
      await withTimeout(Promise.all([
        document.fonts.load('900 72px "Noto Sans TC"', '快訊標題'),
        document.fonts.load('500 50px "Noto Sans TC"', '快訊標題'),
      ]).catch(() => {}), 3000);
    }
    return { fontLoaded: font.ok, fontError: font.error };
  };
  const stickers = {};
  STICKER_IDS.forEach((id, i) => { if (stickerUrls[i]) stickers[id] = stickerUrls[i]; });
  if (tb.assets.admin?.()) {
    const pub = await Promise.all(STICKER_IDS.map((id) => publicUrlOf(tb, 'sticker.' + id)));
    STICKER_IDS.forEach((id, i) => { if (pub[i] && pub[i] !== stickers[id]) stickers[id + PUBLIC_SUFFIX] = pub[i]; });
  }
  const base = { company: Boolean(ribbonEnt || ribbonNews), ribbonEnt, ribbonNews, logo, stickers };
  if (!waitFont) return { ...base, fontLoaded: false, fontError: '', fontReady: loadFonts() };
  const f = await loadFonts();
  return { ...base, ...f };
}
