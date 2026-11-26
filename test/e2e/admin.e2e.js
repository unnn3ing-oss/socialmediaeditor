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
let GD_SAVED = null;
const GD_CHECKS = [];
let PS_SAVED = null;
// 文字背景替身
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const BG = { list: [], posts: [], fetches: [] };
function bgReset() {
  BG.posts = []; BG.fetches = [];
  BG.list = [
    { id: '106018623298955', name: '純紫', type: 'solid', bg: '#C600FF', text: '#FFFFFF', grad: null, dir: null, img: false, hasUrl: false, err: '', show: true, rnd: true },
    { id: '249307305544279', name: '紅→藍漸層', type: 'gradient', bg: '#FF0047', text: '#FFFFFF', grad: '#2C34C7', dir: 'BL_TR', img: false, hasUrl: false, err: '', show: true, rnd: true },
    { id: '303063890126415', name: '黃橘粉圖樣', type: 'image', bg: '#DC7A5A', text: '#FFFFFF', grad: null, dir: null, img: true, hasUrl: true, err: '', show: true, rnd: false },
    { id: '303063890126416', name: '過期圖樣', type: 'image', bg: '#33234B', text: '#FFFFFF', grad: null, dir: null, img: false, hasUrl: true, err: '', show: true, rnd: false }];
}
bgReset();
let VS_SAVED = null;
let TOK_SAVED = null;
let AC = { mode: 'admin', reason: '' };
const PAGES = [
  { id: '1', name: 'TVBS 新聞', short: '新聞', utm: '', rd: 'news', order: 0, show: 1 },
  { id: '2', name: 'TVBS 娛樂', short: '娛樂', utm: '?&utm_source=facebook', utmText: '?&utm_medium=text', rd: 'ent', order: 1, show: 1 },
  { id: '3', name: 'TVBS 少康戰情室', short: '少康', utm: '', rd: '', order: 2, show: 0 }];
let APP = { configured: false, appId: '', source: null, savedAt: null }, APP_SAVED = null;
const TP0 = () => ({ active: 'p1', max: 5, list: [
  { id: 'p1', name: '主管權杖', created: 0, active: true, hasToken: true, source: 'admin', pages: ['新聞', '少康'], dataExpires: Math.floor(Date.UTC(2027, 1, 10) / 1000), appName: 'DEV-TOOL', appId: '999', broken: false },
  { id: 'pabcdef12', name: '鈞評測試', created: 1, active: false, hasToken: true, source: 'admin', pages: ['評 Photography'], dataExpires: null, appName: 'socialmediaeditor', appId: '888', broken: false },
  { id: 'p0000beef', name: '空的', created: 2, active: false, hasToken: false, source: null, pages: [], dataExpires: null, appName: '', appId: '', broken: false }] });
let TP = TP0();
const NOWMS = Date.now();
const USAGE = { app: { callCount: 12, totalTime: 4, totalCputime: 2, at: NOWMS - 3 * 60000 },
  pages: [{ id: '111', name: 'TVBS 新聞', type: 'pages', callCount: 78, totalCputime: 10, totalTime: 92, regainMin: 0, at: NOWMS - 60000 },
    { id: '222', name: '', type: 'pages', callCount: 100, totalCputime: 30, totalTime: 40, regainMin: 25, at: NOWMS - 120000 }],
  throttle: { code: 80001, message: 'too many', at: Date.UTC(2026, 10, 20, 3, 0) } };
function usageNow() {
  const n = Date.now();
  return { ...USAGE, app: { ...USAGE.app, at: n - 3 * 60000 }, pages: USAGE.pages.map((p, i) => ({ ...p, at: n - (i + 1) * 60000 })) };
}
// 首頁儀表板替身
const DASH = { fresh: [], cfgSaved: null };
const DASH_ITEMS = [
  { key: 'access', name: '排程發布', level: 'info', text: '關閉中（只有管理員可用）', tab: 'adv' },
  { key: 'fbtoken', name: '臉書權杖', level: 'warn', text: '9 天後到期', tab: 'adv' },
  { key: 'logs', name: '未處理錯誤', level: 'bad', text: '2 則未處理', tab: 'rec' },
  { key: 'rundown', name: 'Rundown 連線', level: 'ok', text: '已設定', tab: 'conn' },
  { key: 'online', name: '目前在線', level: 'info', text: '3 人', tab: 'people' }];
const CO = { edit: false, who: 'all', staff: [], people: [{ id: 'A001', name: '王小明', enabled: true }, { id: 'A002', name: '李小華', enabled: false }], posts: [] };
const VO = { stream: false, who: 'all', staff: [], posts: [] };
const HO = { on: false, who: 'all', staff: [], method: 'a', posts: [] };
const TV = { on: false, hide: ['fbpost', 'fbvideo', 'fbreports'], posts: [] };
const SR = { on: true, tools: ['pattern', 'linepush', 'watermark', 'design'], posts: [] };
const SR_OPTIONS = [{ id: 'pattern', name: '圖片套版' }, { id: 'linepush', name: 'LINE 推播' }, { id: 'watermark', name: '浮水印' }, { id: 'design', name: '設計' }];
const DATA = {
  'GET /admin/dash': (b, u) => { DASH.fresh.push(u.searchParams.get('fresh')); return { at: Date.UTC(2026, 10, 23, 6, 32), items: DASH_ITEMS }; },
  'GET /admin/dash/config': () => ({ items: ['access', 'fbtoken', 'logs'], all: [{ key: 'access', name: '排程發布' }, { key: 'fbtoken', name: '臉書權杖' }, { key: 'logs', name: '未處理錯誤' }, { key: 'online', name: '目前在線' }] }),
  'POST /admin/dash/config': (b) => { DASH.cfgSaved = b; return b; },
  'GET /admin/site/vis': () => ({ on: TV.on, hide: TV.hide }),
  'GET /admin/selfreg': () => ({ on: SR.on, tools: SR.tools, options: SR_OPTIONS }),
  'POST /admin/selfreg': (b) => { SR.posts.push(b); SR.on = b.on; SR.tools = b.tools; return { on: b.on, tools: b.tools, options: SR_OPTIONS }; },
  'POST /admin/site/vis': (b) => { TV.posts.push(b); TV.on = b.on; TV.hide = b.hide; return { on: b.on, hide: b.hide }; },
  // 時間以「回應當下」往前推（測試跑很久時「3 分鐘前」才不會變成 4 分鐘前）
  'GET /admin/fb/usage': () => usageNow(),
  'POST /admin/fb/usage/refresh': () => ({ ...usageNow(), asked: 3, failed: 1 }),
  'GET /admin/fb/profiles': () => TP,
  'POST /admin/fb/profiles': (b) => { TP.list.push({ id: 'p11112222', name: b.name, created: 3, active: false, hasToken: false, source: null, pages: [], dataExpires: null, appName: '', appId: '', broken: false }); return { ...TP, created: 'p11112222' }; },
  'POST /admin/fb/profiles/pabcdef12/activate': () => { TP.list.forEach((x) => { x.active = x.id === 'pabcdef12'; }); TP.active = 'pabcdef12'; return TP; },
  'GET /admin/assets': [{ key: 'logo.png', tier: 'company', size: 2048, updated: Date.UTC(2026, 10, 1) }],
  'GET /admin/logs': [{ at: Date.UTC(2026, 10, 2), tool: 'fb', code: 'ok', ver: '1' }],
  'GET /admin/fb/status': { configured: true, valid: true, userValid: true, expires: Math.floor(Date.UTC(2027, 0, 5, 4, 0) / 1000), missing: ['pages_manage_posts'], granted: ['pages_read_engagement', 'public_profile'], pageScopes: ['pages_manage_engagement', 'pages_read_engagement'], needed: ['pages_manage_posts', 'pages_read_engagement', 'pages_manage_engagement'], app: '小編工具箱', appId: '123', pages: 3, autoExtend: true,
    stored: { pages: 3, expires: 0, dataExpires: Math.floor(Date.UTC(2027, 1, 10, 4, 0) / 1000), savedAt: Date.UTC(2026, 10, 19, 4, 0) },
    warn: { level: 'warn', days: 10, text: '臉書權杖 10 天後到期，請主管重新產生權杖，再到管理頁「臉書連線」換新。' } },
  'GET /admin/fb/pages': PAGES,
  'GET /admin/fb/backgrounds': () => ({ list: BG.list, batch: 10 }),
  'POST /admin/fb/backgrounds': (b) => { BG.posts.push(b); if (b.dry) return { add: 1, update: 3, gone: [{ id: '303063890126416', name: '過期圖樣', type: 'image' }], bad: 0, exp: Math.floor(Date.now() / 1000) + 2 * 86400 + 600 }; BG.list = BG.list.filter((x) => !b.remove.includes(x.id)); return { list: BG.list, batch: 10 }; },
  'POST /admin/fb/backgrounds/random': (b) => { BG.posts.push(b); BG.list.forEach((x) => { if (b.ids.includes(x.id)) x.rnd = b.rnd; }); return { list: BG.list, batch: 10 }; },
  'GET /admin/fb/comment-opts': () => ({ edit: CO.edit, who: CO.who, staff: CO.staff, people: CO.people }),
  'POST /admin/fb/comment-opts': (b) => { CO.edit = b.edit; CO.who = b.who; CO.staff = b.staff; CO.posts.push(b); return { edit: CO.edit, who: CO.who, staff: CO.staff, people: CO.people }; },
  'GET /admin/fb/preview-opts': () => ({ on: HO.on, who: HO.who, staff: HO.staff, method: HO.method, people: CO.people }),
  'POST /admin/fb/preview-opts': (b) => { HO.on = b.on; HO.who = b.who; HO.staff = b.staff; HO.method = b.method; HO.posts.push(b); return { on: HO.on, who: HO.who, staff: HO.staff, method: HO.method, people: CO.people }; },
  'GET /admin/fb/video-opts': () => ({ stream: VO.stream, who: VO.who, staff: VO.staff, people: CO.people }),
  'POST /admin/fb/video-opts': (b) => { VO.stream = b.stream; VO.who = b.who; VO.staff = b.staff; VO.posts.push(b); return { stream: VO.stream, who: VO.who, staff: VO.staff, people: CO.people }; },
  'POST /admin/fb/backgrounds/fetch': (b) => { BG.fetches.push(b); return { done: 0, failed: 1, left: 0 }; },
  'POST /admin/fb/backgrounds/106018623298955': (b) => { BG.posts.push(b); if (b.name) BG.list[0].name = b.name; if (b.show !== undefined) BG.list[0].show = b.show; if (b.rnd !== undefined) BG.list[0].rnd = b.rnd; return { list: BG.list, batch: 10 }; },
  'POST /admin/fb/pages': (b) => { PG_SAVED = b; return b.pages.map((p) => ({ ...PAGES.find((x) => x.id === p.id), ...p })); },
  'GET /admin/fb/presets': [{ name: '雙11抽獎', body: '雙11活動連結 https://example.com/a' }, { name: '訂閱', body: '歡迎訂閱' }],
  'POST /admin/fb/presets': (b) => { PS_SAVED = b; return b.presets; },
  'GET /admin/fb/video-settings': { prefixes: ['1118_'], suffixes: [], reelsTag: '#焦點新聞影音都在TVBS', tags: ['#國際'] },
  'POST /admin/fb/video-settings': (b) => { VS_SAVED = b; return b; },
  'POST /admin/fb/refresh': {},
  'GET /admin/fb/access': () => AC,
  'POST /admin/fb/access': (b) => { AC = { mode: b.mode, reason: b.reason.trim() }; return AC; },
  'POST /admin/fb/token': (b) => { TOK_SAVED = b; return { configured: true, valid: true, expires: 0, missing: [], pages: 6, source: 'admin', app: 'NEW-APP', extended: true }; },
  // 打開卡片不查權限（meta:null、預選使用中組別）；?check=1 才回 meta
  'GET /admin/fb/guard': (b, u) => { const chk = u.searchParams.get('check') === '1'; GD_CHECKS.push(chk);
    return { mode: 'off', profile: '', pages: [], suggest: 'p1', stats: { since: 0 },
      rules: { names: ['寶爸', '寳爸'], leads: ['老師', '進群'], allow: [], auto: { r1: true, r2: false } }, defaults: { names: ['寶爸', '寳爸'], leads: ['老師', '進群'], allow: [], auto: { r1: true, r2: false } },
      profiles: [{ id: 'p1', name: '主管權杖', active: true, meta: chk ? false : null }, { id: 'pabcdef12', name: '鈞評測試', active: false, meta: chk ? true : null }] }; },
  'POST /admin/fb/guard': (b) => { GD_SAVED = b; return { ...b, pages: [], stats: { since: 0 } }; },
  'GET /admin/fb/guard/pages': { profile: 'pabcdef12', pages: [{ id: '111', name: 'TVBS 新聞', on: false, sub: null }] },
  'POST /admin/fb/guard/pages/111': (b) => ({ id: '111', on: b.on, sub: b.on }),
  'GET /admin/fb/guard/log': { more: false, items: [{ cid: '9_1', page: '111', post: '111_9', uid: '777', uname: 'Eliza Paredes', msg: '幸好一直看 雙寶爸的財經新報 超讚！', tags: ['雙寶爸的財經新報'], rule: 'r1', action: 'observe', edited: true, exempt: false, at: Date.UTC(2026, 10, 20, 5, 8), link: 'https://www.facebook.com/x' }] },
  'POST /admin/fb/guard/log/9_1/hide': { cid: '9_1', page: '111', post: '111_9', uid: '777', uname: 'Eliza Paredes', msg: '幸好一直看 雙寶爸的財經新報 超讚！', tags: ['雙寶爸的財經新報'], rule: 'r1', action: 'manual', edited: true, exempt: false, at: Date.UTC(2026, 10, 20, 5, 8), link: 'https://www.facebook.com/x' },
  'GET /admin/fb/conn': { profile: '主管權杖', pages: [{ id: '111', name: 'TVBS 新聞' }, { id: '222', name: 'TVBS 少康戰情室' }], broken: false, warn: null, error: '' },
  'GET /admin/fb/webhook': { url: 'https://api.example/fbhook', verifyToken: '0123456789abcdef0123456789abcdef', signReady: false, last: { at: Date.UTC(2026, 10, 20, 2, 31), object: 'page', fields: ['feed'] } },
  'GET /admin/fb/app': () => APP,
  'POST /admin/fb/app': (b) => { APP_SAVED = b; APP = { configured: true, appId: b.appId, source: 'admin', savedAt: Date.UTC(2026, 10, 20, 2, 30) }; return APP; },
  'DELETE /admin/fb/app': () => { APP = { configured: false, appId: '', source: null, savedAt: null }; return APP; },
  'DELETE /admin/fb/token': { configured: true, valid: true, expires: 0, missing: [], pages: 6, source: 'secret', app: 'DEV-TOOL' },
  'GET /admin/rundown': { configured: true },
  'POST /admin/rundown/ping': { title: 'FB RUNDOWN(2026)', sheets: ['2026/11'] },
};

// 授權名單的假後端：記錄收到的 body／query，回整份最新狀態
const SF = { bodies: [], audit: [], withCode: false };
const MS = { bodies: [], items: [] };
const PERMS = [{ key: 'view', label: '檢視已排程／已發佈' }, { key: 'post', label: '新增發文（含排入 Rundown）' }, { key: 'edit', label: '改排程時間' }, { key: 'delete', label: '刪除貼文' },
  { key: 'vview', label: '檢視影片發布' }, { key: 'vpost', label: '上傳發布影片（含改時間、刪除）' }, { key: 'report', label: '檢視數據報表' }, { key: 'bypass', label: '關閉時仍可使用排程發布／影片發布' },
  { key: 'card:pages', label: '粉專設定' }, { key: 'card:guard', label: '留言管理' }, { key: 'card:staff', label: '授權名單' }];
const SECTIONS = [{ name: '排程發布', keys: ['view', 'post', 'edit', 'delete'] }, { name: '影片發布', keys: ['vview', 'vpost'] }, { name: '數據報表', keys: ['report'] }, { name: '共用', keys: ['bypass'] },
  { name: '管理頁：發文設定', keys: ['card:pages'] }, { name: '管理頁：留言管理', keys: ['card:guard'] }, { name: '管理頁：人員與權限', keys: ['card:staff'] }];
let STAFF = [];
const GROUPS = [
  { id: 'viewer', name: '唯讀', perms: ['view'] },
  { id: 'editor', name: '小編', perms: ['view', 'post', 'edit'] },
  { id: 'lead', name: '主管', perms: ['view', 'post', 'edit', 'delete', 'bypass', 'card:staff'] }];
// STAFF_AS：設了就模擬「非系統管理者」看到的名單（canEdit／assignable／me）
let STAFF_AS = null;
function sfState() {
  const base = { staff: STAFF, groups: GROUPS.map((g) => ({ ...g, used: STAFF.filter((s) => s.group === g.id).length })), perms: PERMS, sections: SECTIONS, me: { role: 'sys', canRename: true, canAdd: true, id: '' } };
  if (!STAFF_AS) return base;
  return { ...base, staff: STAFF.map((s) => ({ ...s, canEdit: s.id !== STAFF_AS.id })), groups: base.groups.map((g) => ({ ...g, assignable: g.id !== 'lead' })), me: { role: 'staff', canRename: false, canAdd: true, id: STAFF_AS.id } };
}
function staffRoute(req, u, key) {
  const p = u.pathname;
  if (!(p.startsWith('/admin/staff') || p === '/admin/audit')) return null;
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (req.method() !== 'GET') SF.bodies.push({ key, body });
  if (key === 'GET /admin/audit') { SF.audit.push(u.search); return { ok: true, data: [
    { id: 4, at: Date.UTC(2026, 10, 17, 3, 5), uid: 'ADMIN', name: '', action: 'reset', page: '', post: '', detail: 'A001' },
    { id: 3, at: Date.UTC(2026, 10, 17, 2, 30), uid: 'A001', name: '王小明', action: 'publish', page: '111', post: '111_444', detail: 'kind=textimg' },
    { id: 2, at: Date.UTC(2026, 10, 17, 2, 5), uid: 'A001', name: '王小明', action: 'schedule', page: '111', post: '111_222', detail: 'at=1795000000 kind=template' },
    { id: 1, at: Date.UTC(2026, 10, 16, 2, 5), uid: 'ADMIN', name: '', action: 'delete', page: '111', post: '111_333', detail: '' }] }; }
  if (key === 'GET /admin/staff') return { ok: true, data: sfState() };
  if (key === 'POST /admin/staff') { STAFF.push({ ...body, enabled: true, created: 1, lastLogin: null, pw: 'setup', setupExp: Date.now() + 86400000 }); return { ok: true, data: { ...sfState(), ...(SF.withCode ? { setup: { id: body.id, code: '482913', exp: Date.now() + 86400000 } } : {}) } }; }
  const rm = p.match(/^\/admin\/staff\/(.+)\/reset$/);
  if (rm && req.method() === 'POST') { Object.assign(STAFF.find((s) => s.id === rm[1]), { pw: 'setup', setupExp: Date.now() + 86400000, locked: false }); return { ok: true, data: { ...sfState(), setup: { id: rm[1], code: '135790', exp: Date.now() + 86400000 } } }; }
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
  SF.bodies = []; SF.audit = []; SF.withCode = false;
  STAFF = [
    { id: 'A001', name: '王小明', group: 'editor', enabled: true, created: 1, lastLogin: Date.UTC(2026, 10, 17, 2, 5), pw: 'set' },
    { id: 'A002', name: '陳大華', group: 'viewer', enabled: true, created: 1, lastLogin: null, pw: 'none' },
    { id: 'A003', name: '林主管', group: 'lead', enabled: false, created: 1, lastLogin: null, pw: 'set', locked: true }];
}

const ALL_CARDS = ['access', 'profiles', 'fbconn', 'webhook', 'labs', 'toolvis', 'selfreg', 'guard', 'fbstate', 'usage', 'pages', 'presets', 'video', 'bg', 'staff', 'groups', 'audit', 'rundown', 'assets', 'logs'];
const SYS = { role: 'sys', roleName: '系統管理者', unlocked: true, cards: ALL_CARDS, name: '系統管理者' };
// front：首頁登入存在 localStorage 的憑證（{ token, me }），/admin/me 依 Authorization 回身分；'T'＝管理頁密碼登入（系統管理者已解鎖）
async function open(viewport, hash = '', front = null) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: Number(process.env.SHOT_DSF) || 1 });
  const page = await ctx.newPage();
  if (front) await page.addInitScript((t) => { localStorage.setItem('tbx.company', JSON.stringify({ token: t, exp: Math.floor(Date.now() / 1000) + 3600 })); }, front.token);
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
    if (key === 'GET /admin/me') {
      const a = req.headers().authorization || '';
      if (a === 'Bearer T') return r.fulfill({ json: { ok: true, data: SYS } });
      if (front && a === 'Bearer ' + front.token) return r.fulfill({ json: front.me ? { ok: true, data: front.me } : { ok: false, code: 'forbidden', error: '沒有這個功能的權限。' } });
      return r.fulfill({ json: { ok: false, code: 'unauthorized' } });
    }
    if (/^\/admin\/fb\/backgrounds\/\d+\/img$/.test(u.pathname)) return r.fulfill({ contentType: 'image/png', body: Buffer.from(PNG1, 'base64') });
    const rcm = /^\/admin\/msgs\/(\d+)\/recall$/.exec(u.pathname);
    if (rcm && req.method() === 'POST') { MS.bodies.push({ key, id: Number(rcm[1]) }); MS.items.find((x) => x.id === Number(rcm[1])).recalled = true; return r.fulfill({ json: { ok: true, data: { id: Number(rcm[1]), recalled: true } } }); }
    if (key === 'GET /admin/msgs') return r.fulfill({ json: { ok: true, data: { items: MS.items } } });
    if (key === 'POST /admin/msgs') {
      const b = JSON.parse(req.postData()); MS.bodies.push({ key, body: b });
      const n = b.mode === 'all' ? 2 : b.mode === 'group' ? 1 : b.uids.length;
      MS.items.unshift({ id: 10 + MS.items.length, at: Date.now(), fromName: '莊鈞評', body: b.body, recalled: false, count: n, read: 1, to: [{ uid: 'A001', name: '王小明', readAt: Date.now() }, { uid: 'A002', name: '陳大華', readAt: 0 }].slice(0, n) });
      return r.fulfill({ json: { ok: true, data: { id: 10, count: n } } });
    }
    const sf = staffRoute(req, u, key);
    if (sf) return r.fulfill({ json: sf });
    if (typeof DATA[key] === 'function') return r.fulfill({ json: { ok: true, data: DATA[key](req.postData() ? JSON.parse(req.postData()) : null, u) } });
    if (key in DATA) return r.fulfill({ json: { ok: true, data: DATA[key] } });
    return r.fulfill({ json: { ok: false, code: 'not_found', error: '找不到' } });
  });
  await page.goto(srv.url + 'admin/' + hash);
  return { page, calls };
}

// 切到某張卡片所在的分類與功能（管理頁一次只顯示一個功能）
async function show(page, card) {
  await page.evaluate((id) => {
    const t = document.getElementById(id).closest('.panel').id.slice(6);
    const tb = document.getElementById('tab-' + t); if (tb.getAttribute('aria-selected') !== 'true') tb.click();
    const sb = document.querySelector('.sub-tabs [aria-controls="' + id + '"]'); if (sb) sb.click();
  }, card);
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
  assert.equal(await page.getAttribute('#tab-post', 'aria-selected'), 'true');
  assert.ok(page.url().endsWith('#post/pages'));
  assert.equal(await page.isVisible('#logout'), true);
  assert.ok(!calls.some((c) => c.key === 'GET /admin/assets'), '沒進素材分類前不讀素材');
  // 5 個分類；沒有後端 API 的卡片（預設文字、嘗試次數）不出現
  assert.deepEqual(await page.$$eval('nav.side [role=tab]', (els) => els.filter((e) => !e.hidden).map((e) => e.textContent)), ['發文設定', '留言管理', '人員與權限', '連接狀態', '素材設定', '使用紀錄', '進階設定']);
  await page.waitForSelector('#pgWrap:not([hidden])');
  await page.fill('.pg-short >> nth=0', '填到一半');

  // 切到素材再切回來，填到一半的內容還在
  await page.click('#tab-assets');
  assert.equal(await page.isVisible('#panel-post'), false);
  await page.click('#tab-post');
  assert.equal(await page.inputValue('.pg-short >> nth=0'), '填到一半');

  // 素材：第一次進來才讀
  await page.click('#tab-assets');
  await page.waitForSelector('#tableWrap:not([hidden])');
  assert.match(await page.textContent('#rows'), /logo\.png/);

  // 方向鍵切換分類（Rundown → 素材 → 錯誤日誌）
  await page.focus('#tab-assets');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getAttribute('#tab-rec', 'aria-selected'), 'true');
  await page.click('#sub-rec-logs');
  await page.click('#logBtn');
  await page.waitForSelector('#logWrap:not([hidden])');

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
  assert.equal(await page.getAttribute('#tab-rec', 'aria-selected'), 'true');
  assert.equal(await page.isVisible('#panel-rec'), true);
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
  const { page, calls } = await open({ width: 1280, height: 860 }, '#adv');
  await login(page);
  await show(page, 'fbCard');
  await page.waitForFunction(() => /可以發文/.test(document.getElementById('fbState').textContent));
  const st = await page.textContent('#fbState');
  assert.match(st, /可以發文/);
  assert.match(st, /粉專 3 個/);
  const det = await page.textContent('#fbDetail');
  assert.match(det, /粉專權杖：3 個，永不過期/);
  assert.match(det, /資料存取期限：2027-02-10/);
  assert.match(det, /使用者權杖：到期日 2027-01-05/);
  assert.equal(await page.isVisible('#fbWarn'), true);
  assert.match(await page.textContent('#fbWarn'), /10 天後到期/);
  assert.match(await page.textContent('#fbTokHint'), /會自動延長/);
  if (SHOT) await page.locator('#fbState').locator('xpath=ancestor::section[1]').screenshot({ path: path.join(SHOT, 'admin-fb-token.png') });
  assert.match(await page.textContent('#fbMissing'), /缺少權限：pages_manage_posts/);
  const perms = await page.textContent('#fbPerms');
  assert.match(perms, /小編工具箱（ID 123）/);
  assert.match(perms, /使用者權杖權限pages_read_engagement、public_profile/);
  assert.match(perms, /粉專權杖權限pages_manage_engagement、pages_read_engagement/);
  assert.equal(await page.locator('#fbPerms b', { hasText: 'pages_read_engagement' }).count(), 2, '工具需要的權限標粗');
  await page.click('#tab-post'); await page.waitForSelector('#pgWrap:not([hidden])');
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
  await show(page, 'fbCard');
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
  await page.waitForSelector('#pgSave.fx-ok');
  if (SHOT) await page.locator('#pgSave').locator('xpath=ancestor::section[1]').screenshot({ path: path.join(SHOT, 'fx-admin-saved.png') });
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
  await page.click('#tab-conn');
  assert.ok((await over()) <= 0, 'Rundown 橫向捲動');
});

test('Rundown 分類：測試連線打 /admin/rundown/ping 並顯示試算表名稱', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#rd');
  await login(page);
  await show(page, 'rdCard');
  assert.equal(await page.isVisible('#panel-conn'), true);
  await page.waitForFunction(() => document.getElementById('rdState').textContent === '狀態：已設定');
  await page.click('#rdPing');
  await page.waitForFunction(() => /連線正常：FB RUNDOWN\(2026\)/.test(document.getElementById('rdMsg').textContent));
  assert.ok(calls.some((c) => c.key === 'POST /admin/rundown/ping' && c.auth === 'Bearer T'));
});

test('影片設定：讀到既有設定；每行一個，儲存時去空白行', async () => {
  VS_SAVED = null;
  const { page } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await show(page, 'vsCard');
  await page.waitForFunction(() => document.getElementById('vsReels').value === '#焦點新聞影音都在TVBS');
  assert.equal(await page.inputValue('#vsPre'), '1118_');
  await page.fill('#vsSuf', '_v2\n\n_final ');
  await page.fill('#vsTags', '#國際\n#TVBS新聞');
  await page.click('#vsSave');
  await page.waitForFunction(() => document.getElementById('vsMsg').textContent === '已儲存');
  assert.deepEqual(VS_SAVED, { prefixes: ['1118_'], suffixes: ['_v2', '_final'], reelsTag: '#焦點新聞影音都在TVBS', tags: ['#國際', '#TVBS新聞'] });
});

test('活動留言：顯示既有兩則；新增、刪除後儲存，body 依順序', async () => {
  PS_SAVED = null;
  const { page, calls } = await open({ width: 1280, height: 860 }, '#fb');
  await login(page);
  await show(page, 'psCard');
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
  await show(page, 'psCard');
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
  await show(page, 'psCard');
  await page.waitForSelector('#psRows .ps-row');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, '橫向捲動 ' + over);
});

test('Webhook 卡片：顯示回呼網址、驗證權杖、簽章狀態、最後收到；複製', async () => {
  const { page, calls } = await open({ width: 1280, height: 900 }, '#adv');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await show(page, 'whCard');
  await page.waitForFunction(() => /fbhook/.test(document.getElementById('whUrl').textContent));
  assert.equal(await page.textContent('#whUrl'), 'https://api.example/fbhook');
  assert.equal(await page.textContent('#whTok'), '0123456789abcdef0123456789abcdef');
  assert.match(await page.textContent('#whSign'), /還沒設定 App 密鑰/);
  assert.match(await page.textContent('#whLast'), /2026-11-20.*page／feed/);
  await page.click('#whTokCopy');
  await page.waitForFunction(() => /已複製驗證權杖/.test(document.getElementById('whMsg').textContent));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '0123456789abcdef0123456789abcdef');
  if (SHOT) await page.locator('#whCard').screenshot({ path: path.join(SHOT, 'admin-webhook.png') });
  await page.setViewportSize({ width: 375, height: 800 });
  const over = await page.$eval('#whCard', (c) => c.scrollWidth > c.clientWidth + 1);
  assert.equal(over, false, '手機寬不超出');
  assert.ok(calls.some((c) => c.key === 'GET /admin/fb/webhook' && c.auth === 'Bearer T'));
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('App 密鑰：未設定提示、驗證並儲存（送 ID 與 Secret、成功清空、只顯示 App ID）、清除', async () => {
  APP = { configured: false, appId: '', source: null, savedAt: null };
  const { page, calls } = await open({ width: 1280, height: 900 }, '#adv');
  await login(page);
  await show(page, 'fbCard');
  await page.waitForFunction(() => /未設定/.test(document.getElementById('appState').textContent));
  assert.equal(await page.isVisible('#appClear'), false);
  assert.equal(await page.getAttribute('#appSecret', 'type'), 'password');
  await page.click('#appSave');
  assert.match(await page.textContent('#appMsg'), /請填 App ID 和 App Secret/);
  await page.fill('#appId', ' 1234567890 ');
  await page.fill('#appSecret', 'abcdef0123456789abcdef0123456789');
  await page.click('#appSave');
  await page.waitForFunction(() => /已驗證並儲存/.test(document.getElementById('appMsg').textContent));
  assert.deepEqual(APP_SAVED, { appId: '1234567890', secret: 'abcdef0123456789abcdef0123456789' });
  assert.equal(await page.inputValue('#appSecret'), '', '成功後清空');
  await page.waitForFunction(() => /已設定；App ID 1234567890/.test(document.getElementById('appState').textContent));
  assert.ok(!(await page.textContent('#fbCard, body')).includes('abcdef0123456789abcdef0123456789'), '畫面不顯示 Secret');
  if (SHOT) await page.locator('#appState').locator('xpath=ancestor::section[1]').screenshot({ path: path.join(SHOT, 'admin-fb-app.png') });
  page.once('dialog', (d) => d.accept());
  await page.click('#appClear');
  await page.waitForFunction(() => /已清除/.test(document.getElementById('appMsg').textContent));
  assert.ok(calls.some((c) => c.key === 'DELETE /admin/fb/app' && c.auth === 'Bearer T'));
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('臉書連線：貼上權杖→驗證並儲存（body 帶權杖、成功後清空輸入框）；改回 Secret 打 DELETE', async () => {
  const { page, calls } = await open({ width: 1280, height: 860 }, '#adv');
  await login(page);
  await show(page, 'fbCard');
  await page.waitForFunction(() => /可以發文/.test(document.getElementById('fbState').textContent));
  assert.equal(await page.isVisible('#fbTokClear'), false, '來源不是管理頁時不顯示「改回 Secret」');
  await page.click('#fbTokSave');
  assert.match(await page.textContent('#fbTokMsg'), /請先貼上權杖/);
  await page.fill('#fbTok', '  EAAnew123  ');
  await page.click('#fbTokSave');
  await page.waitForFunction(() => /已自動延長權杖/.test(document.getElementById('fbTokMsg').textContent));
  assert.deepEqual(TOK_SAVED, { token: 'EAAnew123' });
  assert.match(await page.textContent('#fbTokMsg'), /並換好 6 個粉專權杖（永不過期）；App：NEW-APP/);
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
  const { page, calls } = await open({ width: 1280, height: 860 }, '#adv');
  await login(page);
  await page.waitForFunction(() => document.getElementById('acState').textContent === '狀態：關閉');
  assert.deepEqual(await page.$$eval('#acCard .ac-row button', (bs) => bs.map((b) => b.textContent)), ['開放', '關閉']);
  assert.equal(await page.getAttribute('#acClose', 'aria-pressed'), 'true');
  assert.equal(await page.isVisible('#acReasonSave'), true, '關閉中可以只存原因');
  const cards = await page.$$eval('#panel-adv section.card:not(.unlock)', (els) => els.map((e) => e.id));
  assert.equal(cards[0], 'acCard', '放在進階設定最上面');
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
  await page.click('#tab-people'); await show(page, 'sfCard');
  await page.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await page.$$eval('#sfRows tr', (r) => r.length), 3);
  assert.deepEqual(await page.$$eval('#sgRows .sg-row > input', (e) => e.map((i) => i.value)), ['唯讀', '小編', '主管']);
  assert.deepEqual(await page.$$eval('#sfGroup option', (e) => e.map((o) => o.textContent)), ['唯讀', '小編', '主管']);
  assert.match(await page.textContent('#sfRows tr:nth-child(2)'), /從未/);
  assert.match(await page.textContent('#sfRows tr:nth-child(1)'), /(\d{4}-\d\d-\d\d|\d{1,2}\/\d{1,2}) \d\d:\d\d/);

  // 新增
  await page.fill('#sfId', 'B009'); await page.fill('#sfName', '新同仁'); await page.fill('#sfContact', '#12345'); await page.selectOption('#sfGroup', 'editor');
  await page.click('#sfAdd');
  await page.waitForFunction(() => document.querySelectorAll('#sfRows tr').length === 4);
  assert.deepEqual(SF.bodies.pop(), { key: 'POST /admin/staff', body: { id: 'B009', name: '新同仁', group: 'editor', contact: '#12345' } });
  assert.equal(await page.inputValue('#sfId'), '');
  assert.equal(await page.inputValue('#sfContact'), '');

  // 分機／手機：改完離開欄位就存
  await page.fill('#sfRows tr:nth-child(2) .sf-contact', ' 0912-345-678 ');
  await page.press('#sfRows tr:nth-child(2) .sf-contact', 'Enter');
  await page.waitForFunction(() => /分機／手機/.test(document.getElementById('sfMsg').textContent));
  assert.deepEqual(SF.bodies.pop(), { key: 'POST /admin/staff/A002', body: { contact: '0912-345-678' } });

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

test('授權名單密碼：密碼欄狀態；新增與重置後顯示設定碼（可複製、關掉清空）；系統管理者列不能停用或移除', async () => {
  resetStaff();
  SF.withCode = true;
  STAFF.push({ id: '13082605', name: '莊鈞評', group: 'lead', sys: true, enabled: true, created: 1, lastLogin: null, pw: 'set' });
  const { page } = await open({ width: 1280, height: 860 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.click('#tab-people'); await show(page, 'sfCard');
  await page.waitForSelector('#sfWrap:not([hidden])');
  const pwCol = await page.$$eval('#sfRows tr', (rows) => rows.map((r) => r.children[5].textContent));
  assert.deepEqual(pwCol, ['已設定', '未設定', '鎖定中', '已設定']);
  // 系統管理者列
  const sys = '#sfRows tr:nth-child(4)';
  assert.equal(await page.inputValue(sys + ' input.sf-name'), '莊鈞評');
  assert.equal(await page.isDisabled(sys + ' button:text("停用")'), true);
  assert.equal(await page.isDisabled(sys + ' button:text("移除")'), true);
  // 新增 → 設定碼視窗
  await page.fill('#sfId', 'B010'); await page.fill('#sfName', '新同仁'); await page.selectOption('#sfGroup', 'editor');
  await page.click('#sfAdd');
  await page.waitForSelector('#sfCode[open]');
  assert.equal(await page.textContent('#sfCodeVal'), '482913');
  assert.match(await page.textContent('#sfCodeTitle'), /新同仁（B010）/);
  await page.click('#sfCodeCopy');
  await page.waitForFunction(() => document.getElementById('sfCodeCopy').textContent === '已複製');
  await page.click('#sfCodeOk');
  assert.equal(await page.isVisible('#sfCode'), false);
  await page.waitForFunction(() => document.getElementById('sfCodeVal').textContent === '');
  assert.match(await page.textContent('#sfRows tr:nth-child(5)'), /等待設定/);
  // 重置密碼（要確認）
  page.once('dialog', (d) => d.dismiss());
  await page.click('#sfRows tr:nth-child(1) button:text("重置密碼")');
  assert.ok(!SF.bodies.some((b) => /reset/.test(b.key)), '取消就不送');
  page.once('dialog', (d) => d.accept());
  await page.click('#sfRows tr:nth-child(1) button:text("重置密碼")');
  await page.waitForSelector('#sfCode[open]');
  assert.equal(await page.textContent('#sfCodeVal'), '135790');
  assert.deepEqual(SF.bodies.pop(), { key: 'POST /admin/staff/A001/reset', body: null });
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/admin-code.png' });
  await page.keyboard.press('Escape');
  assert.match(await page.textContent('#sfRows tr:nth-child(1)'), /等待設定/);
});

test('權限組：儲存帶 id／名稱／權限、使用中不能刪、新增一組', async () => {
  resetStaff();
  const { page } = await open({ width: 1280, height: 860 }, '#adv');
  await login(page);
  await show(page, 'sgCard');
  await page.waitForSelector('#sgRows .sg-row');
  const del = await page.$$eval('#sgRows .sg-row', (rs) => rs.map((r) => [r.querySelector('.danger').disabled, r.querySelector('.danger').title]));
  assert.deepEqual(del, [[true, '還有 1 人使用'], [true, '還有 1 人使用'], [true, '還有 1 人使用']]);
  assert.equal(await page.$$eval('#sgRows .sg-row:nth-child(1) input[type=checkbox]', (c) => c.length), 11);
  await page.check('#sgRows .sg-row:nth-child(1) input[value=post]');
  await page.click('#sgRows .sg-row:nth-child(1) button.primary');
  await page.waitForFunction(() => /已儲存/.test(document.getElementById('sgMsg').textContent));
  assert.deepEqual(SF.bodies.pop().body, { id: 'viewer', name: '唯讀', perms: ['view', 'post'] });
  // 勾選依分區顯示
  assert.deepEqual(await page.$$eval('#sgRows .sg-row:nth-child(1) .sg-sec-h', (h) => h.map((x) => x.textContent)), ['排程發布', '影片發布', '數據報表', '共用', '管理頁：發文設定', '管理頁：留言管理', '管理頁：人員與權限']);
  assert.equal(await page.textContent('#sgRows .sg-row:nth-child(1) .sg-sec:nth-child(2) label:nth-child(2)'), '上傳發布影片（含改時間、刪除）');
  if (process.env.SHOT_DIR) await page.locator('#sgCard').screenshot({ path: process.env.SHOT_DIR + '/admin-groups.png' });
  await page.click('#sgNew');
  assert.equal(await page.$$eval('#sgRows .sg-row', (r) => r.length), 4);
});

test('操作紀錄：查詢帶期間與員工編號或姓名；來源欄與篩選、發文類型、開啟貼文按鈕', async () => {
  resetStaff();
  const { page } = await open({ width: 1280, height: 860 }, '#people/staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  await page.click('#tab-rec');
  await page.selectOption('#auDays', '30'); await page.fill('#auUid', 'a001');
  await page.click('#auBtn');
  await page.waitForSelector('#auWrap:not([hidden])');
  assert.equal(SF.audit.pop(), '?days=30&limit=21&offset=0&q=a001');
  await page.fill('#auUid', '王小明'); await page.press('#auUid', 'Enter');
  await page.waitForFunction(() => document.getElementById('auBtn').disabled === false && document.querySelectorAll('#auRows tr').length === 4);
  assert.equal(SF.audit.pop(), '?days=30&limit=21&offset=0&q=' + encodeURIComponent('王小明'));
  const rows = await page.$$eval('#auRows tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
  assert.deepEqual(rows.map((r) => [r[3], r[4]]), [['後台', '重置密碼'], ['工具', '立即發布（字圖）'], ['工具', '排程（套版）'], ['工具', '刪除']]);
  const links = await page.$$eval('#auRows a.au-open', (as) => as.map((a) => [a.href, a.target, a.rel, a.textContent]));
  assert.deepEqual(links, [['https://www.facebook.com/111/posts/444', '_blank', 'noopener noreferrer', '開啟貼文 ↗'], ['https://www.facebook.com/111/posts/222', '_blank', 'noopener noreferrer', '開啟貼文 ↗']]);
  assert.equal(rows[3][6], '111_333', '刪除的貼文只顯示 ID');
  const hs = await page.$$eval('#auRows tr', (trs) => trs.map((tr) => Math.round(tr.getBoundingClientRect().height)));
  assert.ok(Math.max(...hs) - Math.min(...hs) <= 2, '有按鈕的列和沒按鈕的列一樣高：' + hs);
  if (SHOT) await page.locator('#auCard').screenshot({ path: path.join(SHOT, 'admin-audit.png') });
  // 類別篩選：交給後端（?src=），從第 1 頁重查
  await page.selectOption('#auSrc', 'admin');
  await page.waitForFunction(() => document.getElementById('auBtn').disabled === false);
  await page.waitForTimeout(100);
  assert.equal(SF.audit.pop(), '?days=30&limit=21&offset=0&q=' + encodeURIComponent('王小明') + '&src=admin');
});

test('授權名單：320px 頁面不橫向捲動（表格自己橫捲）', async () => {
  resetStaff();
  const { page } = await open({ width: 320, height: 800 }, '#people/staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.evaluate(() => document.getElementById('sfWrap').scrollWidth > document.getElementById('sfWrap').clientWidth), true);
  await page.click('#tab-rec');
  await page.click('#auBtn'); await page.waitForSelector('#auWrap:not([hidden])');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});

test('測試後端：頁首標「測試後端」且 API 打 dev；正式不顯示', async () => {
  const { page } = await open({ width: 1280, height: 800 });
  assert.equal(await page.isVisible('#envTag'), false);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => { try { localStorage.setItem('tbx.api', 'dev'); } catch {} });
  const hosts = [];
  await p2.route(/^https:\/\/toolbox-api(-dev)?\.19jpz-3\.workers\.dev\//, (r) => { hosts.push(new URL(r.request().url()).host); return r.fulfill({ json: { ok: false, code: 'bad_password' } }); });
  await p2.goto(srv.url + 'admin/');
  await p2.waitForSelector('#envTag:not([hidden])');
  assert.equal(await p2.isVisible('#envTag'), true);
  await p2.fill('#pw', 'x');
  await p2.click('#loginBtn');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual([...new Set(hosts)], ['toolbox-api-dev.19jpz-3.workers.dev']);
  if (process.env.SHOT_DIR) await p2.screenshot({ path: process.env.SHOT_DIR + '/admin-dev.png' });
  await ctx.close();
});

test('權杖組別：列出、新增後設定中的組別換成新組（API 帶 ?p=）、切換使用中、空的組別不能切', async () => {
  TP = TP0();
  const { page } = await open({ width: 1280, height: 900 }, '#adv');
  const urls = [];
  page.on('request', (r) => { if (/\/admin\/fb\/(status|app|token)/.test(r.url())) urls.push(r.url()); });
  await login(page);
  await show(page, 'tpCard');
  await page.waitForSelector('#tpList li');
  assert.equal(await page.locator('#tpList li').count(), 3);
  assert.match(await page.textContent('#tpList li.on'), /主管權杖使用中/);
  assert.match(await page.textContent('#tpList li:nth-child(2)'), /評 Photography.*socialmediaeditor（888）/);
  assert.equal(await page.isDisabled('#tpList li:nth-child(3) button:has-text("切換為使用中")'), true);
  assert.equal(await page.inputValue('#tpPick'), 'p1');
  assert.ok(urls.every((u) => !u.includes('?p=')), '使用中那組不帶 ?p=');
  if (SHOT) await page.locator('#tpCard').screenshot({ path: path.join(SHOT, 'admin-tp.png') });
  await page.fill('#tpName', '新的一組');
  await page.click('#tpAdd');
  await page.waitForFunction(() => document.querySelector('#tpPick').value === 'p11112222');
  await page.waitForFunction(() => /已新增/.test(document.querySelector('#tpMsg').textContent));
  urls.length = 0;
  await show(page, 'fbCard');
  await page.selectOption('#tpPick', 'pabcdef12');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(urls.some((u) => u.endsWith('/admin/fb/status?p=pabcdef12')) && urls.some((u) => u.endsWith('/admin/fb/app?p=pabcdef12')), urls.join(' '));
  await show(page, 'tpCard');
  await page.click('#tpList li:nth-child(2) button:has-text("切換為使用中")');
  await page.waitForFunction(() => /已切換到「鈞評測試」/.test(document.querySelector('#tpMsg').textContent));
  assert.match(await page.textContent('#tpList li.on'), /鈞評測試/);
  if (SHOT) await page.locator('#tpCard').screenshot({ path: path.join(SHOT, 'admin-tp-switched.png') });
});

test('速率限制：App 與各粉專三個 % 長條（≥75 黃、≥90 紅）、被暫停顯示恢復時間、最近一次限流；立即查詢', async () => {
  const { page, calls } = await open({ width: 1280, height: 900 }, '#conn');
  await login(page);
  await show(page, 'usCard');
  await page.waitForSelector('#usList li .us-bars');
  assert.equal(await page.locator('#usList > li').count(), 3);
  assert.match(await page.textContent('#usList > li:nth-child(1)'), /App（使用者權杖）.*3 分鐘前/);
  assert.match(await page.textContent('#usList > li:nth-child(3)'), /粉專 222/);
  assert.match(await page.textContent('#usList > li:nth-child(3) .us-regain'), /約 25 分鐘後恢復/);
  const bars = page.locator('#usList > li:nth-child(2) .us-bar');
  assert.deepEqual(await bars.evaluateAll((els) => els.map((e) => [e.getAttribute('aria-valuenow'), e.className])), [['78', 'us-bar warn'], ['10', 'us-bar'], ['92', 'us-bar bad']]);
  assert.match(await page.textContent('#usThrottle'), /最近一次被臉書限流：2026-11-20.*粉專呼叫太多（粉專權杖）/);
  if (SHOT) await page.locator('#usCard').screenshot({ path: path.join(SHOT, 'admin-usage.png') });
  await page.click('#usAsk');
  await page.waitForFunction(() => /已查詢 3 次，1 次失敗/.test(document.querySelector('#usMsg').textContent));
  assert.ok(calls.some((c) => c.key === 'POST /admin/fb/usage/refresh' && c.auth === 'Bearer T'));
});

test('首頁員工（管理者）直接進入：只看到權限組有的卡片與分類，沒有解鎖區、不顯示登出鈕', async () => {
  resetStaff();
  const me = { role: 'staff', roleName: '主管組', unlocked: false, cards: ['pages', 'staff', 'audit', 'logs'], name: '王小明', id: 'A001' };
  const { page, calls } = await open({ width: 1280, height: 860 }, '', { token: 'F1', me });
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.isVisible('#login'), false);
  assert.equal(await page.textContent('#whoTag'), '王小明・主管組');
  assert.equal(await page.isVisible('#logout'), false);
  assert.equal(await page.isVisible('#unlockBar'), false);
  assert.deepEqual(await page.$$eval('nav.side [role=tab]', (b) => b.filter((x) => !x.hidden).map((x) => x.dataset.tab)), ['post', 'people', 'rec'], '管理者看不到進階設定');
  assert.equal(await page.isVisible('#pgCard'), true);
  for (const id of ['#acCard', '#tpCard', '#fbCard', '#whCard', '#usCard', '#psCard']) assert.equal(await page.isVisible(id), false, id);
  // 沒有權限的卡片不打 API；帶的是首頁憑證
  assert.ok(!calls.some((c) => c.key && /\/admin\/fb\/(status|profiles|webhook)$/.test(c.key)));
  assert.ok(calls.filter((c) => c.key && c.key.startsWith('GET /admin/')).every((c) => c.auth === 'Bearer F1'));
  await page.click('#tab-people'); await show(page, 'sfCard');
  await page.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await page.isVisible('#sgCard'), false);
  await page.click('#tab-rec');
  assert.equal(await page.isVisible('#auCard'), true);
  assert.ok(!calls.some((c) => c.key === 'GET /admin/levels'));
  assert.equal(await page.locator('#lvCard').count(), 0, '層級權限卡片已刪除');
});

test('首頁員工沒有任何卡片：顯示密碼登入與原因', async () => {
  const { page } = await open({ width: 1280, height: 860 }, '', { token: 'F2', me: null });
  await page.waitForSelector('#login:not([hidden])');
  assert.match(await page.textContent('#loginMsg'), /沒有任何可用的卡片/);
  assert.equal(await page.isVisible('#app'), false);
});

test('首頁管理員登入（未解鎖）：敏感卡片隱藏、顯示解鎖區；輸入密碼解鎖後出現，按「鎖定」回到未解鎖', async () => {
  const locked = { ...SYS, unlocked: false, cards: ALL_CARDS.filter((k) => !['access', 'profiles', 'fbconn', 'webhook', 'groups', 'labs', 'toolvis', 'selfreg'].includes(k)) };
  const { page } = await open({ width: 1280, height: 860 }, '', { token: 'F3', me: locked });
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.isVisible('#unlockBar'), false, '其他分類不顯示解鎖區');
  assert.equal(await page.isVisible('#pgCard'), true);
  assert.equal(await page.isVisible('#tab-adv'), true);
  await page.click('#tab-adv');
  assert.equal(await page.isVisible('#unlockBar'), true);
  assert.equal(await page.isVisible('#tpCard'), false); assert.equal(await page.isVisible('#acCard'), false);
  assert.match(await page.textContent('#whoTag'), /系統管理者（進階設定已鎖）/);
  await page.fill('#unlockPw', 'wrong'); await page.click('#unlockBtn');
  await page.waitForFunction(() => /密碼不正確/.test(document.getElementById('unlockMsg').textContent));
  await page.fill('#unlockPw', 'pw-123'); await page.click('#unlockBtn');
  await page.waitForSelector('#sub-adv-profiles:not([hidden])');
  assert.equal(await page.isVisible('#acCard'), true, '解鎖後顯示第一個功能');
  await show(page, 'tpCard');
  assert.equal(await page.isVisible('#tpCard'), true);
  assert.equal(await page.isVisible('#acCard'), false, '一次只顯示一個功能');
  assert.equal(await page.isVisible('#unlockBar'), false);
  assert.equal(await page.textContent('#logout'), '鎖定');
  await page.click('#logout');
  await page.waitForSelector('#unlockBar:not([hidden])');
  assert.equal(await page.isVisible('#tpCard'), false);
});

test('姓名：系統管理者看到輸入框（Enter／離開欄位存、失敗還原）；其他人唯讀', async () => {
  resetStaff();
  const { page } = await open({ width: 1280, height: 860 }, '#people/staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await page.inputValue('#sfRows tr:nth-child(1) input.sf-name'), '王小明');
  await page.fill('#sfRows tr:nth-child(1) input.sf-name', '王大明');
  await page.press('#sfRows tr:nth-child(1) input.sf-name', 'Enter');
  await page.waitForFunction(() => /姓名改成「王大明」/.test(document.getElementById('sfMsg').textContent));
  assert.deepEqual(SF.bodies.pop(), { key: 'POST /admin/staff/A001', body: { name: '王大明' } });
  assert.equal(await page.inputValue('#sfRows tr:nth-child(1) input.sf-name'), '王大明');
  // 空白：還原、不送
  const n = SF.bodies.length;
  await page.fill('#sfRows tr:nth-child(2) input.sf-name', '   ');
  await page.press('#sfRows tr:nth-child(2) input.sf-name', 'Enter');
  assert.equal(await page.inputValue('#sfRows tr:nth-child(2) input.sf-name'), '陳大華'); assert.equal(SF.bodies.length, n);
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/admin-staff-sys.png', fullPage: true });
  // 非系統管理者：唯讀
  STAFF_AS = { id: 'A001' };
  const me = { role: 'staff', roleName: '主管組', unlocked: false, cards: ['staff'], name: '王小明', id: 'A001' };
  const { page: p2 } = await open({ width: 1280, height: 860 }, '#people/staff', { token: 'F4', me });
  await p2.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await p2.locator('input.sf-name').count(), 0);
  assert.equal(await p2.textContent('#sfRows tr:nth-child(2) td:nth-child(2)'), '陳大華');
  STAFF_AS = null;
});

test('授權名單（有授權名單卡片的員工）：不能動的列唯讀、沒有層級欄、新增區只列可指派的權限組', async () => {
  resetStaff();
  const me = { role: 'staff', roleName: '主管組', unlocked: false, cards: ['staff'], name: '王小明', id: 'A001' };
  STAFF_AS = { id: 'A001' };
  const { page } = await open({ width: 1280, height: 860 }, '#staff', { token: 'F4', me });
  await page.waitForSelector('#sfWrap:not([hidden])');
  const row0 = await page.$$eval('#sfRows tr:first-child select, #sfRows tr:first-child button, #sfRows tr:first-child input', (els) => els.map((e) => e.disabled));
  assert.ok(row0.every(Boolean), '自己那列全部停用');
  assert.equal(await page.locator('table.sf-table thead th', { hasText: '層級' }).count(), 0, '沒有層級欄');
  assert.equal(await page.$eval('#sfRows tr:nth-child(2) button', (b) => b.disabled), false);
  assert.deepEqual(await page.$$eval('#sfGroup option', (o) => o.map((x) => x.value)), ['viewer', 'editor']);
  STAFF_AS = null;
});

// 只在 SHOT_DIR 時拍（給使用者確認版面用）
test('截圖：電腦版（系統管理者、管理者）與手機版', async () => {
  if (!SHOT) return;
  resetStaff();
  const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOT, name), fullPage: true }); };
  const { page } = await open({ width: 1280, height: 860 }, '#people/staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  await shot(page, 'admin-sys-staff.png');
  await page.click('#tab-adv'); await page.waitForSelector('#tpList li');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.screenshot({ path: path.join(SHOT, 'admin-sys-fb.png') });
  await page.click('#tab-conn'); await page.waitForSelector('#fsList li');
  await shot(page, 'admin-conn.png');
  await page.click('#tab-guard'); await page.waitForSelector('#gdLog tr.gd-row');
  await shot(page, 'admin-guard-page.png');
  const me = { role: 'staff', roleName: '主管組', unlocked: false, cards: ['usage', 'pages', 'presets', 'video', 'staff', 'audit', 'rundown', 'assets', 'logs'], name: '王小明', id: 'A001' };
  const { page: p2 } = await open({ width: 1280, height: 860 }, '#fb', { token: 'F9', me });
  await p2.waitForSelector('#app:not([hidden])'); await p2.waitForTimeout(500);
  await p2.screenshot({ path: path.join(SHOT, 'admin-mgr-fb.png') });
  const locked = { ...SYS, unlocked: false, cards: ALL_CARDS.filter((k) => !['access', 'profiles', 'fbconn', 'webhook', 'groups', 'labs', 'toolvis', 'selfreg'].includes(k)) };
  const { page: p3 } = await open({ width: 390, height: 844 }, '#adv', { token: 'F8', me: locked });
  await p3.waitForSelector('#app:not([hidden])'); await p3.waitForTimeout(500);
  await p3.screenshot({ path: path.join(SHOT, 'admin-mobile-fb.png') });
  const { page: p4 } = await open({ width: 1280, height: 860 }, '#adv', { token: 'F7', me: locked });
  await p4.waitForSelector('#unlockBar:not([hidden])'); await p4.waitForTimeout(300);
  await p4.screenshot({ path: path.join(SHOT, 'admin-adv-locked.png') });
});

test('留言守門卡片：打開不查權限、按了才查、儲存規則、開粉專、紀錄隱藏', async () => {
  GD_CHECKS.length = 0;
  const { page, calls } = await open({ width: 1280, height: 900 }, '#guard');
  await login(page);
  await page.waitForFunction(() => document.querySelectorAll('#gdLog tr.gd-row').length === 1);
  assert.equal(await page.inputValue('#gdProfile'), 'p1', '沒存過設定：預選發文使用中組別');
  assert.deepEqual(GD_CHECKS, [false], '打開卡片不查權限');
  assert.doesNotMatch(await page.textContent('#gdProfile option[value="p1"]'), /pages_manage_metadata/);
  await page.click('#gdPerm');
  await page.waitForFunction(() => /有 pages_manage_metadata 的組別：鈞評測試/.test(document.getElementById('gdMsg').textContent));
  assert.match(await page.textContent('#gdProfile option[value="p1"]'), /缺 pages_manage_metadata/);
  assert.equal(await page.inputValue('#gdProfile'), 'p1', '檢查後保留原本選的組別');
  await page.selectOption('#gdProfile', 'pabcdef12');
  assert.equal(await page.isChecked('#gdR1'), true); assert.equal(await page.isChecked('#gdR2'), false);
  await page.selectOption('#gdMode', 'observe');
  await page.fill('#gdLeads', '老師\n進群\n 帶單 \n');
  await page.click('#gdSave');
  await page.waitForFunction(() => /已儲存/.test(document.getElementById('gdMsg').textContent));
  assert.deepEqual(GD_SAVED, { mode: 'observe', profile: 'pabcdef12', rules: { names: ['寶爸', '寳爸'], leads: ['老師', '進群', '帶單'], allow: [], auto: { r1: true, r2: false } } });
  await page.check('#gdPg111');
  await page.waitForFunction(() => /已開啟/.test(document.getElementById('gdPgMsg').textContent));
  await show(page, 'gdLogCard');
  // 單行表格：一列一則，內容截一行；點內容展開全文、標註、留言者 ID
  assert.match(await page.textContent('#gdLog tr.gd-row'), /觀察.*Eliza Paredes.*幸好一直看/);
  assert.equal(await page.isVisible('#gdLog tr.gd-exp'), false);
  const rowH = await page.$eval('#gdLog tr.gd-row', (r) => r.getBoundingClientRect().height);
  assert.ok(rowH < 50, '一列高度 ' + rowH);
  await page.click('#gdLog .gd-more');
  assert.equal(await page.getAttribute('#gdLog .gd-more', 'aria-expanded'), 'true');
  assert.match(await page.textContent('#gdLog tr.gd-exp'), /標註：雙寶爸的財經新報.*留言者 ID 777.*編輯過/);
  await page.click('#gdLog td.c-btn button');
  await page.waitForFunction(() => /手動隱藏/.test(document.querySelector('#gdLog tr.gd-row').textContent));
  assert.equal(await page.isVisible('#gdLog tr.gd-exp'), true, '更新後保持展開');
  if (SHOT) await page.locator('#panel-guard').screenshot({ path: path.join(SHOT, 'admin-guard.png') });
  await page.setViewportSize({ width: 375, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '手機寬不超出');
  if (SHOT) await page.locator('#gdLogCard').screenshot({ path: path.join(SHOT, 'admin-guard-log-mobile.png') });
  assert.ok(calls.some((c) => c.key === 'POST /admin/fb/guard/log/9_1/hide'));
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('文字背景：複製擷取腳本＝repo 裡的腳本檔', async () => {
  bgReset();
  const { page } = await open({ width: 1280, height: 900 }, '#post');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await show(page, 'bgCard');
  await page.click('#bgScript');
  await page.waitForFunction(() => /已複製擷取腳本/.test(document.getElementById('bgMsg').textContent));
  const want = require('node:fs').readFileSync(path.join(__dirname, '../../docs/fb-text-backgrounds/extract-fb-backgrounds.js'), 'utf8');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), want);
  if (SHOT) await page.locator('#bgCard').screenshot({ path: path.join(SHOT, 'admin-bg-script.png') });
});

test('文字背景：列表與預覽圖；預覽匯入勾選刪除後套用；下載圖樣；改名', async () => {
  bgReset();
  const { page, calls } = await open({ width: 1280, height: 900 }, '#post');
  await login(page);
  await show(page, 'bgCard');
  await page.waitForSelector('#bgRows tr');
  assert.match(await page.textContent('#bgSum'), /已存 4 個：純色 1．漸層 1．圖樣 2（圖已下載 1／2）/);
  assert.equal(await page.textContent('#bgFetch'), '下載圖樣（1 張）');
  await page.waitForFunction(() => /blob:/.test(document.querySelectorAll('#bgRows .bg-sw')[2].style.backgroundImage));
  assert.ok(calls.some((c) => c.key === 'GET /admin/fb/backgrounds/303063890126415/img' && c.auth === 'Bearer T'));
  assert.match(await page.$eval('#bgRows tr:nth-child(2) .bg-sw', (e) => e.style.background), /linear-gradient/);
  // 格式錯
  await page.fill('#bgPaste', 'nope');
  await page.click('#bgPreview');
  assert.match(await page.textContent('#bgMsg'), /不是擷取腳本的結果/);
  // 預覽 → 勾刪除 → 套用
  await page.fill('#bgPaste', JSON.stringify({ presets: [{ preset_id: '1', type: 'solid' }] }));
  await page.click('#bgPreview');
  await page.waitForSelector('#bgDiff:not([hidden])');
  assert.match(await page.textContent('#bgDiffSum'), /新增 1．更新 3．臉書已沒有 1/);
  assert.match(await page.textContent('#bgDiffSum'), /圖樣網址最早 .+ 到期（剩 2 天），套用後請盡快下載/);
  if (SHOT) await page.locator('#bgCard').screenshot({ path: path.join(SHOT, 'admin-bg.png') });
  await page.check('#bgGone input[value="303063890126416"]');
  await page.click('#bgApply');
  await page.waitForFunction(() => document.getElementById('bgMsg').textContent.startsWith('已匯入'));
  assert.deepEqual(BG.posts[0], { presets: [{ preset_id: '1', type: 'solid' }], dry: true });
  assert.deepEqual(BG.posts[1], { presets: [{ preset_id: '1', type: 'solid' }], remove: ['303063890126416'] });
  assert.equal(await page.$$eval('#bgRows tr', (r) => r.length), 3);
  assert.ok(await page.isHidden('#bgDiff'));
  // 改名（Enter 儲存）
  await page.fill('#bgRows tr:nth-child(1) .bg-name', '紫色');
  await page.press('#bgRows tr:nth-child(1) .bg-name', 'Enter');
  await page.waitForFunction(() => document.getElementById('bgMsg').textContent === '已儲存「紫色」');
  // 下載圖樣：沒剩下就不顯示按鈕
  assert.ok(await page.isHidden('#bgFetch'));
  BG.list.push({ id: '303063890126417', name: '新圖樣', type: 'image', bg: '#000000', text: '#FFFFFF', img: false, hasUrl: true, err: '', show: true });
  await page.reload(); await login(page);
  await page.waitForSelector('#bgFetch:not([hidden])');
  await page.click('#bgFetch');
  await page.waitForFunction(() => /下載完成：成功 0 張、失敗 1 張/.test(document.getElementById('bgMsg').textContent));
  assert.equal(BG.fetches.length, 1);
  assert.ok(typeof BG.fetches[0].since === 'number');
  assert.ok(!calls.some((c) => typeof c === 'string'), JSON.stringify(calls.filter((c) => typeof c === 'string')));
});

test('文字背景：圖樣網址到期（未下載：剩幾天／一天內黃字／已過期紅字；已下載附原網址到期）＋摘要、預覽最早到期', async () => {
  bgReset();
  const now = Math.floor(Date.now() / 1000);
  BG.list[2].exp = now + 3 * 86400;   // 已下載
  BG.list[3].exp = now + 5 * 3600;    // 一天內
  BG.list.push({ id: '303063890126418', name: '還早', type: 'image', bg: '#000000', text: '#FFFFFF', img: false, hasUrl: true, exp: now + 6 * 86400 + 600, err: '', show: true });
  BG.list.push({ id: '303063890126419', name: '過期了', type: 'image', bg: '#000000', text: '#FFFFFF', img: false, hasUrl: true, exp: now - 60, err: '', show: true });
  const { page } = await open({ width: 1280, height: 900 }, '#post');
  await login(page);
  await show(page, 'bgCard');
  await page.waitForSelector('#bgRows tr');
  const st = await page.$$eval('#bgRows tr td:nth-child(4)', (tds) => tds.map((td) => [td.textContent, td.className, (td.querySelector('.bg-sub') || {}).className || '']));
  assert.match(st[2][0], /^已下載原網址到期 \d+\/\d+ \d\d:\d\d$/);
  assert.match(st[3][0], /^待下載網址到期 .+（剩 [45] 小時），請盡快下載圖樣$/); assert.match(st[3][2], /bg-warn/);
  assert.match(st[4][0], /（剩 6 天）$/); assert.doesNotMatch(st[4][2], /bg-warn/);
  assert.deepEqual(st[5].slice(0, 2), ['網址已過期，請重新擷取匯入', 'bg-err']);
  assert.match(await page.textContent('#bgExp'), /^3 張未下載，最早 .+ 已過期（請重新擷取匯入）$/);
  if (SHOT) await page.locator('#bgCard').screenshot({ path: path.join(SHOT, 'admin-bg-exp.png') });
});

test('目前在線（系統管理者）＋名單「最後使用」欄；非系統管理者看不到在線卡片', async () => {
  resetStaff();
  const now = Date.now();
  STAFF[0].lastSeen = now - 2 * 60000;          // 在線
  STAFF[1].lastSeen = now - 3 * 3600000;        // 不在線
  STAFF[2].lastSeen = now - 60000;              // 停用：不算在線
  const { page } = await open({ width: 1280, height: 860 }, '#people/staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  await show(page, 'olCard'); assert.equal(await page.isVisible('#olCard'), true);
  assert.equal(await page.textContent('#olCount'), '1 人');
  assert.deepEqual(await page.$$eval('#olList .ol-item b', (e) => e.map((x) => x.textContent)), ['王小明']);
  assert.match(await page.textContent('#olList .ol-item small'), /^2 分鐘前$/);
  const heads = await page.$$eval('.sf-table thead th', (e) => e.map((x) => x.textContent));
  assert.ok(heads.includes('最後使用'));
  const col = heads.indexOf('最後使用') + 1;
  assert.equal(await page.textContent(`#sfRows tr:nth-child(1) td:nth-child(${col})`), '2 分鐘前');
  assert.match(await page.getAttribute(`#sfRows tr:nth-child(1) td:nth-child(${col})`, 'title'), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.match(await page.textContent(`#sfRows tr:nth-child(2) td:nth-child(${col})`), /^(今天 \d\d:\d\d|\d{1,2}\/\d{1,2} \d\d:\d\d)$/);
  // 刷新：重讀名單
  STAFF[1].lastSeen = Date.now() - 30000;
  await page.click('#olRefresh');
  await page.waitForFunction(() => document.getElementById('olCount').textContent === '2 人');
  // 非系統管理者（有授權名單卡片）：沒有在線卡片
  const { page: p2 } = await open({ width: 1280, height: 860 }, '#people/staff', { token: 'F2', me: { role: 'staff', roleName: '主管', name: '林', uid: 'A003', cards: ['staff'] } });
  await p2.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await p2.isVisible('#olCard'), false);
});

test('表格欄寬：拖表頭右緣改寬、重新整理還在、雙擊恢復；方向鍵可調；手機沒有把手', async () => {
  resetStaff();
  const { page } = await open({ width: 1280, height: 860 }, '#people/staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  const th = '.sf-table thead th:nth-child(2)';
  const w0 = await page.$eval(th, (e) => e.getBoundingClientRect().width);
  const g = await page.$(th + ' .col-grip');
  await g.scrollIntoViewIfNeeded();   // 上方有「發送通知」卡片，表格可能在畫面外
  const b = await g.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  const w1 = await page.$eval(th, (e) => e.getBoundingClientRect().width);
  assert.ok(Math.abs(w1 - (w0 + 80)) <= 3, `拖了 80px：${w0} → ${w1}`);
  // 欄內輸入框跟著欄寬（不超出、不被裁）
  const fit = await page.$eval('#sfRows tr:first-child td:nth-child(2)', (td) => [td.getBoundingClientRect().width, td.querySelector('input').getBoundingClientRect().width]);
  assert.ok(fit[1] <= fit[0] && fit[1] >= fit[0] - 20, '姓名框跟著欄寬：' + fit);
  const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tbx.admin.colw.')));
  assert.deepEqual(saved, ['tbx.admin.colw.sfCard.0']);
  // 重新整理：欄寬還在
  await page.reload(); await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  assert.ok(Math.abs(await page.$eval(th, (e) => e.getBoundingClientRect().width) - w1) <= 2);
  // 方向鍵：+16
  await page.focus(th + ' .col-grip'); await page.keyboard.press('ArrowRight');
  assert.ok(Math.abs(await page.$eval(th, (e) => e.getBoundingClientRect().width) - (w1 + 16)) <= 2);
  // 雙擊恢復預設
  await page.dblclick(th + ' .col-grip');
  assert.ok(Math.abs(await page.$eval(th, (e) => e.getBoundingClientRect().width) - w0) <= 3);
  assert.equal(await page.evaluate(() => localStorage.getItem('tbx.admin.colw.sfCard.0')), null);
  // 其他表格也有把手（錯誤紀錄）
  assert.ok(await page.$$eval('.lg-table thead .col-grip', (e) => e.length) >= 5);
  // 手機：把手隱藏
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await page.isVisible(th + ' .col-grip'), false);
});

test('首頁儀表板：預設打開、需要處理（紅在前黃在後）、小卡、點了跳分類、重新整理帶 fresh；進階設定可選顯示項目', async () => {
  DASH.fresh = []; DASH.cfgSaved = null;
  const me = { ...SYS, cards: [...ALL_CARDS, 'dashcfg'], dash: DASH_ITEMS.map((x) => x.key) };
  const { page, calls } = await open({ width: 1280, height: 860 }, '', { token: 'F9', me });
  await page.waitForSelector('#dashGrid .dash-tile');
  assert.equal(await page.getAttribute('#tab-home', 'aria-selected'), 'true', '沒有網址分類時預設首頁');
  assert.equal((await page.$$eval('nav.side [role=tab]', (b) => b.filter((x) => !x.hidden).map((x) => x.dataset.tab)))[0], 'home');
  assert.deepEqual(await page.$$eval('#dashList li', (l) => l.map((x) => x.textContent)), ['未處理錯誤：2 則未處理使用紀錄', '臉書權杖：9 天後到期進階設定']);
  assert.equal(await page.isVisible('#dashAllOk'), false);
  assert.equal(await page.locator('#dashGrid .dash-tile').count(), 5);
  assert.match(await page.textContent('#dashAt'), /^資料時間 \d\d:\d\d$/);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'admin-dash-desktop.png'), fullPage: true });
  await page.click('#dashRefresh');
  await page.waitForFunction(() => !document.getElementById('dashRefresh').disabled);
  assert.deepEqual(DASH.fresh, [null, '1']);
  // 點需要處理的項目：跳到使用紀錄
  await page.click('#dashList li >> nth=0');
  assert.equal(await page.getAttribute('#tab-rec', 'aria-selected'), 'true');
  assert.equal(await page.isVisible('#lgCard'), true, '跳到錯誤紀錄那個功能');
  assert.equal(await page.isVisible('#auCard'), false);
  // 切回首頁不重查（內容保留）
  await page.click('#tab-home');
  assert.deepEqual(DASH.fresh, [null, '1']);
  // 進階設定：顯示項目
  await page.click('#tab-adv'); await show(page, 'dcCard');
  await page.waitForSelector('#dcList input');
  assert.deepEqual(await page.$$eval('#dcList input', (l) => l.map((c) => c.checked)), [true, true, true, false]);
  await page.check('#dcList input >> nth=3');
  await page.uncheck('#dcList input >> nth=0');
  await page.click('#dcSave');
  await page.waitForFunction(() => /已儲存/.test(document.getElementById('dcMsg').textContent));
  assert.deepEqual(DASH.cfgSaved, { items: ['fbtoken', 'logs', 'online'] });
  assert.ok(!calls.some((c) => typeof c === 'string'), '沒有頁面錯誤');
});

test('首頁儀表板：只有 dash 權限的員工只看到首頁；全部正常顯示綠字；手機 390px 不橫向捲動', async () => {
  const saved = DASH_ITEMS.splice(0, DASH_ITEMS.length, { key: 'rundown', name: 'Rundown 連線', level: 'ok', text: '已設定', tab: 'conn' });
  try {
    const me = { role: 'staff', roleName: '值班', unlocked: false, cards: [], dash: ['rundown'], name: '王小明', id: 'A001' };
    const { page } = await open({ width: 390, height: 800 }, '', { token: 'F8', me });
    await page.waitForSelector('#dashGrid .dash-tile');
    assert.deepEqual(await page.$$eval('nav.side [role=tab]', (b) => b.filter((x) => !x.hidden).map((x) => x.dataset.tab)), ['home']);
    assert.equal(await page.isVisible('#dashAllOk'), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, '頁面不能橫向捲動：' + overflow);
  } finally { DASH_ITEMS.splice(0, DASH_ITEMS.length, ...saved); }
  if (SHOT) {
    const me = { ...SYS, cards: [...ALL_CARDS, 'dashcfg'], dash: DASH_ITEMS.map((x) => x.key) };
    const { page } = await open({ width: 390, height: 800 }, '', { token: 'F7', me });
    await page.waitForSelector('#dashGrid .dash-tile');
    await page.screenshot({ path: path.join(SHOT, 'admin-dash-mobile.png'), fullPage: true });
  }
});

test('發送通知（系統管理者）：選收件方式、確認人數、送出 body 正確；已發送清單可展開已讀、撤回；非系統管理者看不到', async () => {
  resetStaff();
  MS.bodies = []; MS.items = [];
  const { page } = await open({ width: 1280, height: 900 }, '#people/staff');
  await login(page);
  await page.waitForSelector('#sfWrap:not([hidden])');
  await show(page, 'msCard'); assert.equal(await page.isVisible('#msCard'), true);
  // 單人下拉只列啟用中的人（林主管停用）
  assert.deepEqual(await page.$$eval('#msOne option', (o) => o.map((x) => x.value)), ['A001', 'A002']);
  assert.equal(await page.isVisible('#msOne'), true);
  assert.equal(await page.isVisible('#msMany'), false);
  // 空內容
  await page.click('#msSend');
  assert.match(await page.textContent('#msMsg'), /請輸入通知內容/);
  // 多人
  await page.selectOption('#msMode', 'many');
  assert.equal(await page.isVisible('#msMany'), true);
  await page.check('#msMany input[value=A001]');
  await page.check('#msMany input[value=A002]');
  await page.fill('#msBody', '下午三點開會');
  assert.equal(await page.textContent('#msCount'), '6／200 字');
  if (process.env.SHOT_DIR) await page.locator('#msCard').screenshot({ path: process.env.SHOT_DIR + '/msgs-admin.png' });
  await page.click('#msSend');
  assert.equal(await page.textContent('#msCfText'), '要發送給 2 人嗎？');
  await page.click('#msCfNo');
  assert.equal(MS.bodies.length, 0, '取消不送出');
  await page.click('#msSend');
  await page.click('#msCfYes');
  await page.waitForSelector('#msList .ms-item');
  assert.deepEqual(MS.bodies.pop(), { key: 'POST /admin/msgs', body: { mode: 'many', body: '下午三點開會', uids: ['A001', 'A002'] } });
  assert.equal(await page.inputValue('#msBody'), '');
  // 權限組、全部的人數
  await page.selectOption('#msMode', 'group');
  await page.selectOption('#msGroup', 'editor');
  await page.fill('#msBody', '編輯組請注意');
  await page.click('#msSend');
  assert.equal(await page.textContent('#msCfText'), '要發送給 1 人嗎？');
  await page.click('#msCfYes');
  await page.waitForFunction(() => document.querySelectorAll('#msList .ms-item').length === 2);
  assert.deepEqual(MS.bodies.pop(), { key: 'POST /admin/msgs', body: { mode: 'group', body: '編輯組請注意', group: 'editor' } });
  await page.selectOption('#msMode', 'all');
  await page.fill('#msBody', '全體');
  await page.click('#msSend');
  assert.equal(await page.textContent('#msCfText'), '要發送給 2 人嗎？', '全部＝啟用中員工');
  await page.click('#msCfNo');
  // 清單：展開已讀、撤回
  const item = page.locator('#msList .ms-item').nth(1);
  assert.match(await item.textContent(), /下午三點開會/);
  assert.equal(await item.locator('.ms-ops button').first().textContent(), '已讀 1／2');
  assert.equal(await item.locator('.ms-to').isVisible(), false);
  await item.locator('.ms-ops button').first().click();
  assert.deepEqual(await item.locator('.ms-to li').allTextContents().then((a) => a.map((t) => t.replace(/\s+/g, ' ').replace(/已讀 .*/, '已讀'))), ['王小明 已讀', '陳大華 未讀']);
  await item.locator('button.danger').click();
  await page.waitForFunction(() => document.querySelectorAll('#msList .ms-item.is-recalled').length === 1);
  assert.deepEqual(MS.bodies.pop(), { key: 'POST /admin/msgs/10/recall', id: 10 });
  // 非系統管理者看不到
  const { page: p2 } = await open({ width: 1280, height: 860 }, '#people/staff', { token: 'F2', me: { role: 'staff', roleName: '主管', name: '林', uid: 'A003', cards: ['staff'] } });
  await p2.waitForSelector('#sfWrap:not([hidden])');
  assert.equal(await p2.isVisible('#msCard'), false);
});

test('左側分類手風琴：目前分類展開、游標移上展開並往下推、離開左側收回；點功能只顯示該卡片、上方功能分頁、網址記功能；手機不展開', async () => {
  const { page } = await open({ width: 1280, height: 860 }, '#post/video');
  await login(page);
  // 網址帶功能：直接打開影片設定，同分類其他卡片隱藏
  assert.equal(await page.isVisible('#vsCard'), true);
  assert.equal(await page.isVisible('#pgCard'), false);
  assert.equal(await page.getAttribute('#sub-post-video', 'aria-selected'), 'true');
  assert.deepEqual(await page.$$eval('#subs-post button', (b) => b.filter((x) => !x.hidden).map((x) => x.textContent)), ['粉專設定', '活動留言', '文字背景', '影片設定']);
  // 目前分類一直展開，標出目前功能
  assert.equal(await page.isVisible('#side-post'), true);
  assert.equal(await page.getAttribute('#side-post-video', 'aria-current'), 'true');
  assert.equal(await page.isVisible('#side-rec'), false);
  // 游標移到「使用紀錄」：在下方展開，把「進階設定」往下推
  const advY = (await page.locator('#tab-adv').boundingBox()).y;
  await page.hover('#tab-rec');
  await page.waitForSelector('#side-rec:not([hidden])');
  assert.deepEqual(await page.$$eval('#side-rec button', (b) => b.map((x) => x.textContent)), ['操作紀錄', '錯誤紀錄']);
  assert.ok((await page.locator('#tab-adv').boundingBox()).y > advY + 40, '往下推');
  // 游標往上移到別的分類：已展開的不收（游標底下不會換掉）
  const recY = (await page.locator('#tab-rec').boundingBox()).y;
  await page.hover('#tab-conn'); await page.waitForSelector('#side-conn:not([hidden])');
  assert.equal(await page.isVisible('#side-rec'), true);
  assert.equal((await page.locator('#tab-conn').boundingBox()).y < recY, true);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'admin-subnav-fly.png') });
  await page.click('#side-rec-logs');
  assert.equal(await page.isVisible('#lgCard'), true);
  assert.equal(await page.isVisible('#auCard'), false);
  assert.ok(page.url().endsWith('#rec/logs'));
  // 離開左側：收回，只剩目前分類展開
  await page.mouse.move(900, 600);
  await page.waitForSelector('#side-conn', { state: 'hidden' });
  assert.equal(await page.isVisible('#side-rec'), true);
  assert.equal(await page.isVisible('#side-post'), false);
  assert.equal(await page.getAttribute('#side-rec-logs', 'aria-current'), 'true');
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'admin-subnav-one.png') });
  // 上方功能分頁切換，左側跟著標
  await page.click('#sub-rec-audit');
  assert.equal(await page.isVisible('#auCard'), true);
  assert.equal(await page.isVisible('#lgCard'), false);
  assert.ok(page.url().endsWith('#rec/audit'));
  assert.equal(await page.getAttribute('#side-rec-audit', 'aria-current'), 'true');
  // 填到一半切走再回來，內容還在
  await page.fill('#auUid', '填到一半');
  await page.click('#sub-rec-logs'); await page.click('#sub-rec-audit');
  assert.equal(await page.inputValue('#auUid'), '填到一半');
  // 素材設定不拆：沒有子功能
  assert.equal(await page.$('#side-assets'), null);
  // 鍵盤：Esc 收起並回到分類
  await page.hover('#tab-guard'); await page.waitForSelector('#side-guard:not([hidden])');
  await page.focus('#side-guard button'); await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#side-guard'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-guard');
  // 舊網址只寫分類：開第一個功能
  await page.evaluate(() => { location.hash = '#guard'; });
  await page.waitForFunction(() => location.hash === '#guard/set');
  assert.equal(await page.isVisible('#gdCard'), true);
  assert.equal(await page.isVisible('#gdLogCard'), false);
  // 手機：左側不展開，功能分頁在
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await page.isVisible('#side-guard'), false);
  assert.equal(await page.isVisible('#subs-guard'), true);
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'admin-subnav-phone.png') });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, '橫向捲動 ' + over);
});

test('文字背景「列入隨機」：勾選欄與快捷鈕、摘要只算顯示中且已下載', async () => {
  bgReset();
  const { page } = await open({ width: 1280, height: 900 }, '#post');
  await login(page);
  await show(page, 'bgCard');
  await page.waitForSelector('#bgRows tr');
  assert.deepEqual(await page.$$eval('#bgRows tr td:nth-child(6) input', (l) => l.map((c) => c.checked)), [true, true, false, false]);
  assert.match(await page.textContent('#bgRndSum'), /從 2 個背景隨機/);
  await page.click('#bgRnd [data-rnd=image]');
  await page.waitForFunction(() => /已列入隨機 2 個/.test(document.getElementById('bgMsg').textContent));
  assert.deepEqual(BG.posts.at(-1), { ids: ['303063890126415', '303063890126416'], rnd: true });
  assert.match(await page.textContent('#bgRndSum'), /從 3 個背景隨機/, '過期圖樣還沒下載不算');
  await page.uncheck('#bgRows tr:nth-child(1) td:nth-child(6) input');
  await page.waitForFunction(() => /從 2 個/.test(document.getElementById('bgRndSum').textContent));
  assert.deepEqual(BG.posts.at(-1), { rnd: false });
  if (SHOT) await page.locator('#bgCard').screenshot({ path: path.join(SHOT, 'admin-bg-random.png') });
  await page.click('#bgRnd [data-rnd=none]');
  await page.waitForFunction(() => /都沒有＝預設「無」/.test(document.getElementById('bgRndSum').textContent));
});

test('進階設定「實驗功能」：第一則留言再編輯，對象全部人／指定員工；活動留言卡片沒有這個開關', async () => {
  CO.edit = false; CO.who = 'all'; CO.staff = []; CO.posts = [];
  const { page } = await open({ width: 1280, height: 900 }, '#post');
  await login(page);
  assert.equal(await page.$('#psCard #labOn'), null);
  await page.click('#tab-adv'); await show(page, 'labCard');
  await page.waitForFunction(() => !document.getElementById('labSave').disabled);
  assert.equal(await page.isChecked('#labOn'), false);
  assert.equal(await page.isDisabled('input[name=labWho][value=some]'), true, '沒啟用時對象灰掉');
  await page.check('#labOn');
  await page.check('input[name=labWho][value=some]');
  assert.equal(await page.isVisible('#labPeople'), true);
  assert.match(await page.textContent('#labPeople'), /王小明（A001）/);
  assert.match(await page.textContent('#labPeople'), /李小華（A002）・已停用/);
  await page.click('#labSave');
  await page.waitForFunction(() => /至少勾一位/.test(document.getElementById('labMsg').textContent));
  await page.check('#labPeople input[value=A001]');
  if (SHOT) await page.locator('#labCard').screenshot({ path: path.join(SHOT, 'admin-labs.png') });
  await page.click('#labSave');
  await page.waitForFunction(() => /已啟用：指定 1 位員工/.test(document.getElementById('labMsg').textContent));
  assert.deepEqual(CO.posts.at(-1), { edit: true, who: 'some', staff: ['A001'] });
  await page.check('input[name=labWho][value=all]');
  assert.equal(await page.isVisible('#labPeople'), false);
  await page.click('#labSave');
  await page.waitForFunction(() => /已啟用：全部人/.test(document.getElementById('labMsg').textContent));
  assert.deepEqual(CO.posts.at(-1), { edit: true, who: 'all', staff: [] });
});

test('進階設定「實驗功能」：影片串流上傳（獨立開關、指定員工），不影響留言那一項', async () => {
  CO.edit = false; CO.who = 'all'; CO.staff = []; CO.posts = [];
  VO.stream = false; VO.who = 'all'; VO.staff = []; VO.posts = [];
  const { page } = await open({ width: 1280, height: 900 }, '#post');
  await login(page);
  await page.click('#tab-adv'); await show(page, 'labCard');
  await page.waitForFunction(() => !document.getElementById('labVSave').disabled && !document.getElementById('labSave').disabled);
  assert.equal(await page.isChecked('#labVOn'), false);
  assert.equal(await page.isDisabled('input[name=labVWho][value=some]'), true);
  await page.check('#labVOn');
  await page.check('input[name=labVWho][value=some]');
  assert.equal(await page.isVisible('#labVPeople'), true);
  assert.equal(await page.isVisible('#labPeople'), false, '另一項不受影響');
  await page.check('#labVPeople input[value=A001]');
  await page.click('#labVSave');
  await page.waitForFunction(() => /已啟用：指定 1 位員工/.test(document.getElementById('labVMsg').textContent));
  assert.deepEqual(VO.posts.at(-1), { who: 'some', staff: ['A001'], stream: true });
  assert.equal(CO.posts.length, 0);
  if (SHOT) await page.locator('#labCard').screenshot({ path: path.join(SHOT, 'admin-labs-video.png') });
});

test('進階設定「未登入時隱藏的工具」：讀取預設勾選、改了儲存送 on＋hide', async () => {
  TV.on = false; TV.hide = ['fbpost', 'fbvideo', 'fbreports']; TV.posts = [];
  const { page } = await open({ width: 1280, height: 900 }, '#adv');
  await login(page);
  await page.click('#tab-adv'); await show(page, 'tvCard');
  await page.waitForFunction(() => !document.getElementById('tvSave').disabled);
  assert.equal(await page.isChecked('#tvOn'), false);
  assert.equal(await page.isChecked('#tvList input[value=fbpost]'), true);
  assert.equal(await page.isChecked('#tvList input[value=livereq]'), false);
  await page.check('#tvOn');
  await page.uncheck('#tvList input[value=fbreports]');
  await page.check('#tvList input[value=livereq]');
  if (SHOT) await page.locator('#tvCard').screenshot({ path: path.join(SHOT, 'admin-toolvis.png') });
  await page.click('#tvSave');
  await page.waitForFunction(() => /已儲存/.test(document.getElementById('tvMsg').textContent));
  const b = TV.posts.at(-1);
  assert.equal(b.on, true);
  assert.deepEqual(b.hide.slice().sort(), ['fbpost', 'fbvideo', 'livereq']);
});

test('進階設定「實驗功能」：第一則留言移除連結預覽（方法 A／B、指定員工）', async () => {
  HO.on = false; HO.who = 'all'; HO.staff = []; HO.method = 'a'; HO.posts = [];
  const { page } = await open({ width: 1280, height: 900 }, '#adv');
  await login(page);
  await page.click('#tab-adv'); await show(page, 'labCard');
  await page.waitForFunction(() => !document.getElementById('labPSave').disabled);
  assert.equal(await page.isChecked('#labPOn'), false);
  assert.equal(await page.isChecked('input[name=labPMethod][value=a]'), true, '預設 A');
  assert.equal(await page.isDisabled('input[name=labPMethod][value=b]'), true, '沒啟用時方法灰掉');
  await page.check('#labPOn');
  await page.check('input[name=labPMethod][value=b]');
  await page.check('input[name=labPWho][value=some]');
  await page.check('#labPPeople input[value=A001]');
  if (SHOT) await page.locator('#labCard').screenshot({ path: path.join(SHOT, 'admin-labs-np.png') });
  await page.click('#labPSave');
  await page.waitForFunction(() => /已啟用：指定 1 位員工/.test(document.getElementById('labPMsg').textContent));
  assert.deepEqual(HO.posts.at(-1), { on: true, who: 'some', staff: ['A001'], method: 'b' });
  assert.equal(await page.isChecked('input[name=labPMethod][value=b]'), true, '存檔後回填');
});

test('進階設定「自行註冊」：讀取（預設開放、全部工具）、取消一個工具並關閉後儲存；授權名單標示自行註冊、權限組顯示未指派', async () => {
  SR.on = true; SR.tools = SR_OPTIONS.map((o) => o.id); SR.posts = [];
  resetStaff();
  STAFF.push({ id: 'R77', name: '林新人', group: 0, self: true, enabled: true, created: 1, lastLogin: null, pw: 'set' });
  const { page } = await open({ width: 1280, height: 900 }, '#adv');
  await login(page);
  await page.click('#tab-adv'); await show(page, 'srCard');
  await page.waitForFunction(() => !document.getElementById('srSave').disabled);
  assert.equal(await page.isChecked('#srOn'), true);
  assert.deepEqual(await page.$$eval('#srList input', (a) => a.map((c) => [c.value, c.checked])), SR_OPTIONS.map((o) => [o.id, true]));
  assert.equal(await page.locator('#srList input[value=fbpost]').count(), 0, '不列臉書工具');
  await page.uncheck('#srList input[value=linepush]');
  await page.uncheck('#srOn');
  if (SHOT) await page.locator('#srCard').screenshot({ path: path.join(SHOT, 'admin-selfreg.png') });
  await page.click('#srSave');
  await page.waitForFunction(() => /已儲存/.test(document.getElementById('srMsg').textContent));
  assert.deepEqual(SR.posts.at(-1), { on: false, tools: ['pattern', 'watermark', 'design'] });
  await page.click('#tab-people'); await show(page, 'sfCard');
  await page.waitForSelector('#sfRows tr');
  const row = page.locator('#sfRows tr', { hasText: 'R77' });
  assert.equal(await row.locator('.tag.warn', { hasText: '自行註冊' }).count(), 1);
  const sel = row.locator('select');
  assert.equal(await sel.evaluate((s) => s.options[s.selectedIndex].textContent), '（未指派）');
  await sel.selectOption('viewer');
  await page.waitForFunction(() => /已更新「林新人」的權限組/.test(document.getElementById('sfMsg').textContent));
  assert.deepEqual(SF.bodies.at(-1), { key: 'POST /admin/staff/R77', body: { group: 'viewer' } });
});

test('錯誤紀錄：每筆「複製」按鈕複製完整錯誤文字（時間、粉專、貼文、連結、錯誤說明、臉書原文）', async () => {
  const keep = DATA['GET /admin/logs'];
  DATA['GET /admin/logs'] = [{ id: 7, at: Date.UTC(2026, 10, 26, 8, 21), tool: 'fbpost', code: 'comment_failed:100', page: '220050085932', pageName: '新聞', page_name: 'TVBS 新聞', post: '220050085932_1368607782354030', title: '評鑑竟全合格？', ptype: 'template', pub_at: Math.floor(Date.UTC(2026, 10, 26, 8, 20) / 1000), detail: '留言：找不到這個物件（臉書碼 100-33）\n臉書原文：Unsupported post request.', st: 'open' }];
  try {
    const { page } = await open({ width: 1280, height: 860 }, '#rec/logs');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url });
    await login(page);
    await page.click('#sub-rec-logs');
    await page.click('#logBtn');
    await page.waitForSelector('#logRows .lg-copy');
    await page.click('#logRows .lg-copy');
    await page.waitForFunction(() => document.querySelector('#logRows .lg-copy').textContent === '已複製');
    const t = await page.evaluate(() => navigator.clipboard.readText());
    for (const re of [/^時間：/, /工具：排程發布/, /粉專：新聞（TVBS 新聞）／ID 220050085932/, /貼文：評鑑竟全合格？（套版・發布 /, /連結：https:\/\/www\.facebook\.com\/220050085932\/posts\/1368607782354030/, /錯誤：留言失敗（臉書碼 100）\n留言：找不到這個物件（臉書碼 100-33）/, /臉書原文：Unsupported post request\./]) assert.match(t, re);
    await page.context().close();
  } finally { DATA['GET /admin/logs'] = keep; }
});
