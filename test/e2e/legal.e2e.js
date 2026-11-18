// 隱私權政策／資料刪除說明：公開可讀、中英都有、互相連結、首頁頁尾有入口、手機寬度不超出
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const EMAIL = 'jeanzhuang@tvbs.com.tw';
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function page(url, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const p = await ctx.newPage();
  await p.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await p.goto(srv.url + url);
  return p;
}

for (const [url, zh, en] of [['privacy/', '隱私權政策', 'Privacy Policy'], ['data-deletion/', '資料刪除說明', 'Data Deletion Instructions']]) {
  test(`${url}：中英標題、聯絡信箱、沒有 noindex、互連`, async () => {
    const p = await page(url);
    assert.equal(await p.locator('#zh h1').innerText(), zh);
    assert.equal(await p.locator('#en h1').innerText(), en);
    assert.ok((await p.locator(`a[href^="mailto:${EMAIL}"]`).count()) >= 2);
    assert.equal(await p.locator('meta[name=robots]').count(), 0);
    for (const href of ['../privacy/', '../data-deletion/']) {
      const res = await p.request.get(new URL(href, p.url()).href);
      assert.equal(res.status(), 200, href);
    }
    // 樣式有載入（tokens.css 的 --accent）
    const color = await p.locator('.legal a[href^=mailto]').first().evaluate((e) => getComputedStyle(e).color);
    assert.equal(color, 'rgb(21, 94, 239)');
    await p.context().close();
  });

  test(`${url}：320px 寬不超出`, async () => {
    const p = await page(url, 320);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(over, 0);
    await p.context().close();
  });
}

test('隱私權政策列出五個臉書權限', async () => {
  const p = await page('privacy/');
  const text = await p.locator('#zh').innerText();
  for (const perm of ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement', 'pages_read_user_content']) assert.ok(text.includes(perm), perm);
  await p.context().close();
});

test('首頁頁尾有兩個連結', async () => {
  const p = await page('index.html');
  await p.waitForSelector('#showcase .site-foot');
  const hrefs = await p.$$eval('#showcase .site-foot a', (as) => as.map((a) => a.getAttribute('href')));
  assert.deepEqual(hrefs, ['privacy/', 'data-deletion/']);
  await p.context().close();
});
