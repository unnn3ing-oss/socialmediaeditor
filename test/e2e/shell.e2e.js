const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const tool = (id, name, extra = {}) => ({
  id, name, group: '做圖', desc: `${name}說明`, tier: 'public', requires: [],
  icon: 'tools/sample/icon.svg', thumb: 'tools/sample/thumb.svg',
  entry: `test/fixtures/tools/${id}/index.html`, ...extra,
});
const CATALOG = { tools: [tool('alpha', '甲工具'), tool('beta', '乙工具'), tool('gamma', '丙工具', { group: '發文與素材' })] };

let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#showcase .card');
  return page;
}

const ids = (page) => page.$$eval('#work .pane:not([hidden])', (els) => els.map((e) => e.dataset.tool));

test('opens on showcase', async () => {
  const page = await open();
  assert.equal(await page.isVisible('#showcase'), true);
  assert.equal(await page.locator('#showcase .card').count(), 3);
  assert.equal(await page.locator('#toolbar button[data-tool]').count(), 3);
});

test('card opens single full page', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  assert.equal(await page.isVisible('#showcase'), false);
  assert.deepEqual(await ids(page), ['alpha']);
  assert.equal(await page.locator('#work .pane:not([hidden])').count(), 1);
  assert.equal(await page.getAttribute('#toolbar button[data-tool=alpha]', 'aria-pressed'), 'true');
});

test('並排已停用：工具列不能拖、沒有放置區，拖曳事件不改版面', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  assert.equal(await page.getAttribute('#toolbar button[data-tool=beta]', 'draggable'), null);
  assert.equal(await page.locator('#dropzones, .dz').count(), 0);
  const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData('text/plain', 'beta'); return d; });
  await page.dispatchEvent('#toolbar button[data-tool=beta]', 'dragstart', { dataTransfer: dt });
  await page.dispatchEvent('#work', 'drop', { dataTransfer: dt });
  assert.deepEqual(await ids(page), ['alpha']);
  assert.equal(await page.evaluate(() => document.getElementById('work').className), '');
});

test('沒有關閉鈕直條：工具內容滿版到右邊；回櫥窗用品牌', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: 820 });
    const r = await page.$eval('.pane[data-tool=alpha]', (pane) => {
      const p = pane.getBoundingClientRect(), f = pane.querySelector('iframe').getBoundingClientRect();
      return { close: pane.querySelectorAll('.pane-close, button').length, right: p.right - f.right, left: f.left - p.left, top: f.top - p.top, vw: document.documentElement.clientWidth, pr: p.right, title: pane.querySelector('iframe').title };
    });
    assert.equal(r.close, 0, '窗格裡沒有按鈕');
    assert.ok(Math.abs(r.right) < 1 && Math.abs(r.left) < 1 && Math.abs(r.top) < 1, `iframe 滿版 ${JSON.stringify(r)}`);
    assert.ok(Math.abs(r.pr - r.vw) < 1, '窗格到視窗右緣');
    assert.ok(r.title);
  }
  await page.click('#brand');
  assert.equal(await page.isVisible('#showcase'), true);
});

test('鎖定層覆蓋工具內容', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  await page.evaluate(() => window.tbxShell._internal.panes.setLocked('alpha', true));
  const state = await page.$eval('.pane[data-tool=alpha]', (pane) => {
    const p = pane.getBoundingClientRect(), lock = pane.querySelector('.pane-lock').getBoundingClientRect();
    return { top: lock.top - p.top, height: lock.height - p.height, width: lock.width - p.width };
  });
  assert.ok(Math.abs(state.top) < 1);
  assert.ok(Math.abs(state.height) < 1);
  assert.ok(Math.abs(state.width) < 1);
});

test('iframe kept alive', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  const input = page.frameLocator('.pane[data-tool=alpha] iframe').locator('#t');
  await input.fill('測試');
  const created = await page.getAttribute('.pane[data-tool=alpha] iframe', 'data-created');
  assert.ok(created);
  await page.click('#toolbar button[data-tool=beta]');
  assert.deepEqual(await ids(page), ['beta']);
  await page.click('#toolbar button[data-tool=alpha]');
  assert.equal(await page.frameLocator('.pane[data-tool=alpha] iframe').locator('#t').inputValue(), '測試');
  assert.equal(await page.getAttribute('.pane[data-tool=alpha] iframe', 'data-created'), created);
  assert.equal(await page.locator('iframe').count(), 2);
});

test('回櫥窗再開同一工具，內容還在', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=beta]');
  await page.frameLocator('.pane[data-tool=beta] iframe').locator('#t').fill('還在嗎');
  await page.click('#brand');
  await page.click('#showcase .card[data-tool=beta]');
  assert.equal(await page.frameLocator('.pane[data-tool=beta] iframe').locator('#t').inputValue(), '還在嗎');
});

test('brand returns to showcase', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  await page.click('#brand');
  assert.equal(await page.isVisible('#showcase'), true);
  assert.equal(await page.isVisible('#work'), false);
});

test('網址記住工具：重新整理留在原工具，上一頁回櫥窗；舊並排網址只開第一個', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=beta]');
  assert.equal(await page.evaluate(() => location.hash), '#beta');
  await page.reload();
  await page.waitForSelector('#work .pane:not([hidden])');
  assert.deepEqual(await ids(page), ['beta']);
  await page.goBack();
  await page.waitForSelector('#showcase:not([hidden])');
  assert.equal(await page.isVisible('#work'), false);
  await page.goForward();
  await page.waitForSelector('#work:not([hidden])');
  assert.deepEqual(await ids(page), ['beta']);
  await page.goto(srv.url + 'index.html#beta+alpha');
  await page.waitForSelector('#work:not([hidden])');
  assert.deepEqual(await ids(page), ['beta']);
  assert.equal(await page.evaluate(() => location.hash), '#beta');
  // 不存在的工具代號：留在櫥窗
  await page.goto(srv.url + 'index.html#nope');
  await page.reload();
  await page.waitForSelector('#showcase .card');
  assert.equal(await page.isVisible('#work'), false);
});

test('首頁不先載安裝教學；按了才載', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#status .pill-warn');
  assert.equal(urls.some((u) => /shell\/install/.test(u)), false);
  await page.click('#status .pill-warn');
  await page.waitForSelector('.ds:not([hidden])');
  assert.equal(urls.some((u) => /shell\/install\.js/.test(u)), true);
  assert.equal(urls.some((u) => /shell\/install\.css/.test(u)), true);
});

test('沒裝外掛：1 秒內就顯示「未安裝外掛」', async () => {
  const page = await open();
  const t0 = Date.now();
  await page.waitForSelector('#status .pill-warn', { timeout: 1500 });
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(await page.textContent('#status .pill-warn'), '未安裝外掛');
});

test('頂列放不下時只留圖示，目前工具保留文字，頂列維持一行', async () => {
  const many = { tools: Array.from({ length: 9 }, (_, i) => tool(['alpha', 'beta', 'gamma'][i] || `x${i}`, `第${i + 1}個工具名稱`)) };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: many }));
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#showcase .card');
  await page.waitForSelector('#toolbar.compact');
  await page.click('#toolbar button[data-tool=beta]');
  assert.equal(await page.isVisible('#toolbar button[data-tool=beta] .lbl'), true);
  assert.equal(await page.isVisible('#toolbar button[data-tool=alpha] .lbl'), false);
  assert.equal(await page.getAttribute('#toolbar button[data-tool=alpha]', 'title'), '第1個工具名稱');
  const h = await page.evaluate(() => document.getElementById('top').offsetHeight);
  assert.ok(h < 80, `頂列高度 ${h}`);
  // 夠寬就恢復文字
  await page.setViewportSize({ width: 1900, height: 720 });
  await page.waitForSelector('#toolbar:not(.compact)');
});

test('手機寬度：頁面不被撐寬、頂列不超過 2 列、按鈕縮小但 ≥ 24px', async () => {
  for (const w of [320, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 640 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
    await page.goto(srv.url + 'index.html#alpha');
    await page.waitForSelector('#work .pane:not([hidden]) iframe');
    const m = await page.evaluate(() => {
      const b = document.querySelector('#toolbar button').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, top: document.getElementById('top').offsetHeight, bh: b.height,
        frameW: document.querySelector('.pane:not([hidden]) iframe').getBoundingClientRect().width };
    });
    assert.equal(m.sw, w, '頁面沒有水平溢位');
    assert.ok(m.top <= 96, `頂列高 ${m.top}`);
    assert.ok(m.bh >= 24 && m.bh <= 36, `工具按鈕高 ${m.bh}`);
    assert.ok(Math.abs(m.frameW - w) < 1, '工具框等於螢幕寬');
    await ctx.close();
  }
});

test('跳至主要內容：Tab 第一個出現，按下把焦點移到工具且不改網址', async () => {
  const page = await open();
  await page.goto(srv.url + 'index.html#alpha');
  await page.waitForSelector('#work .pane:not([hidden]) iframe');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
  assert.equal(await page.isVisible('.skip'), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'IFRAME');
  assert.equal(await page.evaluate(() => location.hash), '#alpha');
});
