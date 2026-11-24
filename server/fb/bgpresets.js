// 純文字貼文的臉書文字背景（text_format_preset_id）。
// 清單來源：bgpresets.data.js（使用者從粉專發文框擷取的臉書實際資料）。Meta 官方未公開，非官方參數。
// 目前只開放純色與漸層（CSS 畫得出和臉書一樣的預覽）；圖樣類要等圖片存進 R2 才開放。
// 管理頁匯入過（D1 fb_backgrounds 有資料）就用 D1：圖樣類要 R2 有圖才開放；沒匯入過才用這份內建清單。
import DATA from './bgpresets.data.js';
import { storedBackgrounds, rndOf } from './bgstore.js';

export const BG_MAX_CHARS = 130;   // 臉書背景貼文字數上限
export const BG_TYPES = ['solid', 'gradient'];   // 目前開放的種類

const HEX = /^#[0-9a-f]{6}$/i;
const DIR = { BL_TR: 'to top right', TR_BL: 'to bottom left', TL_BR: 'to bottom right', BR_TL: 'to top left' };

// 擷取資料 → { id, name, type, css, text }；格式不對回 null
export function toBackground(p) {
  if (!p || !/^\d{6,20}$/.test(String(p.preset_id)) || !BG_TYPES.includes(p.type)) return null;
  const bg = p.background_color, text = p.text_color;
  if (!HEX.test(bg) || !HEX.test(text)) return null;
  let css = bg;
  if (p.type === 'gradient') {
    if (!HEX.test(p.gradient_color)) return null;
    css = `linear-gradient(${DIR[p.gradient_direction] || 'to bottom right'},${bg},${p.gradient_color})`;
  }
  const name = String(p.label || p.fb_description || '').trim().slice(0, 20) || String(p.preset_id);
  return { id: String(p.preset_id), name, type: p.type, css, text };
}

const ORDER = { solid: 0, gradient: 1 };
export const DEFAULT_BACKGROUNDS = DATA.presets.map(toBackground).filter(Boolean).map((b) => ({ ...b, rnd: true }))
  .sort((a, b) => ORDER[a.type] - ORDER[b.type]);   // 同種類維持臉書選單順序

// D1 一列 → { id, name, type, css, text, img? }；圖樣類 css＝底色（圖片還沒載入時的後備），img＝讀圖路徑
export function fromRow(r) {
  if (!r || !r.show) return null;
  const rnd = rndOf(r);
  if (r.type === 'image') return r.img ? { id: r.id, name: r.name, type: 'image', css: r.bg, text: r.text, img: '/fb/bg/' + r.id, rnd } : null;
  const b = toBackground({ preset_id: r.id, label: r.name, type: r.type, background_color: r.bg, text_color: r.text, gradient_color: r.grad, gradient_direction: r.dir });
  return b ? { ...b, name: r.name, rnd } : null;
}
const ORDER3 = { solid: 0, gradient: 1, image: 2 };

export async function listBackgrounds(env) {
  const rows = env && env.DB ? await storedBackgrounds(env) : [];
  if (!rows.length) return DEFAULT_BACKGROUNDS;
  return rows.map(fromRow).filter(Boolean).sort((a, b) => ORDER3[a.type] - ORDER3[b.type]);
}

export async function findBackground(env, id) {
  return (await listBackgrounds(env)).find((b) => b.id === id) || null;
}
