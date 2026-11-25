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

async function openPlain(opts) {
  const errors = [];
  const t = await openTool(browser, srv.url, 'collage', opts);
  t.page.on('pageerror', (e) => errors.push(String(e)));
  t.page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await t.frame.waitForSelector('#cgDrop');
  return { ...t, errors };
}
const filled = (frame) => frame.evaluate(() => window.Collage.cards().filter((c) => c.img).length);

test('沒密碼：兩張照片放進等分格子並下載 JPG', async () => {
  const { page, frame, errors } = await openPlain();
  await frame.setInputFiles('#cgDrop + input', [pic('a.png', await makePng(page, 400, 300, '#c33')), pic('b.png', await makePng(page, 300, 500, '#3a3'))]);
  await frame.waitForFunction(() => window.Collage.cards().filter((c) => c.img).length === 2);
  assert.equal(await frame.isDisabled('#cgDownloadBtn'), false);
  const [dl] = await Promise.all([page.waitForEvent('download'), frame.click('#cgDownloadBtn')]);
  // 沙盒的 Chromium 對中文檔名會回報成 download，檔名編碼以 CI 為準
  assert.match(dl.suggestedFilename(), /^(\d{8}拼圖\.jpg|download)$/);
  assert.deepEqual(errors, []);
});

test('工具內切換（等分／自由框、調整框／調整照片）不清空照片', async () => {
  const { page, frame } = await openPlain();
  await frame.setInputFiles('#cgDrop + input', [pic('a.png', await makePng(page, 400, 300, '#c33')), pic('b.png', await makePng(page, 300, 500, '#3a3'))]);
  await frame.waitForFunction(() => window.Collage.cards().filter((c) => c.img).length === 2);
  await frame.click('#cgLayout button[data-layout="free"]');
  await frame.waitForSelector('#cgFreeCtrl', { state: 'visible' });
  assert.equal(await frame.isVisible('#cgGridCtrl'), false);
  assert.equal(await filled(frame), 2);
  await frame.click('#cgEdit button[data-edit="photo"]');
  await frame.click('#cgEdit button[data-edit="frame"]');
  await frame.click('#cgLayout button[data-layout="grid"]');
  await frame.waitForSelector('#cgGridCtrl', { state: 'visible' });
  assert.equal(await filled(frame), 2);
  // 改等分數也保留已放的照片
  await frame.click('#cgRows button[data-n="2"]');
  assert.equal(await filled(frame), 2);
  // 「全部清除」才會清空
  await frame.click('#cgResetBtn'); await frame.click('#confirmOkBtn');
  assert.equal(await filled(frame), 0);
});

test('沒密碼與有密碼：畫面都沒有 TVBS 字樣，也不會要公司素材', async () => {
  for (const company of [false, true]) {
    const { frame, requested } = await openPlain({ company });
    assert.doesNotMatch(await frame.evaluate(() => document.body.innerText), /TVBS/i);
    assert.deepEqual(requested, []);
  }
});

test('等分的「不切／2／3／4」：按下後白色選中塊移到那一格（按鈕是程式後加的也要跟著動）', async () => {
  const { frame, errors } = await openPlain();
  const thumbAt = (sel, n) => frame.evaluate(([sel, n]) => {
    const c = document.querySelector(sel), th = c.querySelector('.seg-thumb'), b = c.querySelector(`button[data-n="${n}"]`);
    const m = /translate3d\(([-\d.]+)px/.exec(th.style.transform || '');
    return { x: m ? Number(m[1]) : null, want: b.offsetLeft, active: b.classList.contains('active') };
  }, [sel, n]);
  await frame.click('#cgCols button[data-n="4"]');
  await frame.waitForFunction(() => { const th = document.querySelector('#cgCols .seg-thumb'), b = document.querySelector('#cgCols button[data-n="4"]'); return th.style.transform.includes(`${b.offsetLeft}px`); });
  const a = await thumbAt('#cgCols', 4); assert.equal(a.active, true); assert.equal(a.x, a.want);
  await frame.click('#cgRows button[data-n="3"]');
  await frame.waitForFunction(() => { const th = document.querySelector('#cgRows .seg-thumb'), b = document.querySelector('#cgRows button[data-n="3"]'); return th.style.transform.includes(`${b.offsetLeft}px`); });
  assert.deepEqual(errors, []);
});
