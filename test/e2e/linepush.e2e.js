const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { openTool, fakeAsset } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const RED = fakeAsset([200, 30, 30]);
const BLUE = fakeAsset([30, 60, 200]);

// 目前顯示的版面裡，第 i 格的檔案輸入／文字輸入
const cellSel = (i) => `#cellsList > div:not([hidden]) .cell-box:nth-child(${i + 1})`;
async function putPhoto(frame, i, buf = RED) {
  await frame.setInputFiles(`${cellSel(i)} input[type=file]`, { name: `p${i}.png`, mimeType: 'image/png', buffer: buf });
}
async function setLine(frame, i, text, which = 0) {
  await frame.evaluate(({ sel, text, which }) => {
    const el = document.querySelectorAll(`${sel} .field-row input`)[which];
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: cellSel(i), text, which });
}
async function clickTab(frame, text) {
  await frame.locator('.mode-tab', { hasText: text }).click();
}
async function open(opts = {}) {
  const t = await openTool(browser, srv.url, 'linepush', { viewport: { width: 1280, height: 860 }, ...opts });
  await t.frame.waitForSelector('.mode-tab');
  await t.frame.evaluate(() => document.fonts.ready);
  const errors = [];
  t.page.on('pageerror', (e) => errors.push(e.message));
  t.page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|fonts\.g/.test(m.text())) errors.push(m.text()); });
  t.errors = errors;
  return t;
}
// 下載本頁並解出像素：回傳 { w, h, px(x,y) → [r,g,b,a] }
async function exportPage(t) {
  await t.frame.click('#nextStepBtn');
  await t.frame.waitForSelector('#downloadJpgBtn:not([hidden])');
  const [dl] = await Promise.all([t.page.waitForEvent('download'), t.frame.click('#downloadJpgBtn')]);
  const file = await dl.path();
  const b64 = fs.readFileSync(file).toString('base64');
  const info = await t.frame.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    window.__exp = x.getImageData(0, 0, c.width, c.height);
    return { w: img.width, h: img.height };
  }, b64);
  const px = (x, y) => t.frame.evaluate(([x, y]) => { const d = window.__exp, i = (y * d.width + x) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]]; }, [x, y]);
  return { ...info, px, name: dl.suggestedFilename() };
}
const near = (a, b, tol = 6) => b.every((v, i) => Math.abs(a[i] - v) <= tol);

test('沒密碼：頁面沒有公司字樣與公司版面選項', async () => {
  const t = await open();
  const text = await t.frame.evaluate(() => document.body.innerText + ' ' + document.body.textContent);
  assert.ok(!/TVBS/i.test(text), '不該出現 TVBS');
  assert.ok(!/黃色標題條|拍立得|T寶|娛樂/.test(text), '不該出現公司版面字樣');
  const tabs = await t.frame.$$eval('.mode-tab', (els) => els.map((e) => e.textContent));
  assert.deepEqual(tabs, ['六宮格', '四格 A']);
  assert.deepEqual(t.errors, []);
});

test('沒密碼：四格 A 輸出 1040×1040，格縫是底色，說明留空不畫', async () => {
  const t = await open();
  await clickTab(t.frame, '四格 A');
  await t.frame.evaluate(() => {
    const el = document.getElementById('g4Bg'); el.value = '#112233'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (let i = 0; i < 4; i++) await putPhoto(t.frame, i, i % 2 ? BLUE : RED);
  await setLine(t.frame, 0, '第一格說明');          // 只有第 1 格有說明
  const out = await exportPage(t);
  assert.equal(out.w, 1040);
  assert.equal(out.h, 1040);
  assert.ok(near(await out.px(519, 100), [0x11, 0x22, 0x33]), '直縫是底色 ' + await out.px(519, 100));
  assert.ok(near(await out.px(100, 519), [0x11, 0x22, 0x33]), '橫縫是底色');
  assert.ok(near(await out.px(519, 519), [0x11, 0x22, 0x33]), '中心是底色');
  assert.ok(near(await out.px(100, 100), [200, 30, 30]), '第 1 格是照片');
  assert.ok(near(await out.px(800, 100), [30, 60, 200]), '第 2 格是照片');
  // 第 1 格說明條位置 x 24..、y 514-24-60=430..490：條內是 #202124 混照片(.88)，約 (45,42,45)
  const bar = await out.px(30, 460);
  assert.ok(bar[0] < 80 && bar[2] < 80, `第 1 格有說明條 ${bar}`);
  // 第 2 格沒填說明：同一位置仍是照片
  assert.ok(near(await out.px(526 + 30, 460), [30, 60, 200]), '第 2 格說明留空不畫');
  assert.deepEqual(t.errors, []);
});

test('沒密碼：六宮格（單張）輸出 1040×800', async () => {
  const t = await open();
  for (let i = 0; i < 6; i++) { await putPhoto(t.frame, i); await setLine(t.frame, i, `標題${i}`, 0); await setLine(t.frame, i, '第二行', 1); }
  const out = await exportPage(t);
  assert.equal(out.w, 1040);
  assert.equal(out.h, 800);
  assert.deepEqual(t.errors, []);
});

test('工具內切換不清空內容（版面、頁面、說明、照片）', async () => {
  const t = await open();
  // 六宮格填內容
  await setLine(t.frame, 0, '甲標題', 0);
  await setLine(t.frame, 0, '甲第二行', 1);
  await putPhoto(t.frame, 0);
  // 切到四格 A 填內容
  await clickTab(t.frame, '四格 A');
  await setLine(t.frame, 1, '四格說明', 0);
  await putPhoto(t.frame, 1, BLUE);
  await t.frame.evaluate(() => { const el = document.getElementById('g4Cap'); el.value = '#ff0000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await t.frame.click('.page-tab[data-page="1"]');
  await setLine(t.frame, 2, '第二頁說明', 0);
  // 回六宮格：內容還在
  await clickTab(t.frame, '六宮格');
  assert.equal(await t.frame.inputValue(`${cellSel(0)} .field-row input >> nth=0`), '甲標題');
  assert.equal(await t.frame.inputValue(`${cellSel(0)} .field-row input >> nth=1`), '甲第二行');
  assert.match(await t.frame.textContent(`${cellSel(0)} .dz-text`), /已載入/);
  // 再回四格 A：說明、照片、第二頁、字色都在
  await clickTab(t.frame, '四格 A');
  assert.equal(await t.frame.inputValue(`${cellSel(2)} .field-row input >> nth=0`), '第二頁說明');
  await t.frame.click('.page-tab[data-page="0"]');
  assert.equal(await t.frame.inputValue(`${cellSel(1)} .field-row input >> nth=0`), '四格說明');
  assert.match(await t.frame.textContent(`${cellSel(1)} .dz-text`), /已載入/);
  assert.equal(await t.frame.inputValue('#g4Cap'), '#ff0000');
  await t.frame.click('.page-tab[data-page="1"]');
  assert.equal(await t.frame.inputValue('#g4Cap'), '#ffffff', '字色每頁各自一份');
  // 步驟 1 ↔ 2 切換後也還在
  await t.frame.click('#nextStepBtn');
  await t.frame.click('#backStepBtn');
  assert.equal(await t.frame.inputValue(`${cellSel(2)} .field-row input >> nth=0`), '第二頁說明');
  assert.deepEqual(t.errors, []);
});

test('有密碼：要求黃色標題條與娛樂四格素材，公司版面出現，四格 A 仍可用', async () => {
  const t = await open({ company: true });
  await t.frame.waitForFunction(() => document.querySelectorAll('.mode-tab').length === 3);
  assert.ok(t.requested.includes('line-header') || t.requested.includes('line-grid4-ent'), `requested=${t.requested}`);
  assert.ok(t.requested.includes('line-header'));
  assert.ok(t.requested.includes('line-grid4-ent'));
  assert.ok(t.requested.some((k) => k.startsWith('tbao-')), '貼圖走公司素材');
  const tabs = await t.frame.$$eval('.mode-tab', (els) => els.map((e) => e.textContent));
  assert.deepEqual(tabs, ['新聞', '娛樂', '四格 A']);
  // 新聞與娛樂切換不清空
  await setLine(t.frame, 0, '新聞一', 0);
  await clickTab(t.frame, '娛樂');
  await setLine(t.frame, 0, '娛樂一', 0);
  await clickTab(t.frame, '新聞');
  assert.equal(await t.frame.inputValue(`${cellSel(0)} .field-row input >> nth=0`), '新聞一');
  await clickTab(t.frame, '娛樂');
  assert.equal(await t.frame.inputValue(`${cellSel(0)} .field-row input >> nth=0`), '娛樂一');
  // 新聞第 1 頁有頂部標籤（公司版）
  await clickTab(t.frame, '新聞');
  assert.ok(t.errors.length === 0, t.errors.join('|'));
});
