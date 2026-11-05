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

// 用畫布產生測試圖（不放任何真實素材）
async function makePng(page, w, h, color) {
  const b64 = await page.evaluate(([w, h, color]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.fillRect(0, 0, w / 4, h / 4);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h, color]);
  return Buffer.from(b64, 'base64');
}
const pic = (name, buffer) => ({ name, mimeType: 'image/png', buffer });

async function openPlain(opts) {
  const errors = [];
  const t = await openTool(browser, srv.url, 'resize', opts);
  t.page.on('pageerror', (e) => errors.push(String(e)));
  t.page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await t.frame.waitForSelector('#rsDrop');
  return { ...t, errors };
}

test('沒密碼：載入多張、預覽、下載單張與全部下載', async () => {
  const { page, frame, errors } = await openPlain();
  await frame.setInputFiles('#rsDrop + input', [
    pic('a.png', await makePng(page, 400, 300, '#c33')),
    pic('b.png', await makePng(page, 300, 500, '#3a3')),
  ]);
  await frame.waitForSelector('#rsCanvas:not([hidden])');
  assert.equal(await frame.locator('#rsThumbs > *').count(), 2);
  assert.equal(await frame.isVisible('#rsDownloadAllBtn'), true);
  await frame.fill('#rsW', '200'); await frame.fill('#rsH', '100');
  const [dl] = await Promise.all([page.waitForEvent('download'), frame.click('#rsDownloadBtn')]);
  assert.match(dl.suggestedFilename(), /^a_200x100\.png$/);
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), frame.click('#rsDownloadAllBtn')]);
  assert.match(dl2.suggestedFilename(), /^\d{10}_1\.png$/);
  assert.deepEqual(errors, []);
});

test('工具內切換（轉換方式、輸出格式）不清空照片與尺寸', async () => {
  const { page, frame } = await openPlain();
  await frame.setInputFiles('#rsDrop + input', [pic('a.png', await makePng(page, 400, 300, '#c33')), pic('b.png', await makePng(page, 300, 500, '#3a3'))]);
  await frame.waitForSelector('#rsCanvas:not([hidden])');
  await frame.fill('#rsW', '640'); await frame.fill('#rsH', '360');
  await frame.click('#rsMode button[data-mode="fit"]');
  await frame.click('#rsFormat button[data-fmt="jpeg"]');
  await frame.click('#rsMode button[data-mode="cover"]');
  await frame.click('#rsFormat button[data-fmt="auto"]');
  assert.equal(await frame.locator('#rsThumbs > *').count(), 2);
  assert.equal(await frame.inputValue('#rsW'), '640');
  assert.equal(await frame.inputValue('#rsH'), '360');
  assert.equal(await frame.evaluate(() => window.Resize.state.photos.length), 2);
  // 「全部清除」才會清空
  await frame.click('#rsResetBtn'); await frame.click('#confirmOkBtn');
  assert.equal(await frame.evaluate(() => window.Resize.state.photos.length), 0);
});

test('沒密碼與有密碼：畫面都沒有 TVBS 字樣，也不會要公司素材', async () => {
  for (const company of [false, true]) {
    const { frame, requested } = await openPlain({ company });
    const text = await frame.evaluate(() => document.body.innerText);
    assert.doesNotMatch(text, /TVBS/i);
    assert.deepEqual(requested, []);
  }
});
