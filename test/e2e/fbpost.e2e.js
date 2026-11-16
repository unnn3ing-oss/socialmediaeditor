// 排程發布（測試版）：以 page.route 模擬後端，不打真的臉書。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { fakeAsset, API_BASE } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const PAGES = [{ id: '111', short: '新聞', order: 1, rd: 'news', noTextUtm: false }, { id: '222', short: '娛樂', order: 2, rd: 'ent', noTextUtm: true }, { id: '333', short: '國際', order: 3, rd: '', noTextUtm: true }];
const SHOT = process.env.SHOT_DIR;

// mode: 'admin' | 'company'（無 admin）| 'denied'（401）| 'tokenbad'（管理員，但 /fb/pages 回 fb_token）
async function newPage(mode, viewport = { width: 1280, height: 900 }, opts = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [], fbCalls = [], api = { posts: [], reschedules: [], cancels: [], deletes: [], rundown: [] };
  const soon = Math.floor(Date.now() / 1000) + 7200;
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    const json = (data, status = 200) => r.fulfill({ status, headers: CORS, json: status === 200 ? { ok: true, data } : data });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (p.startsWith('/fb/')) fbCalls.push(p);
    if (p === '/auth/status') {
      if (mode === 'denied') return json({ ok: false, code: 'unauthorized', error: '請先登入' }, 401);
      return json(mode === 'admin' || mode === 'tokenbad' ? { company: true, exp: soon, admin: true } : { company: true, exp: soon });
    }
    // 開放範圍：company＝只開放管理員時的公司帳號（403）；companyOpen＝已開放給公司帳號
    if (mode === 'company' && p.startsWith('/fb/')) return json({ ok: false, code: 'fb_forbidden', error: '目前只有管理員可以使用排程發布。' }, 403);
    if (p === '/fb/access') return json({ mode: mode === 'companyOpen' ? 'company' : 'admin' });
    if (p === '/fb/pages') return mode === 'tokenbad' ? json({ ok: false, code: 'fb_token', error: '臉書 token 無效或過期。' }, 502) : json(PAGES);
    if (p === '/fb/post') {
      const body = req.postData() || '';
      api.posts.push(body);
      const targets = JSON.parse(/name="targets"\r\n\r\n([^\r]*)\r\n/.exec(body)[1]);
      return json({ results: targets.map((t) => (t.page === '222'   // 替身後端：娛樂一定失敗
        ? { page: t.page, ok: false, scheduled: false, comment: 'none', error: '臉書拒絕' }
        : { page: t.page, ok: true, postId: t.page + '_9', scheduled: t.at != null, at: t.at ?? undefined, comment: t.at != null ? 'armed' : 'done' })) });
    }
    if (p === '/fb/scheduled') return json([{ id: '111_7', message: '排好的貼文'.repeat(20), at: soon, picture: 'data:image/png;base64,' + fakeAsset().toString('base64'), comment: 'pending' }]);
    if (p === '/fb/published') return json({ items: [{ id: '111_5', message: '已發的貼文', time: new Date().toISOString(), picture: null, url: 'https://www.facebook.com/111/posts/5', comment: 'done' }], next: null });
    if (p === '/fb/presets') return json([{ name: '雙11抽獎', body: '留言＋分享抽 AirPods！\nhttps://example.com/a' }, { name: '訂閱', body: '記得訂閱 YouTube' }]);
    if (p === '/rundown') {
      const b = JSON.parse(req.postData() || '{}');
      api.rundown.push(b);
      if (opts.rdFail) return json({ results: b.entries.map((e) => ({ ok: false, page: e.page, time: e.time, error: '找不到時段' })) });
      return json({ results: b.entries.map((e) => ({ ok: true, page: e.page, status: 'insert', cell: '2026/11!AE255', time: e.time })) });
    }
    let m = /^\/fb\/posts\/([^/]+)\/(reschedule|cancel|delete)$/.exec(p);
    if (m) {
      const b = JSON.parse(req.postData() || '{}');
      (m[2] === 'reschedule' ? api.reschedules : m[2] === 'cancel' ? api.cancels : api.deletes).push(b);
      return json({ ok: true });
    }
    return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
  });
  return { page, errors, fbCalls, api };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const mode of ['company', 'denied']) {
  test(`只開放管理員時，公司帳號（${mode}）只顯示功能停用`, async () => {
    const { page, errors, fbCalls } = await newPage(mode, { width: 390, height: 700 });
    await page.goto(srv.url + 'tools/fbpost/index.html');
    const box = page.locator('#fbpostOff');
    await box.waitFor();
    assert.match(await box.textContent(), /排程發布 功能停用/);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#fbpostApp').isVisible(), false);
    assert.deepEqual(fbCalls, mode === 'company' ? ['/fb/pages'] : [], '公司帳號只問一次 /fb/pages（403），沒登入不問');
    assert.equal(await page.isHidden('#offReason'), true, '權限不足不顯示原因');
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('已開放給公司帳號：公司帳號可以用，不顯示「測試模式」標籤；管理員在只開放管理員時有標籤', async () => {
  const { page, errors } = await newPage('companyOpen');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.waitForFunction(() => [...document.querySelectorAll('.test-pill')].every((e) => e.hidden));
  await page.click('#newBtn');
  assert.equal(await page.locator('.test-pill:visible').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
  const a = await newPage('admin');
  await a.page.goto(srv.url + 'tools/fbpost/index.html');
  await a.page.waitForSelector('#fbpostApp:not([hidden])');
  await a.page.waitForTimeout(200);
  assert.equal(await a.page.isVisible('.fp-head .test-pill'), true);
  await a.page.close();
});

test('純文字貼文：勾到沒設定文字 UTM 的粉專會先提醒，返回不送、確定才送', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#msg', '只有文字');
  await page.evaluate(() => { document.getElementById('link').value = 'https://news.tvbs.com.tw/life/1'; });
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(333) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForSelector('#cfDlg[open]');
  assert.match(await page.textContent('#cfBody'), /^國際 沒有設定純文字貼文的 UTM/);
  await page.click('#cfNo');
  await page.waitForTimeout(200);
  assert.equal(api.posts.length, 0);
  await page.click('#sendBtn');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfYes');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 1);
  await page.close();
});

test('有圖貼文不提醒文字 UTM', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await pasteImage(page, fakeAsset());
  await page.waitForSelector('#cvEmpty', { state: 'hidden' });
  await page.fill('#msg', 'm');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.click(chip(333) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 1);
  await page.close();
});

test('網站首頁不用登入就看得到排程發布卡片，點進去顯示功能停用', async () => {
  const { page, errors, fbCalls } = await newPage('denied', { width: 1280, height: 800 });
  await page.goto(srv.url + 'index.html');
  const card = page.locator('#showcase .card[data-tool=fbpost]');
  await card.waitFor();
  await card.click();
  await page.frameLocator('.pane[data-tool=fbpost] iframe').locator('#fbpostOff', { hasText: '功能停用' }).waitFor();
  assert.deepEqual(fbCalls, []);
  assert.deepEqual(errors, []);
  await page.close();
});

const p2 = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return p2(d.getHours()) + p2(d.getMinutes()); };
async function openPost(page) {
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.waitForSelector('#pages .chip', { state: 'attached' });
  await page.click('#newBtn');
  await page.waitForSelector('#postDlg:not([hidden])');
}
const chip = (id) => `#pages .chip[data-page="${id}"]`;
// 模擬在新增發文視窗按 Ctrl+V 貼上圖片
const pasteImage = (target, buf) => target.evaluate((b64) => {
  const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([u8], 'p.png', { type: 'image/png' }));
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
}, buf.toString('base64'));

test('管理員：進入是已排程／已發佈；新增發文彈出、膠囊、排程時間小視窗、送出、改時間、取消、刪除', async () => {
  const { page, errors, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  assert.equal(await page.locator('#fbpostOff').isVisible(), false);
  assert.match(await page.textContent('.fp-head .pill.warn'), /測試模式（僅管理員）/);
  assert.deepEqual(await page.locator('#tabs [data-tab]').allTextContents(), ['已排程', '已發佈']);
  assert.equal(await page.isVisible('#tab-sched'), true, '預設是已排程');
  assert.equal(await page.isHidden('#postDlg'), true);

  await openPost(page);
  assert.equal(await page.locator('#sendBtn').isDisabled(), true);
  // 膠囊：點左半勾選；右半顯示立即
  await page.click(chip(111) + ' .chip-l');
  assert.match(await page.getAttribute(chip(111), 'class'), /\bon\b/);
  assert.equal((await page.textContent(chip(111) + ' .chip-r')).trim(), '立即 ▾');
  await page.click(chip(222) + ' .chip-l');
  assert.equal(await page.textContent('#sendBtn'), '全部送出（2 個粉專）');
  // 送出文字在按鈕裡上下左右置中
  const off = await page.$eval('#sendBtn', (b) => {
    const r = document.createRange(); r.selectNodeContents(b);
    const t = r.getBoundingClientRect(), o = b.getBoundingClientRect();
    return [Math.abs((t.left + t.right) / 2 - (o.left + o.right) / 2), Math.abs((t.top + t.bottom) / 2 - (o.top + o.bottom) / 2)];
  });
  assert.ok(off[0] <= 1 && off[1] <= 1, '置中偏差 ' + off);

  // 排程時間小視窗：切排程 → 打 4 碼 → ↑ 加 10 分
  await page.click(chip(222) + ' .chip-r');
  await page.waitForSelector('#timePop:not([hidden])');
  await page.click('#timePop [data-tp=sched]');
  const want = Math.ceil((Date.now() + 3 * 3600000) / 600000) * 600000;
  if (new Date(want).getDate() !== new Date().getDate()) await page.fill('#tpDate', `${new Date(want).getFullYear()}-${p2(new Date(want).getMonth() + 1)}-${p2(new Date(want).getDate())}`);
  await page.fill('#tpTime', '');
  await page.type('#tpTime', hm(want));
  assert.equal(await page.inputValue('#tpTime'), hm(want).slice(0, 2) + ':' + hm(want).slice(2), '4 碼自動補冒號');
  assert.match(await page.textContent(chip(222) + ' .chip-r'), new RegExp('排程 ' + hm(want).slice(0, 2) + ':' + hm(want).slice(2)));
  await page.press('#tpTime', 'ArrowUp');
  assert.match(await page.textContent(chip(222) + ' .chip-r'), new RegExp('排程 ' + hm(want + 600000).slice(0, 2) + ':' + hm(want + 600000).slice(2)));
  assert.match(await page.getAttribute('#tpHint', 'class'), /\bok\b/);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#timePop', { state: 'hidden' });
  assert.equal(await page.isVisible('#postDlg'), true, 'Esc 先關小視窗，不關彈出視窗');

  await pasteImage(page, fakeAsset());
  await page.waitForSelector('#cvEmpty', { state: 'hidden' });
  await page.fill('#msg', '測試貼文');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-new-desktop.png') });
  await page.click('#sendBtn');
  await page.waitForSelector('#results li');
  assert.equal(api.posts.length, 1);
  const body = api.posts[0];
  const targets = JSON.parse(/name="targets"\r\n\r\n([^\r]*)\r\n/.exec(body)[1]);
  assert.deepEqual(targets[0], { page: '111', at: null });
  assert.equal(targets[1].page, '222');
  assert.equal(targets[1].at, Math.floor((want + 600000) / 1000));
  assert.match(body, /name="message"\r\n\r\n測試貼文/);
  assert.match(body, /name="image"; filename="fbpost\.png"/);
  const rows = await page.locator('#results li').allTextContents();
  assert.match(rows[0], /新聞：發布成功；已留言/);
  assert.match(rows[1], /娛樂：失敗（臉書拒絕）/);
  assert.equal(await page.locator('#doneDlg').evaluate((d) => d.open), false, '有粉專失敗：不跳完成視窗、不清空');
  assert.equal(api.rundown.length, 0, 'RD 預設關');

  // 關閉後內容保留
  await page.keyboard.press('Escape');
  await page.waitForSelector('#postDlg', { state: 'hidden' });
  await page.click('#newBtn');
  assert.equal(await page.inputValue('#msg'), '測試貼文');
  await page.click('#dlgClose');

  // 已排程
  await page.click('#schedReload');
  await page.waitForSelector('#schedList li img.thumb[src]');
  assert.ok((await page.textContent('#schedList .body div')).length <= 60);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-sched-desktop.png') });
  await page.click('#schedList li >> text=改時間');
  const at = Math.floor(Date.now() / 1000) + 3 * 3600;
  const d = new Date(at * 1000);
  await page.fill('#schedList .edit input', `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`);
  await page.click('#schedList >> text=確認改時間');
  await page.waitForFunction(() => document.getElementById('schedHint').textContent.includes('共'));
  assert.equal(api.reschedules.length, 1);
  assert.ok(Math.abs(api.reschedules[0].at - at) <= 60);
  await page.click('#schedList li >> text=取消');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfNo');
  assert.equal(api.cancels.length, 0);
  await page.click('#schedList li >> text=取消');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfYes');
  await page.waitForFunction(() => document.getElementById('schedHint').textContent.includes('共'));
  assert.deepEqual(api.cancels, [{ page: '111' }]);

  // 已發佈
  await page.click('#tabs [data-tab=pub]');
  await page.click('#pubReload');
  await page.waitForSelector('#pubList li');
  assert.match(await page.textContent('#pubList .noimg'), /無圖/);
  assert.equal(await page.getAttribute('#pubList a', 'target'), '_blank');
  await page.click('#pubList li >> text=刪除');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfYes');
  await page.waitForFunction(() => !document.querySelector('#pubList li'));
  assert.deepEqual(api.deletes, [{ page: '111' }]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('管理員：排程時間超出範圍顯示紅字、不送出', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.fill('#msg', 'x');
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(111) + ' .chip-r');
  await page.click('#timePop [data-tp=sched]');
  await page.fill('#tpDate', '2020-01-01');
  await page.dispatchEvent('#tpDate', 'change');
  assert.match(await page.textContent('#tpHint'), /至少要晚 10 分鐘/);
  assert.match(await page.getAttribute(chip(111) + ' .chip-r', 'class'), /\bbad\b/);
  await page.keyboard.press('Escape');
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendErr'), /新聞：排程至少要晚 10 分鐘/);
  assert.equal(api.posts.length, 0);
  await page.close();
});

test('排程時間快捷：+30 分、+1 小時、明天', async () => {
  const { page } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(111) + ' .chip-r');
  await page.click('#timePop [data-tp=sched]');
  const read = () => page.evaluate(() => new Date(document.getElementById('tpDate').value + 'T' + document.getElementById('tpTime').value).getTime());
  const t0 = await read();
  await page.click('#timePop [data-q="30"]');
  assert.equal(await read(), t0 + 30 * 60000);
  await page.click('#timePop [data-q="60"]');
  assert.equal(await read(), t0 + 90 * 60000);
  await page.click('#timePop [data-q=tomorrow]');
  const t1 = new Date(t0 + 90 * 60000); t1.setDate(t1.getDate() + 1);
  assert.equal(await read(), t1.getTime());
  await page.close();
});

test('排入 RD：開關記住、SLUG 留空取標題（斜線後前 4 字）、只寫有 RD 區段的粉專', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  assert.equal(await page.isChecked('#rdOn'), false);
  assert.equal(await page.isDisabled('#rdSlug'), true);
  const lbl = await page.locator('.rd-lbl').boundingBox(), slugBox = await page.locator('#rdSlug').boundingBox();
  assert.ok(lbl.x + lbl.width <= slugBox.x, `「排入 RD」與 SLUG 框不能重疊：${lbl.x + lbl.width} > ${slugBox.x}`);
  assert.ok(slugBox.height >= 36, 'SLUG 框有輸入框樣式（高度）');
  await page.click('.rd-switch');
  assert.equal(await page.isChecked('#rdOn'), true);
  await page.fill('#link', 'https://news.tvbs.com.tw/sports/4051394');
  await page.fill('#title', '快訊／蔣萬安激戰沈伯洋\nTVBS封關民調出爐！');
  await page.fill('#msg', 'm');
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(333) + ' .chip-l');
  const before = Date.now();
  await page.click('#sendBtn');
  await page.waitForSelector('#cfDlg[open]');   // 沒附圖、國際沒設定文字 UTM → 先提醒
  await page.click('#cfYes');
  await page.waitForSelector('#doneDlg[open]');
  await page.waitForFunction(() => /RD 主粉/.test(document.getElementById('doneList').textContent));
  assert.equal(await page.isHidden('#doneRd'), true, 'RD 寫入成功不顯示提醒');
  assert.equal(api.rundown.length, 1);
  const [e] = api.rundown[0].entries;
  assert.equal(api.rundown[0].entries.length, 1, '國際沒有 RD 區段、娛樂沒勾，只寫新聞');
  assert.equal(e.page, 'news');
  assert.equal(e.text, '4051394/圖文/蔣萬安激');
  const d = new Date(before);
  assert.equal(e.date, `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
  assert.match(await page.textContent('#doneList'), /RD 主粉 \d\d:\d\d → AE255（插入）/);
  // 再發一則：手填 SLUG 只留文字數字
  await page.click('#doneAgain');
  await page.fill('#link', 'https://news.tvbs.com.tw/sports/4051394');
  await page.fill('#msg', 'm');
  await page.click(chip(111) + ' .chip-l');
  await page.fill('#rdSlug', '秋冬 衣櫃！');
  await page.click('#sendBtn');
  for (let i = 0; i < 50 && api.rundown.length < 2; i++) await page.waitForTimeout(100);
  assert.equal(api.rundown[1].entries[0].text, '4051394/圖文/秋冬衣櫃');
  // 重新整理後開關還記得
  await page.reload();
  await openPost(page);
  assert.equal(await page.isChecked('#rdOn'), true);
  await page.close();
});

test('清空：確認後清掉內容與勾選，留言內容清空', async () => {
  const { page } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.fill('#msg', '要清掉');
  await page.fill('#lead', '自訂');
  await page.click(chip(111) + ' .chip-l');
  await page.click('#clearBtn');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfYes');
  assert.equal(await page.inputValue('#msg'), '');
  assert.equal(await page.inputValue('#lead'), '', '留言內容清空（沒輸入＝預設文字）');
  assert.doesNotMatch(await page.getAttribute(chip(111), 'class'), /\bon\b/);
  assert.equal(await page.textContent('#sendBtn'), '全部送出（0 個粉專）');
  await page.close();
});

test('管理員手機 390px 無橫向捲動', async () => {
  const { page, errors } = await newPage('admin', { width: 390, height: 800 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.click('#schedReload');
  await page.waitForSelector('#schedList li');
  assert.ok((await overflow(page)) <= 0, '已排程：' + (await overflow(page)));
  await openPost(page);
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(111) + ' .chip-r');
  await page.click('#timePop [data-tp=sched]');
  await page.fill('#msg', '手機'.repeat(40));
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1234567890123456789');
  assert.ok((await overflow(page)) <= 0, '新增發文：' + (await overflow(page)));
  const box = await page.locator('#timePop').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, '小視窗不超出畫面');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-new-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});

test('管理員但臉書 token 有問題：停用頁顯示原因', async () => {
  const { page, errors } = await newPage('tokenbad', { width: 390, height: 700 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.locator('#offReason').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#offReason'), /token 無效或過期/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('已排程列表的留言狀態顯示中文', async () => {
  const { page } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.locator('#fbpostApp').waitFor({ state: 'visible' });
  await page.click('#schedReload');
  await page.waitForSelector('img[src^="data:"]');
  const txt = await page.locator('#fbpostApp').textContent();
  assert.match(txt, /留言：等待補留言/);
  assert.doesNotMatch(txt, /pending/);
  await page.close();
});

test('第 2、3 則留言：新增、選活動留言帶入可改、距上一則、最多 3 則、刪除重新編號、送出', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.fill('#msg', 'm');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.click(chip(111) + ' .chip-l');
  await page.click('#addComment');
  const b1 = '#extras .extra:nth-child(1)';
  assert.match(await page.textContent(b1 + ' .extra-title'), /第 2 則留言/);
  assert.equal(await page.inputValue(b1 + ' select.preset'), '', '預設自行輸入');
  assert.equal(await page.inputValue(b1 + ' select.delay'), '5', '預設距上一則 5 分鐘');
  await page.selectOption(b1 + ' select.preset', { label: '活動：雙11抽獎' });
  assert.equal(await page.inputValue(b1 + ' textarea'), '留言＋分享抽 AirPods！\nhttps://example.com/a');
  await page.fill(b1 + ' textarea', '留言＋分享抽 AirPods！（改過）');
  await page.click('#addComment');
  assert.equal(await page.isDisabled('#addComment'), true, '最多 3 則');
  const b2 = '#extras .extra:nth-child(2)';
  assert.match(await page.textContent(b2 + ' .extra-title'), /第 3 則留言/);
  await page.selectOption(b2 + ' select.delay', '10');
  // 空白不能送
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendErr'), /第 3 則留言沒有內容/);
  assert.equal(api.posts.length, 0);
  // 刪掉第 2 則 → 原本第 3 則變第 2 則
  await page.fill(b2 + ' textarea', '第三則內容');
  await page.click(b1 + ' .extra-del');
  assert.equal(await page.locator('#extras .extra').count(), 1);
  assert.match(await page.textContent(b1 + ' .extra-title'), /第 2 則留言/);
  assert.equal(await page.isDisabled('#addComment'), false);
  await page.click('#sendBtn');
  await page.waitForSelector('#doneList li');
  const body = api.posts[0];
  assert.deepEqual(JSON.parse(/name="comments"\r\n\r\n([^\r]*)\r\n/.exec(body)[1]), [{ message: '第三則內容', delay: 10 }]);
  await page.close();
});

test('全部成功：跳送出完成，再發一則清空並留在視窗；返回列表關視窗回已排程、不自動查詢', async () => {
  const { page, api, fbCalls, errors } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.click('#tabs [data-tab=pub]');
  await openPost(page);
  const fill = async (msg) => {
    await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
    await page.fill('#msg', msg);
    await page.click(chip(111) + ' .chip-l');
  };
  await fill('第一則');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.match(await page.textContent('#doneList'), /新聞：發布成功；已留言/);
  assert.equal(await page.isHidden('#doneRd'), true, '沒開 RD 不顯示提醒');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-done.png') });
  // Esc 不關（一定要選），底下新增發文視窗也不關
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#doneDlg').evaluate((d) => d.open), true);
  assert.equal(await page.isVisible('#postDlg'), true);
  // 頁面已清空
  assert.equal(await page.inputValue('#msg'), '');
  assert.equal(await page.inputValue('#link'), '');
  assert.equal(await page.textContent('#results'), '');
  assert.doesNotMatch(await page.getAttribute(chip(111), 'class'), /\bon\b/);
  await page.click('#doneAgain');
  assert.equal(await page.locator('#doneDlg').evaluate((d) => d.open), false);
  assert.equal(await page.isVisible('#postDlg'), true, '再發一則：留在新增發文');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'link');
  await fill('第二則');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 2);
  const before = fbCalls.filter((p) => p === '/fb/scheduled').length;
  await page.click('#doneBack');
  await page.waitForSelector('#postDlg', { state: 'hidden' });
  assert.equal(await page.isVisible('#tab-sched'), true, '回到已排程');
  assert.equal(await page.getAttribute('#tabs [data-tab=sched]', 'aria-selected'), 'true');
  await page.waitForTimeout(200);
  assert.equal(fbCalls.filter((p) => p === '/fb/scheduled').length, before, '不自動查詢');
  // 再打開新增發文是空的
  await page.click('#newBtn');
  assert.equal(await page.inputValue('#msg'), '');
  assert.deepEqual(errors, []);
  await page.close();
});

test('RD 寫入失敗：仍跳完成視窗，提醒並可一鍵複製 RD 格式', async () => {
  const { page, errors } = await newPage('admin', undefined, { rdFail: true });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('.rd-switch');
  await page.fill('#rdSlug', '我是測試');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/4320000');
  await page.fill('#msg', 'm');
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(await page.isVisible('#doneRd'), true);
  assert.match(await page.textContent('#doneRdMsg'), /RD 沒寫進去/);
  assert.equal((await page.textContent('#doneRdText')).trim(), '4320000/圖文/我是測試');
  assert.match(await page.textContent('#doneRdWhere'), /^主粉 \d\d:\d\d$/);
  assert.match(await page.textContent('#doneList'), /RD 主粉：失敗（找不到時段）/);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-done-rdfail.png') });
  await page.click('#doneRdCopy');
  await page.waitForFunction(() => document.getElementById('doneRdText').textContent === '已複製');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '4320000/圖文/我是測試');
  await page.waitForFunction(() => document.getElementById('doneRdText').textContent === '4320000/圖文/我是測試', null, { timeout: 3000 });
  assert.deepEqual(errors, []);
  await page.close();
});

test('RD 沒有文章 ID：完成視窗只顯示原因、沒有複製按鈕', async () => {
  const { page } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('.rd-switch');
  await page.fill('#link', 'https://example.com/abc');
  await page.fill('#msg', 'm');
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.match(await page.textContent('#doneRdMsg'), /沒有文章 ID/);
  assert.equal(await page.isHidden('#doneRdCopy'), true);
  await page.close();
});

test('文章網址必填：沒填按送出會提示、不送出', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  assert.match(await page.textContent('label[for=link]'), /必填/);
  await page.fill('#msg', 'm');
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendErr'), /請貼上文章網址/);
  assert.equal(api.posts.length, 0);
  await page.close();
});

test('舊版版面：1280×800 與窄寬度下，新增發文底列（粉專、送出）都在畫面內', async () => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 400, height: 760 }]) {
    const { page } = await newPage('admin', viewport);
    await page.goto(srv.url + 'tools/fbpost/index.html');
    await openPost(page);
    for (const sel of ['#pages .chip', '#sendBtn', '#clearBtn', '#rdOn + .track']) {
      const box = await page.locator(sel).first().boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height + 0.5, `${viewport.width}px：${sel} 在畫面內`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '沒有橫向捲動');
    await page.close();
  }
});
