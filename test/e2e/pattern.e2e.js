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

// ---- 快速填入（貼文章網址）----
const { fakeAsset, API_BASE } = require('../helpers/tool-page.js');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const ART_TITLE = '台北捷運驚傳亂象乘客嚇壞，市府緊急回應「全面檢討」改善措施';

// 假後端：/fetch/article 回類似 TVBS 的 HTML；網域不在 news.tvbs.com.tw 就回白名單錯誤；圖片回洋橙色小 png
async function fakeBackend(page, calls = []) {
  await page.route(API_BASE + '/fetch/**', async (r) => {
    const u = new URL(r.request().url());
    calls.push(u.pathname);
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (u.pathname === '/fetch/article') {
      const target = u.searchParams.get('url') || '';
      if (!/^https:\/\/news\.tvbs\.com\.tw\//.test(target)) {
        return r.fulfill({ status: 400, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, code: 'bad_request', error: '只能讀取白名單內的 https 網址。' }) });
      }
      const html = `<html><head><meta property="og:image" content="https://img.example/a.jpg"></head><body>
        <h1>${ART_TITLE}</h1><div class="tags"><a href="/tag/a">#捷運</a><a href="/tag/b">#台北</a></div></body></html>`;
      return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, data: { url: target, html } }) });
    }
    if (u.pathname === '/fetch/image') return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset([60, 160, 220]) });
    return r.fulfill({ status: 404, headers: CORS, body: '' });
  });
}

test('快速填入：貼網址 → 標題斷行、主圖載入、通用框保留', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  const errors = watchErrors(page);
  const calls = [];
  await fakeBackend(page, calls);
  await frame.waitForSelector('.batch-item-block');
  const { autoLines } = await import(path.join(ROOT, 'sdk', 'news-rules.js'));
  await frame.click('#qfUrl');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/local/123456');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  const v = await frame.inputValue('.batch-item-block textarea');
  assert.equal(v, autoLines(ART_TITLE).join('\n'));
  assert.ok(v.split('\n').length >= 1);
  assert.match(await frame.textContent('#qfHint'), /主圖/);
  assert.ok(calls.includes('/fetch/image'));
  // 主圖已載入：照片區變成藍色（60,160,220）→ 上半部像素
  await waitPx(frame, 700, 300, (p) => near(p, [60, 160, 220], 12), '主圖載入');
  assert.equal(await frame.isVisible('.gen-tag'), true, '沒密碼維持通用框');
  assert.deepEqual(errors, []);
});

test('快速填入：已有內容要確認；取消不動內容；確認才覆蓋', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await fakeBackend(page);
  await setupItem(page, frame, '我自己打的標題');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/local/1');
  await frame.click('#qfBtn');
  await frame.waitForSelector('#confirmOverlay.open');
  await frame.click('#confirmCancelBtn');
  await frame.waitForFunction(() => /已取消/.test(document.getElementById('qfHint').textContent));
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '我自己打的標題');
  await frame.click('#qfBtn');
  await frame.waitForSelector('#confirmOverlay.open');
  await frame.click('#confirmOkBtn');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  assert.notEqual(await frame.inputValue('.batch-item-block textarea'), '我自己打的標題');
});

test('快速填入：網址不在白名單 → 顯示原因、原內容保留', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await fakeBackend(page);
  await setupItem(page, frame, '原本的標題');
  await frame.fill('#qfUrl', 'https://evil.example.com/news/1');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /帶入失敗/.test(document.getElementById('qfHint').textContent));
  assert.match(await frame.textContent('#qfHint'), /白名單/);
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '原本的標題');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '預覽仍在');
});

test('快速填入：有密碼時娛樂網址選粉框、新聞網址選藍框', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', { company: true });
  await fakeBackend(page);
  await frame.waitForSelector('.batch-item-block');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/entertainment/2999999');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  assert.equal(await frame.getAttribute('.batch-item-block [data-frame="entertainment"]', 'class').then((c) => /active/.test(c)), true);
  // 新增一組、直接貼新聞網址（新組是空的，不需確認）
  await frame.click('#addBatchItemBtn');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/local/1');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent) && document.querySelector('.batch-item-block [data-frame="news"].active'), null, { timeout: 8000 });
});

test('標題最多 4 行：第 5 行起顯示提示；4 行時最後一行對齊 3 行的底線往上長', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', { company: true });
  await frame.waitForSelector('.batch-item-block');
  await setupItem(page, frame, '一\n二\n三\n四');
  assert.equal(await frame.isVisible('.title-lines-warn'), false);
  assert.ok((await frame.locator('.batch-item-block label').allTextContents()).some((t) => /最多 4 行/.test(t)));
  await frame.fill('.batch-item-block textarea', '一\n二\n三\n四\n五');
  assert.equal(await frame.isVisible('.title-lines-warn'), true);
  assert.match(await frame.textContent('.title-lines-warn'), /最多 4 行/);
  // 幾何：3 行的最後一行在 880+lh；4 行的最後一行也要在同一個位置
  const r = await frame.evaluate(() => {
    const lh = 93, last = (n) => anchorY(BOX_CENTER, n, lh) + (n - 1) * lh / 2;
    return { three: last(3), four: last(4), one: anchorY(BOX_CENTER, 1, lh) };
  });
  assert.equal(r.four, r.three);
  assert.equal(r.one, 880, '1～3 行仍以 880 置中');
});
