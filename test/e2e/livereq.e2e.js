const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { openTool } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(ROOT, 'test', 'fixtures', 'livereq');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

async function open() {
  const errors = [];
  const t = await openTool(browser, srv.url, 'livereq');
  t.page.on('pageerror', (e) => errors.push(String(e)));
  await t.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url.replace(/\/$/, '') });
  await t.frame.evaluate(() => localStorage.clear());
  return { ...t, errors };
}

async function paste(frame, text) {
  await frame.fill('#src', text);
  await frame.click('#run');
}

test('貼上 6 場：拆卡片、缺值班小編與粉專時不能複製', async () => {
  const { frame, page, errors } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  assert.equal(await frame.locator('.lr-card').count(), 6);
  assert.equal(await frame.textContent('#count'), '共 6 場');
  const first = frame.locator('.lr-card').first();
  assert.equal(await first.locator('[data-copy]').isDisabled(), true);
  assert.match(await first.locator('[data-msg]').textContent(), /FB 粉專、值班小編/);
  // 2100看世界：需求單已有新聞粉、國際粉 → 打勾鎖住，不算缺粉專
  const c5 = frame.locator('.lr-card').nth(4);
  const p5 = frame.locator('#pagesBar .lr-pages').nth(4);
  assert.equal(await p5.locator('input[value=新聞]').isChecked(), true);
  assert.equal(await p5.locator('input[value=新聞]').isDisabled(), true);
  assert.doesNotMatch(await c5.locator('[data-msg]').textContent(), /FB 粉專/);
  // 九點熱話題：更正版
  const c6 = frame.locator('.lr-card').nth(5);
  assert.equal(await c6.locator('.lr-title').textContent(), '九點熱話題 重1');
  await frame.click('.lr-dot >> nth=5');
  assert.equal(await c6.locator('[data-repeat]').isVisible(), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('填值班小編＋勾粉專 → 輸出更新、複製到剪貼簿；值班小編存到班別結束', async () => {
  const { frame, page, errors } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  await frame.fill('#dutyName', '王小明');
  await frame.fill('#dutyContact', '#85001');
  const first = frame.locator('.lr-card').first();
  await frame.locator('#pagesBar .lr-pages').first().locator('label.lr-box', { hasText: '國際' }).click();
  assert.equal(await first.locator('[data-copy]').isDisabled(), false);
  const out = await first.locator('[data-out]').inputValue();
  assert.match(out, /大白話\nFB:\n國際\n●畫面來源：玉娜4G\n●值班小編：\n王小明 #85001\n/);
  await first.locator('[data-copy]').click();
  await frame.waitForFunction(() => document.querySelector('.lr-card [data-msg]').textContent === '已複製完整需求單');
  assert.equal(await frame.evaluate(() => navigator.clipboard.readText()), out);
  const saved = await frame.evaluate(() => JSON.parse(localStorage.getItem('tbx.livereq.duty')));
  assert.equal(saved.name, '王小明');
  assert.ok(saved.exp > Date.now());
  assert.match(await frame.textContent('#dutyHint'), /本班保留到/);
  // 重新整理：需求單清掉、值班小編還在
  await page.reload();
  await frame.waitForSelector('#dutyName');
  assert.equal(await frame.inputValue('#dutyName'), '王小明');
  assert.equal(await frame.inputValue('#src'), '');
  assert.deepEqual(errors, []);
  await page.close();
});

test('值班小編過期就清空', async () => {
  const { frame, page } = await open();
  await frame.evaluate(() => localStorage.setItem('tbx.livereq.duty', JSON.stringify({ name: '舊班', contact: '1', exp: Date.now() - 1000 })));
  await page.reload();
  await frame.waitForSelector('#dutyName');
  assert.equal(await frame.inputValue('#dutyName'), '');
  await page.close();
});

test('18氣象站：顯示封面提醒、可複製；手改輸出後不會被覆蓋', async () => {
  const { frame, page, errors } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'weather.txt'), 'utf8'));
  const card = frame.locator('.lr-card');
  assert.equal(await card.locator('[data-wbox]').isVisible(), true);
  assert.match(await card.locator('[data-wtext]').textContent(), /今日主播是吳軒彤/);
  await card.locator('[data-weather]').click();
  await frame.waitForFunction(() => /封面提醒/.test(document.querySelector('[data-msg]').textContent));
  assert.match(await frame.evaluate(() => navigator.clipboard.readText()), /^18氣象直播封面PNG麻煩小幫手/);
  await card.locator('[data-out]').fill('手改內容');
  await frame.fill('#dutyName', '甲');
  assert.equal(await card.locator('[data-out]').inputValue(), '手改內容');
  await card.locator('[data-regen]').click();
  assert.match(await card.locator('[data-out]').inputValue(), /◎值班小編：\n甲/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('沒寫新聞事件：卡片要求補上，補了才算', async () => {
  const { frame, page } = await open();
  await paste(frame, '●直播平台：\nTVBS NEWS\n●畫面來源：X\n●YT標：測試｜LIVE');
  const card = frame.locator('.lr-card');
  assert.equal(await card.locator('.lr-event:not([data-timewrap])').isVisible(), true);
  assert.match(await card.locator('[data-msg]').textContent(), /新聞事件/);
  await card.locator('[data-event]').fill('記者會');
  assert.doesNotMatch(await card.locator('[data-msg]').textContent(), /新聞事件/);
  assert.match(await card.locator('[data-out]').inputValue(), /^●新聞事件：記者會\n/);
  assert.match(await card.locator('[data-out]').inputValue(), /●內文：測試，讓TVBS新聞帶您一起來了解。/);
  // 沒寫直播時間：要補，補了插在新聞事件下一行才能複製
  assert.match(await card.locator('[data-msg]').textContent(), /直播時間/);
  assert.equal(await card.locator('[data-copy]').isDisabled(), true);
  await card.locator('[data-time]').fill('1430');
  assert.match(await card.locator('[data-out]').inputValue(), /^●新聞事件：記者會\n●直播時間：1430\n/);
  assert.equal(await card.locator('.lr-time').textContent(), '14:30');
  await page.close();
});

test('再貼一份：取代上一份，只留新的卡片', async () => {
  const { frame, page } = await open();
  const pasteEvt = (text) => frame.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    document.getElementById('src').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await pasteEvt(fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  assert.equal(await frame.locator('.lr-card').count(), 6);
  await pasteEvt(fs.readFileSync(path.join(FIX, 'weather.txt'), 'utf8'));
  assert.equal(await frame.locator('.lr-card').count(), 1);
  assert.match(await frame.inputValue('#src'), /^11月16日《18氣象站》/);
  assert.equal(await frame.textContent('#count'), '共 1 場');
  await page.close();
});

test('一次一張：複製後跳下一張、已複製打勾、可回上一張、粉專勾選各張分開；時間寫成 00:00', async () => {
  const { frame, page, errors } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  await frame.fill('#dutyName', '王小明');
  await frame.fill('#dutyContact', '#85001');
  const visibleCards = () => frame.locator('.lr-card:not([hidden])').count();
  assert.equal(await visibleCards(), 1);
  assert.equal(await frame.textContent('#pos'), '第 1／6 場');
  assert.equal(await frame.locator('.lr-card').first().locator('.lr-time').textContent(), '09:25');
  assert.equal(await frame.locator('#prev').isDisabled(), true);
  await frame.locator('#pagesBar .lr-pages:not([hidden]) label.lr-box', { hasText: '少康' }).click();
  await frame.locator('.lr-card:not([hidden]) [data-copy]').click();
  await frame.waitForFunction(() => document.getElementById('pos').textContent === '第 2／6 場');
  assert.equal(await frame.textContent('.lr-dot >> nth=0'), '✓');
  // 第 2 張的粉專沒被第 1 張影響
  assert.equal(await frame.locator('#pagesBar .lr-pages:not([hidden]) input[value=少康]').isChecked(), false);
  await frame.click('#prev');
  assert.equal(await frame.textContent('#pos'), '第 1／6 場');
  assert.equal(await frame.locator('#pagesBar .lr-pages:not([hidden]) input[value=少康]').isChecked(), true);
  // 最後一張：複製後停在原地並提示
  await frame.click('.lr-dot >> nth=4');
  assert.equal(await frame.locator('.lr-card:not([hidden]) .lr-time').textContent(), '21:00');
  await frame.click('#next');
  assert.equal(await frame.locator('#next').isDisabled(), true);
  await frame.locator('#pagesBar .lr-pages:not([hidden]) label.lr-box', { hasText: '新聞' }).click();
  await frame.locator('.lr-card:not([hidden]) [data-copy]').click();
  await frame.waitForFunction(() => /還有 4 張沒複製/.test(document.querySelector('.lr-card:not([hidden]) [data-msg]').textContent));
  assert.equal(await frame.textContent('#pos'), '第 6／6 場');
  assert.deepEqual(errors, []);
  await page.close();
});

test('導覽列在粉專列上面；畫面來源在檢查列，待補只標黃不擋', async () => {
  const { frame, page } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  const order = await frame.evaluate(() => {
    const n = document.getElementById('nav'), p = document.getElementById('pagesBar');
    return !!(n.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  assert.equal(order, true);
  await frame.fill('#dutyName', '王小明');
  await frame.fill('#dutyContact', '#85001');
  const checks = () => frame.locator('.lr-card:not([hidden]) [data-checks]').innerText();
  assert.match(await checks(), /✓ 畫面來源/);
  await frame.click('.lr-dot >> nth=3'); // 桃園政見：畫面來源待補
  assert.doesNotMatch(await checks(), /✓ 畫面來源/);
  assert.equal(await frame.locator('.lr-card:not([hidden]) [data-checks] li.warn', { hasText: '畫面來源：待補' }).count(), 1);
  await frame.locator('#pagesBar .lr-pages:not([hidden]) label.lr-box', { hasText: '新聞' }).click();
  assert.equal(await frame.locator('.lr-card:not([hidden]) [data-copy]').isDisabled(), false);
  await page.close();
});

test('進入工具：貼上框自動聚焦（值班小編欄位仍在上方）；解析是次要按鈕、複製是主按鈕', async () => {
  const { frame, page } = await open();
  assert.equal(await frame.evaluate(() => document.activeElement && document.activeElement.id), 'src');
  const y = async (id) => (await frame.locator(id).boundingBox()).y;
  assert.ok((await y('#dutyName')) < (await y('#src')));
  assert.match(await frame.getAttribute('#run', 'class'), /btn-secondary/);
  assert.doesNotMatch(await frame.getAttribute('#run', 'class'), /btn-primary/);
  await page.close();
});

test('手機 320px：上下單欄無水平溢位、粉專整列 44px 可按、缺漏提示可跳到欄位', async () => {
  const t = await openTool(browser, srv.url, 'livereq', { viewport: { width: 320, height: 700 } });
  const { frame, page } = t;
  await frame.evaluate(() => localStorage.clear());
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  const ov = await frame.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(ov.sw <= ov.cw, `水平溢位 ${ov.sw}>${ov.cw}`);
  const box = await frame.locator('#pagesBar .lr-pages:visible .lr-box').first().boundingBox();
  assert.ok(box.height >= 44, '粉專列高 ' + box.height);
  // 點整列文字（不是勾選框）也能勾
  await frame.locator('#pagesBar .lr-pages:visible .lr-box').first().click({ position: { x: box.width - 6, y: box.height / 2 } });
  assert.equal(await frame.locator('#pagesBar .lr-pages:visible input').first().isChecked(), true);
  // 缺值班小編 → 點提示跳到值班欄位
  await frame.locator('.lr-card:visible .lr-jump', { hasText: '缺 值班小編' }).click();
  assert.equal(await frame.evaluate(() => document.activeElement.id), 'dutyName');
  // 按鈕與輸入框高度
  const small = await frame.evaluate(() => [...document.querySelectorAll('.lr button, .lr input[type=text], .lr textarea')].filter((e) => e.offsetParent && !e.closest('.lr-box') && e.getBoundingClientRect().height < 43).map((e) => e.id || e.className));
  assert.deepEqual(small, []);
  await page.close();
});

test('複製失敗：選取全文讓使用者手動複製', async () => {
  const { frame, page } = await open();
  await frame.evaluate(() => { localStorage.clear(); Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true }); document.execCommand = () => false; });
  await frame.fill('#dutyName', '小編A'); await frame.fill('#dutyContact', '#85001');
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  await frame.locator('#pagesBar .lr-pages:visible input').first().check();
  await frame.locator('.lr-card:visible [data-copy]').click();
  assert.match(await frame.locator('.lr-card:visible [data-msg]').textContent(), /手動複製/);
  const sel = await frame.evaluate(() => { const t = document.activeElement; return t.tagName === 'TEXTAREA' && t.selectionStart === 0 && t.selectionEnd === t.value.length && t.value.length > 0; });
  assert.equal(sel, true);
  await page.close();
});
