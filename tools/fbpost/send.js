// 送出：組 FormData（圖、內文、文章網址、留言文字、各粉專目標）→ /fb/post，顯示每個粉專的結果
import { $, fmt, errText, COMMENT } from './util.js';

export function createSender({ tb, composer, targets }) {
  function updateButton() {
    const n = targets.count();
    $('sendBtn').textContent = `全部送出（${n} 個粉專）`;
    $('sendBtn').disabled = n === 0;
  }

  function renderResults(rs) {
    const ul = $('results'); ul.textContent = '';
    for (const r of rs) {
      const li = document.createElement('li'); li.className = r.ok ? 'ok' : 'err';
      let t = targets.shortOf(r.page) + '：';
      if (r.ok) {
        t += r.scheduled ? '排程成功' : '發布成功';
        if (r.scheduled && r.at) t += '（' + fmt(r.at * 1000) + '）';
        t += '；' + (COMMENT[r.comment] || '') + (r.comment === 'failed' && r.commentError ? '（' + r.commentError + '）' : '');
      } else t += '失敗（' + (r.error === 'fb_bad_time' ? '排程時間必須在 10 分鐘到 30 天之間' : (r.error || '未知原因')) + '）';
      li.textContent = t; ul.append(li);
    }
  }

  $('sendBtn').addEventListener('click', async () => {
    const err = $('sendErr'); err.textContent = '';
    const c = targets.collect();
    if (c.error) { err.textContent = c.error; return; }
    if (!c.targets.length) return;
    const btn = $('sendBtn'); btn.disabled = true; btn.textContent = '送出中…';
    try {
      const image = await composer.image();
      const msg = $('msg').value;
      if (!msg.trim() && !image) { err.textContent = '請輸入貼文內容或準備圖片。'; return; }
      const fd = new FormData();
      fd.append('message', msg);
      const link = $('link').value.trim();
      if (link) { fd.append('link', link); fd.append('commentLead', $('lead').value); }
      if (image) fd.append('image', image, image.name);
      fd.append('targets', JSON.stringify(c.targets));
      const data = await tb.api.call('/fb/post', { method: 'POST', body: fd });
      renderResults(data.results || []);
    } catch (e) {
      err.textContent = errText(e);
    } finally {
      updateButton();
    }
  });

  return { updateButton };
}
