// 排程發布：假後端（/fb/*、/fetch*），不打真的臉書。
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

const PAGES = [{ id: '111', name: '新聞粉專', link: '', picture: '', followers: 1 }, { id: '222', name: '娛樂粉專', link: '', picture: '', followers: 1 }];

// api.failPage：送到這個粉專就失敗一次；api.posts：收到的發文（multipart 欄位）
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const now = Math.floor(Date.now() / 1000);
  const api = { failPage: null, posts: [], cancels: [], scheduled: { 111: [{ id: '111_7', message: '排好的貼文', at: now + 7200, picture: '', created: '' }], 222: [] } };
  await page.addInitScript(() => {
    try { localStorage.setItem('tbx.company', JSON.stringify({ token: 'test', exp: Math.floor(Date.now() / 1000) + 3600 })); } catch {}
  });
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const u = new URL(req.url());
    const okJ = (data) => r.fulfill({ headers: CORS, json: { ok: true, data } });
    const bad = (code, error, status = 400) => r.fulfill({ status, headers: CORS, json: { ok: false, code, error } });
    if (u.pathname === '/fb/pages') return okJ(PAGES);
    if (u.pathname === '/fb/scheduled') return okJ({ items: api.scheduled[u.searchParams.get('page')] || [] });
    if (u.pathname === '/fb/posts') return okJ({ items: [{ id: '111_1', message: '舊貼文', created: new Date().toISOString(), url: 'https://facebook.com/1', picture: '', reactions: 5, comments: 2, shares: 1 }], next: null });
    if (u.pathname === '/fb/insights') return okJ({ post: '111_1', metrics: { post_media_view: 1234, post_clicks: 56 }, missing: [] });
    if (u.pathname === '/fb/cancel') {
      const b = JSON.parse(req.postData());
      api.cancels.push(b.post);
      return okJ({ post: b.post, canceled: true });
    }
    if (u.pathname === '/fb/post') {
      const body = req.postDataBuffer().toString('latin1');
      const field = (k) => { const m = new RegExp(`name="${k}"\\r\\n\\r\\n([^\\r]*)`).exec(body); return m ? Buffer.from(m[1], 'latin1').toString('utf8') : null; };
      const rec = { page: field('page'), message: field('message'), scheduledAt: field('scheduledAt'), textPreset: field('textPreset'), hasImage: /name="image"; filename=/.test(body) };
      api.posts.push(rec);
      if (api.failPage === rec.page) { api.failPage = null; return bad('fb_permission', '沒有這個粉專的發文權限。', 403); }
      return okJ({ id: rec.page + '_99', scheduled: !!rec.scheduledAt, at: Number(rec.scheduledAt) || null });
    }
    if (u.pathname === '/fetch') return okJ({ url: u.searchParams.get('url'), title: '颱風假最新', image: 'https://news.tvbs.com.tw/a.png', description: '' });
    if (u.pathname === '/fetch/image') return r.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: fakeAsset([200, 120, 40]) });
    return r.fulfill({ status: 404, headers: CORS, body: '' });
  });
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

test('已排程分頁：列出並取消排程', async () => {
  const { page, api, errors } = await open();
  await page.waitForSelector('#schedList .item');
  assert.match(await page.textContent('#schedList'), /排好的貼文/);
  await page.click('#schedList .item button');
  await page.click('#cfYes');
  await page.waitForFunction(() => !document.querySelector('#schedList .item'));
  assert.deepEqual(api.cancels, ['111_7']);
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

test('作圖框：多粉專排程，一個失敗後單獨重送', async () => {
  const { page, api, errors } = await open();
  api.failPage = '222';
  await page.click('#newPost');
  await photo(page);
  await page.fill('#title', '颱風假最新\n北北基照常上班');
  await page.fill('#caption', '小編文 #颱風');
  for (const b of await page.$$('#pages .pg input')) await b.check();
  await page.click('#whenSeg [data-when=sched]');
  await page.click('#timeRow [data-add="60"]');
  await page.click('#sendBtn');
  await page.waitForSelector('#results .r-bad button');
  assert.equal(api.posts.length, 2);
  assert.ok(api.posts.every((p) => p.hasImage && p.scheduledAt && p.message === '小編文 #颱風'));
  assert.match(await page.textContent('#results .r-ok'), /已排程/);
  await page.click('#results .r-bad button');
  await page.waitForFunction(() => document.querySelectorAll('#results .r-ok').length === 2);
  assert.equal(api.posts.length, 3);
  assert.equal(api.posts[2].page, '222');
  assert.deepEqual(errors, []);
});

test('彈窗關閉再開內容還在；切換模式也保留；清空才清', async () => {
  const { page, errors } = await open();
  await page.click('#newPost');
  await photo(page);
  await page.fill('#title', '保留測試');
  await page.fill('#caption', '小編文保留');
  await page.click('#modeSeg [data-mode=text]');
  await page.fill('#cardText', '底圖文字保留');
  await page.click('#mClose');
  assert.equal(await page.isVisible('#modal'), false);
  await page.click('#newPost');
  assert.equal(await page.inputValue('#cardText'), '底圖文字保留');
  await page.click('#modeSeg [data-mode=frame]');
  assert.equal(await page.inputValue('#title'), '保留測試');
  assert.equal(await page.inputValue('#caption'), '小編文保留');
  assert.equal(await page.isVisible('#clearImg'), true);
  await page.click('#clearBtn');
  await page.click('#cfYes');
  assert.equal(await page.inputValue('#title'), '');
  assert.equal(await page.inputValue('#caption'), '');
  assert.equal(await page.isVisible('#clearImg'), false);
  assert.deepEqual(errors, []);
});

test('純文字：底圖送圖片、原生背景送 textPreset、無底色只送文字', async () => {
  const { page, api, errors } = await open();
  await page.click('#newPost');
  await page.click('#modeSeg [data-mode=text]');
  await page.check('#pages .pg input >> nth=0');
  await page.fill('#cardText', '今天放假');
  await page.fill('#caption', '說明');
  await page.click('#sendBtn');
  await page.waitForSelector('#results .r-ok');
  await page.click('#textSeg [data-text=native]');
  await page.fill('#presetId', '106018623298955');
  await page.click('#sendBtn');
  await page.waitForFunction(() => document.querySelector('#sendMsg').textContent.startsWith('完成'));
  await page.click('#textSeg [data-text=plain]');
  await page.click('#sendBtn');
  await page.waitForFunction(() => document.querySelectorAll('#results li').length === 1 && document.querySelector('#sendMsg').textContent.startsWith('完成'));
  const [card, native, plain] = api.posts;
  assert.equal(card.hasImage, true);
  assert.equal(native.textPreset, '106018623298955');
  assert.equal(native.hasImage, false);
  assert.equal(plain.textPreset, null);
  assert.equal(plain.hasImage, false);
  assert.equal(api.posts.length, 3);
  assert.deepEqual(errors, []);
});

test('文章網址帶入：標題、網址、主圖', async () => {
  const { page, errors } = await open();
  await page.click('#newPost');
  await page.fill('#url', 'https://news.tvbs.com.tw/life/1');
  await page.click('#fillBtn');
  await page.waitForFunction(() => /已帶入/.test(document.querySelector('#urlHint').textContent));
  assert.equal(await page.inputValue('#title'), '颱風假最新');
  assert.match(await page.inputValue('#caption'), /【颱風假最新】\nhttps:\/\/news\.tvbs\.com\.tw\/life\/1/);
  assert.match(await page.textContent('#urlHint'), /主圖/);
  assert.deepEqual(errors, []);
});

test('沒勾粉專、沒照片會擋下，不送出', async () => {
  const { page, api } = await open();
  await page.click('#newPost');
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendMsg'), /勾選/);
  await page.check('#pages .pg input >> nth=0');
  await page.click('#sendBtn');
  assert.match(await page.textContent('#sendMsg'), /照片/);
  assert.equal(api.posts.length, 0);
});
