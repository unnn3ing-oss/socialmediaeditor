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

async function makePng(page, w, h, color) {
  const b64 = await page.evaluate(([w, h, color]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h, color]);
  return Buffer.from(b64, 'base64');
}
const pic = (name, buffer) => ({ name, mimeType: 'image/png', buffer });

async function openWm(opts) {
  const errors = [];
  const t = await openTool(browser, srv.url, 'watermark', opts);
  t.page.on('pageerror', (e) => errors.push(String(e)));
  t.page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await t.frame.waitForSelector('#wmLogoField', { state: 'visible' });
  return { ...t, errors };
}
const photos = (frame) => frame.evaluate(() => window.Watermark.state.photos.length);

test('沒密碼：只有「上傳自己的 Logo」，沒有 TVBS 字樣或公司選項', async () => {
  const { frame, requested } = await openWm();
  assert.equal(await frame.isVisible('#wmLogoToggle'), false);
  assert.equal(await frame.isVisible('#wmLogoDrop'), true);
  assert.doesNotMatch(await frame.evaluate(() => document.body.innerText), /TVBS|新版 NEWS|舊版|新聞網/i);
  assert.deepEqual(requested, []);
});

test('沒密碼：上傳自訂 Logo 與照片後能產出圖（單張與全部下載）', async () => {
  const { page, frame, errors } = await openWm();
  await frame.setInputFiles('#wmPhotoDrop + input', [pic('a.png', await makePng(page, 400, 300, '#336')), pic('b.png', await makePng(page, 300, 500, '#363'))]);
  await frame.waitForFunction(() => window.Watermark.state.photos.length === 2);
  assert.equal(await frame.isDisabled('#wmDownloadBtn'), true);          // 還沒有 Logo
  await frame.setInputFiles('#wmLogoDrop + input', pic('logo.png', await makePng(page, 120, 40, '#fff')));
  await frame.waitForFunction(() => !!window.Watermark.state.custom);
  await frame.waitForFunction(() => !document.getElementById('wmDownloadBtn').disabled);
  const [dl] = await Promise.all([page.waitForEvent('download'), frame.click('#wmDownloadBtn')]);
  assert.match(dl.suggestedFilename(), /\.png$|^download$/);
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), frame.click('#wmDownloadAllBtn')]);
  assert.match(dl2.suggestedFilename(), /^\d{10}_1\.png$/);
  assert.deepEqual(errors, []);
});

test('沒密碼：輸出格式、位置切換不清空照片與 Logo', async () => {
  const { page, frame } = await openWm();
  await frame.setInputFiles('#wmPhotoDrop + input', pic('a.png', await makePng(page, 400, 300, '#336')));
  await frame.setInputFiles('#wmLogoDrop + input', pic('logo.png', await makePng(page, 120, 40, '#fff')));
  await frame.waitForFunction(() => window.Watermark.state.photos.length === 1 && !!window.Watermark.state.custom);
  await frame.click('#wmFormat button[data-fmt="jpeg"]');
  await frame.click('#wmGrid button[data-px="0"][data-py="1"]');
  await frame.click('#wmAutoBtn');
  await frame.click('#wmFormat button[data-fmt="auto"]');
  assert.equal(await photos(frame), 1);
  assert.equal(await frame.evaluate(() => !!window.Watermark.state.custom), true);
  await frame.click('#wmResetBtn'); await frame.click('#confirmOkBtn');
  assert.equal(await photos(frame), 0);
});

test('有密碼：會取公司 Logo（含 tvbs-news-logo），出現新版／舊版選項，切換不清空', async () => {
  const { page, frame, requested, errors } = await openWm({ company: true });
  assert.ok(requested.includes('tvbs-news-logo'), `requested: ${requested}`);
  assert.ok(requested.includes('tvbs-old-logo'));
  assert.equal(await frame.isVisible('#wmLogoToggle'), true);
  assert.equal(await frame.isVisible('#wmLogoDrop'), false);
  await frame.setInputFiles('#wmPhotoDrop + input', pic('a.png', await makePng(page, 400, 300, '#336')));
  await frame.waitForFunction(() => window.Watermark.state.photos.length === 1 && !!window.Watermark.state.logoNew);
  await frame.waitForFunction(() => !document.getElementById('wmDownloadBtn').disabled);
  // 自己上傳也還在
  await frame.click('#wmLogoToggle button[data-logo="custom"]');
  assert.equal(await frame.isVisible('#wmLogoDrop'), true);
  await frame.setInputFiles('#wmLogoDrop + input', pic('logo.png', await makePng(page, 120, 40, '#fff')));
  await frame.waitForFunction(() => !!window.Watermark.state.custom);
  await frame.click('#wmLogoToggle button[data-logo="old"]');
  assert.equal(await frame.evaluate(() => window.Watermark.state.logoMode), 'old');
  await frame.click('#wmLogoToggle button[data-logo="new"]');
  await frame.click('#wmLogoToggle button[data-logo="custom"]');
  assert.equal(await photos(frame), 1);
  assert.equal(await frame.evaluate(() => !!window.Watermark.state.custom && !!window.Watermark.state.logoOld), true);
  assert.deepEqual(errors, []);
});
