// 影片發布：以 page.route 模擬後端（分段上傳、送出、狀態），不打真的臉書。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');
const { API_BASE } = require('../helpers/tool-page.js');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(__dirname, '..', 'fixtures', 'fbvideo');
const SHOT = process.env.SHOT_DIR;
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const PAGES = [{ id: '111', short: '新聞', order: 1, rd: 'news' }, { id: '222', short: '娛樂', order: 2, rd: 'ent' }];
const CH = 400;   // 替身後端每段 400 bytes（測試影片約 1.2KB → 4 段）
const file = (name, src = 'wide') => ({ name, mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(FIX, src + '.mp4')) });

async function newPage(mode = 'admin', viewport = { width: 1280, height: 900 }, opts = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [], api = { start: [], chunk: [], publish: [], stop: [], drop: [], rundown: [] };
  const ups = new Map();
  let hold = null;   // 設成 Promise 時，分段請求等它（測試上傳中）
  page.on('pageerror', (e) => errors.push(String(e)));
  const view = (id) => {
    const u = ups.get(id);
    const jobs = Object.entries(u.pages).map(([p, j]) => ({ uploadId: id, page: p, kind: u.kind, name: u.name, size: u.size, state: j.state, uploaded: j.state === 'uploading' ? j.next : u.size, videoId: 'V' + p, sent: !!j.sent, at: u.at ?? null, title: u.title || '', error: '', created: Date.now() }));
    const up = Object.values(u.pages).filter((j) => j.state === 'uploading');
    const s = up.length ? Math.min(...up.map((j) => j.next)) : null;
    return { next: s === null ? null : { start: s, end: Math.min(s + CH, u.size) }, jobs };
  };
  const finish = (u) => { for (const j of Object.values(u.pages)) if (j.sent && j.state === 'uploaded') j.state = u.at ? 'scheduled' : 'processing'; };
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request(), url = new URL(req.url()), p = url.pathname;
    const json = (data, status = 200) => r.fulfill({ status, headers: CORS, json: status === 200 ? { ok: true, data } : data });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (p === '/auth/status') return mode === 'denied' ? json({ ok: false, code: 'unauthorized', error: '請先登入' }, 401) : json({ company: true, admin: true });
    if (mode === 'company' && p.startsWith('/fb/')) return json({ ok: false, code: 'fb_forbidden', error: '關閉', detail: { reason: '測試中' } }, 403);
    if (p === '/fb/pages') return json(PAGES);
    if (p === '/fb/access') return json({ mode: 'admin' });
    if (p === '/fb/me') return json({ admin: true, perms: ['view', 'post', 'edit', 'delete'] });
    if (p === '/fb/presets') return json([{ name: '抽獎', body: '留言抽獎！' }]);
    if (p === '/fb/video/settings') return json({ prefixes: ['1118_'], suffixes: ['_v2'], reelsTag: '#焦點新聞影音都在TVBS', tags: ['#國際', '#TVBS新聞'] });
    if (p === '/fb/video/start') {
      const b = JSON.parse(req.postData()); api.start.push(b);
      if (!ups.has(b.uploadId)) ups.set(b.uploadId, { size: b.size, kind: b.kind, name: b.name, pages: {} });
      const u = ups.get(b.uploadId);
      for (const pg of b.pages) if (!u.pages[pg] || ['stopped', 'canceled'].includes(u.pages[pg].state)) u.pages[pg] = { state: 'uploading', next: 0 };
      return json(view(b.uploadId));
    }
    if (p === '/fb/video/chunk') {
      const id = url.searchParams.get('u'), s = Number(url.searchParams.get('start'));
      const len = req.postDataBuffer().length;
      api.chunk.push([id, s, len]);
      if (hold) await hold;
      const u = ups.get(id);
      for (const j of Object.values(u.pages)) if (j.state === 'uploading' && j.next === s) { j.next = s + len; if (j.next >= u.size) j.state = 'uploaded'; }
      finish(u);
      return json(view(id));
    }
    if (p === '/fb/video/publish') {
      const b = JSON.parse(req.postData()); api.publish.push(b);
      const u = ups.get(b.uploadId); u.at = b.at; u.title = b.title;
      for (const j of Object.values(u.pages)) if (['uploading', 'uploaded'].includes(j.state)) j.sent = true;
      finish(u);
      return json(view(b.uploadId));
    }
    if (p === '/fb/video/stop' || p === '/fb/video/drop') {
      const b = JSON.parse(req.postData()); api[p.endsWith('stop') ? 'stop' : 'drop'].push(b);
      const u = ups.get(b.uploadId);
      if (u) for (const [pg, j] of Object.entries(u.pages)) if ((!b.page || b.page === pg) && ['uploading', 'uploaded'].includes(j.state)) j.state = b.page ? 'canceled' : 'stopped';
      return json(u ? view(b.uploadId) : { next: null, jobs: [] });
    }
    if (p === '/fb/video/status') { const id = url.searchParams.get('u'); for (const j of Object.values(ups.get(id).pages)) if (j.state === 'processing') j.state = 'published'; return json(view(id)); }
    if (p === '/fb/video/jobs') return json([...ups.keys()].flatMap((id) => view(id).jobs.filter((j) => j.sent)));
    if (p === '/rundown') { const b = JSON.parse(req.postData()); api.rundown.push(b); return json({ results: b.entries.map((e) => ({ ok: true, page: e.page, time: e.time })) }); }
    return r.fulfill({ status: 404, headers: CORS, json: { ok: false, code: 'not_found' } });
  });
  if (!opts.noToken) await page.addInitScript(() => { try { localStorage.setItem('tbx.company', JSON.stringify({ token: 't', exp: Math.floor(Date.now() / 1000) + 3600 })); } catch {} });
  await page.goto(srv.url + 'tools/fbvideo/index.html');
  return { page, errors, api, ups, setHold: (pr) => { hold = pr; } };
}
const msg = (page) => page.locator('.ed:not([hidden]) .msg').inputValue();
const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('沒權限：顯示停用頁與原因', async () => {
  const { page, errors } = await newPage('company');
  await page.waitForSelector('#offReason:not([hidden])');
  assert.match(await page.textContent('#offReason'), /測試中/);
  assert.equal(await page.isVisible('#app'), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Reels_ 檔名：去前後綴當標題、自動 hashtag、按鈕、授權行；上傳一次給兩個粉專；送出與 RD', async () => {
  const { page, errors, api } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.chip[data-page="111"]');
  await page.click('.chip[data-page="222"]');
  await page.setInputFiles('#fileIn', file('Reels_1118_立法院三讀_v2.mp4'));
  await page.waitForSelector('.ed:not([hidden])');
  assert.equal(await page.inputValue('.ed:not([hidden]) .title'), '立法院三讀');
  assert.equal(await msg(page), '\n【立法院三讀】\n#焦點新聞影音都在TVBS');
  assert.equal(await page.getAttribute('.ed:not([hidden]) .kind [data-kind=reel]', 'aria-pressed'), 'true');
  // hashtag 按鈕加到同一行；授權照原樣放下一行；小編文寫兩行也不跑位
  await page.click('.ed:not([hidden]) .tag[data-tag="#國際"]');
  await page.fill('.ed:not([hidden]) .lic', '畫面來源：讀者提供');
  await page.dispatchEvent('.ed:not([hidden]) .lic', 'input');
  assert.equal(await msg(page), '\n【立法院三讀】\n#焦點新聞影音都在TVBS #國際\n畫面來源：讀者提供');
  const v = await msg(page);
  await page.fill('.ed:not([hidden]) .msg', '小編第一行\n小編第二行' + v);
  await page.click('.ed:not([hidden]) .tag[data-tag="#國際"]');
  assert.equal(await msg(page), '小編第一行\n小編第二行\n【立法院三讀】\n#焦點新聞影音都在TVBS\n畫面來源：讀者提供');
  // 改標題 → 標題行跟著換
  await page.fill('.ed:not([hidden]) .title', '立法院今三讀');
  assert.match(await msg(page), /\n【立法院今三讀】\n/);
  // 上傳：每段只送一次（兩個粉專共用）
  await page.waitForSelector('.ed:not([hidden]) .up-text:has-text("上傳完成")');
  assert.equal(api.start.length, 1);
  assert.deepEqual(api.start[0].pages, ['111', '222']);
  assert.equal(api.start[0].kind, 'reel');
  const starts = api.chunk.map((c) => c[1]);
  assert.deepEqual(starts, [...new Set(starts)], '同一段不重送');
  // 留言（活動）＋ RD
  await page.click('.ed:not([hidden]) .cm-add');
  await page.selectOption('.ed:not([hidden]) .cm-row select.preset', '0');
  await page.check('#rdOn');
  await page.click('#sendBtn');
  await until(() => api.publish.length === 1);
  const b = api.publish[0];
  assert.equal(b.title, '立法院今三讀');
  assert.equal(b.description, '小編第一行\n小編第二行\n【立法院今三讀】\n#焦點新聞影音都在TVBS\n畫面來源：讀者提供');
  assert.equal(b.at, null);
  assert.deepEqual(b.comments, [{ message: '留言抽獎！', delay: 0 }]);
  await until(() => api.rundown.length === 1);
  assert.deepEqual(api.rundown[0].entries.map((e) => [e.page, e.text, e.style]), [['news', 'Reels/立法院今', 'video'], ['ent', 'Reels/立法院今', 'video']]);
  assert.equal(await page.isDisabled('.ed:not([hidden]) .title'), true, '送出後鎖住');
  assert.deepEqual(errors, []);
  await page.close();
});

test('類型判斷：直式＝Reels、橫式＝影片、Shorts_ 不自動加 hashtag；多支各自時間', async () => {
  const { page, errors, api } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  await page.setInputFiles('#fileIn', [file('直式.mp4', 'tall'), file('橫式.mp4', 'wide'), file('Shorts_短.mp4', 'wide')]);
  // 三支的長寬都讀到才判斷（直式靠長寬）
  await until(async () => (await page.$$eval('.ed .meta', (l) => l.filter((x) => /\d+×\d+/.test(x.textContent)).length)) === 3);
  const metas = await page.$$eval('.vq-meta', (l) => l.map((x) => x.textContent.split('．')[0]));
  assert.deepEqual(metas, ['Reels', '橫式', 'Reels']);
  assert.equal(await msg(page), '\n【短】', 'Shorts_ 不自動加 Reels hashtag');
  assert.equal(api.start.length, 0, '沒選粉專不上傳');
  // 每支各自時間：第 3 支排程
  await page.click('#timeModeSeg [data-tm=each]');
  assert.equal(await page.isVisible('.ed:not([hidden]) .when-each'), true);
  await page.click('.ed:not([hidden]) .when-each [data-w=sched]');
  assert.ok(await page.inputValue('.ed:not([hidden]) .when-each input[type=datetime-local]'));
  // 取消勾第 1 支 → 只有 2 支
  await page.click('.vq summary');
  await page.uncheck('.vq-item >> nth=0 >> input[type=checkbox]');
  await page.click('.chip[data-page="111"]');
  await until(() => api.start.length === 2);
  assert.deepEqual(api.start.map((s) => s.name).sort(), ['Shorts_短.mp4', '橫式.mp4']);
  assert.equal(await page.textContent('#sendBtn'), '全部送出（2 支）');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbvideo-desktop.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

test('上傳中：擋取消粉專、移除影片、切類型；關分頁要確認；停止上傳後可重新上傳', async () => {
  const { page, errors, api, setHold } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  let release; setHold(new Promise((r) => { release = r; }));
  await page.click('.chip[data-page="111"]');
  await page.setInputFiles('#fileIn', file('橫式.mp4'));
  await until(() => api.chunk.length >= 1);
  await page.waitForSelector('#stopBtn:not([hidden])');
  await page.click('.chip[data-page="111"]');
  await page.waitForSelector('#toast:not([hidden])');
  assert.match(await page.textContent('#toast'), /等上傳完成才能取消粉專/);
  assert.equal(await page.getAttribute('.chip[data-page="111"]', 'aria-pressed'), 'true');
  await page.click('.vq summary');
  await page.click('.vq-rm');
  assert.match(await page.textContent('#toast'), /等上傳完成才能移除/);
  assert.equal(await page.locator('.vq-item').count(), 1);
  await page.click('.ed:not([hidden]) .kind [data-kind=reel]');
  assert.match(await page.textContent('#toast'), /等上傳完成才能切換類型/);
  // 關分頁：tb.busy 掛了 beforeunload（無頭瀏覽器不會跳對話框，改驗證事件被攔下）
  const unloadBlocked = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  assert.equal(await unloadBlocked(), true, '上傳中關分頁要先確認');
  // 停止上傳
  await page.click('#stopBtn');
  await page.click('#cfYes');
  release();
  await page.waitForSelector('.ed:not([hidden]) .up-text:has-text("已停止上傳")');
  assert.equal(api.stop.length, 1);
  assert.equal(await page.isVisible('#stopBtn'), false);
  assert.equal(await unloadBlocked(), false, '停止後不再攔');
  await page.click('.ed:not([hidden]) .restart');
  await page.waitForSelector('.ed:not([hidden]) .up-text:has-text("上傳完成")');
  assert.equal(api.start.length, 2);
  assert.notEqual(api.start[0].uploadId, api.start[1].uploadId);
  // 上傳完成後可以取消粉專（取消那個粉專的工作階段）
  await page.click('.chip[data-page="111"]');
  await until(() => api.drop.length === 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('手機寬度不超出畫面', async () => {
  const { page, errors } = await newPage('admin', { width: 360, height: 780 });
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.chip[data-page="111"]');
  await page.setInputFiles('#fileIn', file('Reels_手機.mp4', 'tall'));
  await page.waitForSelector('.ed:not([hidden]) .up-text:has-text("上傳完成")');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'overflow ' + over);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbvideo-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});
