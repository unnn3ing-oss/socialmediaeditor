// 排程發布：貼網址帶入＋套版（共用畫圖核心）。公司模式用測試外殼、公司素材一律假圖。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { fakeAsset, API_BASE, openTool } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const PAGES = [{ id: '111', short: '新聞', order: 0 }, { id: '222', short: '娛樂', order: 1 }];
const TITLE = 'Buffet離場「偷換人吃」會被抓？員工曝驚人內幕：恐背詐欺罪';
const IMG_URL = 'https://cc.tvbs.com.tw/img/upload/2026/11/16/a.jpg';
const ARTICLE = `<html><head><meta property="og:title" content="${TITLE}"><meta property="og:image" content="${IMG_URL}">
<meta name="keywords" content="監視器,吃到飽,詐欺,很長很長的標籤"></head><body><article><h1>${TITLE}</h1>
<figure><img src="${IMG_URL}"><figcaption>（圖／TVBS）</figcaption></figure><p>內文</p></article></body></html>`;
const PHOTO = fakeAsset([60, 170, 90]);

// 公司模式（假外殼＋假憑證）開排程發布
async function openFb() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const posts = [], errors = [], articles = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('tbx.company', JSON.stringify({ token: 't', exp: Math.floor(Date.now() / 1000) + 3600, admin: true })); } catch {} });
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const json = (data) => r.fulfill({ headers: CORS, json: { ok: true, data } });
    if (p.startsWith('/assets/')) return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset() });
    if (p === '/auth/status') return json({ company: true, exp: 9e9, admin: true });
    if (p === '/fb/pages') return json(PAGES);
    if (p === '/fetch/article') {
      const url = u.searchParams.get('url'); articles.push(url);
      if (/slow/.test(url)) await new Promise((res) => setTimeout(res, 1500));
      return json({ html: ARTICLE, url });
    }
    if (p === '/fetch/image') return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: PHOTO });
    if (p === '/fb/post') { posts.push(req.postDataBuffer()); return json({ results: [{ page: '111', ok: true, postId: '111_1', scheduled: false, comment: 'done' }] }); }
    return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
  });
  await page.goto(srv.url + 'test/fixtures/company-host.html?tool=fbpost');
  const frame = await (await page.waitForSelector('iframe[name=tool]')).contentFrame();
  await frame.waitForSelector('#newBtn:not([hidden])');
  await frame.click('#newBtn');   // 第一次開啟才載入做圖模組
  await frame.waitForSelector('#postDlg:not([hidden])');
  await frame.waitForSelector('#pages .chip', { state: 'attached' });
  return { page, frame, posts, errors, articles };
}
const canvasHash = (frame, sel) => frame.evaluate(async (s) => {
  const d = document.querySelector(s).getContext('2d').getImageData(0, 0, 1080, 1080).data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', d))].map((b) => b.toString(16).padStart(2, '0')).join('');
}, sel);

test('貼網址帶入：sports 切娛樂框、標題自動換行、主圖、貼文內容與 hashtag', async () => {
  const { page, frame, posts, errors } = await openFb();
  assert.equal(await frame.isVisible('#frameSeg'), true, '公司模式有新聞／娛樂框');
  await frame.fill('#link', 'https://news.tvbs.com.tw/sports/4051394');   // 打完新聞網址就自動帶入，不用按鈕
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  assert.match(await frame.textContent('#pullHint'), /娛樂粉框.*標題.*貼文內容.*主圖/);
  assert.equal(await frame.getAttribute('#frameSeg [data-frame=entertainment]', 'aria-pressed'), 'true');
  const title = await frame.inputValue('#title');
  assert.ok(title.split('\n').length >= 2, '標題已自動換行：' + title);
  assert.equal(title.replace(/\n/g, ''), TITLE.replace(/\s/g, ''));
  const msg = await frame.inputValue('#msg');
  assert.match(msg, new RegExp('^【' + TITLE.replace(/[?？()（）]/g, '.') + '】'));
  assert.match(msg, /（圖／TVBS）/);
  assert.match(msg, /#監視器 #吃到飽 #詐欺/);
  assert.equal(await frame.isHidden('#cvEmpty'), true, '預覽已有圖');
  assert.equal(await frame.inputValue('#lead'), '', '留言內容不預先填字，避免誤刪');
  assert.match(await frame.getAttribute('#lead', 'placeholder'), /看更多新聞內容/);
  assert.equal(await frame.locator('#pullBtn, #img, #photo, [data-mode=own]').count(), 0, '沒有帶入鈕、上傳與自己的圖');

  await frame.fill('#lead', '完整報導看這裡');
  await frame.click('#pages .chip[data-page="111"] .chip-l');
  await frame.click('#sendBtn');
  await frame.waitForSelector('#doneList li');
  const body = posts[0].toString('latin1');
  assert.match(body, /name="image"; filename="fbpost\.png"\r\nContent-Type: image\/png/);
  assert.match(Buffer.from(body, 'latin1').toString('utf8'), /name="commentLead"\r\n\r\n完整報導看這裡/);
  assert.match(body, /name="link"\r\n\r\nhttps:\/\/news\.tvbs\.com\.tw\/sports\/4051394/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('已有內容時帶入先確認，按返回不覆蓋', async () => {
  const { page, frame } = await openFb();
  await frame.fill('#title', '我自己打的標題');
  await frame.fill('#link', 'https://news.tvbs.com.tw/politics/1');
  await frame.press('#link', 'Enter');
  await frame.waitForSelector('#cfDlg[open]');
  await frame.click('#cfNo');
  await frame.waitForFunction(() => /已取消帶入/.test(document.getElementById('pullHint').textContent));
  assert.equal(await frame.inputValue('#title'), '我自己打的標題');
  await page.close();
});

test('同樣的輸入與字級，排程發布與共用畫圖核心畫出來的圖完全相同（選套版 66px＋標題靠下排法、純文字圖 76px）', async () => {
  const { page, frame } = await openFb();
  // 作圖框：帶入（新聞框）
  await frame.fill('#link', 'https://news.tvbs.com.tw/politics/4046330');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  await frame.fill('#title', '藍營大老拋\n兩岸統一「10年計畫」\n關中、丁守中急切割');
  await frame.evaluate(async () => { await (await import('../../ui/compose/render.js')).loadTitleGlyphs(document.getElementById('title').value); await new Promise((r) => setTimeout(r, 100)); });
  const fbImage = await canvasHash(frame, '#cv');
  // 純文字底圖（預設紅）
  await frame.click('#modeSeg [data-mode=color]');
  await frame.fill('#title', '快訊／\n蔣萬安激戰沈伯洋\nTVBS封關民調出爐！');
  await frame.evaluate(async () => { await (await import('../../ui/compose/render.js')).loadTitleGlyphs(document.getElementById('title').value); await new Promise((r) => setTimeout(r, 100)); });
  const fbColor = await canvasHash(frame, '#cv');
  await page.close();

  const { page: pp, frame: pf } = await openTool(browser, srv.url, 'pattern', { company: true });
  await pf.waitForSelector('.batch-item-block');
  const [ptImage, ptColor] = await pf.evaluate(async (photoB64) => {
    const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + photoB64; });
    const hash = async (ctx) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, 1080, 1080).data))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await PATTERN.renderer.ready;
    await PATTERN.compose.loadTitleGlyphs('藍營大老拋兩岸統一「10年計畫」關中、丁守中急切割快訊／蔣萬安激戰沈伯洋TVBS封關民調出爐！');
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 1080; return c.getContext('2d'); };
    const a = mk(); renderComposite(a, { type: 'image', image: im, view: newView() }, '藍營大老拋\n兩岸統一「10年計畫」\n關中、丁守中急切割', 66, 'news', null, undefined, { titleAnchor: 'bottom' });
    const b = mk(); renderComposite(b, { type: 'color', color: '#c80000' }, '快訊／\n蔣萬安激戰沈伯洋\nTVBS封關民調出爐！', 76, 'news', null);
    return [await hash(a), await hash(b)];
  }, PHOTO.toString('base64'));
  assert.equal(fbImage, ptImage, '作圖框');
  assert.equal(fbColor, ptColor, '純文字底圖');
  await pp.close();
});

test('貼圖與馬賽克：加到預覽，畫布跟著改變', async () => {
  const { page, frame } = await openFb();
  await frame.click('#modeSeg [data-mode=color]');
  await frame.fill('#title', '貼圖測試');
  const before = await canvasHash(frame, '#cv');
  assert.equal(await frame.isVisible('#fxBar'), false, '貼圖列預設收起');
  await frame.click('#fxBtn');
  // 純色底上的馬賽克平均後還是同色、標題又畫在上面，所以用貼圖（最後畫、蓋在最上面）驗證
  await frame.click('#fxSlot .fx-mosaic-tile');
  await frame.click('#fxSlot .fx-sticker-tile >> nth=0');
  await frame.waitForFunction(() => /已加 2 個/.test(document.getElementById('fxCount').textContent));
  assert.equal(await frame.locator('#cvWrap .fx-item').count(), 2, '預覽上有 2 個可拖曳方框');
  assert.notEqual(await canvasHash(frame, '#cv'), before);
  await page.close();
});

test('純文字：不附圖送出；標題字數超過 15 字紅字提醒但仍可送', async () => {
  const { page, frame, posts } = await openFb();
  await frame.fill('#title', '一二三四五六七八九十一二三四五六\n第二行');
  assert.match(await frame.textContent('#titleCount'), /第 1 行 16 字，超過 15 字（仍可送出）/);
  assert.match(await frame.getAttribute('#titleCount', 'class'), /\bbad\b/);
  await frame.click('#modeSeg [data-mode=text]');
  assert.equal(await frame.isHidden('#imgArea'), true);
  assert.equal(await frame.isVisible('#noImg'), true);
  await frame.fill('#msg', '只有文字');
  await frame.evaluate(() => { document.getElementById('link').value = 'https://news.tvbs.com.tw/life/1'; });   // 網址必填（不觸發帶入）
  await frame.click('#pages .chip[data-page="111"] .chip-l');
  await frame.click('#sendBtn');
  await frame.waitForSelector('#doneList li');
  const body = posts[0].toString('utf8');
  assert.doesNotMatch(body, /name="image"/, '純文字不附圖');
  assert.match(body, /name="message"\r\n\r\n只有文字/);
  assert.doesNotMatch(body, /name="commentLead"/, '留言內容沒輸入就不送，後端用預設文字');
  await page.close();
});

test('Ctrl+V 貼上照片（純文字圖時自動切回選套版）；預覽點兩下改標題', async () => {
  const { page, frame } = await openFb();
  await frame.click('#modeSeg [data-mode=color]');
  await frame.evaluate((b64) => {
    const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'x.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, PHOTO.toString('base64'));
  await frame.waitForFunction(() => /已貼上照片/.test(document.getElementById('pullHint').textContent));
  assert.equal(await frame.getAttribute('#modeSeg [data-mode=image]', 'aria-pressed'), 'true');
  assert.equal(await frame.isHidden('#cvEmpty'), true);
  // 點兩下預覽 → 出現輸入框，打字同步到右欄標題
  await frame.dblclick('#cv');
  await frame.waitForSelector('#cvWrap .cv-title:not([hidden])');
  await frame.fill('#cvWrap .cv-title', '預覽上改的標題');
  assert.equal(await frame.inputValue('#title'), '預覽上改的標題');
  await frame.press('#cvWrap .cv-title', 'Escape');
  assert.equal(await frame.isHidden('#cvWrap .cv-title'), true);
  // 一般文字貼上不受影響
  await frame.focus('#msg');
  await frame.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'abc'); document.getElementById('msg').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
  assert.match(await frame.textContent('#pullHint'), /已貼上照片/, '文字貼上不會被當成照片');
  await page.close();
});

test('貼上網址只帶入一次；帶入中換網址，讀完會接著帶入新網址', async () => {
  const { page, frame, articles } = await openFb();
  await frame.evaluate(() => {
    const el = document.getElementById('link');
    el.value = 'https://news.tvbs.com.tw/sports/4051394';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  assert.deepEqual(articles, ['https://news.tvbs.com.tw/sports/4051394'], '只帶入一次');

  await frame.fill('#link', 'https://news.tvbs.com.tw/slow/4000001');   // 讀很久
  await page.waitForTimeout(900);
  await frame.fill('#link', 'https://news.tvbs.com.tw/politics/4000002'); // 讀取中換網址
  await frame.waitForSelector('#cfDlg[open]', { timeout: 6000 });         // 已有內容 → 問要不要覆蓋
  await frame.click('#cfYes');
  for (let i = 0; i < 40 && !articles.includes('https://news.tvbs.com.tw/politics/4000002'); i++) await page.waitForTimeout(100);
  assert.ok(articles.includes('https://news.tvbs.com.tw/politics/4000002'), '新網址有帶入：' + articles.join(','));
  await page.close();
});

test('從 Excel／Word 貼上（同時有文字和圖片）：文字照常貼，不換照片', async () => {
  const { page, frame } = await openFb();
  const prevented = await frame.evaluate((b64) => {
    const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.setData('text/plain', '儲存格文字');
    dt.items.add(new File([u8], 'cell.png', { type: 'image/png' }));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.getElementById('msg').dispatchEvent(ev);
    return ev.defaultPrevented;
  }, PHOTO.toString('base64'));
  assert.equal(prevented, false);
  await page.waitForTimeout(300);
  assert.doesNotMatch(await frame.textContent('#pullHint'), /已貼上照片/);
  await page.close();
});

test('預覽上編輯標題時帶入：編輯框收起，標題是文章標題', async () => {
  const { page, frame } = await openFb();
  await frame.evaluate((b64) => {
    const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'x.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, PHOTO.toString('base64'));
  await frame.waitForSelector('#cvEmpty', { state: 'hidden' });
  await frame.dblclick('#cv');
  await frame.waitForSelector('#cvWrap .cv-title:not([hidden])');
  await frame.evaluate(() => { const el = document.getElementById('link'); el.value = 'https://news.tvbs.com.tw/life/4000003'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await frame.waitForSelector('#cfDlg[open]');
  await frame.click('#cfYes');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  assert.equal(await frame.isHidden('#cvWrap .cv-title'), true);
  assert.equal((await frame.inputValue('#title')).replace(/\n/g, ''), TITLE.replace(/\s/g, ''));
  await page.close();
});

test('底色展示窗：一排可左右滑、按右側鈕往右捲、點色塊換底色並顯示色碼', async () => {
  const { page, frame } = await openFb();
  await frame.click('#modeSeg [data-mode=color]');
  await frame.waitForSelector('#swatchBox:not([hidden])');
  const t = await frame.$eval('#swatches', (el) => ({ sw: el.scrollWidth, cw: el.clientWidth, rows: new Set([...el.children].map((c) => c.offsetTop)).size }));
  assert.equal(t.rows, 1, '只有一排');
  assert.ok(t.sw > t.cw, '比可視寬度長，可以左右滑');
  await frame.waitForFunction(() => { const el = document.getElementById('swatches'), b = el.querySelector('.is-on'), l = b.offsetLeft - el.offsetLeft; return l >= el.scrollLeft - 1 && l + b.offsetWidth <= el.scrollLeft + el.clientWidth + 1; }, null, { timeout: 3000 });   // 選到的底色捲到看得見
  await frame.$eval('#swatches', (el) => { el.scrollLeft = 0; });
  await frame.waitForFunction(() => document.getElementById('swPrev').disabled, null, { timeout: 3000 });   // 最左邊時左鈕停用
  await frame.click('#swNext');
  await frame.waitForFunction(() => document.getElementById('swatches').scrollLeft > 50 && !document.getElementById('swPrev').disabled, null, { timeout: 3000 });   // 往右捲了一頁，左鈕恢復
  assert.match(await frame.textContent('#colorCode'), /#c80000/i);
  const before = await canvasHash(frame, '#cv');
  const c = await frame.locator('#swatches [data-color]:not(.is-on)').first().getAttribute('data-color');
  const btn = frame.locator(`#swatches [data-color="${c}"]`);   // 用色碼固定住，點完它變成選取也找得到
  await btn.click();
  assert.equal(await btn.getAttribute('aria-pressed'), 'true');
  assert.equal((await frame.textContent('#colorCode')).toLowerCase(), c.toLowerCase());
  assert.notEqual(await canvasHash(frame, '#cv'), before);
  await page.close();
});

test('選套版標題照舊版排法：最後一行中心在 y 931、行距 93、往上長；公司字型沒載入時顯示原因', async () => {
  const { page, frame } = await openFb();
  await frame.fill('#link', 'https://news.tvbs.com.tw/politics/4046330');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  // 測試的假素材不是字型檔 → 提示原因
  assert.equal(await frame.isVisible('#fontWarn'), true);
  assert.match(await frame.textContent('#fontWarn'), /公司標題字型沒載入.*字型檔無法載入/);
  // 單色一字「一」：橫畫中心就是該行中心，好量
  const rows = async (title) => {
    await frame.fill('#title', title);
    await frame.evaluate(async () => { await (await import('../../ui/compose/render.js')).loadTitleGlyphs(document.getElementById('title').value); await new Promise((r) => setTimeout(r, 100)); });
    return frame.evaluate(() => {
      const d = document.getElementById('cv').getContext('2d').getImageData(500, 600, 80, 480).data;
      const hit = []; for (let y = 0; y < 480; y++) { let n = 0; for (let x = 0; x < 80; x++) { const i = (y * 80 + x) * 4; if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) n++; } if (n > 20) hit.push(600 + y); }
      const runs = []; for (const y of hit) { const r = runs[runs.length - 1]; if (r && y - r[1] <= 1) r[1] = y; else runs.push([y, y]); }
      return runs.map(([a, b]) => (a + b) / 2);
    });
  };
  const one = await rows('一');
  assert.equal(one.length, 1); assert.ok(Math.abs(one[0] - 931) <= 8, '一行：' + one);
  const three = await rows('一\n一\n一');
  assert.equal(three.length, 3, String(three));
  assert.ok(Math.abs(three[2] - 931) <= 8 && Math.abs(three[1] - 838) <= 8 && Math.abs(three[0] - 745) <= 8, '三行：' + three);
  await page.close();
});
