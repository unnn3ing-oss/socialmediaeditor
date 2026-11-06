const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');

test('tokens.css computed styles', async () => {
  const srv = await serve(ROOT);
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(srv.url + 'test/fixtures/tokens.html');
    const s = (sel) => page.$eval(sel, (el) => {
      const c = getComputedStyle(el);
      return {
        borderRadius: c.borderRadius, height: c.height, width: c.width, backgroundColor: c.backgroundColor,
        color: c.color, borderTopColor: c.borderTopColor, transform: c.transform,
        fvn: c.fontVariantNumeric, animationName: c.animationName,
      };
    });
    const p = await s('#p');
    assert.equal(p.borderRadius, '999px');
    assert.equal(p.height, '44px');
    assert.equal(p.backgroundColor, 'rgb(0, 74, 173)');
    assert.equal((await s('#s')).borderTopColor, 'rgba(0, 74, 173, 0.12)');
    assert.equal((await s('#sm')).height, '36px');
    const d = await s('#d');
    assert.equal(d.backgroundColor, 'rgb(238, 241, 246)');
    assert.equal(d.color, 'rgb(107, 114, 128)');
    const sw = await s('#sw');
    assert.equal(sw.width, '48px');
    assert.equal(sw.height, '28px');
    assert.match((await s('#num')).fvn, /tabular-nums/);
    assert.notEqual((await s('#sk')).animationName, 'none');

    // 按下：scale(.97)
    const box = await (await page.$('#p')).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);
    assert.equal((await s('#p')).transform, 'matrix(0.97, 0, 0, 0.97, 0, 0)');
    await page.mouse.up();

    // 鍵盤焦點
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const c = getComputedStyle(document.activeElement);
      return [c.outlineWidth, c.outlineStyle, c.outlineColor, c.outlineOffset];
    });
    assert.deepEqual(f, ['2px', 'solid', 'rgb(0, 74, 173)', '2px']);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal((await s('#sk')).animationName, 'none');
  } finally {
    await browser.close();
    await srv.close();
  }
});
