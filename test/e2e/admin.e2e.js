// 管理後台（admin/index.html）：登入、分類切換（隱藏切換、內容保留）、各按鈕打到正確的後端 API。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('../helpers/serve.js');
const { launch } = require('../helpers/browser.js');

const ROOT = path.join(__dirname, '..', '..');
const API = 'https://toolbox-api.19jpz-3.workers.dev';
const SHOT = process.env.SHOT_DIR;
let srv, browser;
test.before(async () => { srv = await serve(ROOT); browser = await launch(); });
test.after(async () => { await browser.close(); await srv.close(); });

let PG_SAVED = null;
let PS_SAVED = null;
let TOK_SAVED = null;
let AC = { mode: 'admin', reason: '' };
const PAGES = [
  { id: '1', name: 'TVBS 新聞', short: '新聞', utm: '', rd: 'news', order: 0, show: 1 },
  { id: '2', name: 'TVBS 娛樂', short: '娛樂', utm: '?&utm_source=facebook', utmText: '?&utm_medium=text', rd: 'ent', order: 1, show: 1 },
  { id: '3', name: 'TVBS 少康戰情室', short: '少康', utm: '', rd: '', order: 2, show: 0 }];
const DATA = {
  'GET /admin/assets': [{ key: 'logo.png', tier: 'company', size: 2048, updated: Date.UTC(2026, 10, 1) }],
  'GET /admin/logs': [{ at: Date.UTC(2026, 10, 2), tool: 'fb', code: 'ok', ver: '1' }],
  'GET /admin/fb/status': { configured: true, valid: true, expires: Math.floor(Date.UTC(2027, 0, 5, 4, 0) / 1000), missing: ['pages_manage_posts'], pages: 3 },
  'GET /admin/fb/pages': PAGES,
  'POST /admin/fb/pages': (b) => { PG_SAVED = b; return b.pages.map((p) => ({ ...PAGES.find((x) => x.id === p.id), ...p })); },
  'GET /admin/fb/presets': [{ name: '雙11抽獎', body: '雙11活動連結 https://example.com/a' }, { name: '訂閱', body: '歡迎訂閱' }],
  'POST /admin/fb/presets': (b) => { PS_SAVED = b; return b.presets; },
  'POST /admin/fb/refresh': {},
  'GET /admin/fb/access': () => AC,
  'POST /admin/fb/access': (b) => { AC = { mode: b.mode, reason: b.reason.trim() }; return AC; },
  'POST /admin/fb/token': (b) => { TOK_SAVED = b; return { configured: true, valid: true, expires: 0, missing: [], pages: 6, source: 'admin', app: 'NEW-APP' }; },
  'DELETE /admin/fb/token': { configured: true, valid: true, expires: 0, missing: [], pages: 6, source: 'secret', app: 'DEV-TOOL' },
  'GET /admin/rundown': { configured: true },
  'POST /admin/rundown/ping': { title: 'FB RUNDOWN(2026)', sheets: ['2026/11'] },
};

// 授權名單的假後端：記錄收到的 body／query，回整份最新狀態
const SF = { bodies: [], audit: [] };
const PERMS = [{ key: 'view', label: '檢視已排程／已發佈' }, { key: 'post', label: '新增發文（含排入 Rundown）' }, { key: 'edit', label: '改排程時間' }, { key: 'delete', label: '刪除貼文' }];
let STAFF = [];
const GROUPS = [
  { id: 'viewer', name: '唯讀', perms: ['view'] },
  { id: 'editor', name: '小編', perms: ['view', 'post', 'edit'] },
  { id: 'lead', name: '主管', perms: ['view', 'post', 'edit', 'delete'] }];
function sfState() { return { staff: STAFF, groups: GROUPS.map((g) => ({ ...g, used: STAFF.filter((s) => s.group === g.id).length })), perms: PERMS }; }
function staffRoute(req, u, key) {
  const p = u.pathname;
  if (!(p.startsWith('/admin/staff') || p === '/admin/audit')) return null;
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (req.method() !== 'GET') SF.bodies.push({ key, body });
  if (key === 'GET /admin/audit') { SF.audit.push(u.search); return { ok: true, data: [
    { id: 2, at: Date.UTC(2026, 10, 17, 2, 5), uid: 'A001', name: '王小明', action: 'schedule', page: '111', post: '111_222', detail: '' },
    { id: 1, at: Date.UTC(2026, 10, 16, 2, 5), uid: 'ADMIN', name: '', action: 'delete', page: '111', post: '111_333', detail: '' }] }; }
  if (key === 'GET /admin/staff') return { ok: true, data: sfState() };
  if (key === 'POST /admin/staff') { STAFF.push({ ...body, enabled: true, created: 1, lastLogin: null }); return { ok: true, data: sfState() }; }
  if (key === 'POST /admin/staff-groups') {
    const g = GROUPS.find((x) => x.id === body.id);
    if (g) Object.assign(g, { name: body.name, perms: body.perms }); else GROUPS.push({ id: 'g' + GROUPS.length, name: body.name, perms: body.perms });
    return { ok: true, data: sfState() };
  }
  const m = p.match(/^\/admin\/staff\/(.+)$/);
  if (m && req.method() === 'POST') { Object.assign(STAFF.find((s) => s.id === m[1]), body); return { ok: true, data: sfState() }; }
  if (m && req.method() === 'DELETE') { STAFF = STAFF.filter((s) => s.id !== m[1]); return { ok: true, data: sfState() }; }
  return { ok: false, error: '不明的請求' };
}
function resetStaff() {
  SF.bodies = []; SF.audit = [];
  STAFF = [
    { id: 'A001', name: '王小明', group: 'editor', enabled: true, created: 1, lastLogin: Date.UTC(2026, 10, 17, 2, 5) },
    { id: 'A002', name: '陳大華', group: 'viewer', enabled: true, created: 1, lastLogin: null },
    { id: 'A003', name: '林主管', group: 'lead', enabled: false, created: 1, lastLogin: null }];
}

async function open(viewport, hash = '') {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const calls = [];
  page.on('pageerror', (e) => calls.push('ERR ' + e.message));
  await page.route(API + '/**', async (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const key = req.method() + ' ' + u.pathname;
    calls.push({ key, auth: req.headers().authorization || '' });
    if (key === 'POST /admin/login') {
      const ok = JSON.parse(req.postData()).password === 'pw-123';
      return r.fulfill({ json: ok ? { ok: true, data: { token: 'T' } } : { ok: false, code: 'bad_password' } });
    }
    const sf = staffRoute(req, u, key);
    if (sf) return r.fulfill({ json: sf });
    if (typeof DATA[key] === 'function') return r.fulfill({ json: { ok: true, data: DATA[key](req.postData() ? JSON.parse(req.postData()) : null) } });
    if (key in DATA) return r.fulfill({ json: { ok: true, data: DATA[key] } });
    return r.fulfill({ json: { ok: false, code: 'not_found', error: '找不到' } });
  });
  await page.goto(srv.url + 'admin/' + hash);
  return { page, calls };
}

async function login(page) {
  await page.fill('#pw', 'pw-123');
  await page.click('#loginBtn');
  await page.waitForSelector('#app:not([hidden])');
}

test('登入後依分類切換，按鈕打到後端 API 並帶 token', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 });
  assert.equal(await page.isVisible('#app'), false);
  assert.equal(await page.isVisible('#logout'), false);
  await page.fill('#pw', 'nope');
  await page.click('#loginBtn');
  await page.waitForFunction(() => document.getElementById('loginMsg').textContent === '密碼不正確。');
  await login(page);

  // 預設在臉書發文
  assert.equal(await page.getAttribute('#tab-fb', 'aria-selected'), 'true');
  assert.ok(page.url().endsWith('#fb'));
  assert.equal(await page.isVisible('#logout'), true);
  assert.ok(!calls.some((c) => c.key === 'GET /admin/assets'), '沒進素材分類前不讀素材');
  // 5 個分類；沒有後端 API 的卡片（預設文字、嘗試次數）不出現
  assert.deepEqual(await page.$$eval('nav.side [role=tab]', (els) => els.map((e) => e.textContent)), ['臉書發文', '授權名單', 'Rundown', '素材', '錯誤日誌']);
  await page.waitForSelector('#pgWrap:not([hidden])');
  await page.fill('.pg-short >> nth=0', '填到一半');

  // 切到素材再切回來，填到一半的內容還在
  await page.click('#tab-assets');
  assert.equal(await page.isVisible('#panel-fb'), false);
  await page.click('#tab-fb');
  assert.equal(await page.inputValue('.pg-short >> nth=0'), '填到一半');

  // 素材：第一次進來才讀
  await page.click('#tab-assets');
  await page.waitForSelector('#tableWrap:not([hidden])');
  assert.match(await page.textContent('#rows'), /logo\.png/);

  // 方向鍵切換分類（Rundown → 素材 → 錯誤日誌）
  await page.focus('#tab-assets');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#tab-logs', 'aria-selected'), 'true');
  await page.click('#logBtn');
  await page.waitForFunction(() => /共 1 筆/.test(document.getElementById('logMsg').textContent));

  const api = calls.filter((c) => typeof c === 'object' && c.key !== 'POST /admin/login');
  assert.ok(api.length >= 3);
  for (const c of api) assert.equal(c.auth, 'Bearer T', c.key);
  for (const k of ['GET /admin/fb/status', 'GET /admin/fb/pages', 'GET /admin/assets', 'GET /admin/logs']) {
    assert.ok(api.some((c) => c.key === k), k);
  }
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤：' + calls.filter((c) => typeof c === 'string'));

  // 登出回登入畫面
  await page.click('#logout');
  assert.equal(await page.isVisible('#login'), true);
  assert.equal(await page.isVisible('#app'), false);
});

test('網址帶分類時登入後直接打開；手機版分類不超出畫面', async () => {
  const { page } = await open({ width: 390, height: 800 }, '#logs');
  await login(page);
  assert.equal(await page.getAttribute('#tab-logs', 'aria-selected'), 'true');
  assert.equal(await page.isVisible('#panel-logs'), true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, '頁面不能橫向捲動：' + overflow);
});

test('頁面不用 emoji 或箭頭', async () => {
  const { page } = await open({ width: 1280, height: 800 });
  const html = await page.content();
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}]/u);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('臉書發文：狀態、到期日與缺少權限；粉專表依順序顯示', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  const st = await page.textContent('#fbState');
  assert.match(st, /連線正常/);
  assert.match(st, /到期日 2027-01-05/);
  assert.match(st, /粉專 3 個/);
  assert.match(await page.textContent('#fbMissing'), /缺少權限：pages_manage_posts/);
  assert.equal(await page.locator('#pgRows .pg-card').count(), 3);
  assert.deepEqual(await page.$$eval('#pgRows .pg-card', (rs) => rs.map((r) => r.querySelector('.pg-no').textContent + r.querySelector('.pg-name').textContent)), ['1TVBS 新聞', '2TVBS 娛樂', '3TVBS 少康戰情室']);
  assert.equal(await page.inputValue('#pgRows .pg-card:nth-child(2) .pg-utm'), '?&utm_source=facebook');
  assert.equal(await page.inputValue('#pgRows .pg-card:nth-child(2) .pg-utmtext'), '?&utm_medium=text');
  assert.equal(await page.inputValue('#pgRows .pg-card:nth-child(1) .pg-utmtext'), '');
  assert.equal(await page.isChecked('#pgRows .pg-card:nth-child(3) .pg-show'), false);
  // 內容完整：名稱不折成直排、UTM 欄位夠寬、上下移按鈕在卡片內
  const fit = await page.$$eval('#pgRows .pg-card', (cs) => cs.map((c) => {
    const r = c.getBoundingClientRect(), dn = c.querySelector('.pg-down').getBoundingClientRect(), u = c.querySelector('.pg-utm').getBoundingClientRect();
    return dn.right <= r.right + 0.5 && u.width >= 400 && c.querySelector('.pg-name').getBoundingClientRect().height < 40;
  }));
  assert.deepEqual(fit, [true, true, true]);
  assert.ok(calls.filter((c) => c.key === 'GET /admin/fb/status' || c.key === 'GET /admin/fb/pages').every((c) => c.auth === 'Bearer T'));
  // 重新讀取粉專：先清快取再重讀
  await page.click('#fbRefresh');
  await page.waitForFunction(() => document.getElementById('fbMsg').textContent === '已重新讀取。');
  assert.ok(calls.some((c) => c.key === 'POST /admin/fb/refresh'));
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('粉專設定：改簡稱、RD、上移後儲存，body 含新值與正確 order', async () => {
  PG_SAVED = null;
  const { page } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  await page.fill('#pgRows .pg-card:nth-child(1) .pg-short', '主粉');
  await page.selectOption('#pgRows .pg-card:nth-child(3) .pg-rd', 'shaokang');
  await page.check('#pgRows .pg-card:nth-child(3) .pg-show');
  await page.click('#pgRows .pg-card:nth-child(3) .pg-up');   // 少康移到第 2 列
  assert.equal(await page.inputValue('#pgRows .pg-card:nth-child(2) .pg-short'), '少康');
  assert.equal(await page.inputValue('#pgRows .pg-card:nth-child(2) .pg-rd'), 'shaokang', '換順序後輸入值保留');
  assert.equal(await page.inputValue('#pgRows .pg-card:nth-child(1) .pg-short'), '主粉');
  await page.click('#pgSave');
  await page.waitForFunction(() => document.getElementById('pgMsg').textContent === '已儲存');
  assert.deepEqual(PG_SAVED.pages.map((p) => [p.id, p.short, p.rd, p.order, p.show]),
    [['1', '主粉', 'news', 0, 1], ['3', '少康', 'shaokang', 1, 1], ['2', '娛樂', 'ent', 2, 1]]);
  assert.equal(PG_SAVED.pages[2].utm, '?&utm_source=facebook');
  assert.equal(PG_SAVED.pages[2].utmText, '?&utm_medium=text', 'UTM 文字一起送');
  assert.equal(PG_SAVED.pages[0].utmText, '');
});

test('粉專設定：簡稱空白不送出', async () => {
  PG_SAVED = null;
  const { page } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  await page.fill('#pgRows .pg-card:nth-child(1) .pg-short', '');
  await page.click('#pgSave');
  assert.match(await page.textContent('#pgMsg'), /簡稱要 1～20 字/);
  assert.equal(PG_SAVED, null);
});

test('臉書發文與 Rundown：手機 390px 頁面不橫向捲動', async () => {
  const { page } = await open({ width: 390, height: 800 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok((await over()) <= 0, '臉書發文橫向捲動');
  await page.click('#tab-rd');
  assert.ok((await over()) <= 0, 'Rundown 橫向捲動');
});

test('Rundown 分類：測試連線打 /admin/rundown/ping 並顯示試算表名稱', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#rd');
  await login(page);
  assert.equal(await page.isVisible('#panel-rd'), true);
  await page.waitForFunction(() => document.getElementById('rdState').textContent === '狀態：已設定');
  await page.click('#rdPing');
  await page.waitForFunction(() => /連線正常：FB RUNDOWN\(2026\)/.test(document.getElementById('rdMsg').textContent));
  assert.ok(calls.some((c) => c.key === 'POST /admin/rundown/ping' && c.auth === 'Bearer T'));
});

test('活動留言：顯示既有兩則；新增、刪除後儲存，body 依順序', async () => {
  PS_SAVED = null;
  const { page, calls } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#psRows .ps-row');
  assert.match(await page.textContent('#psCard'), /第 2、3 則留言可以選這裡的內容帶入/);
  assert.ok(calls.some((c) => c.key === 'GET /admin/fb/presets' && c.auth === 'Bearer T'));
  assert.deepEqual(await page.$$eval('#psRows .ps-name', (els) => els.map((e) => e.value)), ['雙11抽獎', '訂閱']);
  await page.click('#psRows .ps-row:nth-child(1) .ps-del');   // 刪掉第一則
  await page.click('#psAdd');
  await page.fill('#psRows .ps-row:nth-child(2) .ps-name', '新活動');
  await page.fill('#psRows .ps-row:nth-child(2) .ps-body', '新活動內容');
  await page.click('#psSave');
  await page.waitForFunction(() => document.getElementById('psMsg').textContent === '已儲存');
  assert.deepEqual(PS_SAVED, { presets: [{ name: '訂閱', body: '歡迎訂閱' }, { name: '新活動', body: '新活動內容' }] });
});

test('活動留言：名稱空白不送出並標出哪一則；滿 20 則停用新增', async () => {
  PS_SAVED = null;
  const { page } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#psRows .ps-row');
  await page.fill('#psRows .ps-row:nth-child(2) .ps-name', '  ');
  await page.click('#psSave');
  assert.match(await page.textContent('#psMsg'), /第 2 則的名稱要 1～20 字/);
  assert.equal(PS_SAVED, null);
  await page.fill('#psRows .ps-row:nth-child(2) .ps-name', '訂閱');
  await page.fill('#psRows .ps-row:nth-child(2) .ps-body', '');
  await page.click('#psSave');
  assert.match(await page.textContent('#psMsg'), /第 2 則的內容要 1～8000 字/);
  assert.equal(PS_SAVED, null);
  for (let i = 0; i < 18; i++) await page.click('#psAdd');
  assert.equal(await page.locator('#psRows .ps-row').count(), 20);
  assert.equal(await page.isDisabled('#psAdd'), true);
});

test('活動留言：手機 390px 不橫向捲動', async () => {
  const { page } = await open({ width: 390, height: 800 }, '#fb');
  await login(page);
  await page.waitForSelector('#psRows .ps-row');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, '橫向捲動 ' + over);
});

test('臉書連線：貼上權杖→驗證並儲存（body 帶權杖、成功後清空輸入框）；改回 Secret 打 DELETE', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForSelector('#pgWrap:not([hidden])');
  assert.equal(await page.isVisible('#fbTokClear'), false, '來源不是管理頁時不顯示「改回 Secret」');
  await page.click('#fbTokSave');
  assert.match(await page.textContent('#fbTokMsg'), /請先貼上權杖/);
  await page.fill('#fbTok', '  EAAnew123  ');
  await page.click('#fbTokSave');
  await page.waitForFunction(() => /已換成新權杖/.test(document.getElementById('fbTokMsg').textContent));
  assert.deepEqual(TOK_SAVED, { token: 'EAAnew123' });
  assert.match(await page.textContent('#fbTokMsg'), /（App：NEW-APP），粉專 6 個/);
  assert.equal(await page.inputValue('#fbTok'), '', '成功後清空');
  assert.equal(await page.getAttribute('#fbTok', 'type'), 'password');
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => { document.getElementById('fbTokClear').hidden = false; });
  await page.click('#fbTokClear');
  await page.waitForFunction(() => /已改回 Secret/.test(document.getElementById('fbTokMsg').textContent));
  assert.ok(calls.some((c) => c.key === 'DELETE /admin/fb/token' && c.auth === 'Bearer T'));
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('排程發布開放／關閉：讀取狀態與原因、關閉帶原因、開放保留原因、只改原因', async () => {
  AC = { mode: 'admin', reason: '' };
  const { page, calls } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await page.waitForFunction(() => document.getElementById('acState').textContent === '狀態：關閉');
  assert.deepEqual(await page.$$eval('#acCard .ac-row button', (bs) => bs.map((b) => b.textContent)), ['開放', '關閉']);
  assert.equal(await page.getAttribute('#acClose', 'aria-pressed'), 'true');
  assert.equal(await page.isVisible('#acReasonSave'), true, '關閉中可以只存原因');
  const cards = await page.$$eval('#panel-fb section.card', (els) => els.map((e) => e.id));
  assert.equal(cards[0], 'acCard', '放在臉書發文最上面');
  await page.fill('#acReason', '臉書權杖更換中');
  await page.click('#acReasonSave');
  await page.waitForFunction(() => document.getElementById('acMsg').textContent === '已儲存原因');
  assert.deepEqual(AC, { mode: 'admin', reason: '臉書權杖更換中' });
  assert.equal(await page.textContent('#acState'), '狀態：關閉（原因：臉書權杖更換中）');
  if (SHOT) await page.locator('#acCard').screenshot({ path: path.join(SHOT, 'admin-access.png') });
  await page.click('#acOpen');
  await page.waitForFunction(() => document.getElementById('acMsg').textContent === '已開放');
  assert.deepEqual(AC, { mode: 'company', reason: '臉書權杖更換中' });
  assert.equal(await page.textContent('#acState'), '狀態：開放');
  assert.equal(await page.isHidden('#acReasonSave'), true);
  assert.equal(await page.inputValue('#acReason'), '臉書權杖更換中', '開放後原因保留');
  await page.fill('#acReason', '');
  await page.click('#acClose');
  await page.waitForFunction(() => document.getElementById('acMsg').textContent === '已關閉');
  assert.deepEqual(AC, { mode: 'admin', reason: '' });
  assert.ok(calls.some((c) => c.key === 'POST /admin/fb/access' && c.auth === 'Bearer T'));
});

test('素材上傳：順序是等級、素材名稱、檔案、上傳；選檔自動帶名稱，替換帶入的名稱不被覆蓋', async () => {
  const { page } = await open({ width: 1280, height: 860 }, '#assets');
  await login(page);
  const order = await page.$$eval('#upForm label, #upForm button', (els) => els.map((e) => e.getAttribute('for') || e.id));
  assert.deepEqual(order, ['tier', 'key', 'file', 'upBtn']);
  const pick = (name) => page.setInputFiles('#file', { name, mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) });
  await pick('Font Taipei Sans.Bold.woff2');
  assert.equal(await page.inputValue('#key'), 'font-taipei-sans.bold');
  await pick('logo_white.png');
  assert.equal(await page.inputValue('#key'), 'logo_white', '上次自動帶的可以再換');
  await page.fill('#key', 'my-name');
  await pick('other.png');
  assert.equal(await page.inputValue('#key'), 'my-name', '手打的不覆蓋');
  await page.waitForSelector('#rows tr');
  await page.click('#rows tr >> text=替換');
  assert.equal(await page.inputValue('#key'), 'logo.png');
  await pick('new-logo.png');
  assert.equal(await page.inputValue('#key'), 'logo.png', '替換帶入的不覆蓋');
});

test('授權名單：切進分類才讀、顯示預設 3 組；新增、改權限組、停用、移除（需確認）', async () => {
  resetStaff();
  const { page, calls } = await open({ width: 1280, height: 860 });
  await login(page);
  assert.ok(!calls.some((c) => c.key === 'GET /admin/staff'), '沒進分類前不讀名單');
  await page.click('#tab-staff');
  await page.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await page.$$eval('#sfRows tr', (r) => r.length), 3);
  assert.deepEqual(await page.$$eval('#sgRows .sg-row > input', (e) => e.map((i) => i.value)), ['唯讀', '小編', '主管']);
  assert.deepEqual(await page.$$eval('#sfGroup option', (e) => e.map((o) => o.textContent)), ['唯讀', '小編', '主管']);
  assert.match(await page.textContent('#sfRows tr:nth-child(2)'), /從未/);
  assert.match(await page.textContent('#sfRows tr:nth-child(1)'), /\d{4}-\d\d-\d\d \d\d:\d\d/);

  // 新增
  await page.fill('#sfId', 'B009'); await page.fill('#sfName', '新同仁'); await page.selectOption('#sfGroup', 'editor');
  await page.click('#sfAdd');
  await page.waitForFunction(() => document.querySelectorAll('#sfRows tr').length === 4);
  assert.deepEqual(SF.bodies.pop(), { key: 'POST /admin/staff', body: { id: 'B009', name: '新同仁', group: 'editor' } });
  assert.equal(await page.inputValue('#sfId'), '');

  // 改權限組
  await page.selectOption('#sfRows tr:nth-child(2) select', 'lead');
  await page.waitForFunction(() => /已更新/.test(document.getElementById('sfMsg').textContent));
  assert.deepEqual(SF.bodies.pop(), { key: 'POST /admin/staff/A002', body: { group: 'lead' } });

  // 停用
  await page.click('#sfRows tr:nth-child(1) button:text("停用")');
  await page.waitForFunction(() => /已停用/.test(document.getElementById('sfMsg').textContent));
  assert.deepEqual(SF.bodies.pop(), { key: 'POST /admin/staff/A001', body: { enabled: false } });

  // 移除：先確認
  await page.click('#sfRows tr:nth-child(1) button:text("移除")');
  assert.equal(await page.isVisible('#sfConfirm'), true);
  assert.equal(await page.textContent('#sfCfText'), '王小明（A001）會從名單移除，對方下一次操作就會被擋。');
  await page.click('#sfCfNo');
  assert.equal(SF.bodies.length, 0);
  await page.click('#sfRows tr:nth-child(1) button:text("移除")');
  await page.click('#sfCfYes');
  await page.waitForFunction(() => document.querySelectorAll('#sfRows tr').length === 3);
  assert.deepEqual(SF.bodies.pop(), { key: 'DELETE /admin/staff/A001', body: null });
  assert.equal(await page.isVisible('#sfConfirm'), false);
});

test('權限組：儲存帶 id／名稱／權限、使用中不能刪、新增一組', async () => {
  resetStaff();
  const { page } = await open({ width: 1280, height: 860 }, '#staff');
  await login(page);
  await page.waitForSelector('#sgRows .sg-row');
  const del = await page.$$eval('#sgRows .sg-row', (rs) => rs.map((r) => [r.querySelector('.danger').disabled, r.querySelector('.danger').title]));
  assert.deepEqual(del, [[true, '還有 1 人使用'], [true, '還有 1 人使用'], [true, '還有 1 人使用']]);
  assert.equal(await page.$$eval('#sgRows .sg-row:nth-child(1) input[type=checkbox]', (c) => c.length), 4);
  await page.check('#sgRows .sg-row:nth-child(1) input[value=post]');
  await page.click('#sgRows .sg-row:nth-child(1) button.primary');
  await page.waitForFunction(() => /已儲存/.test(document.getElementById('sgMsg').textContent));
  assert.deepEqual(SF.bodies.pop().body, { id: 'viewer', name: '唯讀', perms: ['view', 'post'] });
  await page.click('#sgNew');
  assert.equal(await page.$$eval('#sgRows .sg-row', (r) => r.length), 4);
});

test('操作紀錄：查詢帶期間與員工編號，顯示中文動作；沒資料顯示說明', async () => {
  resetStaff();
  const { page } = await open({ width: 1280, height: 860 }, '#staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  await page.selectOption('#auDays', '30'); await page.fill('#auUid', 'a001');
  await page.click('#auBtn');
  await page.waitForSelector('#auWrap:not([hidden])');
  assert.equal(SF.audit.pop(), '?days=30&uid=a001');
  const txt = await page.textContent('#auRows');
  assert.match(txt, /排程/); assert.match(txt, /刪除/); assert.match(txt, /ADMIN/); assert.match(txt, /王小明/);
});

test('授權名單：320px 頁面不橫向捲動（表格自己橫捲）', async () => {
  resetStaff();
  const { page } = await open({ width: 320, height: 800 }, '#staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  await page.click('#auBtn'); await page.waitForSelector('#auWrap:not([hidden])');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.evaluate(() => document.getElementById('sfWrap').scrollWidth > document.getElementById('sfWrap').clientWidth), true);
});

test('後端內嵌管理頁：登入後讀到授權名單並可新增', async () => {
  resetStaff();
  const { ADMIN_HTML } = await import('../../server/core/admin-page.js');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.pathname === '/admin' && req.method() === 'GET') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: ADMIN_HTML });
    if (u.pathname === '/admin/login') return r.fulfill({ json: { ok: true, data: { token: 'T' } } });
    const sf = staffRoute(req, u, req.method() + ' ' + u.pathname);
    if (sf) return r.fulfill({ json: sf });
    return r.fulfill({ json: { ok: true, data: [] } });
  });
  await page.goto('https://embedded.test/admin');
  await page.fill('#pw', 'x'); await page.click('#loginBtn');
  await page.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await page.$$eval('#sfRows tr', (r) => r.length), 3);
  await page.fill('#sfId', 'C1'); await page.fill('#sfName', '內嵌'); await page.click('#sfAdd');
  await page.waitForFunction(() => document.querySelectorAll('#sfRows tr').length === 4);
  assert.deepEqual(errs, []);
  await ctx.close();
});
