// 送出：組 FormData（圖、內文、文章網址、留言文字、各粉專目標）→ /fb/post → 排入 RD → 顯示每個粉專的結果
// 全部粉專成功＝清空頁面、跳「送出完成」（再發一則／返回列表）；有任一失敗＝結果留在頁面、不清空
import { $, fmt, errText, COMMENT, confirmBox, copyText, stripLead } from './util.js';
import { BG_MAX } from './compose.js';

const newSendId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export function createSender({ tb, composer, targets, rd, comments, onBack }) {
  // 防重複發文：同一則（同一個文章網址、還沒清空）沿用同一組 sendId，後端會跳過已成功的粉專
  let sendId = newSendId(), sentLink = null;
  const unknown = new Set();   // 上次結果不明（可能已發出）的粉專
  function updateButton() {
    const n = targets.count();
    $('sendBtn').textContent = `全部送出（${n} 個粉專）`;
    $('sendBtn').disabled = n === 0;
    if (!$('sendErr').textContent || $('sendErr').dataset.auto) { $('sendErr').textContent = n ? '' : '請先勾選要發的粉專'; $('sendErr').dataset.auto = n ? '' : '1'; }
  }

  function renderResults(ul, rs, rdLines) {
    ul.textContent = '';
    for (const r of rs) {
      const li = document.createElement('li'); li.className = r.ok ? 'ok' : 'err';
      let t = targets.shortOf(r.page) + '：';
      if (r.ok && r.dup) {
        t += (r.scheduled ? '先前已排程' : '先前已發布') + '，這次未重送';
        if (r.scheduled && r.at) t += '（' + fmt(r.at * 1000) + '）';
      } else if (r.ok) {
        t += r.scheduled ? '排程成功' : '發布成功';
        if (r.scheduled && r.at) t += '（' + fmt(r.at * 1000) + '）';
        t += '；' + (COMMENT[r.comment] || '') + ((r.comment === 'failed' || r.comment === 'retry') && r.commentError ? '（' + r.commentError + '）' : '');
        if (r.extra) t += `；另排 ${r.extra} 則留言`;
        if (r.extraError) t += `；第 2、3 則留言排定失敗（${r.extraError}）`;
      } else if (r.unknown) {
        li.className = 'err';
        t += '待確認（' + (r.error || '結果不明') + '）：可能已經發出，請先到「已排程／已發佈」確認';
      } else t += '失敗（' + (r.error === 'fb_bad_time' ? '排程時間必須在 10 分鐘到 30 天之間' : (r.error || '未知原因')) + '）';
      li.textContent = t; ul.append(li);
    }
    for (const line of rdLines) {
      const li = document.createElement('li'); li.className = /失敗|未寫入/.test(line) ? 'err' : 'rd';
      li.textContent = line; ul.append(li);
    }
  }

  // 手機沒有游標：點一下送出鈕（停用時也算）顯示提示約 3 秒
  let tipTimer = 0;
  $('sendWrap').addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    $('sendWrap').classList.add('tip-on');
    clearTimeout(tipTimer); tipTimer = setTimeout(() => $('sendWrap').classList.remove('tip-on'), 3000);
  });

  $('sendBtn').addEventListener('click', async () => {
    const err = $('sendErr'); err.textContent = ''; err.dataset.auto = '';
    const c = targets.collect();
    if (c.error) { err.textContent = c.error; return; }
    const extra = comments.collect();
    if (extra.error) { err.textContent = extra.error; return; }
    if (!/^https?:\/\/\S+$/i.test($('link').value.trim())) { err.textContent = '請貼上文章網址（第 1 則留言和排入 RD 都要用到）。'; return; }
    if (!c.targets.length) return;
    const btn = $('sendBtn'); btn.disabled = true; btn.textContent = '送出中…';
    try {
      const image = await composer.image();
      const msg = stripLead($('msg').value);   // 開頭留給小編文的空行沒填就拿掉
      if (!msg.trim() && !image) { err.textContent = '請輸入貼文內容，或貼上網址帶入照片。'; return; }
      const bg = image ? '' : composer.bg();
      if (bg && [...msg].length > BG_MAX) { err.textContent = `有文字背景的貼文最多 ${BG_MAX} 字（目前 ${[...msg].length} 字），請縮短內容或把背景改成「無」。`; return; }
      // 純文字（沒附圖）用各粉專的「文字」UTM；沒設定的提醒一下（留言連結不會加 UTM）
      if (!image) {
        const miss = c.targets.map((t) => targets.page(t.page)).filter((p) => p && p.noTextUtm).map((p) => p.short);
        if (miss.length && !(await confirmBox('沒有設定文字 UTM', `${miss.join('、')} 沒有設定純文字貼文的 UTM，第 1 則留言的文章連結不會加 UTM。仍要送出嗎？（可到管理頁「粉專設定」填寫）`))) return;
      }
      const link = $('link').value.trim();
      if (link !== sentLink) { sendId = newSendId(); sentLink = link; unknown.clear(); }   // 換了文章＝新的一則
      const unsure = c.targets.map((t) => t.page).filter((id) => unknown.has(id));
      if (unsure.length && !(await confirmBox('上次送出結果不明', `${unsure.map((id) => targets.shortOf(id)).join('、')} 上次送出時沒有收到臉書的結果，可能已經發出。請先到「已排程／已發佈」確認；確定沒有發出才按「確定」重送，否則按「返回」並取消勾選這些粉專。`))) return;
      const fd = new FormData();
      fd.append('message', msg);
      fd.append('sendId', sendId);
      if (unsure.length) fd.append('retry', JSON.stringify(unsure));
      if (link) {
        fd.append('link', link);
        const lead = $('lead').value.trim();
        if (lead) fd.append('commentLead', lead);   // 沒輸入＝後端預設「看更多新聞內容」
      }
      if (extra.comments.length) fd.append('comments', JSON.stringify(extra.comments));
      if (image) fd.append('image', image, image.name);
      if (bg) fd.append('bg', bg);
      fd.append('targets', JSON.stringify(c.targets));
      const sentAt = Date.now();
      const data = await tb.api.call('/fb/post', { method: 'POST', body: fd });
      const results = data.results || [];
      for (const r of results) { if (r.unknown) unknown.add(r.page); else unknown.delete(r.page); }
      const rdOut = await rd.write({ results, pageOf: targets.page, link, title: $('title').value, sentAt });
      if (results.length && results.every((r) => r.ok)) { clearAll(); showDone(results, rdOut); return; }
      renderResults($('results'), results, rdOut.lines);
      $('results').scrollIntoView({ block: 'nearest' });
    } catch (e) {
      // 整個請求沒有回應：各粉專可能已發出，再送時後端會依 sendId 跳過已成功的、把結果不明的標成待確認
      err.textContent = errText(e);
    } finally {
      updateButton();
    }
  });

  function clearAll() {
    sendId = newSendId(); sentLink = null; unknown.clear();
    composer.reset(); targets.reset(); rd.reset(); comments.reset();
    $('results').textContent = ''; $('sendErr').textContent = '';
  }
  $('clearBtn').addEventListener('click', async () => {
    if (!(await confirmBox('清空這則發文', '網址、圖片、標題、貼文內容、粉專勾選和結果都會清掉。'))) return;
    clearAll();
  });

  // 送出完成視窗：RD 沒寫進去時顯示提醒＋可複製的 RD 格式
  const done = $('doneDlg');
  function showDone(results, rdOut) {
    renderResults($('doneList'), results, rdOut.lines);
    const f = rdOut.failed, miss = rdOut.missing;
    $('doneRd').hidden = !f && !miss;
    $('doneRdMsg').textContent = f ? 'RD 沒寫進去，請手動貼上：' : (miss || '');
    $('doneRdCopy').hidden = !f;
    $('doneRdWhere').hidden = !f;
    if (f) { $('doneRdText').textContent = f.text; $('doneRdCopy').dataset.text = f.text; $('doneRdWhere').textContent = f.where.join('、'); }
    $('doneRdCopy').classList.remove('copied');
    done.showModal();
    $('doneAgain').focus();
  }
  done.addEventListener('cancel', (e) => e.preventDefault());   // 一定要選一個
  $('doneAgain').addEventListener('click', () => { done.close(); $('link').focus(); });
  $('doneBack').addEventListener('click', () => { done.close(); if (onBack) onBack(); });
  let copyTimer;
  $('doneRdCopy').addEventListener('click', async () => {
    const b = $('doneRdCopy');
    if (!(await copyText(b.dataset.text || ''))) { $('doneRdMsg').textContent = '複製失敗，請手動選取文字。'; return; }
    b.classList.add('copied'); $('doneRdText').textContent = '已複製';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { b.classList.remove('copied'); $('doneRdText').textContent = b.dataset.text; }, 1500);
  });

  return { updateButton };
}
