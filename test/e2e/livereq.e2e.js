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

async function open(opts = {}) {
  const errors = [];
  const t = await openTool(browser, srv.url, 'livereq', opts);
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
  // 一打開還沒操作：值班欄位不標紅；離開空的欄位才標
  for (const id of ['dutyName', 'dutyContact']) assert.equal(await frame.getAttribute('#' + id, 'aria-invalid'), 'false');
  await frame.focus('#dutyName'); await frame.focus('#dutyContact');
  assert.equal(await frame.getAttribute('#dutyName', 'aria-invalid'), 'true');
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  assert.equal(await frame.locator('.lr-card').count(), 6);
  assert.equal(await frame.textContent('#count'), '共 6 場');
  const first = frame.locator('.lr-card').first();
  assert.equal(await frame.locator('#copy').isDisabled(), true);
  assert.match(await frame.locator('.lr-st[data-key="FB 粉專"]').getAttribute('title'), /缺少：FB 粉專/);
  // 值班小編必填，但不列在底列狀態鈕：上方欄位紅框、複製鈕 title 帶原因
  assert.equal(await frame.locator('.lr-st[data-key="值班小編"]').count(), 0);
  assert.match(await frame.getAttribute('#copy', 'title'), /值班小編/);
  for (const id of ['dutyName', 'dutyContact']) assert.equal(await frame.getAttribute('#' + id, 'aria-invalid'), 'true');
  await frame.fill('#dutyName', '甲');
  assert.equal(await frame.getAttribute('#dutyName', 'aria-invalid'), 'false');
  assert.equal(await frame.getAttribute('#dutyContact', 'aria-invalid'), 'true', '只填姓名：分機仍紅框');
  await frame.fill('#dutyName', '');
  // 2100看世界：需求單已有新聞粉、國際粉 → 打勾鎖住，不算缺粉專
  const p5 = frame.locator('.lr-card').nth(4).locator('.lr-pages');
  assert.equal(await p5.locator('input[value=新聞]').isChecked(), true);
  assert.equal(await p5.locator('input[value=新聞]').isDisabled(), true);
  await frame.click('.lr-dot >> nth=4');
  assert.equal(await frame.locator('.lr-st[data-key="FB 粉專"]').getAttribute('data-state'), 'ok');
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
  await first.locator('.lr-pages label.lr-box', { hasText: '國際' }).click();
  assert.equal(await frame.locator('#copy').isDisabled(), false);
  const out = await first.locator('[data-out]').inputValue();
  assert.match(out, /大白話\nFB:\n國際\n●畫面來源：玉娜4G\n●值班小編：\n王小明 #85001\n/);
  await frame.click('#copy');
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
  const st = (k) => frame.locator(`.lr-st[data-key="${k}"]`).getAttribute('data-state');
  assert.equal(await st('新聞事件'), 'bad');
  await card.locator('[data-event]').fill('記者會');
  assert.equal(await st('新聞事件'), 'ok');
  assert.match(await card.locator('[data-out]').inputValue(), /^●新聞事件：記者會\n/);
  assert.match(await card.locator('[data-out]').inputValue(), /●內文：測試，讓TVBS新聞帶您一起來了解。/);
  // 沒寫直播時間：要補，補了插在新聞事件下一行才能複製
  assert.equal(await st('直播時間'), 'bad');
  assert.equal(await frame.locator('#copy').isDisabled(), true);
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
  await frame.locator('.lr-card:not([hidden]) label.lr-box', { hasText: '少康' }).click();
  await frame.click('#copy');
  await frame.waitForFunction(() => document.getElementById('pos').textContent === '第 2／6 場');
  assert.equal(await frame.textContent('.lr-dot >> nth=0'), '✓');
  // 第 2 張的粉專沒被第 1 張影響
  assert.equal(await frame.locator('.lr-card:not([hidden]) .lr-pages input[value=少康]').isChecked(), false);
  await frame.click('#prev');
  assert.equal(await frame.textContent('#pos'), '第 1／6 場');
  assert.equal(await frame.locator('.lr-card:not([hidden]) .lr-pages input[value=少康]').isChecked(), true);
  // 最後一張：複製後停在原地並提示
  await frame.click('.lr-dot >> nth=4');
  assert.equal(await frame.locator('.lr-card:not([hidden]) .lr-time').textContent(), '21:00');
  await frame.click('.lr-dot >> nth=5');
  await frame.locator('.lr-card:not([hidden]) .lr-pages label.lr-box', { hasText: '新聞' }).click();
  await frame.click('#copy');
  await frame.waitForFunction(() => /還有 4 張沒複製/.test(document.querySelector('.lr-card:not([hidden]) [data-msg]').textContent));
  assert.equal(await frame.textContent('#pos'), '第 6／6 場');
  assert.deepEqual(errors, []);
  await page.close();
});

test('畫面來源在狀態鈕列，待補標黃不擋；三種狀態有 class 與圖示；點紅黃跳到位置', async () => {
  const { frame, page } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  await frame.fill('#dutyName', '王小明');
  await frame.fill('#dutyContact', '#85001');
  const btn = (k) => frame.locator(`.lr-st[data-key="${k}"]`);
  assert.deepEqual(await frame.locator('.lr-st').evaluateAll((e) => e.map((x) => x.dataset.key)), ['新聞事件', '直播時間', 'FB 粉專', '畫面來源', '標題', '內文']);
  assert.equal(await btn('畫面來源').getAttribute('data-state'), 'ok');
  assert.equal(await btn('畫面來源').getAttribute('aria-disabled'), 'true');
  assert.equal(await btn('畫面來源').locator('svg').count(), 1);
  assert.match(await btn('畫面來源').getAttribute('class'), /is-ok/);
  await frame.click('.lr-dot >> nth=3'); // 桃園政見：畫面來源待補
  assert.equal(await btn('畫面來源').getAttribute('data-state'), 'warn');
  assert.match(await btn('畫面來源').getAttribute('class'), /is-warn/);
  assert.match(await btn('畫面來源').getAttribute('title'), /^提醒：畫面來源/);
  assert.match(await btn('畫面來源').getAttribute('aria-label'), /待補/);
  assert.equal(await btn('FB 粉專').getAttribute('data-state'), 'bad');
  assert.match(await btn('FB 粉專').getAttribute('class'), /is-bad/);
  // 圖示顏色：綠圓、黃三角、紅圓
  assert.equal(await btn('標題').locator('circle').getAttribute('fill'), '#17b26a');
  assert.equal(await btn('畫面來源').locator('path').first().getAttribute('fill'), '#f79009');
  assert.equal(await btn('FB 粉專').locator('circle').getAttribute('fill'), '#f04438');
  // 點紅色跳到粉專勾選框
  await btn('FB 粉專').click();
  assert.equal(await frame.evaluate(() => document.activeElement.type + ':' + !!document.activeElement.closest('.lr-pages')), 'checkbox:true');
  // 綠色不動作
  await btn('標題').click({ force: true });
  await frame.locator('.lr-card:not([hidden]) label.lr-box', { hasText: '新聞' }).click();
  assert.equal(await frame.locator('#copy').isDisabled(), false);
  await page.close();
});

test('窄螢幕：貼上後縮成一行按鈕，點了展開可重貼（隱藏切換，內容不重建）', async () => {
  const { frame, page } = await open({ viewport: { width: 900, height: 800 } });
  assert.equal(await frame.locator('#pasteBtn').isHidden(), true);
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  assert.equal(await frame.locator('#src').isHidden(), true);
  assert.equal(await frame.textContent('#pasteBtn'), '已貼上 6 場（點這裡重新貼上）');
  await frame.click('#pasteBtn');
  assert.equal(await frame.locator('#src').isVisible(), true);
  assert.equal(await frame.locator('#pasteBtn').isHidden(), true);
  assert.ok((await frame.inputValue('#src')).length > 0);
  await frame.click('#clear');
  assert.equal(await frame.locator('#stage').isHidden(), true);
  assert.equal(await frame.locator('#bar').isHidden(), true);
  await page.close();
});

test('進入工具：貼上框自動聚焦（值班小編欄位仍在上方）；解析是次要按鈕、複製是主按鈕', async () => {
  const { frame, page } = await open({ viewport: { width: 900, height: 800 } });
  assert.equal(await frame.evaluate(() => document.activeElement && document.activeElement.id), 'src');
  const x = async (id) => (await frame.locator(id).boundingBox()).x;
  assert.ok((await x('#dutyName')) > (await x('#src')));
  // 電腦版兩欄：值班欄位在貼上框上方
  await page.setViewportSize({ width: 1440, height: 900 });
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
  const box = await frame.locator('.lr-card:visible .lr-pages .lr-box').first().boundingBox();
  assert.ok(box.height >= 44, '粉專列高 ' + box.height);
  // 點整列文字（不是勾選框）也能勾
  await frame.locator('.lr-card:visible .lr-pages .lr-box').first().click({ position: { x: box.width - 6, y: box.height / 2 } });
  assert.equal(await frame.locator('.lr-card:visible .lr-pages input').first().isChecked(), true);
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
  await frame.locator('.lr-card:visible .lr-pages input').first().check();
  await frame.click('#copy');
  assert.match(await frame.locator('.lr-card:visible [data-msg]').textContent(), /手動複製/);
  const sel = await frame.evaluate(() => { const t = document.activeElement; return t.tagName === 'TEXTAREA' && t.selectionStart === 0 && t.selectionEnd === t.value.length && t.value.length > 0; });
  assert.equal(sel, true);
  await page.close();
});

test('新版面：320px 與 390px 狀態鈕、按鈕不水平溢位；電腦版狀態鈕 34px、複製鈕在右', async () => {
  for (const w of [320, 390]) {
    const t = await openTool(browser, srv.url, 'livereq', { viewport: { width: w, height: 700 } });
    await t.frame.evaluate(() => localStorage.clear());
    await paste(t.frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
    const ov = await t.frame.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(ov.sw <= ov.cw, `${w}px 水平溢位 ${ov.sw}>${ov.cw}`);
    const r = await t.frame.evaluate(() => [...document.querySelectorAll('.lr-st, #copy, #prev')].map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.height]; }));
    assert.ok(r.every(([l, rt]) => l >= 0 && rt <= w), '按鈕超出視窗');
    assert.ok(r.every(([, , h]) => h >= 43.5), '觸控高度不足');
    await t.page.close();
  }
  const { frame, page } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  const h = await frame.locator('.lr-st').first().evaluate((e) => e.getBoundingClientRect().height);
  assert.equal(Math.round(h), 34);
  const xs = await frame.evaluate(() => [document.querySelector('.lr-st').getBoundingClientRect().left, document.getElementById('copy').getBoundingClientRect().left]);
  assert.ok(xs[1] > xs[0]);
  await page.close();
});

test('分機：剛好 5 位數字自動加 #，其他不動；複製出去用補好的', async () => {
  const { frame, page } = await open();
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  for (const [v, want] of [['85001', '#85001'], ['#85001', '#85001'], ['0921925913', '0921925913'], ['8500', '8500'], [' 85002 ', '#85002']]) {
    await frame.fill('#dutyContact', v);
    await frame.locator('#dutyName').focus();
    assert.equal(await frame.inputValue('#dutyContact'), want, v);
  }
  await frame.fill('#dutyName', '王小明');
  await frame.fill('#dutyContact', '85001');   // 還沒離開欄位：需求單也已經用 #85001
  assert.match(await frame.locator('.lr-card:visible [data-out]').inputValue(), /王小明 #85001/);
  await page.close();
});

test('電腦版兩欄：左貼上（不縮合）右成品，勾粉專也不撐高頁面，底列在最下方', async () => {
  const { frame, page, errors } = await open({ viewport: { width: 1440, height: 900 } });
  assert.equal(await frame.locator('.lr-ph').isVisible(), true);
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  await frame.fill('#dutyName', '王小明'); await frame.fill('#dutyContact', '#85001');
  assert.equal(await frame.locator('#src').isVisible(), true);
  assert.equal(await frame.locator('#pasteBtn').isHidden(), true);
  assert.equal(await frame.locator('.lr-ph').isHidden(), true);
  const box = async (sel) => frame.locator(sel).boundingBox();
  const top = await box('#top'), stage = await box('#stage'), bar = await box('#bar');
  assert.ok(stage.x > top.x + top.width, '成品在貼上框右邊');
  assert.equal(await frame.textContent('#stage .lr-stagehead .lr-step'), '2成品');
  const before = await box('.lr-card:not([hidden]) [data-out]');
  for (const n of ['新聞', '少康', '娛樂', '國際']) await frame.locator('.lr-card:not([hidden]) label.lr-box', { hasText: n }).click();
  const after = await box('.lr-card:not([hidden]) [data-out]');
  assert.equal(Math.round(after.height), Math.round(before.height));
  const m = await frame.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }));
  assert.ok(m.sh <= m.ih, `頁面不捲動 ${m.sh} > ${m.ih}`);
  const bar2 = await box('#bar');
  assert.equal(Math.round(bar2.y), Math.round(bar.y));
  assert.ok(bar2.y + bar2.height <= 900);
  assert.deepEqual(errors, []);
  await page.close();
});

test('窄螢幕：底列黏在畫面最下方', async () => {
  const { frame, page } = await open({ viewport: { width: 900, height: 700 } });
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  for (const n of ['新聞', '少康', '娛樂', '國際']) await frame.locator('.lr-card:not([hidden]) label.lr-box', { hasText: n }).click();
  await frame.evaluate(() => scrollTo(0, 0));
  const bar = await frame.locator('#bar').boundingBox();
  assert.ok(bar.y + bar.height <= 700 && bar.y + bar.height >= 680, `底列底部 ${bar.y + bar.height}`);
  await page.close();
});

test('員工編號登入：帶入名單姓名與分機；分機改了自動存回帳號，姓名改了不存；不用班別清空', async () => {
  const posts = [];
  let contact = '12345';
  const api = (route) => {
    const req = route.request();
    if (!/\/staff\/me$/.test(req.url())) return false;
    if (req.method() === 'OPTIONS') { route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }); return true; }
    if (req.method() === 'POST') { const b = JSON.parse(req.postData()); posts.push(b); contact = b.contact; }
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, data: { id: 'A001', name: '王小明', group: '發文', contact } }) });
    return true;
  };
  const { frame, page, errors } = await open({ company: true, staff: 'A001', api });
  await frame.waitForFunction(() => document.getElementById('dutyName').value === '王小明');
  assert.equal(await frame.inputValue('#dutyContact'), '#12345', '5 位數字照樣補 #');
  assert.match(await frame.textContent('#dutyHint'), /已用員工編號 A001 登入/);
  // 改分機：停止輸入後自動存
  await frame.fill('#dutyContact', '0912-345-678');
  await frame.waitForFunction(() => /已儲存/.test(document.getElementById('dutyHint').textContent));
  assert.deepEqual(posts, [{ contact: '0912-345-678' }]);
  // 改姓名：不存回、也不存瀏覽器；輸出用改過的
  await frame.fill('#dutyName', '代班小華');
  await paste(frame, fs.readFileSync(path.join(FIX, 'batch.txt'), 'utf8'));
  const first = frame.locator('.lr-card').first();
  await first.locator('.lr-pages label.lr-box', { hasText: '國際' }).click();
  assert.match(await first.locator('[data-out]').inputValue(), /代班小華 0912-345-678/);
  assert.equal(posts.length, 1);
  assert.equal(await frame.evaluate(() => localStorage.getItem('tbx.livereq.duty')), null);
  // 重新整理：從帳號帶回新分機與名單姓名
  await page.reload();
  const f2 = await (await page.waitForSelector('iframe[name=tool]')).contentFrame();
  await f2.waitForFunction(() => document.getElementById('dutyName').value === '王小明');
  assert.equal(await f2.inputValue('#dutyContact'), '0912-345-678');
  assert.deepEqual(errors, []);
  await page.close();
});

test('員工編號登入但讀不到帳號資料：照舊用瀏覽器保存', async () => {
  const api = (route) => { if (!/\/staff\/me$/.test(route.request().url())) return false; route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '{}' }); return true; };
  const { frame, page } = await open({ company: true, staff: 'A001', api });
  await frame.fill('#dutyName', '王小明');
  await frame.waitForFunction(() => /本班保留到/.test(document.getElementById('dutyHint').textContent));
  await page.close();
});
