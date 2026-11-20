// 數據報表：以 page.route 模擬後端 /fb/reports/posts，不打真的臉書。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { API_BASE } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.env.SHOT_DIR;
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const PAGES = [{ id: '111', short: '新聞', order: 1 }, { id: '222', short: '少康', order: 2 }];
const taipei = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const today = () => taipei(Date.now());
// 台北 d 天前某時刻（h 時 m 分）→ ISO
const at = (d, h, m = 0) => { const day = taipei(Date.now() - d * 86400e3); return new Date(Date.parse(day + 'T00:00:00+08:00') + (h * 60 + m) * 60e3).toISOString(); };
const P = (page, n, time, type, v) => ({ page, id: page + '_' + n, time, type, text: `${page} 第 ${n} 篇 貼文摘要`, url: 'https://www.facebook.com/' + page + '_' + n, views: null, reach: null, clicks: null, reactions: null, comments: null, shares: null, missing: {}, ...v });

// 111：3 篇分 2 批（跨午夜 23:59／00:00）；222：2 篇 1 批，其中一篇瀏覽未知
function dataset() {
  return {
    111: [
      [P('111', 1, at(1, 23, 59), 'image', { views: 1000, clicks: 40, reactions: 10, comments: 5, shares: 5, reach: 200 }),
        P('111', 2, at(0, 0, 0), 'video', { views: 3000, clicks: 10, reactions: 6, comments: 2, shares: 2, reach: 50 })],
      [P('111', 3, at(0, 1), 'reels', { views: 500, clicks: 1, reactions: 2, comments: 1, shares: 1, reach: null, missing: { reach: 'unverified' } })]
    ],
    222: [[P('222', 1, at(2, 9), 'text', { views: null, clicks: 3, reactions: 1, comments: 0, shares: 0, missing: { views: 'no_data' } }),
      P('222', 2, at(0, 2), 'link', { views: 200, clicks: 5, reactions: 0, comments: 0, shares: 0 })]]
  };
}

async function newPage({ viewport = { width: 1280, height: 900 }, handler } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [], calls = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const data = dataset();
  const st = { asOf: Math.floor(Date.now() / 1000), scopeBad: false, hold: null, throttleOnce: false };
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request(), url = new URL(req.url()), p = url.pathname;
    const json = (d, status = 200) => r.fulfill({ status, headers: CORS, json: status === 200 ? { ok: true, data: d } : d }).then(() => true);   // true＝已回應
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (p === '/auth/status') return json({ company: true });
    if (p === '/fb/pages') return json(st.pages || PAGES);
    if (p === '/fb/access') return json({ mode: 'admin' });
    if (p === '/fb/me') return json({ admin: true, perms: ['view'] });
    if (p === '/fb/reports/posts') {
      const q = Object.fromEntries(url.searchParams);
      calls.push(q);
      if (handler && (await handler(q, json, st))) return;
      if (st.hold) await st.hold;
      if (st.scopeBad) return json({ ok: false, code: 'report_scope', error: '已變更' }, 409);
      let page2, k;
      if (q.cursor) [page2, k] = q.cursor.split('~').map((x, i) => (i ? Number(x) : x)); else { page2 = q.page; k = 0; }
      if (st.throttleOnce) { st.throttleOnce = false; return json({ items: [], next: page2 + '~' + k, status: 'throttled', issues: ['throttled'], asOf: st.asOf, scope: 'S' }); }
      const batches = data[page2];
      return json({ items: batches[k], next: k + 1 < batches.length ? page2 + '~' + (k + 1) : null, status: 'ok', issues: [], asOf: st.asOf, scope: 'S' });
    }
    return json({ ok: false, code: 'not_found' }, 404);
  });
  await page.goto(srv.url + 'tools/fbreports/index.html');
  await page.waitForSelector('#app:not([hidden])');
  return { page, errors, calls, st };
}
// 下拉多選：打開 → 勾／取消 → 按 Esc 關閉
async function pick(page, dd, sel, on = true) {
  if (!(await page.locator('#' + dd).evaluate((d) => d.open))) await page.click(`#${dd} summary`);
  const i = page.locator(`#${dd} ${sel}`);
  if (on) await i.check(); else await i.uncheck();
  await page.keyboard.press('Escape');
}
const kpi = async (page, name) => { const k = page.locator('.kpi', { hasText: name }); const v = await k.locator('strong').innerText(); const n = await k.locator('small').count() ? (await k.locator('small').innerText()).split('．')[0] : ''; return /篇有資料/.test(n) ? `${v}（${n}）` : v; };

test('開啟只載入粉專、預設第一個粉專、按查詢才讀報表', async () => {
  const { page, errors, calls } = await newPage();
  assert.equal(calls.length, 0);
  assert.equal(await page.locator('#pageChips input[value="111"]').isChecked(), true);
  assert.equal(await page.locator('#pageChips input[value="222"]').isChecked(), false);
  assert.equal(await page.locator('#report').isHidden(), true);
  assert.equal(await page.locator('#probeBtn').isVisible(), true, '系統管理者看得到欄位檢查');
  // 下拉：預設收起、按鈕顯示選了誰；打開後點外面關閉；Esc 關閉且焦點回按鈕；同時只開一個
  assert.equal(await page.locator('#pageSum').innerText(), '新聞');
  assert.equal(await page.locator('#typeSum').innerText(), '全部類型');
  assert.equal(await page.locator('#pageChips').isVisible(), false);
  await page.click('#pageDd summary');
  assert.equal(await page.locator('#pageChips').isVisible(), true);
  await page.click('#typeDd summary');
  assert.equal(await page.locator('#pageChips').isVisible(), false, '開另一個時先關前一個');
  await page.click('.rp-head h1');
  assert.equal(await page.locator('#typeChips').isVisible(), false, '點外面關閉');
  await page.focus('#pageDd summary'); await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#pageChips').isVisible(), true, '↓ 打開並移到第一個選項');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space');
  assert.equal(await page.locator('#pageSum').innerText(), '未選擇');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pageChips').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SUMMARY');
  assert.deepEqual(errors, []);
  await page.close();
});

test('兩個粉專＋跨午夜：總覽七項、互動率口徑、續頁共用 asOf 與範圍代碼、明細與下鑽', async () => {
  const { page, errors, calls } = await newPage();
  await pick(page, 'pageDd', 'input[name="pageAll"]');
  assert.equal(await page.locator('#pageSum').innerText(), '全部粉專');
  if (SHOT) { await page.click('#pageDd summary'); await page.screenshot({ path: path.join(SHOT, 'fbreports-dd-open.png'), clip: { x: 0, y: 0, width: 1280, height: 360 } }); await page.keyboard.press('Escape'); }
  await page.click('#queryBtn');
  await page.waitForFunction(() => /已完成 2 個粉專，共 5 篇/.test(document.getElementById('qsText').textContent));
  // 第一批 page＋日期；續頁只帶游標；第二個粉專帶回 asOf 與範圍代碼
  assert.deepEqual(Object.keys(calls[0]).sort(), ['from', 'page', 'to']);
  assert.ok(calls[1].cursor);
  assert.equal(calls[2].page, '222'); assert.ok(calls[2].asOf); assert.equal(calls[2].scope, 'S');
  assert.equal(await kpi(page, '發文數'), '5');
  assert.equal(await kpi(page, '瀏覽數'), '4,700（4／5 篇有資料）');
  assert.equal(await kpi(page, '互動數'), '35');
  assert.equal(await kpi(page, '互動率'), '12.00%（2／5 篇有資料）', '(20+10)/(200+50)：只算互動與觸及都有的貼文');
  assert.equal(await kpi(page, '點擊數'), '59');
  assert.match(await page.locator('#qsMeta').innerText(), /依貼文發布日統計.*資料讀取時間/);
  // 跨午夜：23:59 算昨天、00:00 算今天
  const vals = await page.$$eval('#trend details tbody tr', (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent)));
  const t = vals.find((r) => r[0] === new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
  assert.equal(t[1], '3');
  // 類型篩選只用已載入結果
  const n = calls.length;
  await pick(page, 'typeDd', 'input[value="video"]', false);
  assert.equal(await page.locator('#typeSum').innerText(), '文字等 6 個');
  assert.equal(await kpi(page, '發文數'), '4');
  assert.equal(calls.length, n);
  await pick(page, 'typeDd', 'input[value="video"]');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbreports-overview.png'), fullPage: true });
  // 類型成效
  await page.click('#t-types');
  assert.equal(await page.locator('#typeTable tbody tr').count(), 5);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbreports-types.png'), fullPage: true });
  // 粉專成效 → 點粉專名稱看該粉專的貼文
  await page.click('#t-pages');
  await page.click('#pageTable [data-drill="222"]');
  assert.equal(await page.locator('#p-posts').isVisible(), true);
  assert.equal(await page.locator('#postTable tbody tr').count(), 2);
  assert.match(await page.locator('#drillText').innerText(), /少康/);
  await page.click('#drillClear');
  assert.equal(await page.locator('#postTable tbody tr').count(), 5);
  // 排序：瀏覽由高到低，未知放最後
  await page.click('[data-sort="posts:views"]');
  const v = await page.$$eval('#postTable tbody tr td:nth-child(5)', (c) => c.map((x) => x.textContent));
  assert.deepEqual(v, ['3,000', '1,000', '500', '200', '—']);
  assert.equal(await page.locator('#postTable a[target=_blank]').first().getAttribute('href'), 'https://www.facebook.com/111_2');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbreports-posts.png'), fullPage: true });
  // 方向鍵切分頁
  await page.focus('#t-posts'); await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#p-overview').isVisible(), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('限流：保留游標，按繼續讀取接著讀', async () => {
  const { page, st, calls } = await newPage();
  st.throttleOnce = true;
  await page.click('#queryBtn');
  await page.waitForSelector('#moreBtn:not([hidden])');
  assert.match(await page.locator('#qsWarn').innerText(), /限流/);
  await page.click('#moreBtn');
  await page.waitForFunction(() => /已完成 1 個粉專，共 3 篇/.test(document.getElementById('qsText').textContent));
  assert.ok(calls[1].cursor, '續查帶原本的游標');
  await page.close();
});

test('範圍變更：停止續頁、清除報表並重讀粉專', async () => {
  const { page, st } = await newPage();
  await page.click('#queryBtn');
  await page.waitForFunction(() => /共 3 篇/.test(document.getElementById('qsText').textContent));
  st.scopeBad = true; st.pages = [PAGES[1]];
  await page.click('#queryBtn');
  await page.waitForSelector('#report', { state: 'hidden' });
  await page.waitForFunction(() => document.querySelectorAll('#pageChips input[name=page]').length === 1);
  assert.match(await page.locator('#toast').innerText(), /已變更/);
  assert.equal(await page.locator('#qstate').isHidden(), true);
  await page.close();
});

test('舊查詢晚回不覆蓋畫面', async () => {
  let release;
  const { page } = await newPage({
    handler: async (q, json, st) => {
      if (q.page === '111' && !st.slowDone) { st.slowDone = true; await new Promise((r) => { release = r; }); return json({ items: [P('111', 9, at(0, 3), 'text', { views: 999999 })], next: null, status: 'ok', issues: [], asOf: st.asOf, scope: 'S' }); }
      return undefined;
    }
  });
  await page.click('#queryBtn');                                         // 第一次：111 卡住
  await page.waitForFunction(() => /讀取中/.test(document.getElementById('qsText').textContent));
  await pick(page, 'pageDd', 'input[value="111"]', false);
  await pick(page, 'pageDd', 'input[value="222"]');
  await page.click('#queryBtn');                                         // 第二次：222
  await page.waitForFunction(() => /共 2 篇/.test(document.getElementById('qsText').textContent));
  release();
  await page.waitForTimeout(300);
  assert.equal(await kpi(page, '發文數'), '2');
  assert.doesNotMatch(await kpi(page, '瀏覽數'), /999/);
  await page.close();
});

test('期間驗證、零篇、窄窗不撐寬', async () => {
  const { page, errors } = await newPage({ viewport: { width: 360, height: 780 }, handler: (q, json, st) => json({ items: [], next: null, status: 'ok', issues: [], asOf: st.asOf, scope: 'S' }) });
  await page.selectOption('#range', 'custom');
  await page.fill('#from', '2026-01-01'); await page.fill('#to', '2026-03-01');
  await page.click('#queryBtn');
  assert.match(await page.locator('#formErr').innerText(), /31 天/);
  await page.selectOption('#range', '7');
  if (SHOT) { await page.click('#typeDd summary'); await page.screenshot({ path: path.join(SHOT, 'fbreports-dd-mobile.png') }); await page.keyboard.press('Escape'); }
  await page.click('#queryBtn');
  await page.waitForFunction(() => /共 0 篇/.test(document.getElementById('qsText').textContent));
  assert.equal(await kpi(page, '發文數'), '0');
  assert.equal(await kpi(page, '瀏覽數'), '0');
  assert.equal(await kpi(page, '互動率'), '—');
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 360, 'scrollWidth ' + w);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbreports-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});
