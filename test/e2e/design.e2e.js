const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { openTool, fakeAsset } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, rawBrowser, browser;
test.before(async () => {
  srv = await serve(ROOT);
  rawBrowser = await launch();
  // 沙盒沒有網路：Google Fonts 一律回空樣式表，避免噪音
  browser = {
    newPage: async (o) => {
      const p = await rawBrowser.newPage(o);
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      return p;
    },
  };
});
test.after(async () => { await rawBrowser.close(); await srv.close(); });

async function open(opts = {}) {
  const t = await openTool(browser, srv.url, 'design', opts);
  const errors = [];
  t.page.on('pageerror', (e) => errors.push(e.message));
  t.page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  t.errors = errors;
  await t.frame.waitForFunction(() => document.documentElement.dataset.designReady === '1' && window.QPTDesign.ui && QPTDesign.ui.state.zoom > 0);
  await t.frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return t;
}
const curPage = (f) => f.evaluate(() => { const s = QPTDesign.ui.state; return JSON.parse(JSON.stringify(s.doc.pages.find((p) => p.id === s.pageId))); });
async function add(f, what) {
  const before = (await curPage(f)).objects.length;
  await f.click(`#designApp [data-add="${what}"]`);
  await f.waitForFunction((n) => { const s = QPTDesign.ui.state; return s.doc.pages.find((p) => p.id === s.pageId).objects.length > n; }, before);
}
// 用 canvas 產生測試圖
const testPng = (f) => f.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 120;
  const x = c.getContext('2d'); x.fillStyle = '#e33'; x.fillRect(0, 0, 200, 120);
  const b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});

test('沒密碼：能開啟、加文字／貼圖／形狀並匯出 PNG，沒有錯誤', async () => {
  const { page, frame, errors } = await open();
  await add(frame, 'text');
  await add(frame, 'shape:rect');
  await add(frame, 'sticker:smile');
  assert.equal((await curPage(frame)).objects.length, 3);
  const [dl] = await Promise.all([page.waitForEvent('download'), (async () => {
    await frame.click('#dzExportBtn');
    await frame.waitForSelector('#dzExportDlg:not([hidden])');
    await frame.click('#dzExpGo');
  })()]);
  const buf = fs.readFileSync(await dl.path());
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual(errors, []);
});

test('沒密碼：加入圖片檔（setInputFiles）後畫布有圖', async () => {
  const { frame, errors } = await open();
  const bytes = await testPng(frame);
  await frame.setInputFiles('#dzImgFile', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await frame.waitForFunction(() => QPTDesign.ui.state.doc.pages[0].objects.some((o) => o.type === 'image'));
  assert.deepEqual(errors, []);
});

test('沒密碼：通用貼紙生效、沒有 TVBS 字樣與 WHZ-Heavy', async () => {
  const { frame, requested } = await open();
  const src = await frame.getAttribute('#designApp [data-add="sticker:smile"] img', 'src');
  assert.match(src, /assets-public\/stickers\/smile\.png$/);
  assert.ok(await frame.evaluate(() => [...document.querySelectorAll('.dz-sticker img')].every((i) => i.complete && i.naturalWidth > 0)));
  await add(frame, 'text');
  const opts = await frame.locator('#dzFont option').evaluateAll((o) => o.map((x) => x.value));
  assert.ok(!opts.includes('WHZ-Heavy'));
  assert.ok(opts.includes('noto-sans-tc-900'));
  assert.equal(await frame.inputValue('#dzFont'), 'noto-sans-tc-900');
  const text = await frame.evaluate(() => document.body.innerText + document.documentElement.outerHTML);
  assert.ok(!/tvbs|WHZ/i.test(text.replace(/<script[\s\S]*?<\/script>/g, '')), '不應出現 TVBS／WHZ 字樣');
  assert.ok(!requested.some((k) => /^(tbao|font-whz)/.test(k)));
});

test('沒密碼：舊專案檔裡的 WHZ-Heavy 會退回預設字型（選單不留空白）', async () => {
  const { frame, errors } = await open();
  await add(frame, 'text');
  await frame.evaluate(() => {
    const s = QPTDesign.ui.state; const id = s.selection[0];
    QPTDesign.core.findObject(s.doc, id).obj.font = 'WHZ-Heavy';
    QPTDesign.ui.select([]); QPTDesign.ui.select([id]);
  });
  assert.equal(await frame.inputValue('#dzFont'), 'noto-sans-tc-900');
  assert.deepEqual(errors, []);
});

test('切換「屬性／圖層」只改 hidden，內容與選取不消失', async () => {
  const { frame } = await open();
  await add(frame, 'text');
  await frame.fill('#dzTextContent', '颱風假');
  const bodyHandle = await frame.$('#dzPanelBody');
  await frame.click('#dzTabLayers');
  assert.equal(await frame.isVisible('#dzPanelBody'), false);
  assert.equal(await frame.isVisible('#dzLayers'), true);
  await frame.click('#dzTabProps');
  assert.equal(await frame.isVisible('#dzPanelBody'), true);
  assert.equal(await frame.inputValue('#dzTextContent'), '颱風假');
  assert.equal(await frame.evaluate((el) => el.isConnected, bodyHandle), true);
  const o = (await curPage(frame)).objects[0];
  assert.equal(o.text, '颱風假');
});

test('切換頁面再切回來，物件還在；切換匯出範圍不重設其他設定', async () => {
  const { frame } = await open();
  await add(frame, 'shape:ellipse');
  await frame.click('#dzPageAdd');
  await frame.waitForFunction(() => QPTDesign.ui.state.doc.pages.length === 2);
  assert.equal((await curPage(frame)).objects.length, 0);
  await frame.evaluate(() => { const s = QPTDesign.ui.state; document.querySelectorAll('#dzPages > *')[0].click(); });
  await frame.waitForFunction(() => QPTDesign.ui.state.doc.pages[0].id === QPTDesign.ui.state.pageId);
  assert.equal((await curPage(frame)).objects.length, 1);
  await frame.click('#dzExportBtn');
  await frame.waitForSelector('#dzExportDlg:not([hidden])');
  await frame.click('#dzExpFmt button[data-v="jpg"]');
  await frame.click('#dzExpRange button[data-v="all"]');
  await frame.click('#dzExpRange button[data-v="cur"]');
  assert.equal(await frame.getAttribute('#dzExpFmt button[data-v="jpg"]', 'class'), 'active');
});

test('沒用 localStorage 存設計內容', async () => {
  const { page, frame } = await open();
  await add(frame, 'text');
  await frame.click('#dzTabLayers');
  const keys = await frame.evaluate(() => Object.keys(localStorage));
  assert.deepEqual(keys.filter((k) => /design/i.test(k)), []);
  void page;
});

test('有密碼：要求公司貼圖與字型、WHZ-Heavy 出現在選單並成為預設', async () => {
  const { frame, requested, errors } = await open({ company: true, assets: { 'font-whz-heavy': fakeAsset() } });
  assert.ok(requested.includes('font-whz-heavy'), requested.join());
  for (const s of ['smile', 'shock', 'cry', 'angry', 'kiss', 'laugh', 'meh']) assert.ok(requested.includes('tbao-' + s), s);
  const src = await frame.getAttribute('#designApp [data-add="sticker:smile"] img', 'src');
  assert.match(src, /^blob:/);
  await add(frame, 'text');
  const opts = await frame.locator('#dzFont option').evaluateAll((o) => o.map((x) => x.value));
  assert.ok(opts.includes('WHZ-Heavy'));
  assert.equal(await frame.inputValue('#dzFont'), 'WHZ-Heavy');
  assert.equal((await curPage(frame)).objects[0].font, 'WHZ-Heavy');
  // 假字型檔不是真的字型，載入失敗只會退回備用字型，不應丟錯
  assert.deepEqual(errors.filter((e) => !/font|Failed to load/i.test(e)), []);
});
