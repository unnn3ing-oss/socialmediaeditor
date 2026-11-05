const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function open() {
  const page = await browser.newPage();
  await page.goto(srv.url + 'tools/sample/index.html');
  await page.waitForSelector('#mode-switch');
  return page;
}

test('internal switch keeps content', async () => {
  const page = await open();
  await page.fill('#text-1', '颱風假');
  await page.click('#mode-switch');
  assert.equal(await page.isVisible('#text-1'), false);
  await page.fill('#text-2', '停班停課');
  await page.click('#mode-switch');
  assert.equal(await page.inputValue('#text-1'), '颱風假');
  await page.click('#mode-switch');
  assert.equal(await page.inputValue('#text-2'), '停班停課');
});

test('clear empties all modes', async () => {
  const page = await open();
  await page.fill('#text-1', 'a');
  await page.click('#mode-switch');
  await page.fill('#text-2', 'b');
  await page.click('#clear');
  assert.equal(await page.inputValue('#text-2'), '');
  await page.click('#mode-switch');
  assert.equal(await page.inputValue('#text-1'), '');
});

test('reload clears', async () => {
  const page = await open();
  await page.fill('#text-1', 'x');
  await page.reload();
  await page.waitForSelector('#mode-switch');
  assert.equal(await page.inputValue('#text-1'), '');
});
