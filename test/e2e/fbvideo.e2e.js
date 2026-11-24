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
  const errors = [], api = { start: [], chunk: [], publish: [], stop: [], drop: [], rundown: [], cover: [] };
  const ups = new Map();
  let hold = null;   // 設成 Promise 時，分段請求等它（測試上傳中）
  let failN = 0;   // 接下來 N 個分段回 502（前端每段會自動重試 2 次，所以 3＝這段真的失敗）
  page.on('pageerror', (e) => errors.push(String(e)));
  const view = (id) => {
    const u = ups.get(id);
    const jobs = Object.entries(u.pages).map(([p, j]) => ({ uploadId: id, page: p, kind: u.kind, name: u.name, size: u.size, state: j.state, uploaded: j.state === 'uploading' ? j.next : u.size, videoId: 'V' + p, sent: !!j.sent, at: u.at ?? null, title: u.title || '', error: '', created: Date.now() }));
    const up = Object.values(u.pages).filter((j) => j.state === 'uploading');
    const s = up.length ? Math.min(...up.map((j) => j.next)) : null;
    return { next: s === null ? null : { start: s, end: Math.min(s + CH, u.size) }, jobs };
  };
  const finish = (u) => { for (const [pg, j] of Object.entries(u.pages)) if (j.sent && j.state === 'uploaded') j.state = (u.drafts || []).includes(pg) ? 'draft' : u.at ? 'scheduled' : 'processing'; };
  await page.route(API_BASE + '/**', async (r) => {
    const req = r.request(), url = new URL(req.url()), p = url.pathname;
    const json = (data, status = 200) => r.fulfill({ status, headers: CORS, json: status === 200 ? { ok: true, data } : data });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (p === '/auth/status') return mode === 'denied' ? json({ ok: false, code: 'unauthorized', error: '請先登入' }, 401) : json({ company: true, admin: true });
    if (mode === 'company' && p.startsWith('/fb/')) return json({ ok: false, code: 'fb_forbidden', error: '關閉', detail: { reason: '測試中' } }, 403);
    if (p === '/fb/pages') return json(opts.pages || PAGES);
    if (p === '/fb/access') return json({ mode: 'admin' });
    if (p === '/fb/me') return json(opts.me || { admin: true, perms: ['view', 'post', 'edit', 'delete'] });
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
      if (failN > 0) { failN--; return json({ ok: false, code: 'fb_error', error: '連線中斷' }, 502); }
      const u = ups.get(id);
      for (const j of Object.values(u.pages)) if (j.state === 'uploading' && j.next === s) { j.next = s + len; if (j.next >= u.size) j.state = 'uploaded'; }
      finish(u);
      return json(view(id));
    }
    if (p === '/fb/video/cover') { const b = req.postDataBuffer(); api.cover.push([url.searchParams.get('u'), b.length, b[0] === 0xff && b[1] === 0xd8]); return json(view(url.searchParams.get('u'))); }
    if (p === '/fb/video/publish') {
      const b = JSON.parse(req.postData()); api.publish.push(b);
      const u = ups.get(b.uploadId); u.at = b.pages.find((x) => x.at)?.at ?? null; u.title = b.title; u.drafts = b.pages.filter((x) => x.draft).map((x) => x.page);
      for (const [pg, j] of Object.entries(u.pages)) if (b.pages.some((x) => x.page === pg) && ['uploading', 'uploaded'].includes(j.state)) j.sent = true;
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
  return { page, errors, api, ups, setHold: (pr) => { hold = pr; }, failChunk: (n = 3) => { failN = n; } };
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

const ED = '.ed:not([hidden])';
// 勾右欄「發布粉專」下拉裡的粉專
async function pickPage(page, id, on = true) {
  const dd = page.locator(ED + ' .pg-dd');
  if (!(await dd.evaluate((d) => d.open))) await page.click(ED + ' .pg-dd summary');
  const cb = page.locator(`${ED} .pg input[data-page="${id}"]`);
  if (on) await cb.check(); else await cb.click();
}

test('Reels_ 檔名：去前後綴當標題、自動 hashtag、按鈕與自訂標籤、授權行；上傳一次給兩個粉專；送出與 RD', async () => {
  const { page, errors, api, setHold } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  await page.setInputFiles('#fileIn', file('Reels_1118_立法院三讀_v2.mp4'));
  await page.waitForSelector(ED);
  // 右欄順序：發布粉專 → 類型 → 影片標題 → 影片內文 → 標籤 → 授權
  const order = await page.$$eval(ED + ' .ed-body .lbl', (l) => l.map((x) => x.firstChild.textContent.trim()));
  assert.deepEqual(order.slice(0, 6), ['發布粉專', '類型', '影片標題', '影片內文', '標籤（hashtag）', '授權']);
  assert.equal(await page.locator(ED + ' .up').count(), 0, '上傳狀態不在右欄');
  assert.equal(await page.inputValue(ED + ' .title'), '立法院三讀');
  assert.equal(await msg(page), '\n【立法院三讀】\n#焦點新聞影音都在TVBS');
  assert.equal(await page.getAttribute(ED + ' .kind [data-kind=reel]', 'aria-pressed'), 'true');
  await page.click(ED + ' .tag[data-tag="#國際"]');
  // 自訂標籤：補 #、加到 hashtag 行、多一顆按鈕
  await page.fill(ED + ' .tag-in', '颱風 動態');
  await page.press(ED + ' .tag-in', 'Enter');
  assert.equal(await page.getAttribute(ED + ' .tag[data-tag="#颱風動態"]', 'aria-pressed'), 'true');
  await page.fill(ED + ' .lic', '畫面來源：讀者提供');
  await page.dispatchEvent(ED + ' .lic', 'input');
  assert.equal(await msg(page), '\n【立法院三讀】\n#焦點新聞影音都在TVBS #國際 #颱風動態\n畫面來源：讀者提供');
  const v = await msg(page);
  await page.fill(ED + ' .msg', '小編第一行\n小編第二行' + v);
  await page.click(ED + ' .tag[data-tag="#國際"]');
  assert.equal(await msg(page), '小編第一行\n小編第二行\n【立法院三讀】\n#焦點新聞影音都在TVBS #颱風動態\n畫面來源：讀者提供');
  await page.fill(ED + ' .title', '立法院今三讀');
  assert.match(await msg(page), /\n【立法院今三讀】\n/);
  assert.match(await page.textContent('.vq-item.is-cur .vq-name'), /立法院今三讀/, '左欄標題跟著改');
  // 勾兩個粉專 → 上傳（每段只送一次）：先卡住第一段，兩個粉專都開好工作階段再放行
  let release; setHold(new Promise((r) => { release = r; }));
  await pickPage(page, '111');
  await pickPage(page, '222');
  await until(() => new Set(api.start.flatMap((x) => x.pages)).size === 2);
  setHold(null); release();
  assert.match(await page.textContent(ED + ' .pg-sum'), /已選 2 個粉專：新聞（立即）、娛樂（立即）/);
  await page.waitForSelector('#stText:has-text("上傳完成")');
  assert.deepEqual([...new Set(api.start.flatMap((s) => s.pages))].sort(), ['111', '222']);
  assert.equal(api.start[0].kind, 'reel');
  const seen = api.chunk.map((c) => c[1] + ':' + c[2]);
  assert.equal(seen.length, new Set(seen).size, '同一段不重送');
  await page.click(ED + ' .cm-add');
  await page.selectOption(ED + ' .cm-row select.preset', '0');
  await page.click('.rd-switch .track');
  assert.equal(await page.isChecked('#rdOn'), true);
  await page.click('#sendBtn');
  await until(() => api.publish.length === 1);
  const b = api.publish[0];
  assert.equal(b.title, '立法院今三讀');
  assert.equal(b.description, '小編第一行\n小編第二行\n【立法院今三讀】\n#焦點新聞影音都在TVBS #颱風動態\n畫面來源：讀者提供');
  assert.deepEqual(b.pages, [{ page: '111', at: null }, { page: '222', at: null }]);
  assert.deepEqual(b.comments, [{ message: '留言抽獎！', delay: 0 }]);
  await until(() => api.rundown.length === 1);
  assert.deepEqual(api.rundown[0].entries.map((e) => [e.page, e.text, e.style]), [['news', 'Reels/立法院今', 'video'], ['ent', 'Reels/立法院今', 'video']]);
  assert.equal(await page.isDisabled(ED + ' .title'), true, '送出後鎖住');
  assert.deepEqual(errors, []);
  await page.close();
});

test('類型判斷；每支各自粉專與排程；套用到全部影片；RD 用各粉專時間', async () => {
  const { page, errors, api } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  await page.setInputFiles('#fileIn', [file('直式.mp4', 'tall'), file('橫式.mp4', 'wide'), file('Shorts_短.mp4', 'wide')]);
  await until(async () => (await page.$$eval('.vq-thumb img', (l) => l.length)) === 3);
  assert.deepEqual(await page.$$eval('.vq-meta .badge', (l) => l.map((x) => x.textContent)), ['Reels', '橫式', 'Reels']);
  assert.equal(await msg(page), '\n【短】', 'Shorts_ 不自動加 Reels hashtag');
  assert.equal(api.start.length, 0, '沒選粉專不上傳');
  // 第 3 支：新聞立即、娛樂排程（排程才出時間）
  await pickPage(page, '111');
  await pickPage(page, '222');
  const dt = page.locator(ED + ' .pg input.pg-dt').nth(1);
  assert.equal(await dt.isVisible(), false);
  await page.selectOption(ED + ' .pg select.pg-mode >> nth=1', 'sched');
  assert.equal(await dt.isVisible(), true);
  assert.match(await page.textContent(ED + ' .pg-sum'), /娛樂（排程 \d\d\/\d\d \d\d:\d\d）/);
  // 第 1 支不要送；套用到全部影片 → 第 1、2 支也是同樣粉專與時間（第 1 支沒勾，不上傳）
  await page.uncheck('.vq-item >> nth=0 >> input[type=checkbox]');
  await page.click(ED + ' .apply-all');
  await page.click('.vq-item >> nth=1 >> .vq-pick');
  assert.match(await page.textContent(ED + ' .pg-sum'), /已選 2 個粉專：新聞（立即）、娛樂（排程/);
  await until(async () => (await page.$$eval('.vq-meta', (l) => l.filter((x) => /已上傳/.test(x.textContent)).length)) === 2);
  assert.deepEqual([...new Set(api.start.map((s) => s.name))].sort(), ['Shorts_短.mp4', '橫式.mp4']);
  assert.equal(await page.textContent('#sendBtn'), '全部送出（2 支）');
  if (SHOT) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOT, 'fbvideo-desktop.png') }); }
  await page.click('.rd-switch .track');
  assert.equal(await page.isChecked('#rdOn'), true);
  await page.click('#sendBtn');
  await until(() => api.publish.length === 2);
  for (const b of api.publish) { assert.equal(b.pages[0].at, null); assert.ok(b.pages[1].at > Date.now() / 1000); }
  await until(() => api.rundown.length === 2);
  const ent = api.rundown[0].entries.find((e) => e.page === 'ent'), news = api.rundown[0].entries.find((e) => e.page === 'news');
  assert.notEqual(ent.time, news.time, 'RD 用各粉專自己的時間');
  assert.deepEqual(errors, []);
  await page.close();
});

test('上傳中：擋取消粉專、移除影片、切類型；關分頁要確認；停止上傳後可重新上傳', async () => {
  const { page, errors, api, setHold } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  let release; setHold(new Promise((r) => { release = r; }));
  await page.setInputFiles('#fileIn', file('橫式.mp4'));
  await pickPage(page, '111');
  await until(() => api.chunk.length >= 1);
  await page.waitForSelector('#stopBtn:not([hidden])');
  await page.click(`${ED} .pg input[data-page="111"]`);
  await page.waitForSelector('#toast:not([hidden])');
  assert.match(await page.textContent('#toast'), /等上傳完成才能取消粉專/);
  assert.equal(await page.isChecked(`${ED} .pg input[data-page="111"]`), true);
  await page.click('.vq-rm');
  assert.match(await page.textContent('#toast'), /等上傳完成才能移除/);
  assert.equal(await page.locator('.vq-item').count(), 1);
  await page.click(ED + ' .kind [data-kind=reel]');
  assert.match(await page.textContent('#toast'), /等上傳完成才能切換類型/);
  const unloadBlocked = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  assert.equal(await unloadBlocked(), true, '上傳中關分頁要先確認');
  await page.click('#stopBtn');
  await page.click('#cfYes');
  release();
  await page.waitForSelector(ED + ' .up-msg:has-text("已停止上傳")');
  assert.equal(api.stop.length, 1);
  assert.equal(await page.isVisible('#stopBtn'), false);
  assert.equal(await unloadBlocked(), false, '停止後不再攔');
  await page.click(ED + ' .up-restart');
  await page.waitForSelector('#stText:has-text("上傳完成")');
  assert.notEqual(api.start[0].uploadId, api.start[api.start.length - 1].uploadId);
  await page.click(`${ED} .pg input[data-page="111"]`);
  await until(() => api.drop.length === 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('送出後上傳失敗：重新上傳後自動用已送出的內容發布', async () => {
  const { page, errors, api, setHold, failChunk } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  let release; setHold(new Promise((r) => { release = r; }));
  await page.setInputFiles('#fileIn', file('橫式.mp4'));
  await pickPage(page, '111');
  await until(() => api.chunk.length >= 1);
  await page.click('#sendBtn');
  await until(() => api.publish.length === 1);
  failChunk(); setHold(null); release();
  await page.waitForSelector(ED + ' .up-restart:not([hidden])', { timeout: 20000 });
  assert.match(await page.textContent(ED + ' .up-msg'), /上傳失敗/);
  assert.match(await page.textContent('#stText'), /1 支失敗或停止/);
  assert.match(await page.textContent('.vq-err'), /上傳失敗/);
  await page.click(ED + ' .up-restart');
  await until(() => api.publish.length === 2);
  assert.notEqual(api.publish[1].uploadId, api.publish[0].uploadId);
  assert.deepEqual({ ...api.publish[1], uploadId: '' }, { ...api.publish[0], uploadId: '' });
  await page.waitForSelector('#stText:has-text("上傳完成")');
  assert.ok(api.stop.some((s) => s.uploadId === api.publish[0].uploadId), '舊的上傳停掉');
  assert.deepEqual(errors, []);
  await page.close();
});

test('封面：從影片選一格 → 類型右側與左欄縮圖換成封面；送出前先送封面；恢復臉書自動', async () => {
  const { page, errors, api } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  await page.setInputFiles('#fileIn', file('橫式.mp4', 'wide'));
  await page.waitForSelector('.vq-thumb img');
  assert.match(await page.textContent(ED + ' .cover-img'), /自動/);
  const kindBox = await page.locator(ED + ' .kind').boundingBox(), coverBox = await page.locator(ED + ' .cover').boundingBox();
  assert.ok(Math.abs(kindBox.y + kindBox.height / 2 - (coverBox.y + coverBox.height / 2)) < 4, '封面和類型同一列');
  await page.click(ED + ' .cover-btn');
  await page.waitForSelector('#coverDlg[open]');
  await until(async () => (await page.locator('#coverStrip .strip-btn').count()) === 8);
  await page.click('#coverStrip .strip-btn >> nth=5');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbvideo-cover-dlg.png') });
  await page.click('#coverNext');
  await page.click('#coverUse');
  await page.waitForFunction(() => !document.getElementById('coverDlg').open);
  await page.waitForSelector(ED + ' .cover-img img');
  assert.equal(await page.textContent(ED + ' .cover-btn'), '更換封面');
  if (SHOT) await page.locator(ED + ' .cover').screenshot({ path: path.join(SHOT, 'fbvideo-cover.png') });
  assert.equal(await page.getAttribute('.vq-item.is-cur .vq-thumb img', 'src'), await page.getAttribute(ED + ' .cover-img img', 'src'), '左欄縮圖跟著換');
  // 恢復臉書自動 → 再選一次
  await page.click(ED + ' .cover-btn');
  await page.click('#coverAuto');
  await page.waitForSelector(ED + ' .cover-img span:has-text("自動")');
  await page.click(ED + ' .cover-btn');
  await page.click('#coverUse');
  await page.waitForSelector(ED + ' .cover-img img');
  await pickPage(page, '111');
  await page.waitForSelector('#stText:has-text("上傳完成")');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbvideo-cover-row.png') });
  await page.click('#sendBtn');
  await until(() => api.publish.length === 1);
  assert.equal(api.cover.length, 1);
  assert.equal(api.cover[0][0], api.publish[0].uploadId);
  assert.equal(api.cover[0][2], true, 'JPG');
  assert.equal(await page.isDisabled(ED + ' .cover-btn'), true, '送出後鎖住');
  assert.deepEqual(errors, []);
  await page.close();
});

test('手機寬度：上方橫向縮圖列，不超出畫面', async () => {
  const { page, errors } = await newPage('admin', { width: 360, height: 780 });
  await page.waitForSelector('#app:not([hidden])');
  await page.setInputFiles('#fileIn', [file('Reels_手機.mp4', 'tall'), file('第二支.mp4', 'wide'), file('第三支.mp4', 'wide')]);
  await pickPage(page, '111');
  await page.waitForSelector('#stText:has-text("上傳完成")');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'overflow ' + over);
  assert.equal(await page.$eval('#vqList', (u) => getComputedStyle(u).flexDirection), 'row');
  if (SHOT) { await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }); await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOT, 'fbvideo-mobile.png') }); }
  assert.deepEqual(errors, []);
  await page.close();
});

test('發布方式：草稿＋多文發佈（跳選單選粉專）、RD 寫預留格；Reels 不能多文；RD 開關與正方形封面', async () => {
  const pages = [...PAGES, { id: '333', short: '國際', order: 3, rd: 'intl' }];
  const { page, errors, api } = await newPage('admin', { width: 1280, height: 900 }, { pages });
  await page.waitForSelector('#app:not([hidden])');
  // RD 開關：看得到軌道，點了會開、顏色變成主色
  const track = page.locator('.rd-switch .track');
  assert.ok(await track.isVisible());
  const off = await track.evaluate((e) => getComputedStyle(e).backgroundColor);
  await track.click();
  assert.equal(await page.isChecked('#rdOn'), true);
  assert.ok(await until(async () => (await track.evaluate((e) => getComputedStyle(e).backgroundColor)) !== off), '開了要變色');
  await page.setInputFiles('#fileIn', [file('橫式.mp4', 'wide')]);
  const ED = '.ed:not([hidden])';
  // 封面框是正方形
  const box = await page.locator(ED + ' .cover-img').boundingBox();
  assert.equal(Math.round(box.width), Math.round(box.height));
  assert.equal(await page.textContent(ED + ' .apply-all'), '發布方式全套用');
  await page.click(ED + ' .pg-dd summary');
  await page.check(ED + ' .pg-list input[data-page="111"]');
  // 多文：跳選單，只列沒直接上傳的粉專
  await page.selectOption(ED + ' .pg-list li:has(input[data-page="111"]) .pg-mode', 'cross');
  await page.waitForSelector('#crossDlg[open]');
  assert.deepEqual(await page.$$eval('#crossList label', (l) => l.map((x) => x.textContent)), ['娛樂', '國際']);
  // 取消 → 回到立即
  await page.click('#crossCancel');
  assert.equal(await page.inputValue(ED + ' .pg-list li:has(input[data-page="111"]) .pg-mode'), 'now');
  await page.selectOption(ED + ' .pg-list li:has(input[data-page="111"]) .pg-mode', 'cross');
  await page.check('#crossList input[value="333"]');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'fbvideo-cross-dialog.png') });
  await page.click('#crossOk');
  assert.equal(await page.textContent(ED + ' .pg-x'), '多文到：國際');
  // 娛樂：草稿；留言提示
  await page.check(ED + ' .pg-list input[data-page="222"]');
  await page.selectOption(ED + ' .pg-list li:has(input[data-page="222"]) .pg-mode', 'draft');
  assert.match(await page.textContent(ED + ' .pg-sum'), /新聞（立即＋多文到 國際）、娛樂（草稿）/);
  assert.match(await page.textContent(ED + ' .cm-note'), /娛樂.*不會留言/);
  if (SHOT) { await page.locator(ED).screenshot({ path: path.join(SHOT, 'fbvideo-modes.png') }); await page.locator('#foot').screenshot({ path: path.join(SHOT, 'fbvideo-foot.png') }); }
  await until(async () => /已上傳/.test(await page.textContent('.vq-meta')));
  await page.click('#sendBtn');
  await until(() => api.publish.length === 1);
  assert.deepEqual(api.publish[0].pages, [{ page: '111', at: null, cross: ['333'] }, { page: '222', at: null, draft: true }]);
  await until(() => api.rundown.length === 1, 10000);
  const es = api.rundown[0].entries.map((e) => [e.page, e.text, e.slot || '', e.kind || '']);
  assert.deepEqual(es, [['news', '純影/橫式', '', ''], ['intl', '純影/橫式', 'cross', 'video'], ['ent', '純影/橫式', 'draft', 'video']]);
  // Reels：多文選項不能用
  await page.setInputFiles('#fileIn', [file('Reels_短.mp4', 'tall')]);
  await page.click(ED + ' .pg-dd summary');
  await page.check(ED + ' .pg-list input[data-page="111"]');
  assert.equal(await page.$eval(ED + ' .pg-list li:has(input[data-page="111"]) .pg-mode option[value="cross"]', (o) => o.disabled), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('開啟時先顯示骨架、不閃「功能停用」；能用換成內容，不能用才顯示停用（fbvideo）', async () => {
  for (const mode of ['admin', 'denied']) {
    const { page, errors } = await newPage(mode);
    let release; const gate = new Promise((r) => { release = r; });
    await page.route(API_BASE + '/auth/status', async (r) => { await gate; return r.fallback(); });   // 後端慢：先擋住
    await page.goto(srv.url + 'tools/fbvideo/index.html');
    await page.waitForSelector('#bootSk .sk');
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible('#bootSk'), true, '先看到骨架');
    assert.equal(await page.isVisible('#offMain'), false, '不閃停用畫面');
    assert.equal(await page.isVisible('#app'), false);
    if (mode === 'admin' && SHOT) await page.screenshot({ path: path.join(SHOT, 'fbvideo-boot.png') });
    release();
    if (mode === 'admin') await page.waitForSelector('#app:not([hidden])');
    else await page.waitForSelector('#offMain:not([hidden])');
    assert.equal(await page.isVisible('#bootSk'), false, '載完收掉骨架');
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('權限：vview 才能開影片發布、vpost 才有送出鈕；只有排程發布 view／post 不行', async () => {
  const none = await newPage('admin', { width: 1280, height: 900 }, { me: { admin: false, perms: ['view', 'post', 'edit', 'delete'] } });
  await none.page.waitForSelector('#offMain:not([hidden])');
  assert.match(await none.page.locator('#offTitle').innerText(), /沒有權限/);
  assert.match(await none.page.locator('#offDesc').innerText(), /影片發布/);
  assert.equal(await none.page.isVisible('#app'), false);
  assert.deepEqual(none.errors, []);
  await none.page.close();
  const view = await newPage('admin', { width: 1280, height: 900 }, { me: { admin: false, perms: ['vview'], name: '甲', group: '檢視' } });
  await view.page.waitForSelector('#app:not([hidden])');
  await view.page.waitForFunction(() => !document.getElementById('whoAmI').hidden);
  assert.equal(await view.page.isHidden('#sendBtn'), true, '沒有 vpost 隱藏送出鈕');
  await view.page.close();
  const post = await newPage('admin', { width: 1280, height: 900 }, { me: { admin: false, perms: ['vview', 'vpost'], name: '乙', group: '發文' } });
  await post.page.waitForSelector('#app:not([hidden])');
  await post.page.waitForFunction(() => !document.getElementById('whoAmI').hidden);
  assert.equal(await post.page.isVisible('#sendBtn'), true);
  await post.page.close();
});

test('放待排 2359：只有直式能選；排到今天 23:59；RD 用送出當下時間、slot q2359、Shorts_ 寫 Shorts/；23:49 之後停用', async () => {
  const { page, errors, api } = await newPage('admin', { width: 1280, height: 900 });
  await page.waitForSelector('#app:not([hidden])');
  const t0 = new Date(); t0.setHours(10, 5, 0, 0);
  await page.clock.setFixedTime(t0);
  await page.locator('.rd-switch .track').click();
  // 橫式：沒有這個選項
  await page.setInputFiles('#fileIn', [file('橫式.mp4', 'wide')]);
  await page.click(ED + ' .pg-dd summary');
  await page.check(ED + ' .pg-list input[data-page="111"]');
  const opt = ED + ' .pg-list li:has(input[data-page="111"]) .pg-mode option[value="q2359"]';
  assert.deepEqual(await page.$eval(opt, (o) => [o.hidden, o.disabled]), [true, true]);
  // 直式（Shorts_）
  await page.setInputFiles('#fileIn', [file('Shorts_短.mp4', 'tall')]);
  await page.click(ED + ' .pg-dd summary');
  await page.check(ED + ' .pg-list input[data-page="111"]');
  assert.deepEqual(await page.$eval(opt, (o) => [o.hidden, o.disabled, o.textContent]), [false, false, '放待排 2359']);
  await page.selectOption(ED + ' .pg-list li:has(input[data-page="111"]) .pg-mode', 'q2359');
  assert.match(await page.textContent(ED + ' .pg-sum'), /新聞（放待排 2359（今天 23:59））/);
  assert.equal(await page.isVisible(ED + ' .pg-list li:has(input[data-page="111"]) .pg-dt'), false, '不用選時間');
  if (SHOT) await page.locator(ED).screenshot({ path: path.join(SHOT, 'fbvideo-q2359.png') });
  // 兩支一起送（橫式＝立即、直式＝放待排 2359）
  await until(async () => page.$$eval('.vq-meta', (l) => l.length === 2 && l.every((x) => /已上傳/.test(x.textContent))), 10000);
  const at = Math.floor(new Date(t0).setHours(23, 59, 0, 0) / 1000);
  await page.click('#sendBtn');
  await until(() => api.publish.length >= 2, 10000);
  const pub = api.publish.find((b) => b.pages.some((x) => x.q2359));
  assert.ok(pub, JSON.stringify(api.publish.map((b) => b.pages)));
  assert.deepEqual(pub.pages, [{ page: '111', at, q2359: true }]);
  await until(() => api.rundown.some((r) => r.entries.some((e) => e.slot === 'q2359')), 10000);
  const e = api.rundown.flatMap((r) => r.entries).find((x) => x.slot === 'q2359');
  assert.deepEqual([e.page, e.text, e.kind, e.time, e.style], ['news', 'Shorts/短', 'reel', '10:05', 'video']);
  // 23:50：停用並標示
  const t1 = new Date(t0); t1.setHours(23, 50, 0, 0);
  await page.clock.setFixedTime(t1);
  await page.setInputFiles('#fileIn', [file('Reels_晚.mp4', 'tall')]);
  await page.click(ED + ' .pg-dd summary');
  await page.check(ED + ' .pg-list input[data-page="111"]');
  await page.focus(ED + ' .pg-list li:has(input[data-page="111"]) .pg-mode');
  assert.deepEqual(await page.$eval(opt, (o) => [o.disabled, o.textContent]), [true, '放待排 2359（已過 23:49）']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('上傳：單段失敗一次自動重試成功；按送出有「送出中」與結果提示；底部只有一行總進度', async () => {
  const { page, errors, api, failChunk } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  failChunk(1);
  await page.setInputFiles('#fileIn', file('橫式.mp4'));
  await pickPage(page, '111');
  await page.waitForSelector('#stText:has-text("上傳完成 1／1 支")', { timeout: 20000 });
  assert.equal(await page.isVisible(ED + ' .up-restart'), false, '重試成功，沒有失敗');
  assert.match(await page.textContent(ED + ' .up-list'), /新聞：/);
  await page.click('#sendBtn');
  await page.waitForSelector('#toast:has-text("已送出 1 支")');
  assert.equal(api.publish.length, 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('超過 90 秒的直式影片：不擋送出，自動改走一般影片上傳；90 秒內直式走 Reels', async () => {
  const { page, errors, api } = await newPage();
  await page.waitForSelector('#app:not([hidden])');
  await page.setInputFiles('#fileIn', file('Reels_長.mp4', 'tall-long'));
  await pickPage(page, '111');
  await until(() => api.start.length >= 1, 10000);
  assert.equal(api.start[0].kind, 'video', '95 秒走一般影片');
  assert.match(await page.textContent(ED + ' .kind-warn'), /上傳方式：一般影片（超過 90 秒/);
  await page.waitForSelector('#stText:has-text("上傳完成")', { timeout: 20000 });
  await page.click('#sendBtn');
  await until(() => api.publish.length === 1);
  await page.setInputFiles('#fileIn', file('Reels_短.mp4', 'tall'));
  await pickPage(page, '111');
  await until(() => api.start.length >= 2, 10000);
  assert.equal(api.start.at(-1).kind, 'reel');
  assert.match(await page.textContent(ED + ' .kind-warn'), /上傳方式：Reels$/);
  if (SHOT) { await page.waitForSelector('#stText:has-text("已上傳"), #stText:has-text("上傳完成")'); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOT, 'fbvideo-upload-a.png') }); }
  assert.deepEqual(errors, []);
  await page.close();
});
