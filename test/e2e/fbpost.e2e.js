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
const PAGES = [{ id: '111', short: '新聞', order: 1 }, { id: '222', short: '娛樂', order: 2 }, { id: '333', short: '國際', order: 3 }];
const SHOT = process.env.SHOT_DIR;

// mode: 'admin' | 'company'（無 admin）| 'denied'（401）
async function newPage(mode, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const errors = [], fbCalls = [], api = { posts: [], reschedules: [], cancels: [], deletes: [] };
  const soon = Math.floor(Date.now() / 1000) + 7200;
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    const json = (data, status = 200) => r.fulfill({ status, headers: CORS, json: status === 200 ? { ok: true, data } : data });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (p.startsWith('/fb/')) fbCalls.push(p);
    if (p === '/auth/status') {
      if (mode === 'denied') return json({ ok: false, code: 'unauthorized', error: '請先登入' }, 401);
      return json(mode === 'admin' ? { company: true, exp: soon, admin: true } : { company: true, exp: soon });
    }
    if (p === '/fb/pages') return json(PAGES);
    if (p === '/fb/post') {
      const body = req.postData() || '';
      api.posts.push(body);
      const targets = JSON.parse(/name="targets"\r\n\r\n([^\r]*)\r\n/.exec(body)[1]);
      return json({ results: targets.map((t, i) => (i === 1
        ? { page: t.page, ok: false, scheduled: false, comment: 'none', error: '臉書拒絕' }
        : { page: t.page, ok: true, postId: t.page + '_9', scheduled: t.at != null, at: t.at ?? undefined, comment: t.at != null ? 'armed' : 'done' })) });
    }
    if (p === '/fb/scheduled') return json([{ id: '111_7', message: '排好的貼文'.repeat(20), at: soon, picture: 'data:image/png;base64,' + fakeAsset().toString('base64'), comment: { status: 'pending' } }]);
    if (p === '/fb/published') return json({ items: [{ id: '111_5', message: '已發的貼文', time: new Date().toISOString(), picture: null, url: 'https://www.facebook.com/111/posts/5', comment: 'done' }], next: null });
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
  test(`非管理員（${mode}）只顯示功能停用，不呼叫 /fb/*`, async () => {
    const { page, errors, fbCalls } = await newPage(mode, { width: 390, height: 700 });
    await page.goto(srv.url + 'tools/fbpost/index.html');
    const box = page.locator('#fbpostOff');
    await box.waitFor();
    assert.match(await box.textContent(), /排程發布 功能停用/);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#fbpostApp').isVisible(), false);
    assert.deepEqual(fbCalls, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

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

test('管理員：三個分頁、送出 targets、結果列、已排程縮圖、改時間、取消確認', async () => {
  const { page, errors, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden]) #pages li');
  assert.equal(await page.locator('#fbpostOff').isVisible(), false);
  assert.match(await page.textContent('.pill.warn'), /測試模式（僅管理員）/);
  assert.deepEqual(await page.locator('#tabs [data-tab]').allTextContents(), ['新增發文', '已排程', '已發佈']);
  assert.equal(await page.locator('#sendBtn').isDisabled(), true);

  // 預設排程時間約現在＋30 分鐘，min／max 在範圍內
  await page.click('#pages li[data-page="222"] [data-m=sched]');
  const attrs = await page.$eval('#pages li[data-page="222"] input[type=datetime-local]', (i) => ({ v: i.value, min: i.min, max: i.max }));
  assert.ok(attrs.min < attrs.v && attrs.v < attrs.max);

  await page.setInputFiles('#img', { name: 'p.png', mimeType: 'image/png', buffer: fakeAsset() });
  await page.waitForSelector('#imgPrev:not([hidden])');
  await page.fill('#msg', '測試貼文');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.check('#pages li[data-page="111"] input[type=checkbox]');
  await page.check('#pages li[data-page="222"] input[type=checkbox]');
  assert.equal(await page.textContent('#sendBtn'), '全部送出（2 個粉專）');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-new-desktop.png') });
  await page.click('#sendBtn');
  await page.waitForSelector('#results li');
  assert.equal(api.posts.length, 1);
  const body = api.posts[0];
  const targets = JSON.parse(/name="targets"\r\n\r\n([^\r]*)\r\n/.exec(body)[1]);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets[0], { page: '111', at: null });
  assert.equal(targets[1].page, '222');
  assert.ok(Number.isInteger(targets[1].at) && targets[1].at < 1e11, '排程時間是秒');
  assert.match(body, /name="message"\r\n\r\n測試貼文/);
  assert.match(body, /name="link"\r\n\r\nhttps:\/\/news\.tvbs\.com\.tw\/life\/1/);
  assert.match(body, /name="image"; filename="p\.png"/);
  const rows = await page.locator('#results li').allTextContents();
  assert.match(rows[0], /新聞：發布成功；已留言/);
  assert.match(rows[1], /娛樂：失敗（臉書拒絕）/);

  await page.click('#tabs [data-tab=sched]');
  assert.equal(await page.locator('#tab-new').isHidden(), true);
  await page.click('#schedReload');
  await page.waitForSelector('#schedList li img.thumb[src]');
  assert.ok((await page.textContent('#schedList .body div')).length <= 60);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-sched-desktop.png') });

  await page.click('#schedList li >> text=改時間');
  const at = Math.floor(Date.now() / 1000) + 3 * 3600;
  const d = new Date(at * 1000), p2 = (n) => String(n).padStart(2, '0');
  await page.fill('#schedList .edit input', `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`);
  await page.click('#schedList >> text=確認改時間');
  await page.waitForFunction(() => document.getElementById('schedHint').textContent.includes('共'));
  assert.equal(api.reschedules.length, 1);
  assert.equal(api.reschedules[0].page, '111');
  assert.ok(Math.abs(api.reschedules[0].at - at) <= 60);

  // 取消：先跳確認，按返回不送，確定才送
  await page.click('#schedList li >> text=取消');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfNo');
  assert.equal(api.cancels.length, 0);
  await page.click('#schedList li >> text=取消');
  await page.waitForSelector('#cfDlg[open]');
  assert.equal(api.cancels.length, 0, '確認前不能送出');
  await page.click('#cfYes');
  await page.waitForFunction(() => document.getElementById('schedHint').textContent.includes('共'));
  assert.deepEqual(api.cancels, [{ page: '111' }]);

  // 已發佈：無圖、開啟連結、刪除要確認
  await page.click('#tabs [data-tab=pub]');
  await page.click('#pubReload');
  await page.waitForSelector('#pubList li');
  assert.match(await page.textContent('#pubList .noimg'), /無圖/);
  assert.equal(await page.getAttribute('#pubList a', 'target'), '_blank');
  await page.click('#pubList li >> text=刪除');
  await page.waitForSelector('#cfDlg[open]');
  assert.equal(api.deletes.length, 0);
  await page.click('#cfYes');
  await page.waitForFunction(() => !document.querySelector('#pubList li'));
  assert.deepEqual(api.deletes, [{ page: '111' }]);

  // 切回新增發文，內容還在
  await page.click('#tabs [data-tab=new]');
  assert.equal(await page.inputValue('#msg'), '測試貼文');
  assert.deepEqual(errors, []);
  await page.close();
});

test('管理員：排程時間超出範圍不送出', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#pages li');
  await page.fill('#msg', 'x');
  await page.check('#pages li[data-page="111"] input[type=checkbox]');
  await page.click('#pages li[data-page="111"] [data-m=sched]');
  await page.fill('#pages li[data-page="111"] input[type=datetime-local]', '2020-01-01T00:00');
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendErr'), /10 分鐘到 30 天/);
  assert.equal(api.posts.length, 0);
  await page.close();
});

test('管理員手機 390px 無橫向捲動', async () => {
  const { page, errors } = await newPage('admin', { width: 390, height: 800 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#pages li');
  await page.click('#pages li[data-page="111"] [data-m=sched]');
  await page.check('#pages li[data-page="111"] input[type=checkbox]');
  await page.fill('#msg', '手機'.repeat(40));
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1234567890123456789');
  assert.ok((await overflow(page)) <= 0, '新增發文：' + (await overflow(page)));
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-new-mobile.png'), fullPage: true });
  await page.click('#tabs [data-tab=sched]');
  await page.click('#schedReload');
  await page.waitForSelector('#schedList li');
  assert.ok((await overflow(page)) <= 0, '已排程：' + (await overflow(page)));
  await page.click('#tabs [data-tab=pub]');
  await page.click('#pubReload');
  await page.waitForSelector('#pubList li');
  assert.ok((await overflow(page)) <= 0, '已發佈：' + (await overflow(page)));
  assert.deepEqual(errors, []);
  await page.close();
});
