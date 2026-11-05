// 「全部清除」前的確認視窗（照舊的套版產生器寫法，改成模組）。HTML 裡要有 #confirmOverlay。
const overlay = document.getElementById('confirmOverlay');
const cancelBtn = document.getElementById('confirmCancelBtn');
const okBtn = document.getElementById('confirmOkBtn');
const titleEl = document.getElementById('confirmTitle');
const msgEl = document.getElementById('confirmMessage');
let resolver = null;

function close(result) {
  overlay.classList.remove('open');
  if (resolver) { resolver(result); resolver = null; }
}
cancelBtn.addEventListener('click', () => close(false));
okBtn.addEventListener('click', () => close(true));
overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(false); });

export function askConfirm({
  title = '確定要全部清除？',
  message = '這會清空目前畫面上的所有設定，且無法復原。',
  okText = '全部清除',
} = {}) {
  titleEl.textContent = title;
  msgEl.textContent = message;
  okBtn.textContent = okText;
  overlay.classList.add('open');
  okBtn.focus();
  return new Promise((resolve) => { resolver = resolve; });
}

export function isImageFile(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|svg)$/i.test(file.name || '');
}
