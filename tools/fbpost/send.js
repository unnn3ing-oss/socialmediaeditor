// 送出：組 FormData（圖、內文、文章網址、留言文字、各粉專目標）→ /fb/post → 排入 RD → 顯示每個粉專的結果
import { $, fmt, errText, COMMENT, confirmBox } from './util.js';

export function createSender({ tb, composer, targets, rd, comments }) {
  function updateButton() {
    const n = targets.count();
    $('sendBtn').textContent = `全部送出（${n} 個粉專）`;
    $('sendBtn').disabled = n === 0;
  }

  function renderResults(rs, rdLines) {
    const ul = $('results'); ul.textContent = '';
    for (const r of rs) {
      const li = document.createElement('li'); li.className = r.ok ? 'ok' : 'err';
      let t = targets.shortOf(r.page) + '：';
      if (r.ok) {
        t += r.scheduled ? '排程成功' : '發布成功';
        if (r.scheduled && r.at) t += '（' + fmt(r.at * 1000) + '）';
        t += '；' + (COMMENT[r.comment] || '') + ((r.comment === 'failed' || r.comment === 'retry') && r.commentError ? '（' + r.commentError + '）' : '');
        if (r.extra) t += `；另排 ${r.extra} 則留言`;
        if (r.extraError) t += `；第 2、3 則留言排定失敗（${r.extraError}）`;
      } else t += '失敗（' + (r.error === 'fb_bad_time' ? '排程時間必須在 10 分鐘到 30 天之間' : (r.error || '未知原因')) + '）';
      li.textContent = t; ul.append(li);
    }
    for (const line of rdLines) {
      const li = document.createElement('li'); li.className = /失敗|未寫入/.test(line) ? 'err' : 'rd';
      li.textContent = line; ul.append(li);
    }
  }

  $('sendBtn').addEventListener('click', async () => {
    const err = $('sendErr'); err.textContent = '';
    const c = targets.collect();
    if (c.error) { err.textContent = c.error; return; }
    const extra = comments.collect();
    if (extra.error) { err.textContent = extra.error; return; }
    if (!/^https?:\/\/\S+$/i.test($('link').value.trim())) { err.textContent = '請貼上文章網址（第 1 則留言和排入 RD 都要用到）。'; return; }
    if (!c.targets.length) return;
    const btn = $('sendBtn'); btn.disabled = true; btn.textContent = '送出中…';
    try {
      const image = await composer.image();
      const msg = $('msg').value;
      if (!msg.trim() && !image) { err.textContent = '請輸入貼文內容，或貼上網址帶入照片。'; return; }
      const fd = new FormData();
      fd.append('message', msg);
      const link = $('link').value.trim();
      if (link) {
        fd.append('link', link);
        const lead = $('lead').value.trim();
        if (lead) fd.append('commentLead', lead);   // 沒輸入＝後端預設「看更多新聞內容」
      }
      if (extra.comments.length) fd.append('comments', JSON.stringify(extra.comments));
      if (image) fd.append('image', image, image.name);
      fd.append('targets', JSON.stringify(c.targets));
      const sentAt = Date.now();
      const data = await tb.api.call('/fb/post', { method: 'POST', body: fd });
      const results = data.results || [];
      const rdLines = await rd.write({ results, pageOf: targets.page, link, title: $('title').value, sentAt });
      renderResults(results, rdLines);
    } catch (e) {
      err.textContent = errText(e);
    } finally {
      updateButton();
    }
  });

  $('clearBtn').addEventListener('click', async () => {
    if (!(await confirmBox('清空這則發文', '網址、圖片、標題、貼文內容、粉專勾選和結果都會清掉。'))) return;
    composer.reset(); targets.reset(); rd.reset(); comments.reset();
    $('results').textContent = ''; $('sendErr').textContent = '';
  });

  return { updateButton };
}
