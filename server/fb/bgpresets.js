// 純文字貼文的臉書文字背景（text_format_preset_id）。
// 代號來源：Publer 文件（Meta 官方未公開，非官方參數，臉書改了代號就會失效）。
// 第一版寫死在這裡、只放純色與漸層；之後管理頁可增刪時，只要讓 listBackgrounds 改讀 D1、沒有資料才用 DEFAULT。
// css＝預覽用近似色（臉書沒公開色碼），實際以臉書為準。

export const BG_MAX_CHARS = 130;   // 臉書背景貼文字數上限

export const DEFAULT_BACKGROUNDS = [
  { id: '106018623298955', name: '紫', css: '#8a3ffc' },
  { id: '145893972683590', name: '深紫', css: '#4b1d95' },
  { id: '204187940028597', name: '紅', css: '#e41e3f' },
  { id: '1289741387813798', name: '暗紅', css: '#8f1d2c' },
  { id: '219266485227663', name: '洋紅', css: '#d11c8f' },
  { id: '217761075370932', name: '藍', css: '#1877f2' },
  { id: '301029513638534', name: '藍綠', css: '#0f9b94' },
  { id: '1881421442117417', name: '黑', css: '#161616' },
  { id: '901751159967576', name: '橘紅漸層', css: 'linear-gradient(135deg,#f7931e,#e0281c)' },
  { id: '446330032368780', name: '紅漸層', css: 'linear-gradient(135deg,#ff6f6f,#c0102a)' },
  { id: '1777259169190672', name: '紫洋紅漸層', css: 'linear-gradient(135deg,#6a2bd9,#d62c9b)' },
  { id: '249307305544279', name: '紅藍漸層', css: 'linear-gradient(135deg,#f0294b,#2b5cf0)' },
  { id: '688479024672716', name: '藍綠漸層', css: 'linear-gradient(135deg,#0aa5a0,#7bd657)' },
  { id: '1941912679424590', name: '灰漸層', css: 'linear-gradient(135deg,#8e99a5,#3a434e)' },
  { id: '122708641613922', name: '深灰漸層', css: 'linear-gradient(135deg,#4a4f57,#0c0c0e)' }
];

export async function listBackgrounds(env) { void env; return DEFAULT_BACKGROUNDS; }

export async function findBackground(env, id) {
  return (await listBackgrounds(env)).find((b) => b.id === id) || null;
}
