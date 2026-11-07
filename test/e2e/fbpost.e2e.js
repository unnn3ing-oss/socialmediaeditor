// 排程發布：假後端（/fb/*、/fetch/*），不打真的臉書。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { API_BASE, fakeAsset } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const U1 = 'utm_source=facebook&utm_medium=fbarticlepic';
const U2 = 'utm_source=facebook&utm_medium=tvbsteatimenewspic';
const PAGES = [
  { id: '111', name: 'TVBS新聞', code: 'news', label: '新聞', utm: U1, sort: 1, link: '', picture: '', followers: 1 },
  { id: '222', name: 'TVBS娛樂', code: 'ent', label: '娛樂', utm: U2, sort: 2, link: '', picture: '', followers: 1 },
];

// 類似 TVBS 文章頁：h1、og:image、figcaption（圖／TVBS）、#標籤連結
const IMG = 'https://cc.tvbs.com.tw/img/upload/2026/10/26/20261026101010-aa.jpg';
const ARTICLE = `<!doctype html><html><head><meta charset="utf-8">
<title>颱風假最新！北北基桃明天照常上班上課｜TVBS新聞網</title>
<meta property="og:image" content="${IMG}"></head><body><article>
<h1>颱風假最新！北北基桃　明天照常上班上課</h1>
<figure><img src="${IMG}?w=800" alt="颱風"><figcaption>北北基桃宣布明天照常上班上課。（圖／TVBS）</figcaption></figure>
<figure><img src="https://cc.tvbs.com.tw/img/b.jpg"><figcaption>（示意圖／shutterstock達志影像）</figcaption></figure>
<div class="article-tags"><a href="/tag/颱風">#颱風</a><a href="/tag/氣象署">#氣象署</a><a href="/tag/颱風假">#颱風假</a></div>
</article></body></html>`;
const URL1 = 'https://news.tvbs.com.tw/life/3012345';
const URL_ENT = 'https://news.tvbs.com.tw/entertainment/3012346';

// api.failPage：送到這個粉專就失敗一次；api.posts：收到的發文（multipart 欄位）
const LONG_CURSOR = 'QVFI' + 'x'.repeat(700) + '.%3D';
// duty：'skip'＝跳出值班視窗就按「先不選」（舊測試照舊）；'ask'＝留著讓測試操作；物件＝預先存好的值班 { ids, main, exp }
// rundown：預先打開 Rundown 開關
async function skipDuty(page) {
  await page.waitForSelector('#dutyDlg[open]');
  await page.click('#dutySkip');
  await page.waitForSelector('#dutyDlg:not([open])', { state: 'attached' });
}
async function open({ company = false, viewport = { width: 1280, height: 900 }, duty = 'skip', rundown = false, pages = PAGES } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const now = Math.floor(Date.now() / 1000);
  const api = {
    requestPaths: [], failPage: null, posts: [], afters: [], cancels: [], reschedules: [], rescheduleError: null, retries: [], dismisses: [], articleReq: 0, imageFail: 0, rundown: [], rundownFail: null,
    scheduled: {
      111: [
        { id: '111_7', message: '排好的貼文', at: now + 7200, picture: '', created: '', comment: { id: 'cm1', status: 'pending', error: null, message: 'x' } },
        { id: '111_8', message: '留言出事的貼文', at: now + 9000, picture: '', created: '', comment: { id: 'cm2', status: 'failed', error: '貼文沒有出現', message: 'x' } },
      ],
      222: [],
    },
    failedComments: [{ id: 'c1', page: '111', post: '111_8', message: '看更多新聞內容\nhttps://news.tvbs.com.tw/life/1', status: 'failed', error: '貼文沒有出現', due: now - 60, updated: now - 30, dismissed: false }],
  };
  await page.addInitScript(({ duty, rundown }) => {
    try {
      if (duty && typeof duty === 'object') localStorage.setItem('tbx.fbpost.duty.v1', JSON.stringify(duty));
      if (rundown) localStorage.setItem('tbx.fbpost.rundown.v1', JSON.stringify({ on: true }));
    } catch {}
    try { localStorage.setItem('tbx.company', JSON.stringify({ token: 'test', exp: Math.floor(Date.now() / 1000) + 3600 })); } catch {}
    window.__notes = [];
    class FakeNotification { constructor(t, o) { window.__notes.push({ t, o }); } static async requestPermission() { FakeNotification.permission = 'granted'; return 'granted'; } }
    FakeNotification.permission = 'default';
    window.Notification = FakeNotification;
  }, { duty, rundown });
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const u = new URL(req.url());
    api.requestPaths.push(u.pathname);
    const okJ = (data) => r.fulfill({ headers: CORS, json: { ok: true, data } });
    const bad = (code, error, status = 400) => r.fulfill({ status, headers: CORS, json: { ok: false, code, error } });
    if (/^\/assets\//.test(u.pathname)) return company ? r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset([30, 60, 120]) }) : r.fulfill({ status: 404, headers: CORS, body: '' });
    if (u.pathname === '/fb/pages') return okJ(pages);
    if (api.hold && /^\/fb\/(scheduled|insights)$/.test(u.pathname)) await api.hold;   // 測骨架屏：先卡住回應
    if (u.pathname === '/fb/scheduled') {
      if (api.schedError) return bad('fb_error', '排程刷新失敗', 502);
      return okJ({ items: api.scheduled[u.searchParams.get('page')] || [] });
    }
    if (u.pathname === '/fb/posts') {
      if (api.postsError) return bad('fb_error', '貼文刷新失敗', 502);
      // 第一頁帶一個很長的游標（臉書真的會給這種），第二頁沒有下一頁
      const after = u.searchParams.get('after');
      if (!after) return okJ({ items: [{ id: '111_1', message: '舊貼文', created: new Date().toISOString(), url: 'https://facebook.com/1', picture: '', reactions: 5, comments: 2, shares: 1 }], next: LONG_CURSOR });
      api.afters.push(after);
      return okJ({ items: [
        ...(api.moreDuplicate ? [{ id: '111_1', message: '舊貼文更新', created: new Date().toISOString(), url: 'https://facebook.com/1', picture: '', reactions: 6, comments: 2, shares: 1 }] : []),
        { id: '111_2', message: '更舊的貼文', created: new Date().toISOString(), url: 'https://facebook.com/2', picture: '', reactions: 1, comments: 0, shares: 0 }
      ], next: null });
    }
    if (u.pathname === '/fb/insights') {
      if (api.insightsError) return bad('fb_error', '成效讀取失敗', 502);
      return okJ({ post: u.searchParams.get('post'), metrics: { post_media_view: 1234, post_clicks: 56 }, missing: [] });
    }
    if (u.pathname === '/fb/cancel') {
      const b = JSON.parse(req.postData());
      api.cancels.push(b.post);
      for (const [id, items] of Object.entries(api.scheduled)) api.scheduled[id] = items.filter(it => it.id !== b.post);
      return okJ({ post: b.post, canceled: true });
    }
    if (u.pathname === '/fb/reschedule') {
      const b = JSON.parse(req.postData());
      api.reschedules.push(b);
      if (api.rescheduleError) return bad(api.rescheduleError, '已發布', 409);
      for (const list of Object.values(api.scheduled)) for (const it of list) if (it.id === b.post) it.at = b.time;
      return okJ({ ok: true, post: b.post, time: b.time });
    }
    if (u.pathname === '/fb/comments') return okJ({ items: api.failedComments });
    if (u.pathname === '/fb/comment/retry' || u.pathname === '/fb/comment/dismiss') {
      const id = JSON.parse(req.postData()).id;
      (u.pathname.endsWith('retry') ? api.retries : api.dismisses).push(id);
      api.failedComments = api.failedComments.filter((c) => c.id !== id);
      return okJ({ ok: true });
    }
    if (u.pathname === '/fb/post') {
      const fd = await new Response(req.postDataBuffer(), { headers: { 'content-type': req.headers()['content-type'] } }).formData();
      const f = (k) => { const v = fd.get(k); return typeof v === 'string' ? v.replace(/\r\n/g, '\n') : v; };
      const rec = { page: f('page'), message: f('message'), scheduledAt: f('scheduledAt'), textPreset: f('textPreset'), comment: f('comment'), hasImage: typeof fd.get('image') === 'object' && fd.get('image') !== null };
      api.posts.push(rec);
      if (api.postHold) await api.postHold;
      if (api.failPage === rec.page) { api.failPage = null; return bad('fb_permission', '沒有這個粉專的發文權限。', 403); }
      return okJ({ id: rec.page + '_99', scheduled: !!rec.scheduledAt, at: Number(rec.scheduledAt) || null, comment: { status: rec.comment ? (rec.scheduledAt ? 'queued' : 'done') : 'none' } });
    }
    if (u.pathname === '/rundown') {
      const b = JSON.parse(req.postData());
      api.rundown.push(b);
      if (api.rdHold) await api.rdHold;
      if (api.rundownFail) return bad('rundown_failed', api.rundownFail, 502);
      if (b.action === 'ping') return okJ({ title: 'FB RUNDOWN(2026)', sheets: ['2026/11', '2026/10'] });
      return okJ({ results: b.entries.map((e, i) => ({ ok: true, status: i ? 'insert' : 'write', cell: '2026/11!AE' + (100 + i), time: e.time })) });
    }
    if (u.pathname === '/fetch/article') { api.articleReq++; return okJ({ url: u.searchParams.get('url'), html: ARTICLE }); }
    if (u.pathname === '/fetch/image') {
      if (api.imageFail > 0) { api.imageFail--; return bad('bad_request', '圖片讀不到', 502); }
      return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset([200, 120, 40]) });
    }
    return r.fulfill({ status: 404, headers: CORS, body: '' });
  });
  if (company) {   // 公司模式：用外殼測試頁開工具（iframe），之後的操作都對 iframe
    await page.goto(srv.url + 'test/fixtures/company-host.html?tool=fbpost');
    const fr = await (await page.waitForSelector('iframe[name=tool]')).contentFrame();
    await fr.waitForLoadState('load');
    await fr.waitForSelector('#pages .pg', { state: 'attached' });
    if (duty === 'skip') await skipDuty(fr);
    return { page: fr, api, errors };
  }
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  if (duty === 'skip') await skipDuty(page);
  return { page, api, errors };
}

async function querySched(page, pageId) {
  await page.click('#tabs [data-tab=sched]');
  if (pageId !== undefined) await page.selectOption('#schedPage', pageId);
  await page.click('#schedReload');
}
async function queryStats(page) {
  await page.click('#tabs [data-tab=stats]');
  await page.click('#statsReload');
}

async function photo(page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const x = c.getContext('2d'); x.fillStyle = '#3a6'; x.fillRect(0, 0, 1200, 900);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'p.png', { type: 'image/png' }));
    document.getElementById('canvasWrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('#clearImg:not([hidden])');
}
const chip = (id) => `.pg[data-page="${id}"]`;
const pick = (page, id) => page.click(`${chip(id)} .pg-main`);
async function fillUrl(page, url, via = 'enter') {
  await page.fill('#url', url);
  if (via === 'enter') await page.press('#url', 'Enter');
  else await page.dispatchEvent('#url', 'paste');
  await page.waitForFunction(() => /已帶入/.test(document.querySelector('#urlHint').textContent) && !document.querySelector('.is-skel'));
}

const automaticReads = (api) => api.requestPaths.filter((p) => /^\/fb\/(scheduled|posts|insights)$/.test(p));
const readsOf = (api, path) => api.requestPaths.filter(p => p === path).length;

async function reopen(page) {
  await page.reload();
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  await skipDuty(page);
}

test('查詢快取：已發布更名，排程切換粉專及重開還原，空列表也保存', async () => {
  const { page, api, errors } = await open();
  assert.equal(await page.textContent('#tabs [data-tab=stats]'), '已發布');
  assert.equal(await page.textContent('#schedReload'), '刷新');
  assert.equal(await page.textContent('#statsReload'), '刷新');
  await querySched(page, '111');
  await page.waitForFunction(() => document.querySelectorAll('#schedList .item').length === 2);
  assert.match(await page.textContent('#schedHint'), /上次查詢/);
  await page.selectOption('#schedPage', '222');
  assert.equal(await page.locator('#schedList .item').count(), 0);
  await page.click('#schedReload');
  await page.waitForFunction(() => !document.getElementById('schedReload').disabled);
  assert.match(await page.textContent('#schedHint'), /上次查詢/);
  assert.equal(readsOf(api, '/fb/scheduled'), 2);
  await page.selectOption('#schedPage', '111');
  await page.waitForFunction(() => document.querySelectorAll('#schedList .item').length === 2);
  await reopen(page);
  await page.click('#tabs [data-tab=sched]');
  assert.equal(await page.locator('#schedList .item').count(), 2);
  await page.selectOption('#schedPage', '222');
  assert.equal(await page.locator('#schedList .item').count(), 0);
  assert.match(await page.textContent('#schedHint'), /上次查詢/);
  assert.equal(readsOf(api, '/fb/scheduled'), 2, '重開與還原空列表都不讀 Facebook');
  assert.deepEqual(errors, []);
});

test('查詢快取：刷新失敗保留排程與已發布舊資料，成功才替換', async () => {
  const { page, api, errors } = await open();
  await querySched(page);
  await page.waitForSelector('#schedList .item');
  api.schedError = true;
  await page.click('#schedReload');
  await page.waitForFunction(() => /排程刷新失敗/.test(document.getElementById('schedHint').textContent));
  assert.equal(await page.locator('#schedList .item').count(), 2);
  await queryStats(page);
  await page.waitForSelector('#statsList .item');
  await page.click('#statsList .item button');
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent));
  api.postsError = true;
  await page.click('#statsReload');
  await page.waitForFunction(() => /貼文刷新失敗/.test(document.getElementById('statsHint').textContent));
  assert.match(await page.textContent('#statsList'), /舊貼文/);
  // 失敗的刷新不能使已保存的成效失效。
  await reopen(page);
  await page.click('#tabs [data-tab=stats]');
  await page.click('#statsList .item button');
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent));
  assert.equal(readsOf(api, '/fb/insights'), 1);
  assert.equal(readsOf(api, '/fb/posts'), 2);
  api.postsError = false;
  await page.click('#statsReload');
  await page.waitForFunction(() => !document.getElementById('statsReload').disabled && !document.getElementById('statsList').hasAttribute('aria-busy'));
  await page.click('#statsList .item button');
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent));
  assert.equal(readsOf(api, '/fb/insights'), 2, '成功刷新後才重新讀取成效');
  assert.deepEqual(errors, []);
});

test('查詢快取：已發布分頁與成效跨重開保存，刷新重設分頁', async () => {
  const { page, api, errors } = await open();
  await queryStats(page);
  await page.waitForSelector('#statsList .item');
  await page.click('#statsList .item button');
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent));
  await page.selectOption('#statsPage', '222');
  await page.selectOption('#statsPage', '111');
  assert.match(await page.textContent('#statsList'), /舊貼文/);
  assert.equal(readsOf(api, '/fb/posts'), 1);
  api.moreDuplicate = true;
  await page.click('#statsMore');
  await page.waitForFunction(() => document.querySelectorAll('#statsList .item').length === 2);
  assert.equal(api.afters[0], LONG_CURSOR);
  await reopen(page);
  await page.click('#tabs [data-tab=stats]');
  assert.equal(await page.locator('#statsList .item').count(), 2);
  assert.equal(await page.isHidden('#statsMore'), true);
  assert.match(await page.textContent('#statsHint'), /上次查詢/);
  await page.locator('#statsList .item').first().getByRole('button', { name: '看成效' }).click();
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent));
  assert.equal(readsOf(api, '/fb/posts'), 2);
  assert.equal(readsOf(api, '/fb/insights'), 1);
  await page.click('#statsReload');
  await page.waitForFunction(() => document.querySelectorAll('#statsList .item').length === 1 && !document.getElementById('statsReload').disabled);
  assert.equal(await page.isVisible('#statsMore'), true);
  assert.equal(readsOf(api, '/fb/posts'), 3);
  assert.deepEqual(errors, []);
});

for (const pending of [false, true]) test(`查詢快取：其他分頁更新列表後，${pending ? '進行中的' : '尚未開始的'}成效讀取不留下舊結果或忙碌狀態`, async () => {
  const { page, api, errors } = await open();
  await queryStats(page);
  await page.waitForSelector('#statsList .item');
  let release = () => {};
  if (pending) {
    api.hold = new Promise((r) => { release = r; });
    await page.click('#statsList .item button');
    await page.waitForSelector('#statsList .ins[aria-busy=true]');
  }
  try {
    await page.evaluate(() => {
      const key = 'tbx.fbpost.query-cache.v1:published:111';
      const saved = JSON.parse(localStorage.getItem(key));
      saved.generation = 'newer-generation-from-other-tab';
      localStorage.setItem(key, JSON.stringify(saved));
    });
    if (pending) { release(); api.hold = null; }
    else await page.click('#statsList .item button');
    await page.waitForFunction(() => /列表已更新，請按刷新/.test(document.querySelector('#statsList .ins').textContent));
    assert.equal(await page.getAttribute('#statsList .ins', 'aria-busy'), null);
    assert.equal(await page.isDisabled('#statsList .item button'), false);
    assert.equal(readsOf(api, '/fb/insights'), pending ? 1 : 0, '過期列表不得開始新查詢');
    const saved = await page.evaluate(() => localStorage.getItem('tbx.fbpost.query-cache.v1:insights:111%2F111_1'));
    assert.equal(saved, null, '過期 generation 的成效不寫入快取');
    assert.deepEqual(errors, []);
  } finally { release(); api.hold = null; }
});

test('查詢快取：取消與改時間成功會更新本機，重開不還原舊排程', async () => {
  const { page, api, errors } = await open();
  await querySched(page, '111');
  await page.waitForSelector('#schedList .item');
  await page.locator('#schedList .item').first().getByRole('button', { name: '取消排程' }).click();
  await page.click('#cfYes');
  await page.waitForFunction(() => document.querySelectorAll('#schedList .item').length === 1);
  const before = await page.locator('#schedList .item').getAttribute('data-at');
  await page.click('#schedList .item [data-act=resched]');
  await page.click('#rsEditor [data-add="60"]');
  await page.click('#rsYes');
  await page.waitForFunction(() => /已改成/.test(document.getElementById('schedHint').textContent));
  const after = await page.locator('#schedList .item').getAttribute('data-at');
  assert.notEqual(after, before);
  await reopen(page);
  await page.click('#tabs [data-tab=sched]');
  assert.equal(await page.locator('#schedList .item').count(), 1);
  assert.equal(await page.locator('#schedList .item').getAttribute('data-post'), '111_8');
  assert.equal(await page.locator('#schedList .item').getAttribute('data-at'), after);
  assert.equal(readsOf(api, '/fb/scheduled'), 1);
  assert.deepEqual(errors, []);
});

test('排程與成效：進入、切頁、切粉專及值班不查詢，按查詢才讀 Facebook', async () => {
  const { page, api, errors } = await open();
  assert.equal(await page.isVisible('#tab-records'), true);
  assert.deepEqual(automaticReads(api), []);
  await page.click('#tabs [data-tab=sched]');
  await page.selectOption('#schedPage', '222');
  await page.click('#tabs [data-tab=stats]');
  await page.selectOption('#statsPage', '222');
  await page.click('#dutyBtn');
  await dutyPick(page, '111');
  await page.click('#dutyOk');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(100);
  assert.deepEqual(automaticReads(api), [], '顯示資料與切換偏好都不讀 Facebook 列表');
  await querySched(page);
  await page.waitForSelector('#schedList .item');
  assert.deepEqual(automaticReads(api), ['/fb/scheduled']);
  await queryStats(page);
  await page.waitForSelector('#statsList .item');
  assert.deepEqual(automaticReads(api), ['/fb/scheduled', '/fb/posts']);
  await page.click('#statsList .item button');
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent));
  assert.deepEqual(automaticReads(api), ['/fb/scheduled', '/fb/posts', '/fb/insights']);
  assert.deepEqual(errors, []);
});

test('本地排程紀錄：送出後保留、重新開啟仍在，不自動查 Facebook', async () => {
  const { page, api, errors } = await open({ rundown: true });
  assert.equal(await page.isChecked('#recordsAuto'), true);
  await page.click('#newPost');
  await fillUrl(page, URL1);
  await pick(page, '111');
  await page.click(`${chip('111')} .pg-mode`);
  await page.click('#modeMenu [data-m=sched]');
  await page.press('#timePop .tp-time', 'Enter');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(await page.locator('#recordsList [data-record]').count(), 1);
  const recordId = await page.getAttribute('#recordsList [data-record]', 'data-record');
  assert.match(await page.textContent('#recordsList'), /颱風假|小編文|北北基桃/);
  assert.match(await page.textContent('#recordsList'), /新聞|TVBS新聞/);
  assert.deepEqual(automaticReads(api), [], '送出後不能自動查遠端列表');
  await page.reload();
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  await skipDuty(page);
  assert.equal(await page.isVisible('#tab-records'), true);
  assert.equal(await page.locator('#recordsList [data-record]').count(), 1);
  assert.equal(await page.getAttribute('#recordsList [data-record]', 'data-record'), recordId);
  await page.selectOption('#recordsFilter', 'scheduled');
  assert.equal(await page.locator('#recordsList [data-record]').count(), 1);
  assert.deepEqual(automaticReads(api), []);
  assert.deepEqual(errors, []);
});

test('本地紀錄：預設清除七天前已發布，未來排程與失敗保留，到期只標待確認', async () => {
  const { page, api, errors } = await open();
  await page.evaluate(() => {
    const now = Date.now(), day = 86400000, old = now - 8 * day;
    const make = (id, status, scheduledAt = null) => ({ id, at: old, updatedAt: old, title: id, caption: '測試紀錄', url: '',
      pages: [{ page: '111', label: '新聞', status, sentAt: old, scheduledAt, postId: '111_' + id, error: status === 'fail' ? '權限不足' : '' }] });
    localStorage.setItem('tbx.fbpost.records.v1', JSON.stringify([
      make('舊的已發布', 'ok'), make('未來排程', 'ok', (now + day) / 1000),
      make('發文失敗', 'fail'), make('到期待確認', 'ok', (now - day) / 1000),
    ]));
  });
  await page.reload();
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  await skipDuty(page);
  const text = await page.textContent('#recordsList');
  assert.doesNotMatch(text, /舊的已發布/);
  assert.match(text, /未來排程/);
  assert.match(text, /發文失敗/);
  assert.match(text, /到期待確認/);
  assert.match(text, /待確認/);
  assert.equal(await page.locator('#recordsList [data-record]').count(), 3);
  await page.selectOption('#recordsFilter', 'due');
  assert.equal(await page.locator('#recordsList [data-record]').count(), 1);
  assert.match(await page.textContent('#recordsList'), /到期待確認/);
  assert.deepEqual(automaticReads(api), []);
  assert.deepEqual(errors, []);
});

test('本地紀錄：關閉七天清除後重新開啟仍保留舊紀錄', async () => {
  const { page, errors } = await open();
  await page.uncheck('#recordsAuto');
  await page.evaluate(() => {
    const old = Date.now() - 9 * 86400000;
    localStorage.setItem('tbx.fbpost.records.v1', JSON.stringify([{ id: 'keep-old', at: old, updatedAt: old, title: '保留舊紀錄',
      pages: [{ page: '111', label: '新聞', status: 'ok', scheduledAt: null, sentAt: old, postId: '111_99' }] }]));
  });
  await page.reload();
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  await skipDuty(page);
  assert.equal(await page.isChecked('#recordsAuto'), false);
  assert.equal(await page.locator('#recordsList [data-record]').count(), 1);
  assert.match(await page.textContent('#recordsList'), /保留舊紀錄/);
  assert.deepEqual(errors, []);
});

test('已排程分頁：列出（含留言狀態）並取消排程', async () => {
  const { page, api, errors } = await open();
  await querySched(page);
  await page.waitForSelector('#schedList .item');
  const text = await page.textContent('#schedList');
  assert.match(text, /排好的貼文/);
  assert.match(text, /等待留言/);
  assert.match(text, /留言失敗：貼文沒有出現/);
  await page.click('#schedList .item [data-act=resched] + button');
  await page.click('#cfYes');
  await page.waitForFunction(() => document.querySelectorAll('#schedList .item').length === 1);
  assert.deepEqual(api.cancels, ['111_7']);
  assert.deepEqual(errors, []);
});

test('已排程分頁：改時間（成功更新列表、已發布顯示錯誤）', async () => {
  const { page, api, errors } = await open();
  await querySched(page);
  await page.waitForSelector('#schedList .item');
  const before = await page.textContent('#schedList .item:first-child .meta b');
  await page.click('#schedList .item:first-child [data-act=resched]');
  await page.waitForSelector('#rsDlg[open]');
  assert.match(await page.textContent('#rsWhat'), /TVBS新聞/);
  api.rescheduleError = 'already_published';
  await page.click('#rsEditor [data-add="60"]');
  await page.click('#rsYes');
  await page.waitForFunction(() => /已經發布/.test(document.querySelector('#rsErr').textContent));
  assert.equal(await page.isVisible('#rsDlg'), true);
  api.rescheduleError = null;
  await page.click('#rsYes');
  await page.waitForFunction(() => !document.getElementById('rsDlg').open);
  assert.equal(api.reschedules.length, 2);
  assert.equal(api.reschedules[1].post, '111_7');
  const expect = Math.floor(Date.now() / 1000) + 7200 + 3600;
  assert.ok(Math.abs(api.reschedules[1].time - expect) < 120, '時間＝原排程＋1 小時');
  await page.waitForFunction((b) => { const el = document.querySelector('#schedList .item:first-child .meta b'); return !!el && el.textContent !== b; }, before);   // 列表重畫中可能暫時是空的
  assert.deepEqual(errors, []);
});

test('排程時間太近：改時間不送出並提示', async () => {
  const { page, api } = await open();
  await querySched(page);
  await page.waitForSelector('#schedList .item');
  await page.click('#schedList .item:first-child [data-act=resched]');
  await page.fill('#rsEditor .tp-time', '');
  await page.type('#rsEditor .tp-time', new Date().toTimeString().slice(0, 5).replace(':', ''));
  await page.click('#rsYes');
  assert.equal(api.reschedules.length, 0);
  assert.match(await page.textContent('#rsEditor .hint'), /至少要比現在晚 10 分鐘|時間格式/);
});

test('留言失敗：紅點＋數字、補留言、知道了、新失敗跳通知', async () => {
  const { page, api, errors } = await open();
  await page.click('#tabs [data-tab=sched]');
  await page.waitForSelector('#failList .item');
  assert.equal(await page.textContent('#schedBadge'), '1');
  assert.match(await page.textContent('#failBox'), /留言失敗（1）/);
  assert.match(await page.textContent('#failList'), /貼文沒有出現/);
  assert.equal(await page.evaluate(() => window.__notes.length), 0, '第一次載入就存在的只顯示紅點、不跳通知');
  await page.click('#failList [data-act=retry]');
  await page.waitForFunction(() => document.getElementById('failBox').hidden);
  assert.deepEqual(api.retries, ['c1']);
  assert.equal(await page.isVisible('#schedBadge'), false);
  // 新的失敗：按重新整理（等同定時查詢）→ 紅點＋通知
  api.failedComments.push({ id: 'c2', page: '222', post: '222_1', message: '另一則', status: 'failed', error: '逾時', due: 1, updated: 1, dismissed: false });
  api.failedComments.push({ id: 'c3', page: '222', post: '222_2', message: '被知道了的', status: 'failed', error: 'x', due: 1, updated: 1, dismissed: true });
  await page.click('#schedReload');
  await page.waitForFunction(() => document.getElementById('schedBadge').textContent === '1');
  await page.waitForFunction(() => window.__notes.length === 1);
  await page.click('#failList [data-act=dismiss]');
  await page.waitForFunction(() => document.getElementById('failBox').hidden);
  assert.deepEqual(api.dismisses, ['c2']);
  assert.deepEqual(errors, []);
});

test('讀取中顯示骨架列（尺寸同真的一列、aria-hidden），讀完換成真資料；看成效也有占位', async () => {
  const { page, api, errors } = await open();
  await querySched(page);
  await page.waitForSelector('#schedList .item');
  let release; api.hold = new Promise((r) => { release = r; });
  await page.click('#schedReload');
  await page.waitForFunction(() => document.querySelectorAll('#schedList .sk-row[aria-hidden=true]').length === 3);
  assert.equal(await page.getAttribute('#schedList', 'aria-busy'), 'true');
  const h = await page.evaluate(() => document.querySelector('#schedList .sk-row').getBoundingClientRect().height);
  release(); api.hold = null;
  await page.waitForFunction(() => !document.getElementById('schedList').hasAttribute('aria-busy') && document.querySelector('#schedList .item'));
  assert.equal(await page.locator('#schedList .sk-row').count(), 0);
  assert.equal(await page.getAttribute('#schedList', 'aria-busy'), null);
  const real = await page.evaluate(() => document.querySelector('#schedList .item').getBoundingClientRect().height);
  assert.ok(Math.abs(real - h) <= 24, `骨架列 ${h}px、真的一列 ${real}px，高度差太多會跳版`);
  await queryStats(page);
  await page.waitForSelector('#statsList .item');
  api.hold = new Promise((r) => { release = r; });
  await page.click('#statsList .item button');
  await page.waitForSelector('#statsList .ins[aria-busy=true] .sk-line');
  release(); api.hold = null;
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent) && !document.querySelector('#statsList .ins[aria-busy]'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#statsList .meta')).fontVariantNumeric), 'tabular-nums');
  assert.deepEqual(errors, []);
});

test('已排程：純文字顯示「文字」；排序可切換時間最近／最遠，記住選擇', async () => {
  const { page, errors } = await open();
  await querySched(page);
  await page.waitForSelector('#schedList .item');
  assert.equal(await page.textContent('#schedList .item .thumb.txt'), '文字');
  const order = () => page.$$eval('#schedList .item', (ls) => ls.map((l) => l.dataset.post));
  assert.deepEqual(await order(), ['111_7', '111_8']);
  await page.selectOption('#schedSort', 'far');
  assert.deepEqual(await order(), ['111_8', '111_7']);
  assert.equal(await page.evaluate(() => localStorage.getItem('fbpost.schedSort')), 'far');
  await page.click('#schedReload');
  await page.waitForFunction(() => document.querySelectorAll('#schedList .item').length === 2);
  assert.deepEqual(await order(), ['111_8', '111_7']);
  assert.deepEqual(errors, []);
});

test('已排程：最近／最遠比較距離現在，缺少時間放最後且切換不查詢', async () => {
  const { page, api, errors } = await open();
  const current = new Date('2026-11-07T15:00:00+08:00');
  await page.clock.setFixedTime(current);
  const sec = current.getTime() / 1000;
  api.scheduled['111'] = [
    { id: 'past-far', at: sec - 7200 },
    { id: 'future', at: sec + 3600 },
    { id: 'past-near', at: sec - 300 },
    { id: 'no-time', at: null },
  ];
  await querySched(page);
  await page.waitForFunction(() => document.querySelectorAll('#schedList .item').length === 4);
  const order = () => page.$$eval('#schedList .item', rows => rows.map(r => r.dataset.post));
  assert.deepEqual(await order(), ['past-near', 'future', 'past-far', 'no-time']);
  const count = api.requestPaths.filter(p => p.startsWith('/fb/scheduled')).length;
  await page.selectOption('#schedSort', 'far');
  assert.deepEqual(await order(), ['past-far', 'future', 'past-near', 'no-time']);
  await page.evaluate(() => { document.querySelector('[data-post="no-time"]').dataset.at = 'invalid'; });
  await page.selectOption('#schedSort', 'near');
  assert.deepEqual(await order(), ['past-near', 'future', 'past-far', 'no-time']);
  // 現在往後移，最近的項目必須跟著重新計算，不能沿用第一次查詢的基準。
  await page.clock.setFixedTime(new Date(current.getTime() + 3600000));
  await page.selectOption('#schedSort', 'far');
  await page.selectOption('#schedSort', 'near');
  assert.deepEqual(await order(), ['future', 'past-near', 'past-far', 'no-time']);
  assert.equal(api.requestPaths.filter(p => p.startsWith('/fb/scheduled')).length, count);
  assert.deepEqual(errors, []);
});

test('成效：載入更多（很長的游標）接上第二頁，載入中按鈕不能再按', async () => {
  const { page, api, errors } = await open();
  await queryStats(page);
  await page.waitForSelector('#statsList .item');
  await page.waitForSelector('#statsMore:not([hidden])');
  await page.click('#statsMore');
  await page.waitForFunction(() => document.querySelectorAll('#statsList .item').length === 2);
  assert.deepEqual(api.afters, [LONG_CURSOR]);
  assert.equal(await page.isHidden('#statsMore'), true);
  assert.equal(await page.isDisabled('#statsMore'), false);
  assert.deepEqual(errors, []);
});

test('成效分頁：清單與看成效', async () => {
  const { page, errors } = await open();
  await queryStats(page);
  await page.waitForSelector('#statsList .item');
  await page.click('#statsList .item button');
  await page.waitForFunction(() => /瀏覽 1,234/.test(document.querySelector('#statsList .ins').textContent));
  assert.equal(await page.isHidden('#tab-sched'), true);
  assert.deepEqual(errors, []);
});

test('貼網址自動帶入：標題斷行、小編文【標題】／圖說／#標籤、主圖、骨架拿掉', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  await fillUrl(page, URL1, 'paste');   // 貼上就自動讀取
  assert.equal(await page.inputValue('#title'), '颱風假最新！\n北北基桃\n明天照常上班上課');
  assert.match(await page.textContent('#titleCnts'), /6\/15/);
  const cap = await page.inputValue('#caption');
  const rows = cap.split('\n');
  assert.equal(rows[0], '【颱風假最新！北北基桃 明天照常上班上課】');
  assert.equal(rows[1], '（圖／TVBS）');
  assert.match(rows[2], /^#氣象署/);
  assert.equal(await page.isVisible('#clearImg'), true, '主圖已載入畫布');
  assert.equal(api.articleReq, 1);
  assert.equal(await page.locator('.is-skel').count(), 0);
  assert.deepEqual(errors, []);
});

test('主圖：第一張失敗會試下一張；三張都失敗提示手動放照片', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  api.imageFail = 1;
  await fillUrl(page, URL1);
  assert.equal(await page.isVisible('#clearImg'), true, '第二張成功');
  assert.doesNotMatch(await page.textContent('#urlHint'), /讀不出來/);
  await page.click('#clearImg');
  api.imageFail = 5;
  await fillUrl(page, URL1);
  assert.match(await page.textContent('#urlHint'), /主圖讀不出來/);
  assert.equal(await page.isVisible('#clearImg'), false);
  assert.deepEqual(errors, []);
});

test('娛樂網址自動切粉框；預覽上點兩下改標題會寫回標題框', async () => {
  const { page, errors } = await open({ company: true });
  await page.click('#newPost');
  await fillUrl(page, URL_ENT);
  assert.equal(await page.getAttribute('#frameSeg .is-on', 'data-frame'), 'ent');
  await page.dblclick('#editorCanvas');
  await page.waitForSelector('#titleOverlay.editing');
  await page.fill('#titleOverlay', '預覽上改的\n第二行');
  assert.equal(await page.inputValue('#title'), '預覽上改的\n第二行');
  assert.equal((await page.inputValue('#caption')).split('\n')[0], '【預覽上改的 第二行】');
  await fillUrl(page, URL1);
  assert.equal(await page.getAttribute('#frameSeg .is-on', 'data-frame'), 'news');
  assert.deepEqual(errors, []);
});

test('改標題同步【標題】行；小編文改過就不整段覆蓋', async () => {
  const { page, errors } = await open();
  await page.click('#newPost');
  await fillUrl(page, URL1);
  await page.fill('#title', '新標題\n第二行');
  assert.equal((await page.inputValue('#caption')).split('\n')[0], '【新標題 第二行】');
  assert.match(await page.inputValue('#caption'), /（圖／TVBS）/);
  await page.fill('#caption', '我的前言\n【舊的】\n#我的標籤');
  await page.fill('#title', 'ＡＢ');
  assert.equal(await page.inputValue('#caption'), '我的前言\n【ＡＢ】\n#我的標籤');
  await fillUrl(page, URL1);   // 再帶入：小編文改過就不覆蓋
  assert.equal(await page.inputValue('#caption'), '我的前言\n【颱風假最新！北北基桃 明天照常上班上課】\n#我的標籤');
  assert.match(await page.textContent('#urlHint'), /沒有覆蓋/);
  assert.deepEqual(errors, []);
});

test('留言：預設帶各粉專 utm、自訂內容、沒有網址的情況', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  await fillUrl(page, URL1);
  await pick(page, '111');
  await pick(page, '222');
  assert.match(await page.textContent('#commentPrev'), /留言預覽（新聞）：\n看更多新聞內容\nhttps:\/\/news\.tvbs\.com\.tw\/life\/3012345\?utm_source=facebook&utm_medium=fbarticlepic/);
  assert.equal(await page.getAttribute('#comment', 'placeholder'), '不填就自動帶：看更多新聞內容＋各粉專 utm 連結');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 2);
  assert.equal(api.posts[0].comment, `看更多新聞內容\n${URL1}?${U1}`);
  assert.equal(api.posts[1].comment, `看更多新聞內容\n${URL1}?${U2}`);
  // 再發一篇：填自訂留言
  await page.click('#dnAgain');
  assert.equal(await page.inputValue('#url'), '');
  await fillUrl(page, URL1);
  await pick(page, '222');
  await page.fill('#comment', '快看這篇');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts[2].comment, `快看這篇\n${URL1}?${U2}`);
  await page.click('#dnAgain');
  // 沒有文章網址：填了只送填的內容、沒填不留言
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#title', '今天放假');
  await pick(page, '111');
  await page.fill('#comment', '只有留言');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts[3].comment, '只有留言');
  await page.click('#dnAgain');
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#title', '今天放假');
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts[4].comment, '');
  assert.deepEqual(errors, []);
});

test('一台立即、一台排程；失敗的晶片可重送；全部完成跳完成對話框', async () => {
  const { page, api, errors } = await open();
  api.failPage = '222';
  await page.click('#newPost');
  await photo(page);
  await page.fill('#title', '颱風假最新\n北北基照常上班');
  await page.fill('#caption', '小編文 #颱風\n第二行');
  assert.equal(await page.isDisabled('#sendBtn'), true);
  await pick(page, '111');
  await pick(page, '222');
  assert.match(await page.textContent('#sendBtn'), /全部送出（2 台）/);
  // 222 → 排程：選單選「排程發布」開時間視窗，+1 小時
  await page.click(`${chip('222')} .pg-mode`);
  await page.click('#modeMenu [data-m=sched]');
  await page.waitForSelector('#timePop:not([hidden])');
  await page.click('#timePop [data-add="60"]');
  await page.press('#timePop .tp-time', 'Enter');
  assert.equal(await page.isHidden('#timePop'), true);
  assert.match(await page.textContent(`${chip('222')} .pg-mode`), /^排程 /);
  await page.click('#sendBtn');
  await page.waitForSelector(`${chip('222')} .retry:not([hidden])`);
  assert.match(await page.textContent(`${chip('111')} .pg-mode`), /✓ 已發布/);
  assert.match(await page.textContent(`${chip('222')} .pg-mode`), /✗ 失敗/);
  assert.equal(await page.isVisible('#doneDlg'), false);
  assert.equal(api.posts.length, 2);
  assert.ok(api.posts.every((p) => p.hasImage && p.message === '小編文 #颱風\n第二行'));
  assert.equal(api.posts[0].scheduledAt, null);
  assert.ok(Number(api.posts[1].scheduledAt) > Date.now() / 1000 + 3600 * 1.4);
  assert.match(await page.textContent('#sendMsg'), /失敗 1 台/);
  assert.equal(await page.textContent('#sendBtn'), '發文未完成');
  assert.equal(await page.locator('#recordsList [data-record]').count(), 1);
  assert.match(await page.textContent('#recordsList'), /失敗|發文未完成|權限/);
  const recordId = await page.getAttribute('#recordsList [data-record]', 'data-record');
  await page.fill('#caption', '重送改成這段小編文');
  await page.click(`${chip('222')} .retry`);
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 3);
  assert.equal(api.posts[2].page, '222');
  assert.equal(api.posts[2].message, '重送改成這段小編文');
  assert.match(await page.textContent(`${chip('222')} .pg-mode`), /✓ 排程 /);
  assert.match(await page.textContent('#dnBody'), /已發布 1 台、已排程 1 台|已排程 1 台/);
  assert.equal(await page.locator('#recordsList [data-record]').count(), 1, '重試只更新原紀錄');
  assert.equal(await page.getAttribute('#recordsList [data-record]', 'data-record'), recordId);
  const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem('tbx.fbpost.records.v1')).find((r) => r.id === id), recordId);
  assert.equal(stored.pages.find((p) => p.page === '111').caption, '小編文 #颱風\n第二行', '已成功粉專保留原送出內容');
  assert.equal(stored.pages.find((p) => p.page === '222').caption, '重送改成這段小編文', '重送粉專保存當次內容');
  assert.match(await page.textContent('#recordsList'), /重送內容：/);
  assert.match(await page.textContent('#recordsList'), /重送改成這段小編文/);
  assert.deepEqual(automaticReads(api), [], '發文或重送均不查遠端列表');
  await page.click('#dnAgain');
  assert.equal(await page.inputValue('#title'), '');
  assert.equal(await page.locator('.pg.on').count(), 0);
  assert.equal(await page.isVisible('#modal'), true);
  assert.deepEqual(errors, []);
});

test('排程時間不合法：整批不送，提示哪個粉專', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#title', '測試');
  await pick(page, '111');
  await page.click(`${chip('111')} .pg-mode`);
  await page.click('#modeMenu [data-m=sched]');
  await page.fill('#timePop .tp-time', '');
  await page.type('#timePop .tp-time', '0001');
  await page.click('#sendBtn');
  await page.waitForFunction(() => /新聞：/.test(document.getElementById('sendMsg').textContent));
  assert.equal(api.posts.length, 0);
  assert.deepEqual(errors, []);
});

test('關閉：沒內容直接關；有內容要確認，確認後清空；Esc 同樣流程', async () => {
  const { page, errors } = await open();
  await page.click('#newPost');
  await page.click('#mClose');
  assert.equal(await page.isVisible('#modal'), false, '沒內容直接關');
  await page.click('#newPost');
  await photo(page);
  await page.fill('#title', '保留測試');
  await page.fill('#caption', '小編文保留');
  await page.fill('#comment', '留言保留');
  await pick(page, '111');
  await page.click('#mClose');
  await page.waitForSelector('#confirmDlg[open]');
  await page.click('#cfNo');
  assert.equal(await page.isVisible('#modal'), true);
  assert.equal(await page.inputValue('#title'), '保留測試');
  await page.press('#title', 'Escape');
  await page.waitForSelector('#confirmDlg[open]');
  await page.click('#cfNo');
  assert.equal(await page.isVisible('#modal'), true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#confirmDlg[open]');
  await page.click('#cfYes');
  await page.waitForFunction(() => !document.getElementById('modal').open);
  await page.click('#newPost');
  assert.equal(await page.inputValue('#title'), '');
  assert.equal(await page.inputValue('#caption'), '');
  assert.equal(await page.inputValue('#comment'), '');
  assert.equal(await page.isVisible('#clearImg'), false);
  assert.equal(await page.locator('.pg.on').count(), 0);
  // 清空鈕
  await page.fill('#caption', '又打了字');
  await page.click('#clearBtn');
  await page.click('#cfYes');
  assert.equal(await page.inputValue('#caption'), '');
  assert.deepEqual(errors, []);
});

test('切換模式、純文字樣式都不清內容；純文字底圖用標題；原生背景、無底色', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  await photo(page);
  await page.fill('#title', '保留測試');
  await page.fill('#caption', '小編文保留');
  await page.click('#modeSeg [data-mode=text]');
  assert.equal(await page.isHidden('#framePane'), true);
  assert.equal(await page.inputValue('#title'), '保留測試', '底圖文字就是標題欄');
  await page.click('#textSeg [data-text=native]');
  assert.equal(await page.isHidden('#titleBlock'), true);
  await page.click('#textSeg [data-text=card]');
  assert.equal(await page.isVisible('#titleBlock'), true);
  await page.click('#modeSeg [data-mode=frame]');
  assert.equal(await page.inputValue('#title'), '保留測試');
  assert.equal(await page.inputValue('#caption'), '小編文保留');
  assert.equal(await page.isVisible('#clearImg'), true);
  await page.evaluate(() => { document.querySelector('#tabs [data-tab=stats]').click(); document.querySelector('#tabs [data-tab=sched]').click(); });
  assert.equal(await page.inputValue('#title'), '保留測試');
  // 底圖：送圖片
  await page.click('#modeSeg [data-mode=text]');
  await pick(page, '111');
  await page.fill('#title', '');
  await page.click('#sendBtn');
  await page.waitForFunction(() => /請輸入標題/.test(document.getElementById('sendMsg').textContent));
  await page.fill('#title', '今天放假');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  await page.click('#dnAgain');
  // 原生背景
  await page.click('#modeSeg [data-mode=text]');
  await page.click('#textSeg [data-text=native]');
  await page.fill('#presetId', '106018623298955');
  await page.fill('#caption', '說明');
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  await page.click('#dnAgain');
  // 無底色
  await page.click('#modeSeg [data-mode=text]');
  await page.click('#textSeg [data-text=plain]');
  await page.fill('#caption', '只有文字');
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  const [card, native, plain] = api.posts;
  assert.equal(card.hasImage, true);
  assert.equal(native.textPreset, '106018623298955');
  assert.equal(native.hasImage, false);
  assert.equal(plain.textPreset, null);
  assert.equal(plain.hasImage, false);
  assert.equal(api.posts.length, 3);
  assert.deepEqual(errors, []);
});

test('沒照片會擋下；連點送出只會發一次', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForFunction(() => /照片/.test(document.getElementById('sendMsg').textContent));
  assert.equal(api.posts.length, 0);
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#title', '連點');
  await page.evaluate(() => { const b = document.getElementById('sendBtn'); b.click(); b.click(); });
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 1);
  assert.deepEqual(errors, []);
});

const MORE = [...PAGES,
  { id: '333', name: '少康戰情室', code: 'shaokang', label: '少康', utm: 'a=1', sort: 3, link: '', picture: '', followers: 1 },
  { id: '444', name: '擠看看', code: 'jkk', label: '擠看看', utm: 'a=2', sort: 4, link: '', picture: '', followers: 1 },
  { id: '555', name: 'TVBS氣象', code: 'weather', label: '氣象', utm: 'a=3', sort: 6, link: '', picture: '', followers: 1 }];
const chipOrder = (page) => page.$$eval('#pages .pg', (els) => els.map((e) => e.dataset.page));
const checked = (page) => page.$$eval('#pages .pg', (els) => els.filter((e) => e.querySelector('.pg-main').getAttribute('aria-pressed') === 'true').map((e) => e.dataset.page));
const opts = (page, sel) => page.$$eval(sel + ' option', (els) => els.map((e) => e.value));
const dutyPick = (page, id) => page.click(`#dutyList [data-page="${id}"] .duty-pick`);

test('值班粉專：第一次跳視窗、1～3 個、★主要；新增發文只預勾主要、排前面；已排程／成效預設主要；重新整理不再問', async () => {
  const { page, errors } = await open({ duty: 'ask', pages: MORE });
  await page.waitForSelector('#dutyDlg[open]');
  assert.equal(await page.isDisabled('#dutyOk'), true, '沒選不能確定');
  await dutyPick(page, '444'); await dutyPick(page, '222'); await dutyPick(page, '333');
  assert.equal(await page.isDisabled('#dutyList [data-page="555"] .duty-pick'), true, '最多 3 個');
  assert.match(await page.textContent('#dutyHint'), /3／3.*主要：擠看看/);
  await page.click('#dutyList [data-page="222"] .duty-star');
  assert.match(await page.textContent('#dutyHint'), /主要：娛樂/);
  await page.click('#dutyOk');
  assert.match(await page.textContent('#dutyBtn'), /值班：★娛樂、擠看看、少康/);
  assert.deepEqual(await chipOrder(page), ['222', '444', '333', '111', '555']);
  assert.equal(await page.inputValue('#schedPage'), '222');
  assert.deepEqual(await opts(page, '#schedPage'), ['', '222', '444', '333', '111', '555'], '全部粉專與其他粉專都還在');
  assert.equal(await page.inputValue('#statsPage'), '222');
  await page.click('#newPost');
  assert.deepEqual(await checked(page), ['222'], '只預勾主要');
  await pick(page, '111');
  assert.deepEqual((await checked(page)).sort(), ['111', '222'], '其他粉專照樣可勾');
  // 清空後回到只勾主要
  await page.click('#clearBtn'); await page.click('#cfYes');
  assert.deepEqual(await checked(page), ['222']);
  // 重新整理：不再跳，設定還在
  await page.reload();
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#dutyDlg'), false);
  assert.equal(await page.inputValue('#schedPage'), '222');
  assert.deepEqual(errors, []);
});

test('值班粉專：先不選＝照原本預設；過了 05:00 失效就全部空白重選（按新增發文時檢查）', async () => {
  const { page, errors } = await open({ duty: { ids: ['222', '111'], main: '222', exp: Date.now() + 1500 } });
  assert.equal(await page.isVisible('#dutyDlg'), false, '還沒過期不跳');
  assert.deepEqual(await chipOrder(page), ['222', '111']);
  await page.waitForTimeout(1700);
  await page.click('#newPost');
  await page.waitForSelector('#dutyDlg[open]');
  assert.equal(await page.$$eval('#dutyList .duty-item.on', (e) => e.length), 0, '失效後不預選上次的');
  await page.click('#dutySkip');
  await page.waitForSelector('#modal[open]');
  assert.deepEqual(await chipOrder(page), ['111', '222'], '先不選＝原順序');
  assert.deepEqual(await checked(page), [], '先不選＝不預勾');
  assert.match(await page.textContent('#dutyBtn'), /未選/);
  assert.deepEqual(errors, []);
});

test('Rundown：開關記住、SLUG 預設標題前 4 字；送出成功的台各寫一筆（擠看看略過），結果顯示在訊息', async () => {
  const pages = [...PAGES, MORE[3]];
  const { page, api, errors } = await open({ pages });
  await page.click('#newPost');
  assert.equal(await page.isChecked('#rdOn'), false);
  assert.equal(await page.isDisabled('#slug'), true);
  await page.click('#rdOn');
  assert.equal(await page.isDisabled('#slug'), false);
  await fillUrl(page, URL1);
  assert.match(await page.getAttribute('#slug', 'placeholder'), /空白＝颱風假最/);
  await pick(page, '111'); await pick(page, '444');
  await pick(page, '222');
  await page.click(`${chip('222')} .pg-mode`);
  await page.click('#modeMenu [data-m=sched]');
  await page.waitForSelector('#timePop:not([hidden])');
  await page.keyboard.press('Enter');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  const add = api.rundown.find((b) => b.action === 'add');
  assert.deepEqual(add.entries.map((e) => [e.page, e.text]), [['news', '3012345/圖文/颱風假最'], ['ent', '3012345/圖文/颱風假最']]);
  const sched = api.posts.find((p) => p.page === '222').scheduledAt;
  const d = new Date(Number(sched) * 1000), pad = (n) => String(n).padStart(2, '0');
  assert.equal(add.entries[1].time, `${pad(d.getHours())}:${pad(d.getMinutes())}`, '排程用排程時間');
  assert.match(await page.textContent('#dnBody'), /Rundown：新聞 \d\d:\d\d → AE100；娛樂 \d\d:\d\d → AE101（插入）/);
  // 純文字＋無底色 → /文字/；手填 SLUG
  await page.click('#dnAgain');
  await page.click('#modeSeg [data-mode=text]');
  await page.click('#textSeg [data-text=plain]');
  await page.fill('#url', URL1);
  await page.fill('#caption', '只有文字');
  await page.fill('#slug', '自訂！');
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.rundown.at(-1).entries[0].text, '3012345/文字/自訂');
  // 重新整理：開關還開著
  await page.reload();
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  await skipDuty(page);
  assert.equal(await page.isChecked('#rdOn'), true);
  assert.deepEqual(errors, []);
});

for (const width of [1100, 400]) test(`Rundown：按鈕階段與請求順序，寬度 ${width}`, async () => {
  const { page, api } = await open({ rundown: true });
  await page.setViewportSize({ width, height: 900 });
  await page.click('#newPost');
  await fillUrl(page, URL1);
  await pick(page, '111');
  await page.click(`${chip('111')} .pg-mode`);
  await page.click('#modeMenu [data-m=sched]');
  await page.keyboard.press('Enter');
  const before = await page.locator('#sendBtn').boundingBox();
  await page.evaluate((width) => {
    window.stages = [];
    if (width === 400) window.requestAnimationFrame = () => 0; // 模擬背景分頁不繪圖，RD 仍須繼續
    const b = document.getElementById('sendBtn');
    new MutationObserver(() => window.stages.push(b.textContent)).observe(b, { childList: true });
  }, width);
  let releasePost, releaseRd;
  api.postHold = new Promise((r) => { releasePost = r; });
  api.rdHold = new Promise((r) => { releaseRd = r; });
  await page.click('#sendBtn');
  try {
    await page.waitForFunction(() => document.getElementById('sendBtn').textContent === '送出臉書');
    assert.equal(api.rundown.length, 0, '臉書未回覆前不能寫 RD');
    assert.equal(await page.isDisabled('#sendBtn'), true);
    releasePost();
    await page.waitForFunction(() => document.getElementById('sendBtn').textContent === '寫入 RD');
    assert.equal(api.posts.length, 1);
    await page.evaluate(() => document.getElementById('sendBtn').click());
    assert.equal(api.posts.length, 1, '送出期間不能重複發文');
    const during = await page.locator('#sendBtn').boundingBox();
    assert.ok(Math.abs(before.width - during.width) < 1);
    assert.equal(await page.$eval('#sendBtn', b => b.scrollWidth <= b.clientWidth), true);
    releaseRd();
    await page.waitForSelector('#doneDlg[open]');
    assert.equal(await page.textContent('#sendBtn'), '完成');
    const stages = await page.evaluate(() => window.stages);
    for (const label of ['送出臉書', '排程完成', '寫入 RD', '完成']) assert.ok(stages.includes(label), label);
    assert.ok(stages.indexOf('排程完成') < stages.indexOf('寫入 RD'));
  } finally { releasePost(); releaseRd(); }
});

test('Rundown：粉專對應缺漏要顯示原因，不顯示完成', async () => {
  const { page, api } = await open({ rundown: true, pages: [{ ...PAGES[0], code: '', name: '少康戰情室', label: '少康' }] });
  await page.click('#newPost');
  await fillUrl(page, URL1);
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 1);
  assert.equal(api.rundown.length, 0);
  assert.equal(await page.textContent('#sendBtn'), 'RD 未完成');
  assert.match(await page.textContent('#dnBody'), /未寫入 RD：少康.*請檢查粉專對應/);
});

test('Rundown：關著不寫；寫入失敗顯示原因但發文算成功；⚙ 測試連線', async () => {
  const { page, api, errors } = await open({ rundown: true });
  await page.click('#newPost');
  await page.click('#rdSetBtn');
  await page.click('#rdTest');
  await page.waitForFunction(() => /連線成功/.test(document.getElementById('rdHint').textContent));
  assert.match(await page.textContent('#rdHint'), /FB RUNDOWN\(2026\)/);
  await page.click('#rdClose');
  api.rundownFail = 'Rundown：08:00 時段已滿';
  await fillUrl(page, URL1);
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.match(await page.textContent('#dnBody'), /已發布 1 台；Rundown 沒寫入：Rundown：08:00 時段已滿/);
  assert.equal(await page.textContent('#sendBtn'), 'RD 未完成');
  await page.click('#dnAgain');
  await page.click('#rdOn');
  const n = api.rundown.length;
  await fillUrl(page, URL1);
  await pick(page, '111');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.rundown.length, n, '關掉就不寫');
  assert.deepEqual(errors, []);
});

// 時間視窗欄位：日期欄要夠寬看得到完整日期、時間欄固定 96px、兩欄都在視窗內（曾被 .fp-modal input { width:100% } 蓋掉，日期欄剩 22px）
async function assertTimeFields(page, root) {
  const m = await page.evaluate((sel) => {
    const r = (q) => document.querySelector(sel + ' ' + q).getBoundingClientRect();
    const box = document.querySelector(sel).getBoundingClientRect(), d = r('.tp-date'), t = r('.tp-time');
    return { boxL: box.left, boxR: box.right, dL: d.left, dW: d.width, tW: t.width, tR: t.right };
  }, root);
  assert.ok(m.dW >= 140, `${root} 日期欄太窄 ${m.dW}px`);
  assert.ok(Math.abs(m.tW - 96) < 1, `${root} 時間欄應 96px，實際 ${m.tW}px`);
  assert.ok(m.dL >= m.boxL && m.tR <= m.boxR, `${root} 欄位超出視窗`);
}

for (const [w, h] of [[1280, 900], [400, 800]]) {
  test(`時間視窗與改時間（${w} 寬）：日期欄完整、時間欄 96px，不超出`, async () => {
    const { page, errors } = await open({ viewport: { width: w, height: h } });
    await querySched(page);
    await page.waitForSelector('#schedList .item');
    await page.click('#schedList .item:first-child [data-act=resched]');
    await page.waitForSelector('#rsDlg[open]');
    await assertTimeFields(page, '#rsDlg');
    await page.click('#rsNo');
    await page.click('#newPost');
    await pick(page, '111');
    await page.click(`${chip('111')} .pg-mode`);
    await page.click('#modeMenu [data-m=sched]');
    await page.waitForSelector('#timePop:not([hidden])');
    await assertTimeFields(page, '#timePop');
    assert.ok(await page.evaluate(() => document.getElementById('timePop').getBoundingClientRect().right <= innerWidth), '時間視窗不超出畫面');
    assert.deepEqual(errors, []);
  });
}

test('手機寬（390）：彈窗與時間視窗不會橫向捲動', async () => {
  const { page, errors } = await open({ viewport: { width: 390, height: 800 } });
  await page.click('#newPost');
  await fillUrl(page, URL1);
  await pick(page, '111');
  await page.click(`${chip('111')} .pg-mode`);
  await page.click('#modeMenu [data-m=sched]');
  await page.waitForSelector('#timePop:not([hidden])');
  const w = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: innerWidth,
    body: document.querySelector('.m-body').scrollWidth, bodyC: document.querySelector('.m-body').clientWidth,
    pop: document.getElementById('timePop').getBoundingClientRect().right,
  }));
  assert.ok(w.doc <= w.win, `頁面橫向捲動 ${w.doc} > ${w.win}`);
  assert.ok(w.body <= w.bodyC, `彈窗內容橫向捲動 ${w.body} > ${w.bodyC}`);
  assert.ok(w.pop <= w.win, '時間視窗不超出畫面');
  await assertTimeFields(page, '#timePop');
  assert.deepEqual(errors, []);
});

test('標題最多 4 行：4 行可送出、5 行擋下；半形算 0.5；空白預覽有提示、放照片後消失', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  assert.equal(await page.isVisible('#ph'), true);
  assert.match(await page.textContent('label[for=title]'), /最多 4 行/);
  await photo(page);
  assert.equal(await page.isVisible('#ph'), false);
  await pick(page, '111');
  await page.fill('#title', '一\n二\n三\n四\n五');
  await page.click('#sendBtn');
  await page.waitForFunction(() => /最多 4 行/.test(document.getElementById('sendMsg').textContent));
  assert.equal(api.posts.length, 0);
  await page.fill('#title', 'abcdefghij\n二\n三\n四');
  assert.equal((await page.textContent('#titleCnts span')).trim(), '5/15', '半形 10 字＝5');
  await page.click('#sendBtn');
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 1);
  assert.deepEqual(errors, []);
});
