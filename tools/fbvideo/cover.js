// 從影片選封面：預覽＋時間軸＋前一格／下一格＋平均 8 格快速挑選
// pickCover(v) → Promise：{ blob, url, t }（使用這一格）｜'auto'（恢復臉書自動封面）｜null（取消）
import { $, durText } from './util.js';

const STEP = 1 / 30;          // 前一格／下一格：約一格（30fps）
const MAX_EDGE = 1280;        // 封面輸出長邊
const STRIP = 8;

const seek = (vid, t) => new Promise((res) => {
  const done = () => { clearTimeout(timer); res(); };
  const timer = setTimeout(done, 3000);
  vid.addEventListener('seeked', done, { once: true });
  vid.currentTime = Math.max(0, Math.min(t, (vid.duration || 0) - 0.01));
});
const loaded = (vid) => new Promise((res) => {
  if (vid.readyState >= 2) return res();
  const done = () => { clearTimeout(timer); res(); };
  const timer = setTimeout(done, 5000);
  vid.addEventListener('loadeddata', done, { once: true });
  vid.addEventListener('error', done, { once: true });
});

function grab(vid, maxEdge) {
  const w0 = vid.videoWidth || 16, h0 = vid.videoHeight || 9;
  const k = Math.min(1, maxEdge / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  c.getContext('2d').drawImage(vid, 0, 0, c.width, c.height);
  return c;
}

export function pickCover(v) {
  const dlg = $('coverDlg'), vid = $('coverVid'), range = $('coverRange'), strip = $('coverStrip');
  return new Promise((resolve) => {
    let closed = false;
    const finish = (val) => { if (closed) return; closed = true; dlg.close(); vid.removeAttribute('src'); vid.load(); resolve(val); };
    const sync = () => {
      const d = vid.duration || 0;
      range.value = d ? String(Math.round((vid.currentTime / d) * 1000)) : '0';
      $('coverCur').textContent = durText(vid.currentTime);
      for (const b of strip.children) b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.t - vid.currentTime) < 0.05));
    };
    vid.src = v.url;
    strip.textContent = '';
    range.value = '0';
    $('coverCur').textContent = '0:00';
    $('coverDur').textContent = durText(v.duration);
    $('coverAuto').hidden = !v.cover;
    vid.onseeked = sync;
    range.oninput = () => { const d = vid.duration || 0; if (d) vid.currentTime = (+range.value / 1000) * d; };
    $('coverPrev').onclick = () => seek(vid, vid.currentTime - STEP);
    $('coverNext').onclick = () => seek(vid, vid.currentTime + STEP);
    $('coverCancel').onclick = () => finish(null);
    $('coverAuto').onclick = () => finish('auto');
    $('coverUse').onclick = () => {
      const c = grab(vid, MAX_EDGE);
      const t = vid.currentTime;
      c.toBlob((blob) => { if (!blob) return finish(null); finish({ blob, url: URL.createObjectURL(blob), t }); }, 'image/jpeg', 0.9);
    };
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    dlg.showModal();

    // 平均取 8 格（另一個 video 依序跳，畫成小圖；點了跳到那一格）
    (async () => {
      await loaded(vid);
      if (closed) return;
      await seek(vid, v.cover ? v.cover.t : Math.min(1, (vid.duration || 0) / 3));
      if (closed) return;
      sync();
      const d = vid.duration || 0;
      if (!d) return;
      const tmp = document.createElement('video');
      tmp.muted = true; tmp.preload = 'auto'; tmp.src = v.url;
      await loaded(tmp);
      if (closed) { tmp.removeAttribute('src'); tmp.load(); return; }
      for (let i = 0; i < STRIP && !closed; i++) {
        const t = (d * (i + 0.5)) / STRIP;
        await seek(tmp, t);
        if (closed) break;
        const c = grab(tmp, 240);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'strip-btn'; b.dataset.t = String(tmp.currentTime);
        b.setAttribute('aria-label', '跳到 ' + durText(t));
        const img = document.createElement('img'); img.src = c.toDataURL('image/jpeg', 0.7); img.alt = '';
        b.append(img);
        b.onclick = () => seek(vid, +b.dataset.t);
        strip.append(b);
      }
      tmp.removeAttribute('src'); tmp.load();
      sync();
    })();
  });
}
