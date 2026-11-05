// 設計：自由排版（文字、圖片、貼圖、形狀、馬賽克）。畫面與邏輯照舊工具搬入（design-*.js），這裡只接素材與下載。
// - 貼圖：tb.assets.get('sticker.<id>')，有密碼是 T 寶、沒密碼是通用貼紙。
// - 字型：有密碼且取得 font.title 就載入成 WHZ-Heavy；沒密碼預設 Noto Sans TC 900，選單不出現 WHZ-Heavy。
import { tb } from '../../sdk/toolbox.js';

tb.init('design');

const Q = window.QPTDesign;
const stickerIds = Q.core.STICKERS;

const [title, ...stickers] = await Promise.all([
  tb.assets.get('font.title').catch(() => null),
  ...stickerIds.map((s) => tb.assets.get('sticker.' + s).catch(() => null)),
]);

const stickerUrls = {};
stickerIds.forEach((s, i) => { stickerUrls[s] = stickers[i] && stickers[i].url ? stickers[i].url : ''; });

Q.fonts.configure({ titleUrl: title && title.url ? title.url : null });
Q.core.setDefaultFont(Q.fonts.defaultId());
Q.host = {
  stickerUrl: (s) => stickerUrls[s] || '',
  download: (blob, name) => tb.download(blob, name),
};

await new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'design-ui.js';
  s.onload = resolve;
  s.onerror = () => { tb.log.error('design-ui-load-failed'); reject(new Error('design-ui')); };
  document.body.appendChild(s);
});
document.documentElement.dataset.designReady = '1';
