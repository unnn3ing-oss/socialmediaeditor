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

// 從頂列下拉選工具：先點分類再點工具
async function pick(page, id) {
  const trigger = page.locator(`.nav-group:has(button[data-tool=${id}]) .nav-trigger`);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await page.click(`#toolbar button[data-tool=${id}]`);
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
  assert.equal(await page.getAttribute('#toolbar button[data-tool=alpha]', 'aria-current'), 'page');
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
  await pick(page, 'beta');
  assert.deepEqual(await ids(page), ['beta']);
  await pick(page, 'alpha');
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

test('桌面下拉：hover 150ms 才開、快速路過不開、離開 200ms 關、跨間隙不關', async () => {
  const page = await open();
  const trig = page.locator('.nav-trigger').first();
  const box = await trig.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(60);
  await page.mouse.move(600, 500); // 快速路過
  await page.waitForTimeout(250);
  assert.equal(await trig.getAttribute('aria-expanded'), 'false');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  assert.equal(await trig.getAttribute('aria-expanded'), 'false', '150ms 內不開');
  await page.waitForTimeout(150);
  assert.equal(await trig.getAttribute('aria-expanded'), 'true');
  // 往下跨過 8px 間隙到第一項，不會關
  const item = await page.locator('#toolbar button[data-tool=alpha]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 4, { steps: 3 });
  await page.mouse.move(item.x + 20, item.y + item.height / 2, { steps: 3 });
  await page.waitForTimeout(300);
  assert.equal(await trig.getAttribute('aria-expanded'), 'true');
  await page.mouse.move(900, 600);
  await page.waitForTimeout(100);
  assert.equal(await trig.getAttribute('aria-expanded'), 'true', '200ms 內不關');
  await page.waitForTimeout(200);
  assert.equal(await trig.getAttribute('aria-expanded'), 'false');
});

test('桌面下拉：點擊開關、同時只開一個、Esc 還焦點、ArrowDown 進第一項、點外面與 iframe 關閉', async () => {
  const page = await open();
  const [a, b] = [page.locator('.nav-trigger').nth(0), page.locator('.nav-trigger').nth(1)];
  await a.click();
  assert.equal(await a.getAttribute('aria-expanded'), 'true');
  assert.ok(await a.getAttribute('aria-controls'));
  await b.click();
  assert.equal(await a.getAttribute('aria-expanded'), 'false');
  assert.equal(await b.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await b.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('nav-trigger')), true);
  await a.focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tool), 'alpha');
  await page.keyboard.press('Enter');
  assert.deepEqual(await ids(page), ['alpha']);
  assert.equal(await a.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'IFRAME', '選完焦點進工具');
  await a.click();
  await page.mouse.click(700, 500); // 點進 iframe
  await page.waitForFunction(() => document.querySelector('.nav-trigger').getAttribute('aria-expanded') === 'false');
  await a.click();
  await page.click('#brand');
  assert.equal(await a.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getAttribute('.nav-home', 'aria-current'), 'page');
});

test('觸控裝置（寬度 >820）：點擊開分類，不靠 hover', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#showcase .card');
  await page.tap('.nav-trigger >> nth=0');
  assert.equal(await page.getAttribute('.nav-trigger >> nth=0', 'aria-expanded'), 'true');
  await page.tap('#toolbar button[data-tool=beta]');
  assert.deepEqual(await ids(page), ['beta']);
  await ctx.close();
});

test('手機「工具」面板：開、選工具、Esc、點外面關；狀態在面板裡；內容保留', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
  await page.goto(srv.url + 'index.html');
  await page.waitForSelector('#showcase .card');
  assert.equal(await page.isVisible('.nav-trigger'), false);
  await page.tap('#tools-btn');
  assert.equal(await page.getAttribute('#tools-btn', 'aria-expanded'), 'true');
  assert.equal(await page.locator('#tools-panel #status').count(), 1);
  assert.equal(await page.isVisible('#toolbar button[data-tool=gamma]'), true);
  await page.tap('#toolbar button[data-tool=alpha]');
  assert.equal(await page.getAttribute('#tools-btn', 'aria-expanded'), 'false');
  await page.frameLocator('.pane[data-tool=alpha] iframe').locator('#t').fill('手機');
  await page.tap('#tools-btn');
  await page.keyboard.press('Escape');
  assert.equal(await page.getAttribute('#tools-btn', 'aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tools-btn');
  await page.tap('#tools-btn');
  await page.tap('#tools-panel .nav-home');
  assert.equal(await page.isVisible('#showcase'), true);
  await page.tap('#showcase .card[data-tool=alpha]');
  assert.equal(await page.frameLocator('.pane[data-tool=alpha] iframe').locator('#t').inputValue(), '手機');
  // 轉成桌面寬度：狀態回頁首
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => document.getElementById('status').parentNode.id === 'top');
  await ctx.close();
});

test('首頁欄數：桌面 3、平板 2、手機 1（手機不放縮圖）；使用條件標籤', async () => {
  const cat = { tools: [...CATALOG.tools, tool('ytx', '下載', { group: '發文與素材', requires: ['extension', 'helper'], badges: ['管理員測試'] })] };
  for (const [w, cols, thumb] of [[1280, 3, true], [1024, 2, true], [390, 1, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    const page = await ctx.newPage();
    await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: cat }));
    await page.goto(srv.url + 'index.html');
    await page.waitForSelector('#showcase .card');
    const n = await page.$eval('#showcase .grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    assert.equal(n, cols, `${w}px 欄數`);
    assert.equal(await page.isVisible('#showcase .card[data-tool=alpha] .thumb'), thumb);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), w);
    assert.deepEqual(await page.$$eval('#showcase .card[data-tool=ytx] .badge', (e) => e.map((x) => x.textContent)), ['管理員測試', '需要外掛', '需要下載助手']);
    await ctx.close();
  }
});

test('手機寬度：頁面不被撐寬、56px 單列頁首、觸控目標 ≥ 44px', async () => {
  for (const w of [320, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 640 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.route('**/shell/catalog.json', (r) => r.fulfill({ json: CATALOG }));
    await page.goto(srv.url + 'index.html#alpha');
    await page.waitForSelector('#work .pane:not([hidden]) iframe');
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, top: document.getElementById('top').offsetHeight,
      bh: document.getElementById('tools-btn').getBoundingClientRect().height,
      lh: document.getElementById('company-btn').getBoundingClientRect().height,
      frameW: document.querySelector('.pane:not([hidden]) iframe').getBoundingClientRect().width,
    }));
    assert.equal(m.sw, w, '頁面沒有水平溢位');
    assert.equal(m.top, 56, `頂列高 ${m.top}`);
    assert.ok(m.bh >= 44 && m.lh >= 44, `按鈕高 ${m.bh}/${m.lh}`);
    assert.ok(Math.abs(m.frameW - w) < 1, '工具框等於螢幕寬');
    await page.tap('#tools-btn');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), w, '面板不撐寬');
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
