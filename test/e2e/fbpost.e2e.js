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
async function open({ company = false, viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const now = Math.floor(Date.now() / 1000);
  const api = {
    failPage: null, posts: [], afters: [], cancels: [], reschedules: [], rescheduleError: null, retries: [], dismisses: [], articleReq: 0, imageFail: 0,
    scheduled: {
      111: [
        { id: '111_7', message: '排好的貼文', at: now + 7200, picture: '', created: '', comment: { id: 'cm1', status: 'pending', error: null, message: 'x' } },
        { id: '111_8', message: '留言出事的貼文', at: now + 9000, picture: '', created: '', comment: { id: 'cm2', status: 'failed', error: '貼文沒有出現', message: 'x' } },
      ],
      222: [],
    },
    failedComments: [{ id: 'c1', page: '111', post: '111_8', message: '看更多新聞內容\nhttps://news.tvbs.com.tw/life/1', status: 'failed', error: '貼文沒有出現', due: now - 60, updated: now - 30, dismissed: false }],
  };
  await page.addInitScript(() => {
    try { localStorage.setItem('tbx.company', JSON.stringify({ token: 'test', exp: Math.floor(Date.now() / 1000) + 3600 })); } catch {}
    window.__notes = [];
    class FakeNotification { constructor(t, o) { window.__notes.push({ t, o }); } static async requestPermission() { FakeNotification.permission = 'granted'; return 'granted'; } }
    FakeNotification.permission = 'default';
    window.Notification = FakeNotification;
  });
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const u = new URL(req.url());
    const okJ = (data) => r.fulfill({ headers: CORS, json: { ok: true, data } });
    const bad = (code, error, status = 400) => r.fulfill({ status, headers: CORS, json: { ok: false, code, error } });
    if (/^\/assets\//.test(u.pathname)) return company ? r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset([30, 60, 120]) }) : r.fulfill({ status: 404, headers: CORS, body: '' });
    if (u.pathname === '/fb/pages') return okJ(PAGES);
    if (api.hold && /^\/fb\/(scheduled|insights)$/.test(u.pathname)) await api.hold;   // 測骨架屏：先卡住回應
    if (u.pathname === '/fb/scheduled') return okJ({ items: api.scheduled[u.searchParams.get('page')] || [] });
    if (u.pathname === '/fb/posts') {
      // 第一頁帶一個很長的游標（臉書真的會給這種），第二頁沒有下一頁
      const after = u.searchParams.get('after');
      if (!after) return okJ({ items: [{ id: '111_1', message: '舊貼文', created: new Date().toISOString(), url: 'https://facebook.com/1', picture: '', reactions: 5, comments: 2, shares: 1 }], next: LONG_CURSOR });
      api.afters.push(after);
      return okJ({ items: [{ id: '111_2', message: '更舊的貼文', created: new Date().toISOString(), url: 'https://facebook.com/2', picture: '', reactions: 1, comments: 0, shares: 0 }], next: null });
    }
    if (u.pathname === '/fb/insights') return okJ({ post: '111_1', metrics: { post_media_view: 1234, post_clicks: 56 }, missing: [] });
    if (u.pathname === '/fb/cancel') {
      const b = JSON.parse(req.postData());
      api.cancels.push(b.post);
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
      if (api.failPage === rec.page) { api.failPage = null; return bad('fb_permission', '沒有這個粉專的發文權限。', 403); }
      return okJ({ id: rec.page + '_99', scheduled: !!rec.scheduledAt, at: Number(rec.scheduledAt) || null, comment: { status: rec.comment ? (rec.scheduledAt ? 'queued' : 'done') : 'none' } });
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
    return { page: fr, api, errors };
  }
  await page.goto(srv.url + 'tools/fbpost/index.html');
  await page.waitForSelector('#pages .pg', { state: 'attached' });
  return { page, api, errors };
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

test('已排程分頁：列出（含留言狀態）並取消排程', async () => {
  const { page, api, errors } = await open();
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
  await page.waitForSelector('#schedList .item');
  let release; api.hold = new Promise((r) => { release = r; });
  await page.click('#schedReload');
  await page.waitForFunction(() => document.querySelectorAll('#schedList .sk-row[aria-hidden=true]').length === 3);
  assert.equal(await page.getAttribute('#schedList', 'aria-busy'), 'true');
  const h = await page.evaluate(() => document.querySelector('#schedList .sk-row').getBoundingClientRect().height);
  release(); api.hold = null;
  await page.waitForSelector('#schedList .item');
  assert.equal(await page.locator('#schedList .sk-row').count(), 0);
  assert.equal(await page.getAttribute('#schedList', 'aria-busy'), null);
  const real = await page.evaluate(() => document.querySelector('#schedList .item').getBoundingClientRect().height);
  assert.ok(Math.abs(real - h) <= 24, `骨架列 ${h}px、真的一列 ${real}px，高度差太多會跳版`);
  await page.click('#tabs [data-tab=stats]');
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

test('成效：載入更多（很長的游標）接上第二頁，載入中按鈕不能再按', async () => {
  const { page, api, errors } = await open();
  await page.click('#tabs [data-tab=stats]');
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
  await page.click('#tabs [data-tab=stats]');
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
  assert.match(await page.textContent('#sendBtn'), /全部送出（1 台）/);
  await page.click(`${chip('222')} .retry`);
  await page.waitForSelector('#doneDlg[open]');
  assert.equal(api.posts.length, 3);
  assert.equal(api.posts[2].page, '222');
  assert.match(await page.textContent(`${chip('222')} .pg-mode`), /✓ 排程 /);
  assert.match(await page.textContent('#dnBody'), /已發布 1 台、已排程 1 台|已排程 1 台/);
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

test('Rundown 區塊：停用並標示尚未連接', async () => {
  const { page } = await open();
  await page.click('#newPost');
  assert.equal(await page.isDisabled('#rdOn'), true);
  assert.match(await page.textContent('.rd-panel'), /尚未連接/);
});

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
