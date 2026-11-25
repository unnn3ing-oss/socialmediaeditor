const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { openTool } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

// 測試照片：用 canvas 產生一張淺灰 1200×900 PNG
async function photoBuffer(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(210,210,210)';
    x.fillRect(0, 0, 1200, 900);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // 素材 401／離線抓不到 Google Fonts 只是網路訊息，不算程式錯誤
    if (m.type() === 'error' && !/Failed to load resource|ERR_|fonts\.g/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const px = (frame, x, y) => frame.evaluate(([x, y]) => {
  const d = document.getElementById('batchCanvas').getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}, [x, y]);

async function waitPx(frame, x, y, pred, label) {
  const deadline = Date.now() + 8000;
  let last;
  while (Date.now() < deadline) {
    last = await px(frame, x, y);
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${label}：等不到預期的像素，最後是 ${last}`);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, t = 6) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);

async function setupItem(page, frame, title) {
  await frame.waitForSelector('.batch-item-block .dropzone input[type=file]', { state: 'attached' });
  await frame.setInputFiles('.batch-item-block .dropzone input[type=file]', {
    name: 'photo.png', mimeType: 'image/png', buffer: await photoBuffer(page),
  });
  await frame.fill('.batch-item-block textarea', title);
}

test('沒密碼：只有通用框，標籤區是主色、底部偏暗', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  const errors = watchErrors(page);
  await frame.waitForSelector('.batch-item-block');
  await setupItem(page, frame, '標題第一行\n第二行副標');
  const tag = await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '標籤區');
  assert.ok(near(tag, hex('#202124'), 2));
  const bottom = await px(frame, 700, 1060);
  assert.ok(bottom[0] < 90, `底部應該偏暗，實際 ${bottom}`);
  const top = await px(frame, 700, 300);
  assert.ok(top[0] > 190, `上半部應該是原照片亮度，實際 ${top}`);
  // 標籤右側白條
  const bar = await px(frame, 296, 100);
  assert.ok(bar[0] > 200 && bar[1] > 200 && bar[2] > 200);
  assert.deepEqual(errors, []);
});

test('改主色後標籤色改變；自訂色也行', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '標題');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '預設墨黑');
  await frame.click('.gen-swatch[data-color="#b03a2e"]');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#b03a2e'), 2), '磚紅');
  await frame.$eval('.gen-custom', (el) => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitPx(frame, 40, 100, (p) => near(p, hex('#123456'), 2), '自訂色');
  assert.equal(await frame.locator('.gen-swatch').count(), 5);
});

test('角標字留空：整個不畫；字很長：色塊變寬', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '標題');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '有標籤');
  await frame.fill('.gen-tag', '');
  const p = await waitPx(frame, 40, 100, (q) => !near(q, hex('#202124'), 20), '標籤留空');
  assert.ok(p[0] > 150, `留空時該區應是照片，實際 ${p}`);
  await frame.fill('.gen-tag', '獨家深度追蹤報導專題');
  await waitPx(frame, 400, 100, (q) => near(q, hex('#202124'), 2), '長標籤色塊變寬');
});

test('長標題自動縮小、不超出右邊界', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '這是一個非常非常非常非常非常非常非常非常長的標題用來測試自動縮小\n第二行也是非常非常非常非常非常非常非常非常長的副標題用來測試');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '畫好');
  await new Promise((r) => setTimeout(r, 300));
  for (const y of [880, 905, 980]) {
    const p = await px(frame, 1040, y);
    assert.ok(p[0] < 120, `x=1040,y=${y} 不應有字，實際 ${p}`);
  }
});

test('工具內切換不清空內容：背景類型、各組收合展開、框', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '第一組標題');
  await frame.fill('.gen-tag', '特報');
  await frame.click('.gen-swatch[data-color="#2f6b4f"]');
  // 圖片背景 → 純色背景 → 回圖片背景：照片與標題還在
  await frame.click('.batch-item-block .bg-toggle button:has-text("純色背景")');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第一組標題');
  await frame.click('.batch-item-block .bg-toggle button:has-text("圖片背景")');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#2f6b4f'), 2), '回到圖片背景後框還在');
  // 新增第二組，左側換成第二組；點縮圖切回第一組
  await frame.click('#thumbAddBtn');
  await frame.waitForFunction(() => document.querySelectorAll('.thumb-item').length === 2);
  await frame.fill('.batch-item-block textarea', '第二組標題');
  await frame.click('.thumb-item >> nth=0');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第一組標題');
  assert.equal(await frame.inputValue('.gen-tag'), '特報');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#2f6b4f'), 2), '展開後預覽');
  await frame.click('.thumb-item >> nth=1');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第二組標題');
});

test('完成後可下載，檔名是 YYMMDDHHMM_編號.png', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '下載測試');
  await frame.waitForSelector('#dlBtn:not([disabled])');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    frame.click('#dlBtn'),
  ]);
  assert.match(dl.suggestedFilename(), /^\d{10}_1\.png$/);
  // 貼圖在彈窗裡（按預覽右下角的按鈕才看得到）
  await frame.click('#fxBtn');
  await frame.waitForSelector('.fx-sticker-tile');
  assert.equal(await frame.locator('.fx-sticker-tile').count(), 7);
});

test('沒密碼：頁面沒有公司字樣與公司選項', async () => {
  const { page, frame, requested } = await openTool(browser, srv.url, 'pattern');
  await frame.waitForSelector('.batch-item-block');
  const text = await frame.evaluate(() => document.body.textContent);
  for (const w of ['TVBS', '粉框', '藍框', '緞帶']) assert.ok(!text.includes(w), `不應出現「${w}」`);
  assert.equal(await frame.isVisible('.batch-item-block [data-frame]'), false, '沒密碼不顯示框的切換');
  assert.ok(await frame.isVisible('.gen-tag'));
  assert.ok(Array.isArray(requested));
});

test('有密碼：要了公司素材，公司框選項出現，切換框不清空標題', async () => {
  const { page, frame, requested } = await openTool(browser, srv.url, 'pattern', { company: true });
  await frame.waitForSelector('.batch-item-block');
  await setupItem(page, frame, '公司版標題');
  assert.ok(requested.includes('pattern-ribbon-ent'), `requested = ${requested}`);
  assert.ok(requested.includes('pattern-ribbon-news'));
  assert.ok(requested.includes('pattern-logo-white'));
  const labels = await frame.locator('.batch-item-block [data-frame]').allTextContents();
  assert.deepEqual(labels, ['新聞（藍框）', '娛樂（粉框）', '通用框']);
  // 預設新聞：右上角緞帶（假圖洋紅）
  await waitPx(frame, 1000, 100, (p) => near(p, [255, 0, 255], 8), '右上角緞帶');
  assert.equal(await frame.isVisible('.gen-tag'), false);
  await frame.click('[data-frame="generic"]');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '切到通用框');
  assert.ok(await frame.isVisible('.gen-tag'));
  await frame.click('[data-frame="entertainment"]');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '公司版標題');
  await waitPx(frame, 1000, 100, (p) => near(p, [255, 0, 255], 8), '娛樂緞帶');
});

// ---- 快速填入（貼文章網址）----
const { fakeAsset, API_BASE } = require('../helpers/tool-page.js');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const ART_TITLE = '台北捷運驚傳亂象乘客嚇壞，市府緊急回應「全面檢討」改善措施';

// 假後端：/fetch/article 回類似 TVBS 的 HTML；網域不在 news.tvbs.com.tw 就回白名單錯誤；圖片回洋橙色小 png
async function fakeBackend(page, calls = []) {
  await page.route(API_BASE + '/fetch/**', async (r) => {
    const u = new URL(r.request().url());
    calls.push(u.pathname);
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (u.pathname === '/fetch/article') {
      const target = u.searchParams.get('url') || '';
      if (!/^https:\/\/news\.tvbs\.com\.tw\//.test(target)) {
        return r.fulfill({ status: 400, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, code: 'bad_request', error: '只能讀取白名單內的 https 網址。' }) });
      }
      const html = `<html><head><meta property="og:image" content="https://img.example/a.jpg"></head><body>
        <h1>${ART_TITLE}</h1><div class="tags"><a href="/tag/a">#捷運</a><a href="/tag/b">#台北</a></div></body></html>`;
      return r.fulfill({ headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, data: { url: target, html } }) });
    }
    if (u.pathname === '/fetch/image') return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset([60, 160, 220]) });
    return r.fulfill({ status: 404, headers: CORS, body: '' });
  });
}

test('快速填入：貼網址 → 標題斷行、主圖載入、通用框保留', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  const errors = watchErrors(page);
  const calls = [];
  await fakeBackend(page, calls);
  await frame.waitForSelector('.batch-item-block');
  const { autoLines } = await import(path.join(ROOT, 'sdk', 'news-rules.js'));
  await frame.click('#qfUrl');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/local/123456');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  const v = await frame.inputValue('.batch-item-block textarea');
  assert.equal(v, autoLines(ART_TITLE).join('\n'));
  assert.ok(v.split('\n').length >= 1);
  assert.match(await frame.textContent('#qfHint'), /主圖/);
  assert.ok(calls.includes('/fetch/image'));
  // 主圖已載入：照片區變成藍色（60,160,220）→ 上半部像素
  await waitPx(frame, 700, 300, (p) => near(p, [60, 160, 220], 12), '主圖載入');
  assert.equal(await frame.isVisible('.gen-tag'), true, '沒密碼維持通用框');
  assert.deepEqual(errors, []);
});

test('快速填入：已有內容要確認；取消不動內容；確認才覆蓋', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await fakeBackend(page);
  await setupItem(page, frame, '我自己打的標題');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/local/1');
  await frame.click('#qfBtn');
  await frame.waitForSelector('#confirmOverlay.open');
  await frame.click('#confirmCancelBtn');
  await frame.waitForFunction(() => /已取消/.test(document.getElementById('qfHint').textContent));
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '我自己打的標題');
  await frame.click('#qfBtn');
  await frame.waitForSelector('#confirmOverlay.open');
  await frame.click('#confirmOkBtn');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  assert.notEqual(await frame.inputValue('.batch-item-block textarea'), '我自己打的標題');
});

test('快速填入：網址不在白名單 → 顯示原因、原內容保留', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await fakeBackend(page);
  await setupItem(page, frame, '原本的標題');
  await frame.fill('#qfUrl', 'https://evil.example.com/news/1');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /帶入失敗/.test(document.getElementById('qfHint').textContent));
  assert.match(await frame.textContent('#qfHint'), /白名單/);
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '原本的標題');
  await waitPx(frame, 40, 100, (p) => near(p, hex('#202124'), 2), '預覽仍在');
});

test('快速填入：有密碼時娛樂網址選粉框、新聞網址選藍框', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', { company: true });
  await fakeBackend(page);
  await frame.waitForSelector('.batch-item-block');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/entertainment/2999999');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  assert.equal(await frame.getAttribute('.batch-item-block [data-frame="entertainment"]', 'class').then((c) => /active/.test(c)), true);
  // 新增一組、直接貼新聞網址（新組是空的，不需確認）
  await frame.click('#thumbAddBtn');
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/local/1');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent) && document.querySelector('.batch-item-block [data-frame="news"].active'), null, { timeout: 8000 });
});

test('標題最多 4 行：第 5 行起顯示提示；4 行時最後一行對齊 3 行的底線往上長', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', { company: true });
  await frame.waitForSelector('.batch-item-block');
  await setupItem(page, frame, '一\n二\n三\n四');
  assert.equal(await frame.isVisible('.title-lines-warn'), false);
  assert.ok((await frame.locator('.batch-item-block label').allTextContents()).some((t) => /最多 4 行/.test(t)));
  await frame.fill('.batch-item-block textarea', '一\n二\n三\n四\n五');
  assert.equal(await frame.isVisible('.title-lines-warn'), true);
  assert.match(await frame.textContent('.title-lines-warn'), /最多 4 行/);
  // 幾何：3 行的最後一行在 880+lh；4 行的最後一行也要在同一個位置
  const r = await frame.evaluate(() => {
    const lh = 93, last = (n) => anchorY(BOX_CENTER, n, lh) + (n - 1) * lh / 2;
    return { three: last(3), four: last(4), one: anchorY(BOX_CENTER, 1, lh) };
  });
  assert.equal(r.four, r.three);
  assert.equal(r.one, 880, '1～3 行仍以 880 置中');
});

test('手機：每組右上的紅色 × 維持正圓', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(srv.url + 'tools/pattern/index.html');
  const btn = page.locator('.batch-item-head .remove-btn').first();
  await btn.waitFor();
  const box = await btn.boundingBox();
  assert.ok(Math.abs(box.width - box.height) < 1, `寬 ${box.width}、高 ${box.height}`);
  assert.ok(box.width >= 24);
  await ctx.close();
});

// ---- UI 改版第 2 輪：桌面兩欄、手機編輯／預覽切換、底部操作列 ----
const mobile = (w, h = 800) => ({ viewport: { width: w, height: h } });

async function putPhoto(page, frame, title) {
  await frame.waitForSelector('.batch-item-block .dropzone input[type=file]', { state: 'attached' });
  await frame.setInputFiles('.batch-item-block .dropzone input[type=file]', {
    name: 'photo.png', mimeType: 'image/png', buffer: await photoBuffer(page),
  });
  if (title) await frame.fill('.batch-item-block textarea', title);
}

test('桌面 1280：設定欄與預覽左右並列，沒有編輯／預覽切換，下載這張在設定欄尾端', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', mobile(1280, 800));
  await frame.waitForSelector('.batch-item-block');
  const r = await frame.evaluate(() => {
    const b = (id) => document.getElementById(id).getBoundingClientRect();
    return {
      tabsHidden: document.getElementById('mTabs').hidden,
      edit: b('panelEdit'), preview: b('panelPreview'), act: b('actionBar'), gen: b('dlBtn'),
      dlAllInShelf: document.getElementById('dlAllSlot').contains(document.getElementById('batchDownloadAllBtn')),
      resetInShelf: document.getElementById('dlAllSlot').contains(document.getElementById('batchResetBtn')),
      moreHidden: document.getElementById('moreWrap').hidden,
      settingsW: b('panelEdit').width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert.ok(r.tabsHidden && r.moreHidden);
  assert.ok(r.edit.right <= r.preview.left, '設定欄在預覽左邊');
  assert.ok(Math.abs(r.settingsW - 340) < 2, `設定欄 340px，實際 ${r.settingsW}`);
  assert.ok(r.gen.left >= r.edit.left && r.gen.right <= r.edit.right + 1, '下載這張在左設定欄內');
  assert.ok(r.act.top >= r.edit.bottom - 1, '操作列在設定欄尾端');
  assert.ok(r.dlAllInShelf, '全部下載在縮圖列右側');
  assert.ok(r.resetInShelf, '全部清除在縮圖列右側');
  assert.equal(r.overflow, 0);
  await page.close();
});

test('桌面 1024：設定欄 320px、無水平溢位', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', mobile(1024, 768));
  await frame.waitForSelector('.batch-item-block');
  const r = await frame.evaluate(() => ({
    w: document.getElementById('panelEdit').getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert.ok(Math.abs(r.w - 320) < 2, `實際 ${r.w}`);
  assert.equal(r.overflow, 0);
  await page.close();
});

test('手機：編輯／預覽切換保留內容，canvas 與表單是同一個元素，非選中頁不可 Tab', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', mobile(390, 844));
  await putPhoto(page, frame, '切換保留測試');
  await frame.evaluate(() => { document.getElementById('batchCanvas').__mark = 1; document.querySelector('.batch-item-block textarea').__mark = 1; });
  const st = () => frame.evaluate(() => ({
    editSel: document.getElementById('tabEdit').getAttribute('aria-selected'),
    prevSel: document.getElementById('tabPreview').getAttribute('aria-selected'),
    editHidden: document.getElementById('panelEdit').hidden,
    prevHidden: document.getElementById('panelPreview').hidden,
    tabIdx: [document.getElementById('tabEdit').tabIndex, document.getElementById('tabPreview').tabIndex],
    role: document.getElementById('panelEdit').getAttribute('role'),
  }));
  let s = await st();
  assert.deepEqual([s.editSel, s.prevSel, s.editHidden, s.prevHidden, s.role], ['true', 'false', false, true, 'tabpanel']);
  assert.deepEqual(s.tabIdx, [0, -1]);
  await frame.click('#tabPreview');
  s = await st();
  assert.deepEqual([s.editSel, s.prevSel, s.editHidden, s.prevHidden], ['false', 'true', true, false]);
  // 隱藏的編輯頁裡沒有任何可聚焦（Tab）的元素可見
  assert.equal(await frame.locator('#panelEdit textarea').isVisible(), false);
  await frame.click('#tabEdit');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '切換保留測試');
  const same = await frame.evaluate(() => [document.getElementById('batchCanvas').__mark, document.querySelector('.batch-item-block textarea').__mark]);
  assert.deepEqual(same, [1, 1]);
  // 方向鍵切換
  await frame.focus('#tabEdit');
  await page.keyboard.press('ArrowRight');
  s = await st();
  assert.equal(s.prevSel, 'true');
  assert.equal(await frame.evaluate(() => document.activeElement.id), 'tabPreview');
  await page.keyboard.press('ArrowLeft');
  assert.equal((await st()).editSel, 'true');
  // 回到桌面寬度：兩區都顯示、並列；再縮回手機仍是原本分頁
  await page.setViewportSize({ width: 1280, height: 800 });
  // 斷點 change 事件是非同步的，等它套用
  await frame.waitForFunction(() => !document.getElementById('panelEdit').hidden && !document.getElementById('panelPreview').hidden);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '切換保留測試');
  await page.close();
});

test('手機：缺背景按下載這張出現提醒 toast、留在編輯；齊全後可下載', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', mobile(390, 844));
  await frame.waitForSelector('.batch-item-block');
  await frame.click('#dlBtn');   // 還沒有背景與標題 -> 提醒
  assert.equal(await frame.getAttribute('#tabEdit', 'aria-selected'), 'true');
  await frame.waitForSelector('#toastHost .toast.show');
  assert.match(await frame.textContent('#toastHost'), /還沒有背景/);
  assert.equal(await frame.getAttribute('#toastHost', 'role'), 'status');
  // toast 不被底部動作列遮住
  const r = await frame.evaluate(() => ({ t: document.querySelector('.toast').getBoundingClientRect().bottom, a: document.getElementById('actionBar').getBoundingClientRect().top }));
  assert.ok(r.t <= r.a + 0.5, `toast 底 ${r.t} 動作列頂 ${r.a}`);
  // × 可關閉
  await frame.click('.toast-close');
  assert.equal(await frame.locator('.toast').count(), 0);
  await putPhoto(page, frame, '成功後下載');
  const [dl] = await Promise.all([page.waitForEvent('download'), frame.click('#dlBtn')]);
  assert.match(dl.suggestedFilename(), /^\d{10}_1\.png$/);
  await page.close();
});

test('手機：320／390／768／820 無整頁水平捲動（編輯與預覽兩頁）', async () => {
  for (const w of [320, 390, 768, 820]) {
    const { page, frame } = await openTool(browser, srv.url, 'pattern', mobile(w, 800));
    await putPhoto(page, frame, '很長很長很長很長很長很長很長很長很長很長很長很長的標題');
    await frame.click('#tabPreview');   // 縮圖列的「＋」在預覽頁
    await frame.click('#thumbAddBtn');
    for (const tab of ['tabEdit', 'tabPreview']) {
      await frame.click('#' + tab);
      const o = await frame.evaluate(() => ({ d: document.documentElement.scrollWidth - document.documentElement.clientWidth, b: document.body.scrollWidth - document.body.clientWidth }));
      assert.ok(o.d <= 0 && o.b <= 0, `${w}px ${tab} 水平溢位 ${JSON.stringify(o)}`);
    }
    await page.close();
  }
});

test('手機：底部操作列黏在底部、不遮住最後一個欄位；按鈕與輸入符合觸控尺寸', async () => {
  for (const w of [320, 390]) {
    const { page, frame } = await openTool(browser, srv.url, 'pattern', mobile(w, 640));
    await frame.waitForSelector('.batch-item-block');
    await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const r = await frame.evaluate(() => {
      const bar = document.getElementById('actionBar').getBoundingClientRect();
      const last = document.getElementById('helpBtn').getBoundingClientRect();
      return { barTop: bar.top, barBottom: bar.bottom, vh: window.innerHeight, lastBottom: last.bottom };
    });
    assert.ok(Math.abs(r.barBottom - r.vh) <= 1, `${w}px 操作列貼底 ${JSON.stringify(r)}`);
    assert.ok(r.lastBottom <= r.barTop + 0.5, `${w}px 最後欄位被遮 ${JSON.stringify(r)}`);
    // 捲回頂端時操作列仍在畫面底部
    await frame.evaluate(() => window.scrollTo(0, 0));
    const b2 = await frame.evaluate(() => document.getElementById('actionBar').getBoundingClientRect().bottom - window.innerHeight);
    assert.ok(Math.abs(b2) <= 1, `${w}px 捲回頂端操作列貼底`);
    // 觸控目標與文字大小
    const small = await frame.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#actionBar button, #mTabs button, .bg-toggle button, #qfBtn, #thumbAddBtn, #helpBtn, .step-btn')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.height < 44 || r.width < 44)) bad.push(el.id || el.className || el.textContent);
      }
      const fs = [...document.querySelectorAll('.batch-item-block input[type=text], .batch-item-block textarea, #qfUrl')].filter((e) => e.offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { bad, minFont: Math.min(...fs) };
    });
    assert.deepEqual(small.bad, [], `${w}px 觸控目標不足`);
    assert.ok(small.minFont >= 16, `${w}px 輸入字級 ${small.minFont}`);
    // 按鈕不截字
    const clipped = await frame.evaluate(() => [...document.querySelectorAll('#actionBar button')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
    assert.deepEqual(clipped, []);
    await page.close();
  }
});

test('手機：「更多」含全部下載與全部清除、可開可關、Esc 關閉並還原焦點', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', mobile(390, 844));
  await frame.waitForSelector('.batch-item-block');
  assert.equal(await frame.locator('#moreMenu').isVisible(), false);
  await frame.click('#moreBtn');
  assert.equal(await frame.getAttribute('#moreBtn', 'aria-expanded'), 'true');
  assert.ok(await frame.locator('#moreMenu #batchDownloadAllBtn').isVisible());
  assert.ok(await frame.locator('#moreMenu #batchResetBtn').isVisible());
  assert.equal(await frame.locator('#actionBar button:visible').count() >= 2, true);
  await page.keyboard.press('Escape');
  assert.equal(await frame.locator('#moreMenu').isVisible(), false);
  assert.equal(await frame.evaluate(() => document.activeElement.id), 'moreBtn');
  await frame.click('#moreBtn');
  await frame.click('#moreBtn');
  assert.equal(await frame.locator('#moreMenu').isVisible(), false);
  await page.close();
});

// ---- 介面調整：純色預設隨機、縮圖即時小圖與「＋」、貼圖彈窗、toast、無灰字說明 ----
test('純色背景：沒選過顏色就隨機一個色票並立即預覽；選過則沿用', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await frame.waitForSelector('.batch-item-block');
  await frame.click('.batch-item-block .bg-toggle button:has-text("純色背景")');
  await frame.waitForSelector('.batch-item-block .color-swatch.selected');
  const first = await frame.$eval('.batch-item-block .color-swatch.selected', (e) => e.title);
  const p = await waitPx(frame, 540, 100, (q) => q[3] === 255, '純色預覽有畫');
  assert.ok(p[3] === 255);
  // 換一個顏色、切到圖片再切回：沿用上次選的
  const other = await frame.$$eval('.batch-item-block .color-swatch', (els, f) => els.map((e) => e.title).find((t) => t !== f), first);
  await frame.click(`.batch-item-block .color-swatch[title="${other}"]`);
  await frame.click('.batch-item-block .bg-toggle button:has-text("圖片背景")');
  await frame.click('.batch-item-block .bg-toggle button:has-text("純色背景")');
  assert.equal(await frame.$eval('.batch-item-block .color-swatch.selected', (e) => e.title), other);
  await page.close();
});

test('縮圖列：即時小圖、沒背景是空框、最後一格＋新增一組', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await frame.waitForSelector('.batch-item-block');
  // 一開始就有縮圖列與「＋」；新組沒背景＝空框
  assert.ok(await frame.isVisible('#batchThumbsShelf'));
  assert.equal(await frame.getAttribute('#thumbAddBtn', 'aria-label'), '新增一張');
  assert.equal(await frame.locator('.thumb-item.thumb-empty').count(), 1);
  assert.equal(await frame.locator('#batchResetBtn, #addBatchItemBtn, #genBtn, #batchStatus, .preview-hint').count(), 1, '只剩全部清除這顆');
  await setupItem(page, frame, '縮圖測試');
  await frame.waitForFunction(() => !document.querySelector('.thumb-item').classList.contains('thumb-empty'));
  // 小圖有畫：中心像素不透明
  await frame.waitForFunction(() => { const c = document.querySelector('.thumb-item canvas'); return c.getContext('2d').getImageData(88, 88, 1, 1).data[3] === 255; });
  // ＋ 新增一組並切過去；左側只顯示選中的那一組
  await frame.click('#thumbAddBtn');
  await frame.waitForFunction(() => document.querySelectorAll('.thumb-item').length === 2);
  assert.equal(await frame.locator('.batch-item-block').count(), 1);
  assert.equal(await frame.locator('#batchItemsList > *').count(), 1, '左側只有一組');
  assert.equal(await frame.locator('.thumb-item.active-thumb').count(), 1);
  assert.equal(await frame.locator('.thumb-item.thumb-empty').count(), 1);
  // 點第一個縮圖切回去，標題還在
  await frame.click('.thumb-item >> nth=0');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '縮圖測試');
  // 沒有完成相關字樣
  const text = await frame.evaluate(() => document.body.textContent);
  for (const w of ['已完成', '未完成', '產生此張', '再做一張']) assert.ok(!text.includes(w), `不應出現「${w}」`);
  await page.close();
});

test('貼圖與馬賽克：按鈕開關彈窗，Esc 關閉後焦點回按鈕；彈窗不超出預覽、內容保留', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '彈窗測試');
  assert.equal(await frame.getAttribute('#fxBtn', 'aria-label'), '貼圖與馬賽克');
  assert.equal(await frame.getAttribute('#fxBtn', 'aria-expanded'), 'false');
  assert.equal(await frame.isVisible('#fxPop'), false);
  await frame.click('#fxBtn');
  assert.equal(await frame.getAttribute('#fxBtn', 'aria-expanded'), 'true');
  await frame.waitForSelector('#fxPop .fx-sticker-tile');
  const r = await frame.evaluate(() => {
    const p = document.getElementById('fxPop').getBoundingClientRect(), w = document.querySelector('.canvas-wrap').getBoundingClientRect(), b = document.getElementById('fxBtn').getBoundingClientRect();
    return { inside: p.left >= w.left - 1 && p.right <= w.right + 1 && p.top >= w.top - 1, above: p.bottom <= b.top + 1 };
  });
  assert.ok(r.inside, '彈窗在預覽範圍內');
  assert.ok(r.above, '彈窗在按鈕上方');
  // 加一張貼圖，關閉再開：還在（不重建）
  await frame.click('#fxPop .fx-sticker-tile >> nth=0');
  await page.keyboard.press('Escape');
  assert.equal(await frame.isVisible('#fxPop'), false);
  assert.equal(await frame.evaluate(() => document.activeElement.id), 'fxBtn');
  await frame.click('#fxBtn');
  assert.ok(await frame.isVisible('#fxPop .fx-sticker-tile'));
  // 再按一次關閉；點外面也關閉
  await frame.click('#fxBtn');
  assert.equal(await frame.isVisible('#fxPop'), false);
  await frame.click('#fxBtn');
  await frame.click('.settings', { position: { x: 20, y: 400 } });
  assert.equal(await frame.isVisible('#fxPop'), false);
  await page.close();
});

test('缺背景按「下載這張」：出現 toast（role=status）並自動消失；沒有灰字說明；標題在預覽上方', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await frame.waitForSelector('.batch-item-block');
  await frame.fill('.batch-item-block textarea', '只有標題');
  await frame.click('#dlBtn');
  await frame.waitForSelector('#toastHost .toast.show');
  assert.match(await frame.textContent('#toastHost'), /還沒有背景/);
  assert.equal(await frame.getAttribute('#toastHost', 'role'), 'status');
  assert.equal(await frame.getAttribute('#toastHost', 'aria-live'), 'polite');
  await frame.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 7000 });
  // 全部下載：都不能下載 → 也是 toast
  await frame.click('#batchDownloadAllBtn');
  await frame.waitForSelector('#toastHost .toast');
  assert.equal(await frame.locator('.preview-hint, #batchStatus, #mStatus').count(), 0);
  assert.ok(!(await frame.evaluate(() => document.body.textContent)).includes('Ctrl+V 貼上圖片；滾輪縮放'));
  // 標題字在 canvas 上方
  await setupItem(page, frame, '標題在上方');
  const t = await frame.locator('#batchPreviewTitle').boundingBox();
  const c = await frame.locator('#batchCanvas').boundingBox();
  assert.ok(t && c && t.y + t.height <= c.y + 1, `標題 ${t && t.y} 應在 canvas ${c && c.y} 上方`);
  await page.close();
});

test('全部下載：部分缺標題或背景會問；確認後只下載可下載的', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  await setupItem(page, frame, '第一張');
  await frame.click('#thumbAddBtn');   // 第二張空的
  await frame.click('#batchDownloadAllBtn');
  await frame.waitForSelector('#confirmOverlay.open');
  assert.match(await frame.textContent('#confirmMessage'), /1 組缺標題或背景/);
  await frame.click('#confirmCancelBtn');
  await page.close();
});

test('左側只顯示選中的那一組；刪除選前一張；手機切換列', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern', { viewport: { width: 1280, height: 800 } });
  await setupItem(page, frame, '第一組');
  await frame.click('#thumbAddBtn');
  await frame.fill('.batch-item-block textarea', '第二組');
  await frame.click('#thumbAddBtn');
  await frame.fill('.batch-item-block textarea', '第三組');
  assert.equal(await frame.locator('#batchItemsList > *').count(), 1);
  assert.equal(await frame.isVisible('#mPager'), false, '桌面不顯示切換列');
  await frame.click('.thumb-item >> nth=1');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第二組');
  assert.match(await frame.textContent('.batch-item-head .label'), /#2/);
  // 刪掉第二組 → 選前一張（第一組）
  await frame.click('.batch-item-head .remove-btn');
  await frame.click('#confirmOkBtn');
  await frame.waitForFunction(() => document.querySelectorAll('.thumb-item').length === 2);
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第一組');
  // 手機：切換列 ‹ 第 1／2 張 ›
  await page.setViewportSize({ width: 390, height: 844 });
  await frame.waitForFunction(() => matchMedia('(max-width: 820px)').matches);
  assert.ok(await frame.isVisible('#mPager'));
  assert.equal(await frame.textContent('#mPagerText'), '第 1／2 張');
  assert.equal(await frame.isDisabled('#mPagerPrev'), true);
  await frame.click('#mPagerNext');
  assert.equal(await frame.textContent('#mPagerText'), '第 2／2 張');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '第三組');
  assert.equal(await frame.isDisabled('#mPagerNext'), true);
  await page.close();
});

test('快速填入讀取中：預覽顯示骨架，確認視窗前收起，讀完收起', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  const errors = watchErrors(page);
  let release;
  const gate = new Promise((r) => { release = r; });
  await fakeBackend(page);
  await page.route(API_BASE + '/fetch/article**', async (r) => { if (r.request().method() !== 'OPTIONS') await gate; await r.fallback(); });
  await frame.waitForSelector('.batch-item-block');
  assert.equal(await frame.isHidden('#qfSkel'), true);
  await frame.fill('#qfUrl', 'https://news.tvbs.com.tw/local/123456');
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForSelector('#qfSkel:not([hidden])');
  release();
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  assert.equal(await frame.isHidden('#qfSkel'), true);
  assert.deepEqual(errors, []);
});

test('快速填入：網址與提示跟著每一張；新增的一張空白；切回第 1 張網址還在', async () => {
  const { page, frame } = await openTool(browser, srv.url, 'pattern');
  const errors = watchErrors(page);
  await fakeBackend(page, []);
  await frame.waitForSelector('.batch-item-block');
  const URL1 = 'https://news.tvbs.com.tw/local/123456';
  await frame.fill('#qfUrl', URL1);
  await frame.press('#qfUrl', 'Enter');
  await frame.waitForFunction(() => /已帶入/.test(document.getElementById('qfHint').textContent), null, { timeout: 8000 });
  await frame.click('#thumbAddBtn');
  await frame.waitForFunction(() => document.querySelectorAll('.thumb-item').length === 2);
  assert.equal(await frame.inputValue('#qfUrl'), '', '新的一張網址空白');
  assert.doesNotMatch(await frame.textContent('#qfHint'), /已帶入/, '新的一張沒有上一張的提示');
  assert.equal(await frame.inputValue('.batch-item-block textarea'), '', '新的一張標題空白');
  await frame.click('.thumb-item >> nth=0');
  await frame.waitForFunction((u) => document.getElementById('qfUrl').value === u, URL1);
  assert.match(await frame.textContent('#qfHint'), /已帶入/);
  assert.deepEqual(errors, []);
});
