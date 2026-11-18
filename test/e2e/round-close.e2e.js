// 圓形關閉 ×：全站一律正圓（寬＝高）；貼圖的刪除 × 是紅色。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { openTool } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, rawBrowser, browser;
test.before(async () => {
  srv = await serve(ROOT);
  rawBrowser = await launch();
  browser = {
    newPage: async (o) => {
      const p = await rawBrowser.newPage(o);
      await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      return p;
    },
  };
});
test.after(async () => { await rawBrowser?.close(); await srv?.close(); });

const RED = 'rgb(217, 45, 32)';
const photo = (page) => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#89a'; x.fillRect(0, 0, 600, 400); return c.toDataURL('image/png').split(',')[1]; }).then((b) => Buffer.from(b, 'base64'));

// 畫面上所有圓角 50% 的關閉／移除鈕：寬高相同
async function roundOnes(frame) {
  return frame.evaluate(() => [...document.querySelectorAll('button')].filter((b) => {
    const t = (b.textContent || '').trim(), l = b.getAttribute('aria-label') || '';
    if (!/^[×✕✖]$/.test(t) && !/關閉|移除|刪除/.test(l) && !b.classList.contains('fx-del')) return false;
    return b.getBoundingClientRect().width > 0 && getComputedStyle(b).borderRadius === '50%';
  }).map((b) => { const r = b.getBoundingClientRect(); return { name: b.className || b.id, w: r.width, h: r.height, bg: getComputedStyle(b).backgroundColor }; }));
}
const assertRound = (list, where) => { for (const x of list) assert.ok(Math.abs(x.w - x.h) < 0.5, `${where} ${x.name} 不是正圓：${x.w}×${x.h}`); };

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`圖片套版 ${vp.width}px：貼圖 × 紅色正圓，其他圓形 × 也是正圓`, async () => {
    const { page, frame } = await openTool(browser, srv.url, 'pattern', { viewport: vp });
    await frame.waitForSelector('.batch-item-block .dropzone input[type=file]', { state: 'attached' });
    await frame.setInputFiles('.batch-item-block .dropzone input[type=file]', { name: 'a.png', mimeType: 'image/png', buffer: await photo(page) });
    if (vp.width < 800) await frame.click('#tabPreview');
    await frame.click('#fxBtn');
    await frame.click('.fx-sticker-tile >> nth=0');
    await page.keyboard.press('Escape');
    await frame.click('.fx-item');
    const list = await roundOnes(frame);
    const del = list.find((x) => /fx-del/.test(x.name));
    assert.ok(del, '貼圖 × 有出現');
    assert.equal(del.bg, RED);
    // 缺項提醒的 ×
    await frame.click('#thumbAddBtn');
    await frame.click('#dlBtn');
    await frame.waitForSelector('.toast-close');
    assertRound(await roundOnes(frame), 'pattern');
    await page.close();
  });

  test(`LINE 推播 ${vp.width}px：說明視窗 × 正圓；預覽上的貼圖 × 紅色`, async () => {
    const { page, frame } = await openTool(browser, srv.url, 'linepush', { viewport: vp });
    await frame.waitForSelector('#canvas');
    await frame.click('#helpDetailBtn');
    await frame.waitForSelector('#helpCloseBtn', { state: 'visible' });
    assertRound(await roundOnes(frame), 'linepush');
    await frame.click('#helpCloseBtn');
    if (vp.width < 800) return page.close();
    const cb = await frame.locator('#canvas').boundingBox();
    await frame.click('#canvas', { position: { x: cb.width * 0.17, y: cb.height * 0.55 } });
    await frame.click('.sticker-btn >> nth=0');
    await frame.waitForFunction(() => {
      const c = document.getElementById('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 217) < 3 && Math.abs(d[i + 1] - 45) < 3 && Math.abs(d[i + 2] - 32) < 3) return true;
      return false;
    }, null, { timeout: 5000 });
    await page.close();
  });
}
