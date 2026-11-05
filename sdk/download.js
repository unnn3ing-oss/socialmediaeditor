// 下載：檔名規則與批次下載（每張隨機間隔 500～1000ms，避免瀏覽器擋連續下載）。

const pad = (n) => String(n).padStart(2, '0');

// 'YYMMDDHHMM_n'，例：2610122312_1
export function stampName(date, n) {
  const y = pad(date.getFullYear() % 100);
  return `${y}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}_${n}`;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function download(blob, name) {
  saveBlob(blob, name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// items: [{ blob, name }]；rng、wait、save 可注入，方便測試。
download.batch = async function batch(items, { rng = Math.random, wait = sleep, save = saveBlob } = {}) {
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await wait(500 + rng() * 500);
    save(items[i].blob, items[i].name);
  }
};
