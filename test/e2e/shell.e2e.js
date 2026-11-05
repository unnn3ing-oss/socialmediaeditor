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

async function drag(page, id, side) {
  const dt = await page.evaluateHandle((i) => { const d = new DataTransfer(); d.setData('text/plain', i); return d; }, id);
  await page.dispatchEvent(`#toolbar button[data-tool=${id}]`, 'dragstart', { dataTransfer: dt });
  await page.dispatchEvent(`.dz[data-side=${side}]`, 'dragover', { dataTransfer: dt });
  await page.dispatchEvent(`.dz[data-side=${side}]`, 'drop', { dataTransfer: dt });
}
const ids = (page) => page.$$eval('#work .pane[data-side]', (els) => els.sort((a, b) => a.dataset.side.localeCompare(b.dataset.side)).map((e) => e.dataset.tool));

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
  assert.equal(await page.locator('#work .pane[data-side=left]').count(), 1);
  assert.equal(await page.getAttribute('#toolbar button[data-tool=alpha]', 'aria-pressed'), 'true');
});

test('drag to right splits', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  await drag(page, 'beta', 'right');
  assert.equal(await page.locator('#work .pane[data-side]').count(), 2);
  assert.equal(await page.getAttribute('#work .pane[data-side=left]', 'data-tool'), 'alpha');
  assert.equal(await page.getAttribute('#work .pane[data-side=right]', 'data-tool'), 'beta');
  assert.equal(await page.isVisible('#dropzones'), false);
});

test('third tool replaces last-operated', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  await drag(page, 'beta', 'right');
  await page.frameLocator('.pane[data-tool=alpha] iframe').locator('#t').click();
  await page.waitForSelector('.pane[data-side=left].is-last');
  await page.click('#toolbar button[data-tool=gamma]');
  assert.equal(await page.getAttribute('#work .pane[data-side=left]', 'data-tool'), 'gamma');
  assert.equal(await page.getAttribute('#work .pane[data-side=right]', 'data-tool'), 'beta');
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

test('closed pane keeps content', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  await drag(page, 'beta', 'right');
  await page.frameLocator('.pane[data-tool=beta] iframe').locator('#t').fill('還在嗎');
  await page.click('#work .pane[data-tool=beta] .pane-close');
  assert.deepEqual(await ids(page), ['alpha']);
  await page.click('#toolbar button[data-tool=beta]');
  assert.deepEqual(await ids(page), ['beta']);
  assert.equal(await page.frameLocator('.pane[data-tool=beta] iframe').locator('#t').inputValue(), '還在嗎');
});

test('drop outside keeps layout', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  await drag(page, 'beta', 'right');
  const before = await ids(page);
  const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData('text/plain', 'gamma'); return d; });
  // 放在工具列上
  await page.dispatchEvent('#toolbar button[data-tool=gamma]', 'dragstart', { dataTransfer: dt });
  assert.equal(await page.isVisible('#dropzones'), true);
  await page.dispatchEvent('#toolbar', 'drop', { dataTransfer: dt });
  assert.deepEqual(await ids(page), before);
  assert.equal(await page.isVisible('#dropzones'), false);
  // 拖曳中按 Esc
  await page.dispatchEvent('#toolbar button[data-tool=gamma]', 'dragstart', { dataTransfer: dt });
  assert.equal(await page.isVisible('#dropzones'), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(await ids(page), before);
  assert.equal(await page.isVisible('#dropzones'), false);
  // dragend
  await page.dispatchEvent('#toolbar button[data-tool=gamma]', 'dragstart', { dataTransfer: dt });
  await page.dispatchEvent('#toolbar button[data-tool=gamma]', 'dragend', { dataTransfer: dt });
  assert.equal(await page.isVisible('#dropzones'), false);
  assert.deepEqual(await ids(page), before);
});

test('brand returns to showcase', async () => {
  const page = await open();
  await page.click('#showcase .card[data-tool=alpha]');
  await page.click('#brand');
  assert.equal(await page.isVisible('#showcase'), true);
  assert.equal(await page.isVisible('#work'), false);
});
