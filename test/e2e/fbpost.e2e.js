// 排程發布（測試版）：以 page.route 模擬後端，不打真的臉書。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { fakeAsset, API_BASE, presetDuty } = require('../helpers/tool-page.js');

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
  const errors = [], fbCalls = [], api = { posts: [], reschedules: [], cancels: [], deletes: [], rundown: [], retries: [] };
  const soon = Math.floor(Date.now() / 1000) + 7200;
  page.on('pageerror', (e) => errors.push(String(e)));
  if (opts.duty !== false) await presetDuty(page, opts.duty || []);
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    const json = (data, status = 200) => r.fulfill({ status, headers: CORS, json: status === 200 ? { ok: true, data } : data });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (p.startsWith('/fb/') && p !== '/fb/open') fbCalls.push(p);   // /fb/open＝首頁查開放狀態（不需登入）
    if (p === '/auth/status') {
      if (mode === 'denied') return json({ ok: false, code: 'unauthorized', error: '請先登入' }, 401);
      if (mode === 'needStaff') return json({ company: true, exp: soon });
      return json(mode === 'admin' || mode === 'tokenbad' ? { company: true, exp: soon, admin: true } : { company: true, exp: soon });   // closedReason／companyOpen＝一般公司帳號
    }
    if (mode === 'needStaff' && p.startsWith('/fb/')) return json({ ok: false, code: 'fb_need_staff', error: '排程發布需要用員工編號登入。' }, 403);
    if (p === '/fb/me' && opts.me) return json(opts.me);
    // 開放範圍：company＝只開放管理員時的公司帳號（403）；companyOpen＝已開放給公司帳號
    if ((mode === 'company' || mode === 'closedReason') && p.startsWith('/fb/')) return json({ ok: false, code: 'fb_forbidden', error: '排程發布目前關閉。', detail: { reason: mode === 'closedReason' ? '臉書權杖更換中' : '' } }, 403);
    if (p === '/fb/access') return json({ mode: mode === 'companyOpen' ? 'company' : 'admin' });
    if (p === '/fb/pages') return mode === 'tokenbad' ? json({ ok: false, code: 'fb_token', error: '臉書 token 無效或過期。' }, 502) : json(PAGES);
    if (p === '/fb/post') {
      const body = req.postData() || '';
      api.posts.push(body);
      if (opts.postDelay) await new Promise((res) => setTimeout(res, opts.postDelay));
      const targets = JSON.parse(/name="targets"\r\n\r\n([^\r]*)\r\n/.exec(body)[1]);
      if (opts.post) return json(opts.post(targets, body));
      return json({ results: targets.map((t) => (t.page === '222'   // 替身後端：娛樂一定失敗
        ? { page: t.page, ok: false, scheduled: false, comment: 'none', error: '臉書拒絕' }
        : { page: t.page, ok: true, postId: t.page + '_9', scheduled: t.at != null, at: t.at ?? undefined, comment: t.at != null ? 'armed' : 'done' })) });
    }
    if (p === '/fb/scheduled') api.schedQs = [...(api.schedQs || []), u.search];
    if (p === '/fb/scheduled' && opts.schedFn) return json(opts.schedFn(u));
    if (p === '/fb/scheduled' && opts.sched) return json(opts.sched);
    if (p === '/fb/scheduled') return json([{ id: '111_7', message: '排好的貼文'.repeat(20), at: soon, picture: 'data:image/png;base64,' + fakeAsset().toString('base64'), comment: 'pending' }]);
    if (p === '/staff/me/notices' && opts.notices) { api.noticeCalls = (api.noticeCalls || 0) + 1; return json(typeof opts.notices === 'function' ? opts.notices() : opts.notices); }
    if (p === '/fb/published') api.pubPages = [...(api.pubPages || []), u.searchParams.get('page')];
    if (p === '/fb/comment/retry') { api.retries.push(JSON.parse(req.postData() || '{}')); return opts.retryFail ? json({ ok: false, code: 'bad_request', error: '沒有失敗的留言' }, 400) : json({ ok: true }); }
    if (p === '/fb/published' && opts.pubFn) return json(opts.pubFn(u));
    if (p === '/fb/published' && opts.pub) return json({ items: opts.pub, next: null });
    if (p === '/fb/published') return json({ items: [{ id: '111_5', message: '已發的貼文', time: new Date().toISOString(), picture: null, url: 'https://www.facebook.com/111/posts/5', comment: 'done' }], next: null });
    let ms = /^\/fb\/posts\/([^/]+)\/source$/.exec(p);
    if (ms) { api.sources = [...(api.sources || []), { id: decodeURIComponent(ms[1]), page: u.searchParams.get('page') }]; return opts.source ? (typeof opts.source === 'function' ? opts.source() : json(opts.source)) : json({ message: '', link: '', images: [], imageFailed: false }); }
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
  test(`關閉時，公司帳號（${mode}）只顯示功能停用`, async () => {
    const { page, errors, fbCalls } = await newPage(mode, { width: 390, height: 700 });
    await page.goto(srv.url + 'tools/fbpost/index.html');
    const box = page.locator('#fbpostOff');
    await box.waitFor();
    assert.match(await box.textContent(), /排程發布 功能停用/);
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#fbpostApp').isVisible(), false);
    assert.deepEqual(fbCalls, mode === 'company' ? ['/fb/pages'] : [], '公司帳號只問一次 /fb/pages（403），沒登入不問');
    assert.equal(await page.isHidden('#offReason'), true, '沒填關閉原因不顯示');
    assert.deepEqual(errors, []);
    await page.close();
  });
}

test('關閉且有填原因：公司帳號的停用頁顯示原因', async () => {
  const { page, errors } = await newPage('closedReason');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#offReason:not([hidden])');
  assert.equal(await page.textContent('#offReason'), '原因：臉書權杖更換中');
  assert.equal(await page.locator('#fbpostApp').isVisible(), false);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-closed.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

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
  await page.fill('#title', '只有文字');
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

test('送出中按鈕轉圈（aria-busy）、完成後恢復', async () => {
  const { page } = await newPage('admin', undefined, { postDelay: 600 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#title', '只有文字');
  await page.evaluate(() => { document.getElementById('link').value = 'https://news.tvbs.com.tw/life/1'; });
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForSelector('#sendBtn[aria-busy="true"]');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fx-fbpost-sending.png') });
  assert.match(await page.textContent('#sendBtn'), /送出中（1 個粉專）/);
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(await page.getAttribute('#sendBtn', 'aria-busy'), null);
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
// 選套版沒照片不能送出：送出前若還在選套版又沒照片，貼一張假圖
async function withPhoto(page) {
  const img = await page.getAttribute('#modeSeg [data-mode=image]', 'aria-pressed');
  if (img !== 'true' || await page.isHidden('#cvEmpty')) return;
  await pasteImage(page, fakeAsset());
  await page.waitForSelector('#cvEmpty', { state: 'hidden' });
}
async function openPost(page) {
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.click('#newBtn');   // 第一次開啟才載入做圖模組，按鈕先顯示「載入中…」
  await page.waitForSelector('#postDlg:not([hidden])');
  await page.waitForSelector('#pages .chip', { state: 'attached' });
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

  // 右半先跳小選單（立即發布／排程發布…），目前是立即 → 「立即發布」標示
  await page.click(chip(222) + ' .chip-r');
  await page.waitForSelector('#tpMenu:not([hidden])');
  assert.equal(await page.isHidden('#timePop'), true, '先跳選單，不直接開時間視窗');
  assert.deepEqual(await page.locator('#tpMenu [data-tp]').allTextContents(), ['立即發布', '排程發布…']);
  assert.equal(await page.getAttribute('#tpMenu [data-tp=now]', 'aria-checked'), 'true');
  assert.equal(await page.$eval('#tpMenu [data-tp=now]', (b) => b === document.activeElement), true, '焦點在目前選項');
  const mw = (await page.locator('#tpMenu').boundingBox()).width;
  assert.ok(mw < 160, '選單貼合文字寬度 ' + mw);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#tpMenu', { state: 'hidden' });
  assert.equal(await page.isVisible('#postDlg'), true, 'Esc 只關選單');
  // 排程發布… → 排程時間小視窗（沒有立即／排程切換）：打 4 碼 → ↑ 加 10 分
  await page.click(chip(222) + ' .chip-r');
  await page.click('#tpMenu [data-tp=sched]');
  await page.waitForSelector('#timePop:not([hidden])');
  assert.equal(await page.isHidden('#tpMenu'), true);
  assert.equal(await page.locator('#timePop [data-tp]').count(), 0, '視窗內沒有立即／排程切換');
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
  // 已排程再點右半：選單標示「排程發布…」；選「立即發布」切回立即
  await page.click(chip(222) + ' .chip-r');
  await page.waitForSelector('#tpMenu:not([hidden])');
  assert.equal(await page.getAttribute('#tpMenu [data-tp=sched]', 'aria-checked'), 'true');
  await page.click('#tpMenu [data-tp=now]');
  await page.waitForSelector('#tpMenu', { state: 'hidden' });
  assert.equal((await page.textContent(chip(222) + ' .chip-r')).trim(), '立即 ▾');
  await page.click(chip(222) + ' .chip-r');
  await page.click('#tpMenu [data-tp=sched]');
  await page.keyboard.press('Escape');

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
  // 列表一列：內容一行截斷、相片．粉專．留言、編輯（即將推出）／改時間／刪除、時間欄
  assert.equal(await page.$eval('#schedList .msg', (e) => getComputedStyle(e).whiteSpace), 'nowrap');
  assert.match(await page.$eval('#schedList .meta', (m) => m.querySelector('.kind').textContent + m.querySelector('.cm').textContent), /^相片．新聞．留言：/);
  assert.deepEqual(await page.$$eval('#schedList li:first-child .acts button', (b) => b.map((x) => [x.textContent, x.disabled])), [['編輯', true], ['再發一次', true], ['改時間', false], ['刪除', false]]);
  assert.match(await page.textContent('#schedList .when'), /^\d+月\d+日 \d\d:\d\d$/);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-sched-desktop.png') });
  await page.click('#schedList li >> text=改時間');
  const at = Math.floor(Date.now() / 1000) + 3 * 3600;
  const d = new Date(at * 1000);
  await page.fill('#schedList .edit input', `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`);
  await page.click('#schedList >> text=確認改時間');
  await page.waitForFunction(() => document.getElementById('schedHint').textContent.includes('共'));
  assert.equal(api.reschedules.length, 1);
  assert.ok(Math.abs(api.reschedules[0].at - at) <= 60);
  await page.click('#schedList li .acts >> text=刪除');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfNo');
  assert.equal(api.cancels.length, 0);
  await page.click('#schedList li .acts >> text=刪除');
  await page.waitForSelector('#cfDlg[open]');
  const liBefore = await page.locator('#schedList li').count();
  await page.click('#cfYes');
  await page.waitForFunction((n) => document.querySelectorAll('#schedList li').length === n, liBefore - 1);
  assert.deepEqual(api.cancels, [{ page: '111' }]);

  // 已發佈
  await page.click('#tabs [data-tab=pub]');
  await page.click('#pubReload');
  await page.waitForSelector('#pubList li');
  assert.match(await page.textContent('#pubList .noimg'), /無圖/);
  assert.equal(await page.getAttribute('#pubList a', 'target'), '_blank');
  // 預覽：點一下轉半透明並出現開新分頁圖示，按圖示才打開；已發佈沒有改時間
  assert.equal(await page.isVisible('#pubList .pv-open'), false);
  await page.click('#pubList .pv-arm');
  assert.equal(await page.isVisible('#pubList .pv-open'), true);
  assert.equal(await page.getAttribute('#pubList .pv-arm', 'aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#pubList .pv-open'), false);
  assert.deepEqual(await page.$$eval('#pubList li:first-child .acts button', (b) => b.map((x) => x.textContent)), ['編輯', '再發一次', '幫直出', '刪除']);
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
  await page.click('#tpMenu [data-tp=sched]');
  await page.fill('#tpDate', '2020-01-01');
  await page.dispatchEvent('#tpDate', 'change');
  assert.match(await page.textContent('#tpHint'), /至少要晚 10 分鐘/);
  assert.match(await page.getAttribute(chip(111) + ' .chip-r', 'class'), /\bbad\b/);
  await page.keyboard.press('Escape');
  await withPhoto(page);
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
  await page.click('#tpMenu [data-tp=sched]');
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
  await withPhoto(page);
  await page.click('#sendBtn');   // 有附圖 → 用圖文 UTM，不提醒文字 UTM
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
  await withPhoto(page);
  await page.click('#sendBtn');
  for (let i = 0; i < 50 && api.rundown.length < 2; i++) await page.waitForTimeout(100);
  assert.equal(api.rundown[1].entries[0].text, '4051394/圖文/秋冬衣櫃');
  // 純文字：寫「文字」
  await page.waitForSelector('#doneDlg[open]');
  await page.click('#doneAgain');
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#link', 'https://news.tvbs.com.tw/sports/4051394');
  await page.fill('#title', '純文字貼文');
  await page.click(chip(111) + ' .chip-l');
  await page.fill('#rdSlug', '純文字');
  await withPhoto(page);
  await page.click('#sendBtn');
  for (let i = 0; i < 50 && api.rundown.length < 3; i++) await page.waitForTimeout(100);
  assert.equal(api.rundown[2].entries[0].text, '4051394/文字/純文字');
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
  await page.click('#tpMenu [data-tp=sched]');
  await page.fill('#msg', '手機'.repeat(40));
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1234567890123456789');
  assert.ok((await overflow(page)) <= 0, '新增發文：' + (await overflow(page)));
  const box = await page.locator('#timePop').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, '小視窗不超出畫面');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-new-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});

test('管理員手機 320px 無橫向捲動，粉專膠囊與送出鈕可按（≥44px）', async () => {
  const { page, errors } = await newPage('admin', { width: 320, height: 700 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.click('#schedReload');
  await page.waitForSelector('#schedList li');
  assert.ok((await overflow(page)) <= 0, '已排程：' + (await overflow(page)));
  await openPost(page);
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(111) + ' .chip-r');
  await page.fill('#msg', '手機'.repeat(40));
  assert.ok((await overflow(page)) <= 0, '新增發文：' + (await overflow(page)));
  const send = await page.locator('#sendBtn').boundingBox();
  assert.ok(send.height >= 44, '送出鈕高度 ' + send.height);
  const chipBox = await page.locator(chip(111)).boundingBox();
  assert.ok(chipBox.height >= 44, '粉專膠囊高度 ' + chipBox.height);
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
  await withPhoto(page);
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendErr'), /第 3 則留言沒有內容/);
  assert.equal(api.posts.length, 0);
  // 刪掉第 2 則 → 原本第 3 則變第 2 則
  await page.fill(b2 + ' textarea', '第三則內容');
  await page.click(b1 + ' .extra-del');
  assert.equal(await page.locator('#extras .extra').count(), 1);
  assert.match(await page.textContent(b1 + ' .extra-title'), /第 2 則留言/);
  assert.equal(await page.isDisabled('#addComment'), false);
  await withPhoto(page);
  await page.click('#sendBtn');
  await page.waitForSelector('#doneList li');
  const body = api.posts[0];
  assert.deepEqual(JSON.parse(/name="comments"\r\n\r\n([^\r]*)\r\n/.exec(body)[1]), [{ message: '第三則內容', delay: 10 }]);
  await page.close();
});

test('警語留言：選單多選（打勾）、再點拿掉、Esc 關閉；警語框可改；送出帶 warn；清空後消失', async () => {
  const { page, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.fill('#msg', 'm');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.click(chip(111) + ' .chip-l');
  assert.equal(await page.isHidden('#warnBox'), true, '沒選警語不顯示警語框');
  await page.click('#warnBtn');
  assert.equal(await page.getAttribute('#warnBtn', 'aria-expanded'), 'true');
  const opt = (w) => `.warn-opt[data-w="${w}"]`;
  await page.click(opt('💬珍愛生命請撥打1925'));
  await page.click(opt('▲危險動作，請勿模仿'));
  assert.equal(await page.getAttribute(opt('💬珍愛生命請撥打1925'), 'aria-checked'), 'true');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-warn-menu.png') });
  assert.equal(await page.inputValue('#warnText'), '💬珍愛生命請撥打1925\n▲危險動作，請勿模仿');
  assert.equal(await page.isVisible('#warnBox'), true);
  await page.click(opt('▲危險動作，請勿模仿'));
  assert.equal(await page.inputValue('#warnText'), '💬珍愛生命請撥打1925', '再點一次拿掉');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('.warn-menu'), true, 'Esc 關閉選單');
  assert.equal(await page.isVisible('#postDlg'), true, 'Esc 只關選單，不關新增發文');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'warnBtn', '焦點回按鈕');
  assert.equal(await page.inputValue('#msg'), 'm', '警語不放進貼文內容');
  if (SHOT) await page.locator('#warnBox').scrollIntoViewIfNeeded().then(() => page.screenshot({ path: path.join(SHOT, 'fbpost-warn-box.png') }));
  await withPhoto(page);
  await page.click('#sendBtn');
  await page.waitForSelector('#doneList li');
  assert.equal(/name="warn"\r\n\r\n([^\r]*)\r\n/.exec(api.posts[0])[1], '💬珍愛生命請撥打1925');
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
  await withPhoto(page);
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
  await withPhoto(page);
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
  await withPhoto(page);
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
  await withPhoto(page);
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
  await withPhoto(page);
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendErr'), /請貼上文章網址/);
  assert.equal(api.posts.length, 0);
  await page.close();
});

test('粉專膠囊一列左右滑：不換行、滾輪左右捲、右邊淡出提示還有', async () => {
  const { page } = await newPage('admin', { width: 300, height: 760 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.$eval('#pages', (el) => { el.style.maxWidth = '160px'; });   // 測試只有 3 個粉專，縮窄才放不下
  const r = await page.$eval('#pages', (el) => ({ rows: new Set([...el.children].map((c) => c.offsetTop)).size, over: el.scrollWidth > el.clientWidth, wrap: getComputedStyle(el).flexWrap }));
  assert.equal(r.rows, 1, '只有一排');
  assert.equal(r.wrap, 'nowrap');
  assert.ok(r.over, '放不下時可以左右滑');
  await page.waitForFunction(() => document.getElementById('pages').classList.contains('fade-r'));
  await page.hover('#pages');
  await page.mouse.wheel(0, 300);
  await page.waitForFunction(() => { const el = document.getElementById('pages'); return el.scrollLeft > 20 && el.classList.contains('fade-l'); });
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

test('U6：開視窗焦點在文章網址、背景 inert（Tab 不跑到背景）、關閉後還原；開頁不載做圖模組', async () => {
  const { page, errors } = await newPage('admin');
  const reqs = [];
  page.on('request', (r) => reqs.push(r.url()));
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.waitForTimeout(300);
  assert.equal(reqs.some((u) => /ui\/compose\/(render|fx|assets)\.js|titleedit\.js|news-article\.js/.test(u)), false, '開頁不載做圖模組');
  await openPost(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'link');
  assert.equal(await page.$eval('#fbpostApp', (e) => e.inert), true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('#postDlg')), true, 'Tab 沒跑到背景');
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#postDlg'), true);
  assert.equal(await page.$eval('#fbpostApp', (e) => e.inert), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('U7：換粉專自動讀一次、切回不重查；改時間、取消成功只更新該列、不重查', async () => {
  const { page, errors, fbCalls, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.waitForSelector('#schedList li');   // 進入自動讀第一個粉專
  const n0 = fbCalls.filter((c) => c === '/fb/scheduled').length;
  assert.equal(n0, 1, '進入自動讀一次');
  await page.selectOption('#schedPage', '222');
  await page.waitForSelector('#schedList li');
  assert.equal(fbCalls.filter((c) => c === '/fb/scheduled').length, n0 + 1, '換粉專自動讀一次');
  await page.selectOption('#schedPage', '111');
  await page.waitForSelector('#schedList li');
  await page.selectOption('#schedPage', '222');
  await page.waitForTimeout(200);
  assert.equal(fbCalls.filter((c) => c === '/fb/scheduled').length, n0 + 1, '切回讀過的粉專不重查');
  await page.click('#schedReload');
  await page.waitForTimeout(300);
  assert.equal(fbCalls.filter((c) => c === '/fb/scheduled').length, n0 + 2, '按刷新才重查');
  const n1 = fbCalls.filter((c) => c === '/fb/scheduled').length;
  const before = await page.getAttribute('#schedList li', 'data-at');
  await page.click('#schedList li >> text=改時間');
  const later = new Date(Date.now() + 5 * 3600 * 1000), z = (x) => String(x).padStart(2, '0');
  await page.fill('#schedList li input[type=datetime-local]', `${later.getFullYear()}-${z(later.getMonth() + 1)}-${z(later.getDate())}T${z(later.getHours())}:${z(later.getMinutes())}`);
  await page.click('#schedList li >> text=確認改時間');
  await page.waitForFunction((b) => document.querySelector('#schedList li').dataset.at !== b, before);
  assert.equal(api.reschedules.length, 1);
  assert.equal(fbCalls.filter((c) => c === '/fb/scheduled').length, n1, '改時間不重查');
  page.once('dialog', (d) => d.accept());
  await page.click('#schedList li .acts >> text=刪除');
  await page.click('#cfYes');
  await page.waitForFunction(() => !document.querySelector('#schedList li'));
  assert.equal(fbCalls.filter((c) => c === '/fb/scheduled').length, n1, '取消不重查');
  assert.deepEqual(errors, []);
  await page.close();
});

test('U8：1280×720 預覽、貼圖按鈕、底列都在視窗內', async () => {
  const { page } = await newPage('admin', { width: 1280, height: 720 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  for (const sel of ['#cv', '#fxBtn', '#pages .chip', '#clearBtn', '#sendBtn']) {
    const box = await page.locator(sel).first().boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 720.5, sel + ' 在畫面內');
  }
  await page.close();
});

test('送出提示不佔位：平常隱藏，游標移到送出鈕才浮出；被擋原因同樣只在游標移上時顯示', async () => {
  const { page, errors } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  const foot = async () => (await page.locator('.post-foot').boundingBox()).height;
  const h0 = await foot();
  assert.match(await page.textContent('#sendErr'), /請先勾選要發的粉專/);
  assert.equal(await page.locator('#sendErr').evaluate((e) => getComputedStyle(e).visibility), 'hidden', '平常隱藏');
  await page.hover('#sendWrap');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#sendErr').evaluate((e) => getComputedStyle(e).visibility), 'visible', '游標移上顯示');
  assert.equal(await page.locator('#sendErr').evaluate((e) => getComputedStyle(e).position), 'absolute');
  await page.mouse.move(5, 5);
  await page.fill('#msg', 'm');
  await page.click(chip(111) + ' .chip-l');
  await withPhoto(page);
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendErr'), /請貼上文章網址/);
  assert.equal(await foot(), h0, '提示不撐高底列');
  await page.mouse.move(5, 5); await page.waitForTimeout(200);
  assert.equal(await page.locator('#sendErr').evaluate((e) => getComputedStyle(e).visibility), 'hidden');
  assert.deepEqual(errors, []);
  await page.close();
});

test('電腦版新增發文：左邊預覽固定，只有右邊捲動', async () => {
  const { page, errors } = await newPage('admin', { width: 1280, height: 720 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  const st = await page.evaluate(() => {
    const body = document.querySelector('.post-body'), left = document.querySelector('.compose > .left'), right = document.querySelector('.compose > .right');
    return { body: getComputedStyle(body).overflowY, left: getComputedStyle(left).overflowY, right: getComputedStyle(right).overflowY, rScroll: right.scrollHeight > right.clientHeight };
  });
  assert.equal(st.body, 'hidden');
  assert.equal(st.right, 'auto');
  assert.ok(st.rScroll, '右邊內容超出可捲');
  const y0 = (await page.locator('#cvWrap').boundingBox()).y;
  await page.locator('.compose > .right').evaluate((e) => { e.scrollTop = 400; });
  assert.equal((await page.locator('#cvWrap').boundingBox()).y, y0, '右邊捲動時預覽不動');
  assert.deepEqual(errors, []);
  await page.close();
});

test('已排程查詢中顯示 3 列骨架，讀完換成結果', async () => {
  const { page, errors } = await newPage('admin');
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(API_BASE + '/fb/scheduled**', async (r) => { await gate; await r.fallback(); });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#schedReload');
  await page.click('#schedReload');
  await page.waitForSelector('#schedList li.sk-row');
  assert.equal(await page.locator('#schedList li.sk-row').count(), 3);
  release();
  await page.waitForSelector('#schedList li:not(.sk-row)');
  assert.equal(await page.locator('#schedList li.sk-row').count(), 0);
  assert.equal(await page.locator('#schedList li').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('公司密碼登入（fb_need_staff）：顯示請用員工編號登入與按鈕，按下通知外殼', async () => {
  const { page, errors } = await newPage('needStaff', { width: 1280, height: 700 });
  await page.addInitScript(() => { window.__logins = 0; });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#needStaff:not([hidden])');
  assert.match(await page.textContent('#needStaff'), /排程發布需要用員工編號登入/);
  assert.equal(await page.locator('#fbpostApp').isVisible(), false);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-need-staff.png') });
  assert.equal(await page.textContent('#needStaffBtn'), '用員工編號登入');
  assert.deepEqual(errors, []);
  await page.close();
});

test('只有 view 權限：看不到新增發文、改時間、刪除；標題列顯示姓名與權限組', async () => {
  const t = await newPage('companyOpen', { width: 1280, height: 700 }, { me: { admin: false, id: 'A1', name: '王小明', group: '唯讀組', perms: ['view'], mode: 'company' } });
  await t.page.goto(srv.url + 'tools/fbpost/index.html');
  await t.page.waitForSelector('#fbpostApp:not([hidden])');
  await t.page.waitForFunction(() => document.getElementById('whoAmI') && !document.getElementById('whoAmI').hidden);
  assert.equal(await t.page.textContent('#whoAmI'), '王小明．唯讀組');
  assert.equal(await t.page.isVisible('#newBtn'), false);
  await t.page.click('#schedReload');
  await t.page.waitForSelector('#schedList li');
  assert.equal(await t.page.locator('#schedList li .act-time:visible').count(), 0);
  assert.equal(await t.page.locator('#schedList li .btn-del:visible').count(), 0);
  await t.page.click('#tabs [data-tab=pub]');
  await t.page.click('#pubReload');
  await t.page.waitForSelector('#pubList li');
  assert.equal(await t.page.locator('#pubList li .btn-del:visible').count(), 0);
  await t.page.click('#tabs [data-tab=sched]');
  if (SHOT) await t.page.screenshot({ path: path.join(SHOT, 'fbpost-view-only.png') });
  assert.deepEqual(t.errors, []);
  await t.page.close();
});

test('沒有 view 權限：列表區隱藏並提示；讀不到 /fb/me 視為全權限', async () => {
  const a = await newPage('companyOpen', { width: 1280, height: 700 }, { me: { admin: false, id: 'A2', name: '乙', group: '只發文', perms: ['post'], mode: 'company' } });
  await a.page.goto(srv.url + 'tools/fbpost/index.html');
  await a.page.waitForSelector('#noView:not([hidden])');
  assert.equal(await a.page.isVisible('#listCard'), false);
  assert.equal(await a.page.isVisible('#newBtn'), true);
  await a.page.close();
  const b = await newPage('companyOpen', { width: 1280, height: 700 });   // /fb/me 404
  await b.page.goto(srv.url + 'tools/fbpost/index.html');
  await b.page.waitForSelector('#fbpostApp:not([hidden])');
  await b.page.waitForTimeout(300);
  assert.equal(await b.page.isVisible('#newBtn'), true);
  assert.equal(await b.page.isVisible('#listCard'), true);
  await b.page.close();
});

test('管理員：臉書權杖快到期／失效時頂端顯示提醒；沒有提醒時不顯示', async () => {
  const a = await newPage('admin', { width: 1280, height: 700 }, { me: { admin: true, perms: [], mode: 'admin', tokenWarn: { level: 'bad', text: '發文時遇到臉書權杖失效，請到管理頁「臉書連線」檢查並換新權杖。' } } });
  await a.page.goto(srv.url + 'tools/fbpost/index.html');
  await a.page.waitForSelector('#tokWarn:not([hidden])');
  assert.match(await a.page.textContent('#tokWarn'), /權杖失效/);
  assert.equal(await a.page.getAttribute('#tokWarn', 'class'), 'tok-warn bad');
  if (SHOT) await a.page.screenshot({ path: SHOT + '/fbpost-tokwarn.png' });
  await a.page.close();
  const b = await newPage('admin', { width: 1280, height: 700 }, { me: { admin: true, perms: [], mode: 'admin', tokenWarn: null } });
  await b.page.goto(srv.url + 'tools/fbpost/index.html');
  await b.page.waitForSelector('#fbpostApp:not([hidden])');
  await b.page.waitForTimeout(300);
  assert.equal(await b.page.isVisible('#tokWarn'), false);
  await b.page.close();
});

test('防重複：同一則再送沿用 sendId；結果不明先確認，確定才帶 retry；換網址換新 sendId', async () => {
  const field = (body, k) => { const m = new RegExp('name="' + k + '"\\r\\n\\r\\n([^\\r]*)\\r\\n').exec(body); return m ? m[1] : null; };
  let n = 0;
  const { page, api } = await newPage('admin', undefined, { post: (targets) => {
    n++;
    return { results: targets.map((t) => (t.page === '111'
      ? (n === 1 ? { page: '111', ok: true, postId: '111_9', scheduled: false, comment: 'done' } : { page: '111', ok: true, dup: true, postId: '111_9', scheduled: false, comment: 'none' })
      : (n < 3 ? { page: t.page, ok: false, unknown: true, scheduled: false, comment: 'none', error: '連不上臉書' } : { page: t.page, ok: true, postId: t.page + '_1', scheduled: false, comment: 'done' }))) };
  } });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await pasteImage(page, fakeAsset());
  await page.waitForSelector('#cvEmpty', { state: 'hidden' });
  await page.fill('#msg', 'm');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(333) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForFunction(() => /待確認/.test(document.getElementById('results').textContent));
  assert.match(await page.textContent('#results'), /國際：待確認（連不上臉書）：可能已經發出/);
  const sid = field(api.posts[0], 'sendId');
  assert.match(sid, /^[A-Za-z0-9-]{8,64}$/);
  assert.equal(field(api.posts[0], 'retry'), null);
  // 再送：先問；返回＝不送
  await page.click('#sendBtn');
  await page.waitForSelector('#cfDlg[open]');
  assert.match(await page.textContent('#cfBody'), /^國際 上次送出時沒有收到臉書的結果/);
  await page.click('#cfNo');
  await page.waitForTimeout(200);
  assert.equal(api.posts.length, 1);
  // 確定＝同 sendId＋retry
  await page.click('#sendBtn');
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfYes');
  await page.waitForFunction(() => /先前已發布，這次未重送/.test(document.getElementById('results').textContent));
  assert.equal(field(api.posts[1], 'sendId'), sid);
  assert.equal(field(api.posts[1], 'retry'), '["333"]');
  // 換網址＝新的一則：換 sendId、不再問待確認
  await page.fill('#link', 'https://news.tvbs.com.tw/life/2');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 3);
  assert.notEqual(field(api.posts[2], 'sendId'), sid);
  assert.equal(field(api.posts[2], 'retry'), null);
  await page.close();
});

test('外掛側邊欄（is-side，360px）：按鈕縮小、RD 開關與 SLUG 同列、文章網址在預覽上面且聚焦', async () => {
  const { page, errors } = await newPage('admin', { width: 360, height: 760 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.evaluate(() => document.documentElement.classList.add('is-side'));   // 真的側邊欄由 ancestorOrigins 判斷，測試直接加
  await openPost(page);
  const h = (sel) => page.$eval(sel, (e) => Math.round(e.getBoundingClientRect().height));
  assert.equal(await h('#dlgClose'), 32);
  assert.equal(await h('#modeSeg button'), 32);
  assert.equal(await h('#fxBtn'), 32);
  assert.equal(await h('#link'), 40);
  assert.equal(await h('#pages .chip'), 36);
  assert.equal(await h('#rdSlug'), 36);
  assert.equal(await h('#sendBtn'), 40);
  assert.equal(await h('#clearBtn'), 40);
  const sw = await page.$eval('.rd-switch .track', (e) => e.getBoundingClientRect());
  const slug = await page.$eval('#rdSlug', (e) => e.getBoundingClientRect());
  assert.ok(Math.abs((sw.top + sw.height / 2) - (slug.top + slug.height / 2)) < 4 && slug.left > sw.right, 'RD 開關在左、SLUG 在右同一列');
  assert.equal(await page.$eval('.link-box', (e) => e.nextElementSibling.classList.contains('compose')), true, '網址在預覽上面');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'link');
  assert.equal(await overflow(page), 0);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'side-360.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

test('網頁版：窄版網址在最上面，電腦版回右欄最上面；按鈕維持原尺寸', async () => {
  const { page, errors } = await newPage('admin', { width: 1280, height: 900 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  assert.equal(await page.$eval('.link-box', (e) => e.parentElement.classList.contains('right') && !e.previousElementSibling), true);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForFunction(() => document.querySelector('.link-box').nextElementSibling?.classList.contains('compose'));
  assert.equal(await page.$eval('#pages .chip', (e) => Math.round(e.getBoundingClientRect().height)), 44, '網頁版手機膠囊仍 44');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.querySelector('.link-box').parentElement.classList.contains('right'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('外掛側邊欄：「＋ 新增發文」在已排程／已發佈右邊同一列；不能檢視時放回標題列；網頁版不搬', async () => {
  const side = async (me) => {
    const t = await newPage(me ? 'companyOpen' : 'admin', { width: 360, height: 760 }, me ? { me } : {});
    await t.page.route('**/tools/fbpost/index.html', async (r) => {   // 模擬被外掛嵌入：一開始就是 is-side
      const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace('<html lang="zh-Hant-TW">', '<html lang="zh-Hant-TW" class="is-side">') });
    });
    await t.page.goto(srv.url + 'tools/fbpost/index.html');
    await t.page.waitForSelector('#fbpostApp:not([hidden])');
    return t;
  };
  const a = await side();
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.$eval('#newBtn', (e) => e.parentElement.id), 'tabsRow');
  const tabs = await a.page.$eval('#tabs', (e) => e.getBoundingClientRect()), nb = await a.page.$eval('#newBtn', (e) => e.getBoundingClientRect());
  assert.ok(nb.left > tabs.right && Math.abs((nb.top + nb.height / 2) - (tabs.top + tabs.height / 2)) < 4, '在分頁右邊同一列');
  assert.equal(Math.round(nb.height), Math.round(tabs.height), '和分頁外框同高');
  assert.equal(await overflow(a.page), 0);
  if (SHOT) await a.page.screenshot({ path: path.join(SHOT, 'side-list.png') });
  await a.page.click('#newBtn');
  await a.page.waitForSelector('#postDlg:not([hidden])');
  assert.deepEqual(a.errors, []);
  await a.page.close();
  const b = await side({ admin: false, id: 'A2', name: '乙', group: '只發文', perms: ['post'], mode: 'company' });
  await b.page.waitForFunction(() => document.getElementById('fbpostApp').classList.contains('no-view'));
  await b.page.waitForFunction(() => document.getElementById('newBtn').parentElement.classList.contains('fp-head'));
  assert.equal(await b.page.isVisible('#newBtn'), true, '不能檢視時新增發文仍看得到');
  await b.page.close();
  const c = await newPage('admin');
  await c.page.goto(srv.url + 'tools/fbpost/index.html');
  await c.page.waitForSelector('#fbpostApp:not([hidden])');
  assert.equal(await c.page.$eval('#newBtn', (e) => e.parentElement.classList.contains('fp-head')), true, '網頁版不搬');
  await c.page.close();
});

test('開啟時先顯示骨架、不閃「功能停用」；能用換成內容，不能用才顯示停用（fbpost）', async () => {
  for (const mode of ['admin', 'denied']) {
    const { page, errors } = await newPage(mode);
    let release; const gate = new Promise((r) => { release = r; });
    await page.route(API_BASE + '/auth/status', async (r) => { await gate; return r.fallback(); });   // 後端慢：先擋住
    await page.goto(srv.url + 'tools/fbpost/index.html');
    await page.waitForSelector('#bootSk .sk');
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible('#bootSk'), true, '先看到骨架');
    assert.equal(await page.isVisible('#offMain'), false, '不閃停用畫面');
    assert.equal(await page.isVisible('#fbpostApp'), false);
    if (mode === 'admin' && SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-boot.png') });
    release();
    if (mode === 'admin') await page.waitForSelector('#fbpostApp:not([hidden])');
    else await page.waitForSelector('#offMain:not([hidden])');
    assert.equal(await page.isVisible('#bootSk'), false, '載完收掉骨架');
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('值班粉專：班段第一次開啟要先選（不能略過），選好的在新增發文、清空後自動勾選', async () => {
  const { page, errors } = await newPage('admin', { width: 1280, height: 900 }, { duty: false });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#dutyDlg[open]');
  assert.equal(await page.isHidden('#dutyCancel'), true, '第一次不能取消');
  assert.match(await page.textContent('#dutyShift'), /^(早班|晚班)/);
  assert.equal(await page.isDisabled('#dutyOk'), true, '至少選 1 個');
  if (SHOT) { await page.check('#dutyList input[value="111"]'); await page.screenshot({ path: path.join(SHOT, 'fbpost-duty.png') }); await page.uncheck('#dutyList input[value="111"]'); }
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#dutyDlg'), true, 'Esc 關不掉');
  await page.check('#dutyList input[value="111"]');
  await page.check('#dutyList input[value="333"]');
  await page.click('#dutyOk');
  assert.equal(await page.isVisible('#dutyDlg'), false);
  assert.equal(await page.textContent('#dutyBtn'), '值班：新聞、國際');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tbx.fbpost.duty')));
  assert.deepEqual(saved.pages, ['111', '333']);
  await openPost(page);
  const on = () => page.$$eval('#pages .chip.on', (els) => els.map((e) => e.dataset.page));
  assert.deepEqual(await on(), ['111', '333']);
  // 手動改勾選後清空：回到值班粉專
  await page.click(chip(111) + ' .chip-l');
  await page.click(chip(222) + ' .chip-l');
  await page.click('#clearBtn');
  await page.click('#cfYes');
  assert.deepEqual(await on(), ['111', '333']);
  // 從按鈕改值班（可以取消）；已有勾選時不蓋掉
  await page.click('#dlgClose');
  await page.click('#dutyBtn');
  assert.equal(await page.isVisible('#dutyCancel'), true);
  await page.uncheck('#dutyList input[value="333"]');
  await page.click('#dutyOk');
  assert.equal(await page.textContent('#dutyBtn'), '值班：新聞');
  await page.click('#newBtn');
  assert.deepEqual(await on(), ['111', '333'], '正在編輯的勾選不被改掉');
  await page.click('#clearBtn'); await page.click('#cfYes');
  assert.deepEqual(await on(), ['111']);
  // 重新整理：同班段不再問
  await page.reload();
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#dutyDlg'), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('值班粉專：膠囊列值班排前面，改值班即時重排、勾選不變', async () => {
  const { page, errors } = await newPage('admin', { width: 1280, height: 900 }, { duty: ['333'] });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  const order = () => page.$$eval('#pages .chip', (els) => els.map((e) => e.dataset.page));
  const on = () => page.$$eval('#pages .chip.on', (els) => els.map((e) => e.dataset.page));
  assert.deepEqual(await order(), ['333', '111', '222']);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbpost-duty-order.png'), clip: await page.locator('#pages').boundingBox().then((b) => ({ x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 })) });
  await page.click(chip(222) + ' .chip-l');
  await page.click('#dlgClose');
  await page.click('#dutyBtn');
  await page.check('#dutyList input[value="222"]');
  await page.uncheck('#dutyList input[value="333"]');
  await page.click('#dutyOk');
  await page.click('#newBtn');
  assert.deepEqual(await order(), ['222', '111', '333'], '值班改成娛樂：娛樂排第一，其他照原順序');
  assert.deepEqual((await on()).sort(), ['222', '333'], '正在編輯的勾選不變');
  assert.deepEqual(errors, []);
  await page.close();
});

test('值班粉專：沒有發文權限不問、不顯示按鈕', async () => {
  const { page } = await newPage('admin', { width: 1280, height: 900 }, { duty: false, me: { admin: false, perms: ['view'], name: '小明' } });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible('#dutyDlg'), false);
  assert.equal(await page.isHidden('#dutyBtn'), true);
  await page.close();
});

test('再發一次：送出記錄帶回網址、照片、發出時的標題與模式；沒記錄的停用；有內容先問', async () => {
  const soon = Math.floor(Date.now() / 1000) + 7200;
  const sched = [{ id: '111_9', message: '【改過的標題】', at: soon, picture: null, comment: 'none' }, { id: '111_7', message: '別人發的', at: soon + 60, picture: null, comment: 'none' }];
  const { page, errors, api } = await newPage('admin', { width: 1280, height: 900 }, { duty: ['111'], sched });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  assert.deepEqual(await page.$$eval('#pages .chip.on', (els) => els.map((e) => e.dataset.page)), ['111'], '值班粉專預勾');
  await pasteImage(page, fakeAsset([200, 30, 30]));
  await page.waitForSelector('#cvEmpty', { state: 'hidden' });
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.fill('#title', '改過的標題');
  await page.fill('#msg', '貼文內容不帶回');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  await page.click('#doneBack');
  await page.click('#schedReload');
  await page.waitForSelector('#schedList li[data-id="111_7"]');
  const r7 = '#schedList li[data-id="111_7"] .act-resend', r9 = '#schedList li[data-id="111_9"] .act-resend';
  assert.equal(await page.isDisabled(r7), true, '沒記錄的停用');
  assert.match(await page.getAttribute(r7, 'title'), /只有這台電腦/);
  assert.equal(await page.isDisabled(r9), false);
  if (SHOT) await page.locator('#listCard').screenshot({ path: path.join(SHOT, 'fbpost-resend-list.png') });
  await page.click(r9);
  await page.waitForSelector('#postDlg:not([hidden])');
  assert.equal(await page.inputValue('#link'), 'https://news.tvbs.com.tw/life/1');
  assert.equal(await page.inputValue('#title'), '改過的標題');
  assert.equal(await page.inputValue('#msg'), '', '貼文內容不帶回');
  await page.waitForSelector('#cvEmpty', { state: 'hidden' });
  const px = await page.evaluate(() => Array.from(document.getElementById('cv').getContext('2d').getImageData(540, 300, 1, 1).data));
  assert.ok(px[0] > 150 && px[1] < 90, '照片帶回：' + px);
  assert.deepEqual(await page.$$eval('#pages .chip.on', (els) => els.map((e) => e.dataset.page)), ['111']);
  assert.match(await page.textContent('#pullHint'), /已帶回上次送出的網址、標題、照片/);
  // 已有內容：先問，按返回不動
  await page.fill('#title', '正在編輯');
  await page.click('#dlgClose');
  await page.click(r9);
  await page.waitForSelector('#cfDlg[open]');
  await page.click('#cfNo');
  assert.equal(await page.inputValue('#title'), '正在編輯');
  // 再送一次是新的一則（不同 sendId）
  await page.click(r9); await page.waitForSelector('#cfDlg[open]'); await page.click('#cfYes');
  await page.waitForSelector('#postDlg:not([hidden])');
  await page.fill('#msg', '第二次');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  const sid = (b) => /name="sendId"\r\n\r\n([^\r]*)\r\n/.exec(b)[1];
  assert.notEqual(sid(api.posts[0]), sid(api.posts[1]));
  assert.deepEqual(errors, []);
  await page.close();
});

test('再發一次：純文字帶回模式與標題框', async () => {
  const soon = Math.floor(Date.now() / 1000) + 7200;
  const { page } = await newPage('admin', { width: 1280, height: 900 }, { duty: ['111'], sched: [{ id: '111_9', message: 'x', at: soon, picture: null, comment: 'none' }] });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.fill('#title', '純文字標題');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  await page.click('#doneAgain');
  await page.click('#modeSeg [data-mode=image]');
  await page.click('#dlgClose');
  await page.click('#schedReload');
  await page.click('#schedList li[data-id="111_9"] .act-resend');
  await page.waitForSelector('#postDlg:not([hidden])');
  assert.equal(await page.getAttribute('#modeSeg [data-mode=text]', 'aria-pressed'), 'true');
  assert.equal(await page.isHidden('#msg'), true);
  assert.equal(await page.inputValue('#title'), '純文字標題');
  if (SHOT) await page.locator('.post-body, #postDlg .dlg-box, #postDlg').first().screenshot({ path: path.join(SHOT, 'fbpost-text-mode.png') });
  await page.close();
});

test('再發一次：純色底色帶回時色塊亮起；值班視窗開著按 Esc 不會關掉新增發文', async () => {
  const soon = Math.floor(Date.now() / 1000) + 7200;
  const { page } = await newPage('admin', { width: 1280, height: 900 }, { duty: ['111'], sched: [{ id: '111_9', message: 'x', at: soon, picture: null, comment: 'none' }] });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('#modeSeg [data-mode=color]');
  const colors = await page.$$eval('#swatches [data-color]', (b) => b.map((x) => x.dataset.color));
  const pick = colors[colors.length - 1];
  await page.click(`#swatches [data-color="${pick}"]`);
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.fill('#title', '純色標題');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  await page.click('#doneAgain');
  await page.click('#modeSeg [data-mode=image]');
  await page.click('#dlgClose');
  await page.click('#schedReload');
  await page.click('#schedList li[data-id="111_9"] .act-resend');
  await page.waitForSelector('#postDlg:not([hidden])');
  assert.equal(await page.getAttribute(`#swatches [data-color="${pick}"]`, 'aria-pressed'), 'true');
  // 值班視窗（手動開）開著按 Esc：只關值班視窗，新增發文留著
  await page.evaluate(() => document.getElementById('dutyDlg').showModal());
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#postDlg'), true);
  await page.close();
});

test('已排程只顯示晚於現在的貼文：已過時間的不列，沒有時間的照列', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { page, errors } = await newPage('admin', undefined, { sched: [
    { id: '111_1', message: '過去', at: now - 600, comment: 'none' },
    { id: '111_2', message: '未來', at: now + 7200, comment: 'none' },
    { id: '111_3', message: '沒時間', comment: 'none' },
  ] });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.click('#schedReload');
  await page.waitForFunction(() => /共 2 則/.test(document.getElementById('schedHint').textContent));
  const txt = await page.textContent('#schedList');
  assert.ok(!txt.includes('過去'), '過去的排程不顯示');
  assert.ok(txt.includes('未來') && txt.includes('沒時間'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('選套版沒照片：送出鈕停用並說明原因；改純文字就能送', async () => {
  const { page } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.fill('#title', '標題');
  await page.click(chip(111) + ' .chip-l');
  assert.equal(await page.locator('#sendBtn').isDisabled(), true);
  assert.equal(await page.textContent('#sendErr'), '照片套圖需要照片，請貼上或選一張照片，或改用純文字');
  await page.click('#modeSeg [data-mode=text]');
  assert.equal(await page.locator('#sendBtn').isDisabled(), false);
  assert.equal(await page.textContent('#sendErr'), '');
  await page.click('#modeSeg [data-mode=image]');
  await withPhoto(page);
  assert.equal(await page.locator('#sendBtn').isDisabled(), false, '有照片就能送');
  await page.close();
});

// ===== 留言失敗提醒（2026-11-22）=====
const ALERT_PUB = [
  { id: '111_5', message: '留言失敗的貼文', time: new Date().toISOString(), picture: null, url: 'https://www.facebook.com/111/posts/5', comment: { status: 'failed', alert: true, failed: true, seq: 1, error: '(#32) page rate limit' } },
  { id: '111_6', message: '重試中的貼文', time: new Date().toISOString(), picture: null, url: 'https://www.facebook.com/111/posts/6', comment: { status: 'pending', alert: true, failed: false, seq: 2, error: 'temporary' } },
  { id: '111_8', message: '正常的貼文', time: new Date().toISOString(), picture: null, url: 'https://www.facebook.com/111/posts/8', comment: 'done' }
];
test('留言失敗：紅字＋「重新留言」；按下送出 postId／page，改成重新留言中、按鈕消失；正常的沒有按鈕', async () => {
  const { page, errors, api } = await newPage('admin', undefined, { pub: ALERT_PUB });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  await page.click('[data-tab=pub]');
  await page.click('#pubReload');
  await page.waitForFunction(() => /共 3 則/.test(document.getElementById('pubHint').textContent));
  const rows = page.locator('#pubList > li');
  assert.match(await rows.nth(0).locator('.cm').textContent(), /留言失敗（第 1 則：\(#32\) page rate limit）/);
  assert.match(await rows.nth(1).locator('.cm').textContent(), /留言重試中（第 2 則：temporary）/);
  const red = await rows.nth(0).locator('.cm').evaluate((el) => getComputedStyle(el).color);
  assert.equal(red, 'rgb(217, 45, 32)');
  assert.equal(await rows.nth(0).locator('.act-retry').count(), 1);
  assert.equal(await rows.nth(1).locator('.act-retry').count(), 1);
  assert.equal(await rows.nth(2).locator('.act-retry').count(), 0);
  assert.doesNotMatch(await rows.nth(2).locator('.cm').evaluate((el) => el.className), /cm-bad/);
  await rows.nth(0).locator('.act-retry').click();
  await page.waitForFunction(() => /重新留言中/.test(document.querySelector('#pubList > li .cm').textContent));
  assert.deepEqual(api.retries, [{ postId: '111_5', page: '111' }]);
  assert.equal(await rows.nth(0).locator('.act-retry').count(), 0);
  assert.doesNotMatch(await rows.nth(0).locator('.cm').evaluate((el) => el.className), /cm-bad/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('留言失敗：重新留言失敗顯示原因、按鈕可再按；沒有發文權限看不到按鈕', async () => {
  const a = await newPage('admin', undefined, { pub: ALERT_PUB, retryFail: true });
  await a.page.goto(srv.url + 'tools/fbpost/index.html');
  await a.page.waitForSelector('#fbpostApp:not([hidden])');
  await a.page.click('[data-tab=pub]'); await a.page.click('#pubReload');
  await a.page.waitForFunction(() => /共 3 則/.test(document.getElementById('pubHint').textContent));
  await a.page.locator('#pubList > li').nth(0).locator('.act-retry').click();
  await a.page.waitForFunction(() => /沒有失敗的留言/.test(document.getElementById('pubHint').textContent));
  assert.equal(await a.page.locator('#pubList > li').nth(0).locator('.act-retry').isEnabled(), true);
  await a.page.close();
  const b = await newPage('admin', undefined, { pub: ALERT_PUB, me: { admin: false, perms: ['view'], name: '小明', group: '檢視' } });
  await b.page.goto(srv.url + 'tools/fbpost/index.html');
  await b.page.waitForSelector('#fbpostApp:not([hidden])');
  await b.page.waitForSelector('#fbpostApp.no-post');
  await b.page.click('[data-tab=pub]'); await b.page.click('#pubReload');
  await b.page.waitForFunction(() => /共 3 則/.test(document.getElementById('pubHint').textContent));
  assert.equal(await b.page.locator('#pubList .act-retry').first().isVisible(), false);
  await b.page.close();
});

test('已排程、已發佈每 10 分鐘自動刷新；不到 10 分鐘不查；分頁在背景時不查', async () => {
  const { page, fbCalls } = await newPage('admin');
  await page.clock.install();
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#fbpostApp:not([hidden])');
  const n = () => fbCalls.filter((p) => p === '/fb/scheduled').length;
  const m = () => fbCalls.filter((p) => p === '/fb/published').length;
  await page.waitForFunction(() => /共 1 則/.test(document.getElementById('schedHint').textContent));
  await page.waitForFunction(() => /共 \d+ 則/.test(document.getElementById('pubHint').textContent));
  assert.equal(n(), 1, '開頁自動讀一次');
  const p0 = m();
  await page.clock.fastForward('09:00');
  assert.equal(n(), 1); assert.equal(m(), p0);
  await page.clock.fastForward('02:00');
  await page.waitForFunction(() => /共 1 則/.test(document.getElementById('schedHint').textContent));
  await page.waitForTimeout(50);
  assert.equal(n(), 2); assert.equal(m(), p0 + 1, '已發佈也自動刷新');
  await page.clock.fastForward('05:00');
  assert.equal(n(), 2, '剛查過不再查');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
  await page.clock.fastForward('20:00');
  assert.equal(n(), 2, '背景不查');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => document.getElementById('schedList').getAttribute('aria-busy') === 'false');
  await page.waitForTimeout(50);
  assert.equal(n(), 3, '切回來超過 10 分鐘補查');
  await page.close();
});

// ===== 即時狀態（外掛側邊欄）與回列表切到已發佈（2026-11-22）=====
const FAIL_NOTE = { enabled: true, items: [{ postId: '222_5', page: '222', pageName: '娛樂', kind: 'post', seq: 1, error: '(#32) page rate limit', failed: true, at: Date.now(), canRetry: true }] };
const sidePage = async (opts) => {
  return newPage('admin', { width: 360, height: 760 }, opts);
};
test('即時狀態（側邊欄）：沒問題綠燈；權限組沒開通知就不顯示；網頁版不顯示', async () => {
  const a = await sidePage({ notices: { enabled: true, items: [] } });
  await a.page.goto(srv.url + 'tools/fbpost/index.html');
  await a.page.evaluate(() => document.documentElement.classList.add('is-side'));
  await openPost(a.page);
  await a.page.waitForSelector('#liveState:not([hidden])');
  assert.equal(await a.page.$eval('#liveState', (e) => e.classList.contains('is-bad')), false);
  assert.match(await a.page.textContent('#liveState'), /即時狀態/);
  assert.equal(await a.page.$eval('#liveState i', (e) => getComputedStyle(e).backgroundColor), 'rgb(23, 178, 106)');
  await a.page.close();
  const b = await sidePage({ notices: { enabled: false, items: [] } });
  await b.page.goto(srv.url + 'tools/fbpost/index.html');
  await b.page.evaluate(() => document.documentElement.classList.add('is-side'));
  await openPost(b.page);
  await b.page.waitForTimeout(300);
  assert.equal(await b.page.isVisible('#liveState'), false);
  await b.page.close();
  const c = await newPage('admin', undefined, { notices: { enabled: true, items: [] } });
  await c.page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(c.page);
  await c.page.waitForTimeout(300);
  assert.equal(await c.page.isVisible('#liveState'), false);
  await c.page.close();
});

test('即時狀態（側邊欄）：留言失敗紅燈閃爍；點一下關新增發文、切到已發佈並讀該粉專', async () => {
  const { page, errors, api } = await sidePage({ notices: FAIL_NOTE, pub: ALERT_PUB });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.evaluate(() => document.documentElement.classList.add('is-side'));
  await openPost(page);
  await page.waitForSelector('#liveState.is-bad');
  assert.notEqual(await page.$eval('#liveState', (e) => getComputedStyle(e).animationName), 'none');
  assert.match(await page.getAttribute('#liveState', 'aria-label'), /留言有問題 1 則（娛樂）/);
  assert.equal(await page.isVisible('#liveTip'), false, '沒移上去不顯示小視窗');
  await page.hover('#liveState');
  await page.waitForSelector('#liveTip:not([hidden])');
  assert.match(await page.textContent('#liveTip'), /娛樂｜第 \d 則留言/);
  assert.equal(await page.isVisible('#postDlg'), true, '只移上去不跳列表');
  await page.mouse.move(0, 0);
  await page.waitForSelector('#liveTip', { state: 'hidden' });
  await page.click('#liveState');
  await page.waitForSelector('#postDlg', { state: 'hidden' });
  await page.waitForFunction(() => document.getElementById('pubPage').value === '222' && !document.getElementById('tab-pub').hidden && /共 3 則/.test(document.getElementById('pubHint').textContent));
  assert.equal(await page.isVisible('#tab-pub'), true);
  assert.equal(await page.$eval('#pubPage', (e) => e.value), '222');
  assert.equal(api.pubPages.at(-1), '222');
  assert.equal(await page.locator('#pubList .cm-bad').count(), 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('網頁版：留言失敗時關閉新增發文回列表，直接切到已發佈並顯示錯誤；沒有失敗維持原分頁', async () => {
  let fail = false;
  const { page, api } = await newPage('admin', undefined, { notices: () => (fail ? FAIL_NOTE : { enabled: true, items: [] }), pub: ALERT_PUB });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('#dlgClose');
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#tab-sched'), true, '沒有失敗留在已排程');
  assert.deepEqual(api.pubPages, ['111'], '只有進入時自動讀第一個粉專');
  fail = true;
  await page.click('#newBtn'); await page.waitForSelector('#postDlg:not([hidden])');
  await page.click('#dlgClose');
  await page.waitForFunction(() => document.getElementById('pubPage').value === '222' && !document.getElementById('tab-pub').hidden && /共 3 則/.test(document.getElementById('pubHint').textContent));
  assert.equal(await page.isVisible('#tab-pub'), true);
  assert.deepEqual(api.pubPages, ['111', '222']);
  await page.close();
});

// ===== 列表改版（2026-11-25）：自動讀、值班粉專預設、換粉專、分頁、卡片 =====
const mkSched = (n, from, soon) => Array.from({ length: n }, (_, i) => ({ id: '111_' + (from + i), message: '排程 ' + (from + i), at: soon + (from + i) * 60, picture: null, comment: 'none' }));
const mkPub = (n, from) => Array.from({ length: n }, (_, i) => ({ id: '111_p' + (from + i), message: '已發 ' + (from + i), time: new Date(Date.now() - (from + i) * 60000).toISOString(), picture: null, url: 'https://www.facebook.com/111/posts/' + (from + i), comment: 'done' }));

test('進入自動讀兩批（50＋50）；第 2 批背景接著讀；只有 1 頁以上才有分頁器；不再自動讀第 3 批', async () => {
  const soon = Math.floor(Date.now() / 1000) + 7200;
  const { page, errors, fbCalls, api } = await newPage('admin', undefined, {
    schedFn: (u) => (u.searchParams.get('after') === 'C3' ? { items: mkSched(50, 100, soon), next: null } : u.searchParams.get('after') ? { items: mkSched(50, 50, soon), next: 'C3' } : { items: mkSched(50, 0, soon), next: 'C2' }),
    pubFn: (u) => (u.searchParams.get('after') ? { items: mkPub(30, 50), next: null } : { items: mkPub(50, 0), next: 'P2' })
  });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForFunction(() => /共 100 則/.test(document.getElementById('schedHint').textContent));
  assert.equal(fbCalls.filter((c) => c === '/fb/scheduled').length, 2, '兩批');
  assert.match(api.schedQs[0], /v=2/); assert.match(api.schedQs[1], /after=C2/);
  assert.equal(await page.locator('#schedList li').count(), 50, '每頁 50 則');
  assert.equal(await page.isVisible('#schedPager'), true);
  assert.match(await page.textContent('#schedNo'), /第 1／2 頁/);
  assert.equal(await page.isVisible('#schedMore'), false, '不在最後一頁不顯示讀取更多');
  await page.click('#schedNext');
  assert.match(await page.textContent('#schedNo'), /第 2／2 頁/);
  assert.equal(await page.locator('#schedList li').count(), 50);
  assert.equal(await page.isVisible('#schedMore'), true, '100 則後還有 next：最後一頁出現讀取更多');
  const n = fbCalls.filter((c) => c === '/fb/scheduled').length;
  await page.click('#schedPrev');
  await page.waitForTimeout(150);
  assert.equal(fbCalls.filter((c) => c === '/fb/scheduled').length, n, '換頁不重查');
  // 已發佈：80 則，2 頁，沒有 next → 沒有讀取更多
  await page.click('[data-tab=pub]');
  await page.waitForFunction(() => /共 80 則/.test(document.getElementById('pubHint').textContent));
  assert.match(await page.textContent('#pubNo'), /第 1／2 頁/);
  await page.click('#pubNext');
  assert.equal(await page.locator('#pubList li').count(), 30);
  assert.equal(await page.isVisible('#pubMore'), false);
  // 讀取更多：已排程再讀一批接在後面
  await page.click('[data-tab=sched]');
  await page.click('#schedNext');
  await page.click('#schedMore');
  await page.waitForFunction(() => /共 150 則/.test(document.getElementById('schedHint').textContent));
  assert.match(await page.textContent('#schedNo'), /第 \d／3 頁/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('列表每列「開啟貼文 ↗」：已發佈用 permalink、已排程用 /粉專/posts/貼文、另開分頁', async () => {
  const { page, errors } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#schedList li .act-open');
  assert.equal(await page.getAttribute('#schedList li .act-open', 'href'), 'https://www.facebook.com/111/posts/7');
  assert.equal(await page.getAttribute('#schedList li .act-open', 'target'), '_blank');
  await page.click('[data-tab=pub]');
  await page.waitForSelector('#pubList li .act-open');
  assert.equal(await page.getAttribute('#pubList li .act-open', 'href'), 'https://www.facebook.com/111/posts/5');
  if (SHOT) await page.screenshot({ path: SHOT + '/fbpost-open-btn.png' });
  assert.deepEqual(errors, []);
  await page.close();
});

test('幫直出（多圖）：照片套圖＋「照片」框、每張帶入、貼文內容、標題、去 utm 的連結，粉專全不勾；送出 kind=photo 且照順序送全部照片', async () => {
  const png = fakeAsset().toString('base64');
  const { page, errors, api } = await newPage('admin', undefined, { duty: ['111'], source: { message: '\n小編文\n【大新聞 標題】\n#tag', link: 'https://news.tvbs.com.tw/politics/3000000', images: [{ type: 'image/png', data: png }, { type: 'image/png', data: png }], imageFailed: false } });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.click('[data-tab=pub]');
  await page.waitForSelector('#pubList li .act-direct');
  await page.click('#pubList li .act-direct');
  await page.waitForSelector('#postDlg:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#psList .ps-thumb').length === 2);
  assert.deepEqual(api.sources, [{ id: '111_5', page: '111' }]);
  assert.equal(await page.getAttribute('#modeSeg [data-mode=image]', 'aria-pressed'), 'true');
  assert.equal((await page.textContent('#modeSeg [data-mode=image]')).trim(), '照片套圖');
  assert.equal(await page.locator('#modeSeg [data-mode]').count(), 3, '模式只有三個');
  assert.equal(await page.getAttribute('#frameSeg [data-frame=photo]', 'aria-pressed'), 'true', '「照片」框');
  assert.equal(await page.inputValue('#link'), 'https://news.tvbs.com.tw/politics/3000000');
  assert.equal(await page.inputValue('#msg'), '\n小編文\n【大新聞 標題】\n#tag');
  assert.equal(await page.inputValue('#title'), '大新聞 標題');
  assert.equal(await page.locator('#pages .chip.on').count(), 0, '粉專全部不勾（不套值班）');
  assert.match(await page.textContent('#pullHint'), /2 張圖片/);
  if (SHOT) await page.screenshot({ path: SHOT + '/fbpost-direct.png' });
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  for (let i = 0; !api.posts.length && i < 100; i++) await page.waitForTimeout(30);
  const body = api.posts[0];
  assert.match(body, /name="kind"\r\n\r\nphoto\r\n/);
  assert.deepEqual([...body.matchAll(/name="image"; filename="([^"]+)"/g)].map((m) => m[1]), ['photo1.png', 'photo2.png']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('幫直出（純文字、沒有連結）：純文字模式、文字放標題框、提示自己貼連結', async () => {
  const { page, errors } = await newPage('admin', undefined, { source: { message: '只有文字的貼文', link: '', images: [], imageFailed: false } });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.click('[data-tab=pub]');
  await page.click('#pubList li .act-direct');
  await page.waitForSelector('#postDlg:not([hidden])');
  await page.waitForFunction(() => document.getElementById('title').value === '只有文字的貼文');
  assert.equal(await page.getAttribute('#modeSeg [data-mode=text]', 'aria-pressed'), 'true');
  assert.equal(await page.inputValue('#link'), '');
  assert.match(await page.textContent('#pullHint'), /找不到文章連結/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('「照片」框：加多張、縮圖調順序／移除、不套框不加貼圖；切回套版只送第 1 張（其他保留）；刪除在側邊欄是垃圾桶', async () => {
  const { page, errors, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#schedList li .btn-del');
  assert.equal(await page.$eval('#schedList li .btn-del', (b) => getComputedStyle(b).fontSize !== '0px'), true, '電腦版顯示文字');
  await page.evaluate(() => document.documentElement.classList.add('is-side'));
  const d = await page.$eval('#schedList li .btn-del', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, fs: getComputedStyle(b).fontSize, ic: getComputedStyle(b, '::before').content, name: b.textContent.trim() }; });
  assert.equal(d.fs, '0px'); assert.equal(d.w, d.h, '正方形'); assert.notEqual(d.ic, 'none'); assert.equal(d.name, '刪除');
  if (SHOT) { await page.setViewportSize({ width: 360, height: 500 }); await page.click('[data-tab=pub]'); await page.waitForSelector('#pubList li .act-direct'); await page.screenshot({ path: SHOT + '/fbpost-side-pub.png' }); await page.click('[data-tab=sched]'); await page.setViewportSize({ width: 1280, height: 900 }); }
  await page.evaluate(() => document.documentElement.classList.remove('is-side'));
  await openPost(page);
  assert.deepEqual(await page.locator('#frameSeg [data-frame]:visible').allTextContents(), ['套版', '照片'], '測試環境沒有公司素材：套版｜照片');
  assert.equal(await page.isHidden('#photoStrip'), true);
  await page.click('#frameSeg [data-frame=photo]');
  assert.equal(await page.isVisible('#photoStrip'), true);
  for (let k = 0; k < 3; k++) await pasteImage(page, fakeAsset());
  await page.waitForFunction(() => document.querySelectorAll('#psList .ps-thumb').length === 3);
  assert.equal(await page.getAttribute('#modeSeg [data-mode=image]', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#frameSeg [data-frame=photo]', 'aria-pressed'), 'true', '貼照片＝加一張，框不變');
  assert.equal(await page.isHidden('#fxBtn'), true, '照片框不加貼圖');
  assert.match(await page.textContent('#psCount'), /共 3 張/);
  await page.click('#psList .ps-item:nth-child(2) [aria-label^="移除"]');
  await page.waitForFunction(() => document.querySelectorAll('#psList .ps-thumb').length === 2);
  if (SHOT) await page.screenshot({ path: SHOT + '/fbpost-photo-frame.png' });
  await page.click('#psList .ps-item:nth-child(2) [aria-label$="往前"]');
  // 切回套版：只送第 1 張（套版 PNG），其他保留
  await page.click('#frameSeg [data-frame=generic]');
  assert.match(await page.textContent('#pullHint'), /套版只會用第 1 張/);
  assert.equal(await page.isHidden('#photoStrip'), true);
  await page.click('#frameSeg [data-frame=photo]');
  assert.equal(await page.locator('#psList .ps-thumb').count(), 2, '切回照片：其他張還在');
  await page.click('#frameSeg [data-frame=generic]');
  await page.fill('#link', 'https://example.com/a');
  await page.fill('#title', '標題');
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  for (let i = 0; !api.posts.length && i < 100; i++) await page.waitForTimeout(30);
  assert.equal([...api.posts[0].matchAll(/name="image"/g)].length, 1, '套版只送一張');
  assert.match(api.posts[0], /name="kind"\r\n\r\ntemplate\r\n/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('多圖發多個粉專：一個粉專送一次請求（避免單次請求對外呼叫過多），結果合在一起', async () => {
  const { page, errors, api } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.click('#frameSeg [data-frame=photo]');
  await pasteImage(page, fakeAsset()); await pasteImage(page, fakeAsset());
  await page.waitForFunction(() => document.querySelectorAll('#psList .ps-thumb').length === 2);
  await page.fill('#link', 'https://example.com/a');
  await page.click(chip(111) + ' .chip-l'); await page.click(chip(333) + ' .chip-l');
  await page.click('#sendBtn');
  for (let i = 0; api.posts.length < 2 && i < 200; i++) await page.waitForTimeout(30);
  assert.equal(api.posts.length, 2);
  const tg = api.posts.map((b) => JSON.parse(/name="targets"\r\n\r\n([^\r]*)\r\n/.exec(b)[1]).map((t) => t.page));
  assert.deepEqual(tg, [['111'], ['333']]);
  assert.ok(api.posts.every((b) => [...b.matchAll(/name="image"/g)].length === 2));
  assert.ok(api.posts.every((b) => /name="sendId"\r\n\r\n([^\r]+)\r\n/.exec(b)[1] === /name="sendId"\r\n\r\n([^\r]+)\r\n/.exec(api.posts[0])[1]), '同一則（同 sendId）');
  assert.deepEqual(errors, []);
  await page.close();
});

test('手機（390px）：刪除是 44px 垃圾桶', async () => {
  const { page } = await newPage('admin', { width: 390, height: 800 });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#schedList li .btn-del');
  const d = await page.$eval('#schedList li .btn-del', (b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  assert.deepEqual(d, [44, 44]);
  if (SHOT) await page.screenshot({ path: SHOT + '/fbpost-phone-trash.png' });
  await page.close();
});

test('外掛側邊欄：不分頁，先 20 則、載入更多 +20 不重查；剩不到 20 則才背景先讀一批、一次一批；讀完顯示已經到底了', async () => {
  const soon = Math.floor(Date.now() / 1000) + 7200;
  const { page, errors, fbCalls, api } = await newPage('admin', { width: 360, height: 760 }, {
    schedFn: (u) => { const a = u.searchParams.get('after'); return a === 'C3' ? { items: mkSched(10, 150, soon), next: null } : a === 'C2' ? { items: mkSched(50, 100 - 50, soon).map((x, i) => ({ ...x, id: '111_' + (50 + i), message: '排程 ' + (50 + i) })), next: 'C3' } : a ? { items: [], next: null } : { items: mkSched(50, 0, soon), next: 'C2' }; },
  });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('is-side')));
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForFunction(() => /共 100 則/.test(document.getElementById('schedHint').textContent));
  const calls = () => fbCalls.filter((c) => c === '/fb/scheduled').length;
  assert.equal(calls(), 2, '進入照舊自動讀兩批');
  assert.equal(await page.locator('#schedList li').count(), 20, '先 20 則');
  assert.equal(await page.isVisible('#schedPager'), false, '側邊欄不分頁');
  assert.equal((await page.textContent('#schedMore')).trim(), '載入更多');
  if (SHOT) { await page.evaluate(() => document.getElementById('schedMore').scrollIntoView({ block: 'end' })); await page.screenshot({ path: SHOT + '/fbpost-side-more.png' }); }
  await page.click('#schedMore'); await page.click('#schedMore'); await page.click('#schedMore');
  assert.equal(await page.locator('#schedList li').count(), 80);
  await page.waitForTimeout(200);
  assert.equal(calls(), 2, '還剩 20 則，不先讀');
  await page.click('#schedMore');   // 顯示 100、剩 0 → 背景先讀第 3 批
  await page.waitForFunction(() => /共 110 則/.test(document.getElementById('schedHint').textContent));
  assert.equal(calls(), 3, '背景只先讀一批');
  assert.match(api.schedQs[2], /after=C3/);
  assert.equal(await page.isVisible('#schedMore'), true);
  await page.click('#schedMore');
  assert.equal(await page.locator('#schedList li').count(), 110);
  assert.equal(await page.isVisible('#schedMore'), false);
  assert.equal(await page.isVisible('#schedEnd'), true, '已經到底了');
  assert.equal(calls(), 3);
  if (SHOT) { await page.evaluate(() => document.getElementById('schedEnd').scrollIntoView()); await page.screenshot({ path: SHOT + '/fbpost-side-end.png' }); }
  assert.deepEqual(errors, []);
  await page.close();
});

test('外掛側邊欄：背景還沒讀到就按載入更多＝等它接上；網頁版維持分頁', async () => {
  const soon = Math.floor(Date.now() / 1000) + 7200;
  let release; const gate = new Promise((r) => { release = r; });
  const { page, errors } = await newPage('admin', { width: 360, height: 760 }, {
    schedFn: (u) => { const a = u.searchParams.get('after'); return a === 'C3' ? { items: mkSched(5, 30, soon), next: null } : a ? { items: mkSched(10, 20, soon), next: 'C3' } : { items: mkSched(20, 0, soon), next: 'C2' }; }
  });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('is-side')));
  let n = 0;
  await page.route(API_BASE + '/fb/scheduled**', async (r) => { if (++n >= 3) await gate; await r.fallback(); });   // 第 3 批（背景先讀）卡住
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForFunction(() => /共 30 則/.test(document.getElementById('schedHint').textContent) && document.querySelectorAll('#schedList li').length === 20);
  for (let i = 0; n < 3 && i < 100; i++) await page.waitForTimeout(30);
  await page.click('#schedMore');   // 快取裡還有 10 則：馬上接上
  assert.equal(await page.locator('#schedList li').count(), 30);
  await page.click('#schedMore');   // 背景還在讀：轉圈等它
  await page.waitForFunction(() => document.getElementById('schedMore').getAttribute('aria-busy') === 'true');
  release();
  await page.waitForFunction(() => document.querySelectorAll('#schedList li').length === 35);
  assert.equal(n, 3, '沒有重複讀');
  assert.equal(await page.isVisible('#schedEnd'), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('預設粉專＝值班粉專第一個；值班改了且沒手動換過就跟著切；手動換過就不動', async () => {
  const { page, errors, fbCalls, api } = await newPage('admin', undefined, { duty: ['222', '333'] });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#schedList li');
  assert.equal(await page.inputValue('#schedPage'), '222');
  assert.equal(await page.inputValue('#pubPage'), '222');
  assert.deepEqual(api.pubPages, ['222']);
  // 改值班（沒手動換過）：兩個列表都切到新值班粉專並讀取
  await page.click('#dutyBtn');
  await page.click('#dutyList input[value="222"]');
  await page.click('#dutyList input[value="333"]');
  await page.click('#dutyList input[value="111"]');
  await page.click('#dutyOk');
  await page.waitForFunction(() => document.getElementById('schedPage').value === '111');
  assert.equal(await page.inputValue('#pubPage'), '111');
  await page.waitForFunction(() => document.getElementById('schedList').getAttribute('aria-busy') === 'false');
  // 手動換過粉專後，改值班不再動列表
  await page.selectOption('#schedPage', '333');
  await page.waitForFunction(() => document.getElementById('schedList').getAttribute('aria-busy') === 'false');
  await page.click('#dutyBtn');
  await page.click('#dutyList input[value="111"]');
  await page.click('#dutyList input[value="222"]');
  await page.click('#dutyOk');
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue('#schedPage'), '333');
  assert.ok(fbCalls.length > 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('沒有值班粉專：預設第一個粉專；列表／卡片切換記在瀏覽器、不重建資料', async () => {
  const { page, errors } = await newPage('admin');
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#schedList li');
  assert.equal(await page.inputValue('#schedPage'), '111');
  assert.equal(await page.$eval('#listCard', (e) => e.dataset.view), 'list');
  const li = await page.$('#schedList li');
  await page.click('#ctl-sched [data-view=card]');
  assert.equal(await page.$eval('#listCard', (e) => e.dataset.view), 'card');
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.fbpost.view')), 'card');
  assert.equal(await li.evaluate((e) => e.isConnected), true, '切換不重建列');
  assert.equal(await page.$eval('#schedList', (e) => getComputedStyle(e).display), 'grid');
  await page.click('[data-tab=pub]');
  assert.equal(await page.$eval('#ctl-pub [data-view=card]', (e) => e.getAttribute('aria-pressed')), 'true', '兩個分頁共用');
  await page.reload();
  await page.waitForSelector('#schedList li');
  assert.equal(await page.$eval('#listCard', (e) => e.dataset.view), 'card', '重新整理還在');
  assert.deepEqual(errors, []);
  await page.close();
});

test('控制列在分頁右邊同一列；窄版與側邊欄換到下一行、不超出畫面', async () => {
  const wide = await newPage('admin');
  await wide.page.goto(srv.url + 'tools/fbpost/index.html');
  await wide.page.waitForSelector('#schedList li');
  const box = (pg, sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, b: r.bottom }; });
  const t = await box(wide.page, '#tabs'), c = await box(wide.page, '#ctl-sched');
  assert.ok(c.x > t.x + t.w - 1 && Math.abs(c.y - t.y) < 40, '電腦版同一列、在右邊');
  if (SHOT) { await wide.page.screenshot({ path: SHOT + '/fbpost-list-desktop.png' }); await wide.page.click('#ctl-sched [data-view=card]'); await wide.page.screenshot({ path: SHOT + '/fbpost-cards-desktop.png' }); }
  await wide.page.close();
  const side = await newPage('admin', { width: 360, height: 760 });
  await side.page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('is-side')));
  await side.page.goto(srv.url + 'tools/fbpost/index.html');
  await side.page.waitForSelector('#schedList li');
  const t2 = await box(side.page, '#tabs'), c2 = await box(side.page, '#ctl-sched');
  assert.ok(c2.y >= t2.b - 1, '側邊欄控制列在下一行');
  assert.ok(await overflow(side.page) <= 0, '不超出畫面');
  if (SHOT) { await side.page.click('#ctl-sched [data-view=card]'); await side.page.screenshot({ path: SHOT + '/fbpost-side.png' }); }
  assert.deepEqual(side.errors, []);
  await side.page.close();
  const phone = await newPage('admin', { width: 390, height: 800 });
  await phone.page.goto(srv.url + 'tools/fbpost/index.html');
  await phone.page.waitForSelector('#schedList li');
  assert.ok(await overflow(phone.page) <= 0);
  const c3 = await box(phone.page, '#ctl-sched'), t3 = await box(phone.page, '#tabs');
  assert.ok(c3.y >= t3.b - 1, '手機控制列在下一行');
  await phone.page.close();
});

test('第一則留言移除預覽（實驗功能）：/fb/me 沒開不顯示；開了在「留言內容」右側，勾了才送 noPreview、結果顯示已試移除預覽、送出完成恢復不勾', async () => {
  // 沒開：不顯示、不送
  let t = await newPage('admin', undefined, { me: { admin: true, perms: [], noPreview: false } });
  await t.page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(t.page);
  assert.equal(await t.page.isVisible('#npChk'), false);
  await t.page.close();
  // 開了
  const { page, api, errors } = await newPage('admin', undefined, {
    me: { admin: true, perms: [], noPreview: true },
    post: (targets, body) => ({ results: targets.map((x) => ({ page: x.page, ok: true, postId: x.page + '_9', scheduled: false, comment: 'done', ...(/name="noPreview"/.test(body) ? { preview: 'tried' } : {}) })) })
  });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await openPost(page);
  await page.waitForSelector('#npChk:not([hidden])');
  const lbl = await page.locator('label[for=lead]').boundingBox(), chk = await page.locator('#npChk').boundingBox();
  assert.ok(chk.x > lbl.x && Math.abs((chk.y + chk.height / 2) - (lbl.y + lbl.height / 2)) < 8, '在留言內容標題右側同一列');
  assert.equal(await page.isChecked('#noPreview'), false, '預設不勾');
  assert.equal(await page.isVisible('#npNote'), false);
  await page.check('#noPreview');
  assert.equal(await page.isVisible('#npNote'), true);
  if (SHOT) await page.locator('.lbl-row').screenshot({ path: path.join(SHOT, 'fbpost-np-chk.png') });
  await page.fill('#link', 'https://news.tvbs.com.tw/life/1');
  await page.fill('#msg', '第一則');
  await withPhoto(page);
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.match(api.posts[0], /name="noPreview"\r\n\r\n1\r\n/);
  assert.match(await page.textContent('#doneList'), /第 1 則已試移除預覽/);
  assert.equal(await page.isChecked('#noPreview'), false, '送出完成恢復不勾');
  assert.equal(await page.isVisible('#npNote'), false);
  await page.click('#doneAgain');
  // 沒勾：不送
  await page.fill('#link', 'https://news.tvbs.com.tw/life/2');
  await page.fill('#msg', '第二則');
  await withPhoto(page);
  await page.click(chip(111) + ' .chip-l');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.doesNotMatch(api.posts[1], /name="noPreview"/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('已排程／已發佈列表：第 1 則留言移除預覽結果接在留言狀態後面', async () => {
  const { page } = await newPage('admin', undefined, { pub: [{ id: '111_5', message: '已發的貼文', time: new Date().toISOString(), picture: null, url: null, comment: { status: 'done', preview: 'tried' } }, { id: '111_6', message: '另一則', time: new Date().toISOString(), picture: null, url: null, comment: { status: 'done', preview: 'failed' } }] });
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.click('#tabs [data-tab=pub]');
  await page.waitForSelector('#tab-pub li[data-id="111_6"]');
  assert.match(await page.textContent('#tab-pub li[data-id="111_5"] .cm'), /已留言．第 1 則已試移除預覽/);
  assert.match(await page.textContent('#tab-pub li[data-id="111_6"] .cm'), /第 1 則移除預覽失敗/);
  await page.close();
});
