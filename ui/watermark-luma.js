export function lumaTable(c) {
  try {
    const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const t = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, a = d[i + 3] / 255;
        row += a * (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) + (1 - a) * 255;
        t[(y + 1) * (w + 1) + x + 1] = t[y * (w + 1) + x + 1] + row;
      }
    }
    return { w, h, t };
  } catch (e) { return null; }
}
export function meanLuma(L, x, y, w, h) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(L.w, Math.max(x0 + 1, Math.ceil(x + w))), y1 = Math.min(L.h, Math.max(y0 + 1, Math.ceil(y + h)));
  const W = L.w + 1, t = L.t;
  return (t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
}
