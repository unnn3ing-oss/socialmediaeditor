// 臉書「背景樣式」文字貼文 preset 擷取腳本（2026-11-21 版）
// 用法：在粉專開啟「建立貼文」→ 點 Aa 彩色方塊 → 顯示所有背景 → 捲到底，
//       再到 DevTools Console 貼上執行。結果會複製到剪貼簿（JSON）。
// 注意：只讀取頁面 Relay store，不會發文。
// 已知欄位變更（相對於舊版腳本）：
//   - font_weight 欄位已不存在
//   - 500px 背景圖改在 background(...) → image(scale:2,width:500)
//   - 新增 background_description（臉書的中文描述）

(() => {
  const src = require('CometRelayEnvironment').getStore().getSource();
  const hex = argb => (argb ? '#' + String(argb).slice(2) : null);
  const fileId = id => {
    const r = id && src.get(id);
    if (!r) return null;
    const f = String(r.uri || r.url || '').split('?')[0].split('/').pop();
    const m = f.match(/^(\d+_\d+)_/);
    return m ? m[1] : null;
  };
  const refKey = (obj, prefix) =>
    Object.keys(obj).find(k => k.startsWith(prefix) && obj[k] && obj[k].__ref);

  const seen = new Set();
  const presets = [];
  for (const id of src.getRecordIDs()) {
    const r = src.get(id);
    if (!r || r.__typename !== 'TextFormatMetadata' || seen.has(r.preset_id)) continue;
    seen.add(r.preset_id);

    let imageId = null;
    const bk = refKey(r, 'background(');
    if (bk) {
      const b = src.get(r[bk].__ref);
      const ik = b && refKey(b, 'image(');
      if (ik) imageId = fileId(b[ik].__ref);
    }
    if (!imageId) {
      const tk = refKey(r, 'background_image(');
      if (tk) imageId = fileId(r[tk].__ref);
    }

    const bg = hex(r.background_color);
    const grad = hex(r.background_gradient_color);
    const type = imageId ? 'image' : grad && grad !== bg ? 'gradient' : 'solid';

    const p = {
      preset_id: r.preset_id,
      fb_description: (r.background_description || '').replace(/，背景$/, ''),
      type,
      background_color: bg,
      text_color: hex(r.color),
    };
    if (type === 'gradient') {
      p.gradient_color = grad;
      p.gradient_direction = r.background_gradient_direction || null;
    }
    if (type === 'image') p.background_image_id = imageId;
    presets.push(p);
  }

  const out = {
    _note: `擷取日期 ${new Date().toISOString().slice(0, 10)}，來源 TextFormatMetadata`,
    presets,
  };
  copy(JSON.stringify(out, null, 2));
  return `${presets.length} 組，已複製到剪貼簿`;
})();
