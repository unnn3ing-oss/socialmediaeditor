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
const BGS = [{ id: '106018623298955', name: '純紫', type: 'solid', css: '#C600FF', text: '#FFFFFF' }, { id: '249307305544279', name: '紅→藍漸層', type: 'gradient', css: 'linear-gradient(to top right,#FF0047,#2C34C7)', text: '#FFFFFF' }];

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
    if (p === '/fb/backgrounds') return json(BGS);
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
  assert.match(msg, new RegExp('^\n【' + TITLE.replace(/[?？()（）]/g, '.') + '】'));
  assert.match(msg, /（圖／TVBS）/);
  assert.match(msg, /#監視器 #吃到飽 #詐欺/);
  assert.equal(await frame.isHidden('#cvEmpty'), true, '預覽已有圖');
  assert.equal(await frame.inputValue('#lead'), '', '留言內容不預先填字，避免誤刪');
  assert.match(await frame.getAttribute('#lead', 'placeholder'), /看更多新聞內容/);
  assert.equal(await frame.locator('#pullBtn, #img, #photo, [data-mode=own]').count(), 0, '沒有帶入鈕與自己的圖（選照片用預覽框連點兩下）');

  await frame.fill('#lead', '完整報導看這裡');
  await frame.click('#pages .chip[data-page="111"] .chip-l');
  await frame.click('#sendBtn');
  await frame.waitForSelector('#doneList li');
  const body = posts[0].toString('latin1');
  assert.match(body, /name="image"; filename="fbpost\.png"\r\nContent-Type: image\/png/);
  assert.match(Buffer.from(body, 'latin1').toString('utf8'), /name="commentLead"\r\n\r\n完整報導看這裡/);
  assert.match(Buffer.from(body, 'latin1').toString('utf8'), /name="message"\r\n\r\n【/, '開頭留給小編文的空行沒填，送出時拿掉');
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

// 字型載完後工具會非同步重畫：連續兩次（間隔 150ms）雜湊相同才算畫好，最多等約 3 秒
async function stableHash(frame, sel) {
  let prev = await canvasHash(frame, sel);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const h = await canvasHash(frame, sel);
    if (h === prev) return h;
    prev = h;
  }
  return prev;
}

test('同樣的輸入與字級，排程發布與共用畫圖核心畫出來的圖完全相同（選套版 66px＋標題靠下排法、純文字圖 76px）', async () => {
  const { page, frame } = await openFb();
  // 作圖框：帶入（新聞框）
  await frame.fill('#link', 'https://news.tvbs.com.tw/politics/4046330');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  await frame.fill('#title', '藍營大老拋\n兩岸統一「10年計畫」\n關中、丁守中急切割');
  await frame.evaluate(async () => { await (await import('../../ui/compose/render.js')).loadTitleGlyphs(document.getElementById('title').value); await new Promise((r) => setTimeout(r, 100)); });
  const fbImage = await stableHash(frame, '#cv');
  // 純文字底圖（預設紅）
  await frame.click('#modeSeg [data-mode=color]');
  await frame.fill('#title', '快訊／\n蔣萬安激戰沈伯洋\nTVBS封關民調出爐！');
  await frame.evaluate(async () => { await (await import('../../ui/compose/render.js')).loadTitleGlyphs(document.getElementById('title').value); await new Promise((r) => setTimeout(r, 100)); });
  const fbColor = await stableHash(frame, '#cv');
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

test('純文字文字背景：選了顯示預覽與 N／130 字、送出帶 bg；超過 130 字擋送出；清空回「無」', async () => {
  const { page, frame, posts } = await openFb();
  await frame.click('#modeSeg [data-mode=text]');
  await frame.waitForSelector('#bgBox:not([hidden])');
  assert.equal(await frame.locator('#bgSws .sw').count(), 3, '「無」＋2 個背景');
  assert.equal(await frame.isHidden('#bgPrev'), true, '預設無背景');
  await frame.fill('#msg', '\n今天你投票了嗎？');
  await frame.click('#bgSws .sw[data-bg="106018623298955"]');
  assert.equal(await frame.isVisible('#bgPrev'), true);
  assert.equal(await frame.textContent('#bgText'), '今天你投票了嗎？');
  assert.equal(await frame.textContent('#bgName'), '純紫');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.getElementById('bgPrev')).color), 'rgb(255, 255, 255)');
  assert.equal(await frame.locator('#bgSws .bg-sep').count(), 2, '純色、漸層各一組');
  assert.match(await frame.textContent('#msgCount'), /^8／130 字/);
  await frame.evaluate(() => { document.getElementById('link').value = 'https://news.tvbs.com.tw/life/1'; });
  await frame.click('#pages .chip[data-page="111"] .chip-l');
  // 超過 130 字：字數變紅、擋送出
  await frame.fill('#msg', '字'.repeat(131));
  assert.match(await frame.getAttribute('#msgCount', 'class'), /\bbad\b/);
  await frame.click('#sendBtn');
  await frame.waitForFunction(() => /最多 130 字（目前 131 字）/.test(document.getElementById('sendErr').textContent));
  assert.equal(posts.length, 0);
  await frame.fill('#msg', '短句');
  await frame.click('#sendBtn');
  await frame.waitForSelector('#doneList li');
  const body = posts[0].toString('utf8');
  assert.match(body, /name="bg"\r\n\r\n106018623298955/);
  assert.doesNotMatch(body, /name="image"/);
  await frame.click('#doneAgain');
  assert.equal(await frame.textContent('#bgName'), '無', '送出完成清空後回「無」');
  // 切到選套版：不帶 bg、字數不顯示 130
  await frame.click('#bgSws .sw[data-bg="249307305544279"]');
  await frame.click('#modeSeg [data-mode=image]');
  assert.doesNotMatch(await frame.textContent('#msgCount'), /130/);
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

test('貼網址讀取中：預覽顯示骨架，讀完收起；T寶／馬賽克旁沒有「？」', async () => {
  const { page, frame, errors } = await openFb();
  assert.equal(await frame.locator('#cvHelp').count(), 0);
  assert.equal(await frame.isHidden('#cvSkel'), true, '平常不顯示骨架');
  await frame.fill('#link', 'https://news.tvbs.com.tw/slow/1234567');
  await frame.waitForSelector('#cvSkel:not([hidden])');
  assert.equal(await frame.locator('#cvSkel .sk').count(), 3);
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  assert.equal(await frame.isHidden('#cvSkel'), true, '讀完收起');
  assert.deepEqual(errors, []);
  await page.close();
});

// 白字範圍（r,g,b 都 > 200）的外框；兩張截圖比對預覽編輯框的字和畫布上的字是否同一位置
const whiteBox = (page, pngs) => page.evaluate(async (list) => Promise.all(list.map(async (b64) => {
  const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let l = 1e9, t = 1e9, r = -1, bt = -1;
  for (let y = 20; y < c.height - 20; y++) for (let i = 20; i < c.width - 20; i++) {   // 避開圓角外的白底
    const p = (y * c.width + i) * 4;
    if (d[p] > 200 && d[p + 1] > 200 && d[p + 2] > 200) { l = Math.min(l, i); r = Math.max(r, i); t = Math.min(t, y); bt = Math.max(bt, y); }
  }
  return { l, t, r, b: bt };
})), pngs);

for (const mode of ['image', 'color']) {
  test(`預覽上點一下標題（${mode === 'image' ? '選套版' : '純文字圖'}）：游標落在點的字，編輯框的字和畫布同一位置`, async () => {
    const { page, frame, errors } = await openFb();
    await frame.evaluate((b64) => {
      const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([u8], 'x.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, PHOTO.toString('base64'));
    await frame.waitForSelector('#cvEmpty', { state: 'hidden' });
    if (mode === 'color') { await frame.click('#modeSeg [data-mode=color]'); await frame.click('.shelf .swatches .sw'); }
    await frame.fill('#title', '第一行標題\n第二行比較長的標題');
    await page.waitForTimeout(400);
    const cv = frame.locator('#cv');
    const before = (await cv.screenshot()).toString('base64');
    const at = { len1: '第一行標題'.length };
    const box = await cv.boundingBox();
    // 用畫布座標換算：找第 2 行白字的範圍，取它前 3 個字的右緣
    const lineRect = await frame.evaluate(() => {
      const c = document.getElementById('cv'), x = c.getContext('2d');
      const d = x.getImageData(0, 0, 1080, 1080).data;
      // 由下往上找白字行
      const rows = [];
      for (let y = 0; y < 1080; y++) { let n = 0; for (let i = 0; i < 1080; i++) { const p = (y * 1080 + i) * 4; if (d[p] > 230 && d[p + 1] > 230 && d[p + 2] > 230) n++; } rows.push(n); }
      const bands = []; let s = -1;
      rows.forEach((n, y) => { if (n && s < 0) s = y; if (!n && s >= 0) { bands.push([s, y]); s = -1; } });
      const big = bands.filter(([a, b]) => b - a > 20);
      const [y0, y1] = big[big.length - 1];
      let l = 1080, r = 0;
      for (let y = y0; y < y1; y++) for (let i = 0; i < 1080; i++) { const p = (y * 1080 + i) * 4; if (d[p] > 230 && d[p + 1] > 230 && d[p + 2] > 230) { l = Math.min(l, i); r = Math.max(r, i); } }
      return { y: (y0 + y1) / 2, l, r };
    });
    const k = box.width / 1080, charW = (lineRect.r - lineRect.l) / 9;
    await page.mouse.click(box.x + (lineRect.l + charW * 2.8) * k, box.y + lineRect.y * k);
    await frame.waitForSelector('#cvWrap .cv-title:not([hidden])');
    const sel = await frame.evaluate(() => document.querySelector('#cvWrap .cv-title').selectionStart);
    assert.equal(sel, at.len1 + 1 + 3, '游標在第 2 行第 3 個字後面');
    // 拿掉虛線框與游標，比對字的位置
    await frame.addStyleTag({ content: '#cvWrap .cv-title{outline:none!important;caret-color:transparent!important}' });
    await page.waitForTimeout(200);
    const after = (await cv.screenshot()).toString('base64');
    const [a, b] = await whiteBox(page, [before, after]);
    assert.ok(a.r > a.l && a.b > a.t && a.r - a.l > 100, '畫布上有抓到標題白字 ' + JSON.stringify(a));
    for (const key of ['l', 't', 'r', 'b']) assert.ok(Math.abs(a[key] - b[key]) <= 3, `${key}：畫布 ${a[key]}、編輯框 ${b[key]}`);
    await frame.press('#cvWrap .cv-title', 'Escape');
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('貼文內容：有填小編文就照原樣送出；字數不算開頭空行', async () => {
  const { page, frame, posts } = await openFb();
  await frame.fill('#link', 'https://news.tvbs.com.tw/sports/4051394');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  const msg = await frame.inputValue('#msg');
  assert.equal(msg[0], '\n', '第一行空白');
  assert.match(await frame.textContent('#msgCount'), new RegExp(`^${[...msg.slice(1)].length} 字`));
  await frame.focus('#msg');
  await frame.evaluate(() => { const t = document.getElementById('msg'); t.setSelectionRange(0, 0); });
  await frame.type('#msg', '小編文');
  await frame.click('#pages .chip[data-page="111"] .chip-l');
  await frame.click('#sendBtn');
  await frame.waitForSelector('#doneList li');
  assert.match(posts[0].toString('utf8'), /name="message"\r\n\r\n小編文\r?\n【/);
  await page.close();
});

test('標題右側每行字數和輸入框的行對齊；電腦版聚焦外框不被裁切', async () => {
  const { page, frame } = await openFb();
  await frame.fill('#title', '第一行\n第二行標題\n第三行\n第四行');
  const r = await frame.evaluate(() => {
    const ta = document.getElementById('title'), cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight), top = ta.getBoundingClientRect().top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    return [...document.querySelectorAll('#titleLines div')].map((d, i) => { const b = d.getBoundingClientRect(); return Math.abs((b.top + b.height / 2) - (top + lh * (i + 0.5))); });
  });
  assert.equal(r.length, 4);
  r.forEach((d, i) => assert.ok(d < 2, `第 ${i + 1} 行差 ${d}px`));
  assert.equal(await frame.getAttribute('#title', 'wrap'), 'off');
  // 聚焦外框（outline 2px＋offset 2px）完整落在捲動區內
  for (const id of ['link', 'msg']) {
    await frame.focus('#' + id);
    const ok = await frame.evaluate((id) => {
      const el = document.getElementById(id), sc = el.closest('.compose > .right');
      const a = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
      return a.left - 4 >= b.left && a.right + 4 <= b.right - (sc.offsetWidth - sc.clientWidth);
    }, id);
    assert.ok(ok, id + ' 的外框被裁切');
  }
  await page.close();
});

test('改標題同步貼文內容的【標題】：預覽上改、標題欄改都同步；刪掉【】行後不補回', async () => {
  const { page, frame, errors } = await openFb();
  await frame.fill('#link', 'https://news.tvbs.com.tw/world/4053093');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('pullHint').textContent));
  await frame.fill('#msg', '小編文\n' + (await frame.inputValue('#msg')).replace(/^\n/, ''));
  await frame.dblclick('#cv');
  await frame.waitForSelector('#cvWrap .cv-title:not([hidden])');
  await frame.fill('#cvWrap .cv-title', '預覽上改的\n新款 iPhone\n17 標題');
  await frame.press('#cvWrap .cv-title', 'Escape');
  let msg = await frame.inputValue('#msg');
  assert.equal(msg.split('\n')[0], '小編文', '小編文不動');
  assert.equal(msg.split('\n')[1], '【預覽上改的新款 iPhone 17 標題】');
  assert.match(msg, /（圖／TVBS）/, '圖說不動');
  await frame.fill('#title', '標題欄改的');
  assert.equal((await frame.inputValue('#msg')).split('\n')[1], '【標題欄改的】');
  await frame.fill('#msg', '只剩小編文');
  await frame.fill('#title', '再改一次');
  assert.equal(await frame.inputValue('#msg'), '只剩小編文', '沒有【】行不補回');
  assert.deepEqual(errors, []);
  await page.close();
});

test('標題、貼文內容預設 4 行，多打幾行自動長高、不出現框內捲軸', async () => {
  const { page, frame, errors } = await openFb();
  const box = (id) => frame.$eval(id, (e) => { const cs = getComputedStyle(e); return { h: e.offsetHeight, sh: e.scrollHeight, ch: e.clientHeight, lh: parseFloat(cs.lineHeight), rows: (e.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight) }; });
  const t0 = await box('#title'), m0 = await box('#msg');
  assert.equal(await frame.getAttribute('#msg', 'rows'), '4');
  for (const b of [t0, m0]) assert.ok(b.rows > 3.6 && b.rows < 4.6, `預設 4 行：${b.rows}`);
  await frame.fill('#msg', '一\n二\n三\n四\n五\n六\n七\n八');
  const m1 = await box('#msg');
  assert.ok(m1.h > m0.h + m0.lh * 3, `內文長高：${m0.h}→${m1.h}`);
  assert.ok(m1.sh <= m1.ch + 1, '沒有框內捲軸');
  await frame.fill('#msg', '');
  assert.equal((await box('#msg')).h, m0.h, '清掉回到 4 行');
  await frame.fill('#title', '一\n二\n三\n四\n五\n六');
  assert.ok((await box('#title')).h > t0.h, '標題長高');
  assert.deepEqual(errors, []);
  await page.close();
});

test('沒照片的預覽：底圖＋兩行提示；點一下聚焦、連點兩下選照片、可拖曳照片進來', async () => {
  const { page, frame, errors } = await openFb();
  assert.equal(await frame.isVisible('#cvEmpty strong'), true);
  assert.match(await frame.textContent('#cvEmpty'), /連點兩下選照片.*拖曳照片進來.*Ctrl\+V/);
  const px = await frame.$eval('#cv', (c) => [...c.getContext('2d').getImageData(540, 300, 1, 1).data]);
  assert.ok(px[3] === 255 && px[2] > 150, '畫了淡藍灰底圖：' + px);
  // 點一下：聚焦預覽框，不開選檔
  let chooser = false;
  page.on('filechooser', () => { chooser = true; });
  await frame.click('#cv');
  assert.equal(await frame.evaluate(() => document.activeElement.id), 'cvWrap');
  await page.waitForTimeout(200);
  assert.equal(chooser, false, '點一下不開選檔');
  // 連點兩下：開選檔，選了就換上照片
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), frame.dblclick('#cv')]);
  await fc.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: PHOTO });
  await frame.waitForFunction(() => document.getElementById('cvEmpty').hidden);
  assert.match(await frame.textContent('#pullHint'), /已選擇照片/);
  await page.close();
  const b = await openFb();
  await b.frame.evaluate((b64) => {
    const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'x.png', { type: 'image/png' }));
    const w = document.getElementById('cvWrap');
    w.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    w.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, PHOTO.toString('base64'));
  await b.frame.waitForFunction(() => document.getElementById('cvEmpty').hidden);
  assert.match(await b.frame.textContent('#pullHint'), /已放入照片/);
  assert.deepEqual([...errors, ...b.errors], []);
  await b.page.close();
});

test('沒照片時也能在預覽上點標題直接改（不開選檔）', async () => {
  const { page, frame, errors } = await openFb();
  await frame.fill('#title', '還沒有照片的標題');
  let chooser = false;
  page.on('filechooser', () => { chooser = true; });
  // 點標題那一帶（套版標題最後一行中心 y=931）；frame 在 iframe 裡，換成頁面座標
  const r = await frame.$eval('#cv', (c) => { const b = c.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 931 / 1080 }; });
  const off = await page.$eval('iframe[name=tool]', (f) => { const b = f.getBoundingClientRect(); return { x: b.left, y: b.top }; });
  await page.mouse.click(r.x + off.x, r.y + off.y);
  await frame.waitForSelector('#cvWrap .cv-title:not([hidden])');
  await frame.fill('#cvWrap .cv-title', '預覽上改');
  assert.equal(await frame.inputValue('#title'), '預覽上改');
  await frame.press('#cvWrap .cv-title', 'Escape');
  assert.equal(chooser, false);
  assert.equal(await frame.isVisible('#cvEmpty'), true, '仍是沒照片狀態');
  assert.deepEqual(errors, []);
  await page.close();
});

test('外掛側邊欄（is-side）預覽上改標題：編輯框不被側邊欄輸入框樣式撐小，最後一行不被切掉', async () => {
  const { page, frame, errors } = await openFb();
  await page.setViewportSize({ width: 360, height: 900 });
  await frame.evaluate(() => document.documentElement.classList.add('is-side'));
  await frame.evaluate((b64) => { const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([u8], 'x.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, PHOTO.toString('base64'));
  await frame.waitForFunction(() => document.getElementById('cvEmpty').hidden);
  await frame.fill('#title', '蔣萬安靠老師加分？\n老同學翻往事全說了\n嘆「對手像恐怖情人」');
  await frame.dblclick('#cv');
  await frame.waitForSelector('#cvWrap .cv-title:not([hidden])');
  const b = await frame.$eval('#cvWrap .cv-title', (e) => { const cs = getComputedStyle(e); return { h: e.clientHeight, sh: e.scrollHeight, pt: cs.paddingTop, pb: cs.paddingBottom }; });
  assert.equal(b.pt, '0px'); assert.equal(b.pb, '0px');
  assert.ok(b.sh <= b.h + 1, `內容沒超出編輯框：${b.sh}／${b.h}`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('沒照片時展開「T寶／馬賽克」：貼圖列不被停用頁的 .off 樣式撐成整個畫面高（網頁＋側邊欄）', async () => {
  for (const side of [false, true]) {
    const { page, frame, errors } = await openFb();
    await page.setViewportSize({ width: 360, height: 800 });
    if (side) await frame.evaluate(() => document.documentElement.classList.add('is-side'));
    await frame.click('#fxBtn');
    const b = await frame.$eval('#fxBar', (e) => ({ off: e.classList.contains('off'), h: e.offsetHeight, d: getComputedStyle(e).display, hint: document.getElementById('fxHint').offsetWidth }));
    assert.equal(b.off, true, '沒照片＝灰掉狀態');
    assert.notEqual(b.d, 'flex');
    assert.ok(b.h < 200, `貼圖列高度正常：${b.h}`);
    assert.ok(b.hint > 200, `說明文字不被擠成一直條：${b.hint}`);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
