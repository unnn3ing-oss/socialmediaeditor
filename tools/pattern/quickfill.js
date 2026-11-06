// 快速填入：貼文章網址 → 讀文章 → 自動選框、標題斷行、載入主圖到目前展開的那一組。
// 一般腳本，在 app.js 之後載入，沿用 app.js 的全域（batchItems、expandedBatchItemId、askConfirm、expandBatchItem、hasBackground）。
// 需要的純函式與 tb 由 tool.js 放在 window.PATTERN（tb、parseArticle、autoLines、frameForUrl）。
(function () {
  const PA = window.PATTERN;
  const input = document.getElementById('qfUrl');
  const btn = document.getElementById('qfBtn');
  const hint = document.getElementById('qfHint');
  if (!input || !btn || !PA.parseArticle) return;

  const MAX_IMAGES = 3;
  let busy = false;

  const say = (text, isError) => { hint.textContent = text; hint.classList.toggle('qf-error', !!isError); };

  // 後端錯誤（tb.api.call 會 reject：code 是錯誤代碼、message 是後端給的中文說明）→ 給人看的原因
  function reason(e) {
    const code = e && e.code;
    if (code === 'bad_request' && e.message) return e.message;   // 例如「只能讀取白名單內的 https 網址。」
    if (code === 'too_large') return '網頁太大，讀不了';
    if (e instanceof TypeError) return '連線失敗，請稍後再試';
    return '讀不到文章' + (code ? '（' + code + '）' : '');
  }

  // 目前要填的那一組：展開中的；沒有就用最後一組並展開
  function targetItem() {
    let item = batchItems.find(it => it.id === expandedBatchItemId);
    if (!item) {
      item = batchItems[batchItems.length - 1];
      expandBatchItem(item);
    }
    return item;
  }

  async function firstImageBlob(images) {
    for (const im of images.slice(0, MAX_IMAGES)) {
      if (!im || !im.url) continue;
      try {
        const res = await PA.tb.api.call('/fetch/image?url=' + encodeURIComponent(im.url), { raw: true });
        const blob = await res.blob();
        if (blob && blob.size) return blob;
      } catch { /* 換下一張 */ }
    }
    return null;
  }

  async function waitImage(item) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (item.bg && item.bg.type === 'image' && item.bg.image) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  }

  async function run() {
    if (busy) return;
    const url = input.value.trim();
    if (!/^https?:\/\//i.test(url)) { say('請貼文章網址（https:// 開頭）', true); return; }
    busy = true; btn.disabled = true;
    say('讀取中…');
    try {
      let article;
      try {
        const d = await PA.tb.api.call('/fetch/article?url=' + encodeURIComponent(url));
        article = PA.parseArticle((d && d.html) || '', (d && d.url) || url);
      } catch (e) { say('帶入失敗：' + reason(e), true); return; }  // 失敗不動已有內容
      if (!article.title && !article.images.length) { say('帶入失敗：文章裡找不到標題或圖片', true); return; }

      let item = targetItem();
      if (item.title.trim() || hasBackground(item.bg)) {
        const ok = await askConfirm({
          title: '要用文章內容覆蓋嗎？',
          message: `目前這一組已有標題或照片，帶入會覆蓋它們（框也會依網址切換）。`,
          okText: '覆蓋'
        });
        if (!ok) { say('已取消帶入'); return; }
        item = targetItem();
      }
      say('帶入中…');
      const done = [];
      const block = batchItemsList.querySelector(`[data-item-id="${item.id}"]`);

      // 框：娛樂 → 粉框、其他新聞 → 藍框；沒有公司素材時沒有這些框，維持通用框
      if (PA.company && block) {
        const key = PA.frameForUrl(url) === 'ent' ? 'entertainment' : 'news';
        const fb = block.querySelector(`.bg-toggle button[data-frame="${key}"]`);
        if (fb) { fb.click(); done.push(key === 'entertainment' ? '娛樂粉框' : '新聞藍框'); }
      }
      // 標題：自動斷行後填入（走 textarea 的 input，和手打同一路徑）
      if (article.title && block) {
        const ta = block.querySelector('textarea');
        ta.value = PA.autoLines(article.title).join('\n');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        done.push('標題');
      }
      // 主圖：依序試最多 3 張，第一張成功的走使用者選檔同一路徑
      let imgFail = false;
      if (article.images.length) {
        const blob = await firstImageBlob(article.images);
        if (blob && item.handleFile) {
          const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
          item.handleFile(new File([blob], 'article.' + ext, { type: blob.type || 'image/jpeg' }));
          if (await waitImage(item)) done.push('主圖'); else imgFail = true;
        } else imgFail = true;
      } else imgFail = true;

      say('已帶入：' + done.join('、') + (imgFail ? '（主圖讀取失敗，請手動放照片）' : ''), false);
    } finally {
      busy = false; btn.disabled = false;
    }
  }

  btn.addEventListener('click', run);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  // 貼上後等值進來再自動讀取
  input.addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\//i.test(input.value.trim())) run(); }, 0));
})();
