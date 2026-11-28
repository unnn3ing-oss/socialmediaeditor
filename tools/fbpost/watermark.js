import { lumaTable, meanLuma } from '../../ui/watermark-luma.js';

const corners = [[1, 0], [0, 0], [0, 1], [1, 1]];

export async function loadWatermark(tb) {
  const asset = await tb.assets.get('watermark.news');
  if (!asset?.url) return null;
  const image = new Image();
  image.src = asset.url;
  await image.decode();
  return image;
}

function rect(W, H, logo, [x, y]) {
  const w = W * .13, h = w * logo.naturalHeight / logo.naturalWidth;
  const m = Math.min(W, H) * .03;
  const dx = W - w - 2 * m, dy = H - h - 2 * m;
  return [dx > 0 ? m + x * dx : (W - w) / 2, dy > 0 ? m + y * dy : (H - h) / 2, w, h];
}

export function watermarkPosition(image, logo) {
  const sample = document.createElement('canvas');
  const scale = 256 / Math.max(image.naturalWidth, image.naturalHeight);
  sample.width = Math.max(1, Math.round(image.naturalWidth * scale));
  sample.height = Math.max(1, Math.round(image.naturalHeight * scale));
  sample.getContext('2d').drawImage(image, 0, 0, sample.width, sample.height);
  const table = lumaTable(sample);
  let best = corners[0], minimum = Infinity;
  if (!table) return best;
  for (const corner of corners) {
    const value = meanLuma(table, ...rect(table.w, table.h, logo, corner));
    if (value < minimum - 2) { best = corner; minimum = value; }
  }
  return best;
}

export function paintWatermark(ctx, logo, corner, x, y, width, height) {
  const [left, top, w, h] = rect(width, height, logo, corner);
  ctx.drawImage(logo, x + left, y + top, w, h);
}
