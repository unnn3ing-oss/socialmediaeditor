const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { openTool } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// 測試照片：用 canvas 產生一張淺灰 1200×900 PNG
async function photoBuffer(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(210,210,210)';
    x.fillRect(0, 0, 1200, 900);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // 素材 401／離線抓不到 Google Fonts 只是網路訊息，不算程式錯誤
    if (m.type() === 'error' && !/Failed to load resource|ERR_|fonts\.g/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const px = (frame, x, y) => frame.evaluate(([x, y]) => {
  const d = document.getElementById('batchCanvas').getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}, [x, y]);

async function waitPx(frame, x, y, pred, label) {
  const deadline = Date.now() + 8000;
  let last;
  while (Date.now() < deadline) {
    last = await px(frame, x, y);
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${label}：等不到預期的像素，最後是 ${last}`);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, t = 6) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);

async function setupItem(page, frame, title) {
  await frame.waitForSelector('.batch-item-block .dropzone input[type=file]', { state: 'attached' });
  await frame.setInputFiles('.batch-item-block .dropzone input[type=file]', {
    name: 'photo.png', mimeType: 'image/png', buffer: await photoBuffer(page),
  });
  await frame.fill('.batch-item-block textarea', title);
}

test('沒密碼：只有通用框，標籤區是主色、底部偏暗', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  const errors = watchErrors(page);
  await frame.waitForSelector('.batch-item-block');
  await setupItem(page, frame, '標題第一行\n第二行副標');
  const tag = await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '標籤區');
  assert.ok(near(tag, hex('#202124'), 2));
  const bottom = await px(frame, 700, 1060);
  assert.ok(bottom[0] < 90, `底部應該偏暗，實際 ${bottom}`);
  const top = await px(frame, 700, 300);
  assert.ok(top[0] > 190, `上半部應該是原照片亮度，實際 ${top}`);
  // 標籤右側白條
  const bar = await px(frame, 296, 100);
  assert.ok(bar[0] > 200 && bar[1] > 200 && bar[2] > 200);
  assert.deepEqual(errors, []);
});

test('改主色後標籤色改變；自訂色也行', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '標題');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '預設墨黑');
  await frame.click('.gen-swatch[data-color="#b03a2e"]');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#b03a2e'), 2), '磚紅');
  await frame.$eval('.gen-custom', (el) => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitPx(frame, 40, 100, (p) => near(p, hex('#123456'), 2), '自訂色');
  assert.equal(await frame.locator('.gen-swatch').count(), 5);
});

test('角標字留空：整個不畫；字很長：色塊變寬', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '標題');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '有標籤');
  await frame.fill('.gen-tag', '');
  const p = await waitPx(frame, 40, 100, (q) => !near(q, hex('#202124'), 20), '標籤留空');
  assert.ok(p[0] > 150, `留空時該區應是照片，實際 ${p}`);
  await frame.fill('.gen-tag', '獨家深度追蹤報導專題');
  await waitPx(frame, 400, 100, (q) => near(q, hex('#202124'), 2), '長標籤色塊變寬');
});

test('長標題自動縮小、不超出右邊界', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '這是一個非常非常非常非常非常非常非常非常長的標題用來測試自動縮小\n第二行也是非常非常非常非常非常非常非常非常長的副標題用來測試');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '畫好');
  await new Promise((r) => setTimeout(r, 300));
  for (const y of [880, 905, 980]) {
    const p = await px(frame, 1040, y);
    assert.ok(p[0] < 120, `x=1040,y=${y} 不應有字，實際 ${p}`);
  }
});

test('工具內切換不清空內容：背景類型、各組收合展開、框', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '第一組標題');
  await frame.fill('.gen-tag', '特報');
  await frame.click('.gen-swatch[data-color="#2f6b4f"]');
  // 圖片背景 → 純色背景 → 回圖片背景：照片與標題還在
  await frame.click('.batch-item-block .bg-toggle button:has-text("純色背景")');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第一組標題');
  await frame.click('.batch-item-block .bg-toggle button:has-text("圖片背景")');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#2f6b4f'), 2), '回到圖片背景後框還在');
  // 新增第二組，第一組收合成一列；再點回第一組
  await frame.click('#addBatchItemBtn');
  await frame.waitForFunction(() => document.querySelectorAll('.batch-item-row').length === 1);
  await frame.fill('.batch-item-block textarea', '第二組標題');
  await frame.click('.batch-item-row');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第一組標題');
  assert.equal(await frame.inputValue('.gen-tag'), '特報');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#2f6b4f'), 2), '展開後預覽');
  await frame.click('.batch-item-row');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第二組標題');
});

test('完成後可下載，檔名是 YYMMDDHHMM_編號.png', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '下載測試');
  await frame.waitForSelector('.batch-item-block button:has-text("下載")');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    frame.click('.batch-item-block .batch-item-head button:has-text("下載")'),
  ]);
  assert.match(dl.suggestedFilename(), /^\d{10}_1\.png$/);
  // 貼圖：加一個後該組變回未完成之外不應出錯
  await frame.waitForSelector('.fx-sticker-tile');
  assert.equal(await frame.locator('.fx-sticker-tile').count(), 7);
});

test('沒密碼：頁面沒有公司字樣與公司選項', async () => {
  const { page, frame, requested } = await openTool(browser, srv.url, 'pattern');
  await frame.waitForSelector('.batch-item-block');
  const text = await frame.evaluate(() => document.body.textContent);
  for (const w of ['TVBS', '粉框', '藍框', '緞帶']) assert.ok(!text.includes(w), `不應出現「${w}」`);
  assert.equal(await frame.isVisible('.batch-item-block [data-frame]'), false, '沒密碼不顯示框的切換');
  assert.ok(await frame.isVisible('.gen-tag'));
  assert.ok(Array.isArray(requested));
});

test('有密碼：要了公司素材，公司框選項出現，切換框不清空標題', async () => {
  const { page, frame, requested } = await openTool(browser, srv.url, 'pattern', { company: true });
  await frame.waitForSelector('.batch-item-block');
  await setupItem(page, frame, '公司版標題');
  assert.ok(requested.includes('pattern-ribbon-ent'), `requested = ${requested}`);
  assert.ok(requested.includes('pattern-ribbon-news'));
  assert.ok(requested.includes('pattern-logo-white'));
  const labels = await frame.locator('.batch-item-block [data-frame]').allTextContents();
  assert.deepEqual(labels, ['新聞（藍框）', '娛樂（粉框）', '通用框']);
  // 預設新聞：右上角緞帶（假圖洋紅）
  await waitPx(frame, 1000, 100, (p) => near(p, [255, 0, 255], 8), '右上角緞帶');
  assert.equal(await frame.isVisible('.gen-tag'), false);
  await frame.click('[data-frame="generic"]');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '切到通用框');
  assert.ok(await frame.isVisible('.gen-tag'));
  await frame.click('[data-frame="entertainment"]');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '公司版標題');
  await waitPx(frame, 1000, 100, (p) => near(p, [255, 0, 255], 8), '娛樂緞帶');
});
