// 管理員登入（網站管理密碼，adm:1）：貼圖列同時有公司版 7 張＋通用版 7 張；一般公司帳號仍只有 7 張。
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

// 回傳某個選擇器下的貼圖：數量與通用版（public 網址）數量
async function count(frame, rowSel, imgSel) {
  await frame.waitForSelector(rowSel + ' ' + imgSel, { state: 'attached' });
  return frame.evaluate(([r, i]) => {
    const row = document.querySelector(r);
    const imgs = [...row.querySelectorAll(i)];
    return { total: imgs.length, pub: imgs.filter((im) => /assets-public\/stickers\//.test(im.src)).length };
  }, [rowSel, imgSel]);
}

const CASES = [
  { id: 'pattern', row: '.fx-row', img: '.fx-sticker-tile img' },
  { id: 'linepush', row: '#stickerPalette', img: '.sticker-btn img' },
  { id: 'design', row: 'body', img: '.dz-tool.dz-sticker img' },
];

for (const c of CASES) {
  test(`${c.id}：管理員 14 張（含通用 7 張），一般公司帳號 7 張`, async () => {
    const a = await openTool(browser, srv.url, c.id, { company: true, admin: true });
    assert.deepEqual(await count(a.frame, c.row, c.img), { total: 14, pub: 7 });
    await a.page.close();
    const b = await openTool(browser, srv.url, c.id, { company: true });
    assert.deepEqual(await count(b.frame, c.row, c.img), { total: 7, pub: 0 });
    await b.page.close();
  });
}
