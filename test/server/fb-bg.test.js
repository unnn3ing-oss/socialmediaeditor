const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
async function call(env, path, headers, body, method) {
  const w = await load();
  const m = method || (body === undefined ? 'GET' : 'POST');
  const r = await w.fetch(new Request('https://api.test' + path, { method: m, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
}
const auth = async (env, kind, adm) => { const { signToken } = await tok(); if (adm) env.SYS_STAFF_ID = 'SYS1'; return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600, false, adm ? 'SYS1' : '', adm ? 1 : 0)) }; };

const CDN = (n) => `https://scontent.xx.fbcdn.net/v/t39.10873-6/${n}.jpg?oh=abc&oe=1`;
const DATA = { presets: [
  { preset_id: '106018623298955', label: '純紫', type: 'solid', background_color: '#C600FF', text_color: '#FFFFFF' },
  { preset_id: '249307305544279', label: '紅→藍漸層', type: 'gradient', background_color: '#FF0047', text_color: '#FFFFFF', gradient_color: '#2C34C7', gradient_direction: 'BL_TR' },
  { preset_id: '303063890126415', fb_description: '黃橘粉圖樣', type: 'image', background_color: '#DC7A5A', text_color: '#FFFFFF', background_image_url: CDN(1) },
  { preset_id: '303063890126416', fb_description: '過期圖樣', type: 'image', background_color: '#000000', text_color: '#FFFFFF', background_image_url: CDN(2) },
  { preset_id: '303063890126417', fb_description: '沒網址', type: 'image', background_color: '#000000', text_color: '#FFFFFF' },
  { preset_id: 'x', type: 'solid', background_color: '#000000', text_color: '#FFFFFF' }
] };
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 9, 9]);

test('網址白名單：只收 https *.fbcdn.net', async () => {
  const { validImgUrl } = await import('../../server/fb/bgstore.js');
  assert.ok(validImgUrl(CDN(1)));
  for (const u of ['http://scontent.xx.fbcdn.net/a.jpg', 'https://fbcdn.net.evil.com/a.jpg', 'https://evilfbcdn.net/a.jpg', 'https://scontent.fbcdn.net:8443/a.jpg', 'https://u:p@scontent.fbcdn.net/a.jpg', 'https://example.com/a.jpg', 'nope', 42]) assert.equal(validImgUrl(u), false, String(u));
});

test('文字背景：沒匯入用內建清單；匯入預覽／套用；圖樣下載後才開放；讀圖要登入', async (t) => {
  const f = installFetch({
    [CDN(1).split('?')[0]]: () => new Response(JPG, { headers: { 'content-type': 'image/jpeg' } }),
    [CDN(2).split('?')[0]]: () => new Response('expired', { status: 403 })
  });
  t.after(f.restore);
  const env = mkEnv();
  const adm = await auth(env, 'admin');
  const staff = await auth(env, 'company', true);

  // 沒匯入：排程發布拿到內建 11 個，管理頁列表空白
  assert.equal((await call(env, '/fb/backgrounds', staff)).body.data.length, 11);
  assert.deepEqual((await call(env, '/admin/fb/backgrounds', adm)).body.data.list, []);

  // 預覽：不存
  const dry = await call(env, '/admin/fb/backgrounds', adm, { ...DATA, dry: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.deepEqual(dry.body.data, { add: 5, update: 0, gone: [], bad: 1, exp: null });
  assert.deepEqual((await call(env, '/admin/fb/backgrounds', adm)).body.data.list, []);

  // 套用
  const ap = await call(env, '/admin/fb/backgrounds', adm, DATA);
  assert.equal(ap.status, 200);
  assert.equal(ap.body.data.list.length, 5);
  assert.deepEqual(ap.body.data.list.map((x) => x.hasUrl), [false, false, true, true, false]);
  // 圖樣還沒下載：只有純色＋漸層
  let list = (await call(env, '/fb/backgrounds', staff)).body.data;
  assert.deepEqual(list.map((b) => b.id), ['106018623298955', '249307305544279']);

  // 下載：一張成功、一張過期失敗、沒網址的不算
  const since = Date.now();
  const fr = await call(env, '/admin/fb/backgrounds/fetch', adm, { since });
  assert.deepEqual(fr.body.data, { done: 1, failed: 1, left: 0 });
  assert.ok(env.FILES.store.has('fbbg/303063890126415'));
  const st = (await call(env, '/admin/fb/backgrounds', adm)).body.data.list;
  assert.equal(st.find((x) => x.id === '303063890126416').err, '網址已過期，請重新擷取');
  assert.equal(st.find((x) => x.id === '303063890126415').img, true);
  // 同一輪不再重試；下一輪（since 更新）會重試失敗的
  assert.equal(f.calls.length, 2);
  assert.deepEqual((await call(env, '/admin/fb/backgrounds/fetch', adm, { since })).body.data, { done: 0, failed: 0, left: 0 });
  assert.equal(f.calls.length, 2);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual((await call(env, '/admin/fb/backgrounds/fetch', adm, { since: Date.now() })).body.data, { done: 0, failed: 1, left: 0 });

  list = (await call(env, '/fb/backgrounds', staff)).body.data;
  const imgBg = list.find((b) => b.id === '303063890126415');
  assert.deepEqual(imgBg, { id: '303063890126415', name: '黃橘粉圖樣', type: 'image', css: '#DC7A5A', text: '#FFFFFF', img: '/fb/bg/303063890126415', rnd: false });
  assert.deepEqual(list.map((b) => b.type), ['solid', 'gradient', 'image']);

  // 讀圖：要登入
  const g = await call(env, '/fb/bg/303063890126415', staff);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get('content-type'), 'image/jpeg');
  assert.match(g.headers.get('cache-control'), /private/);
  assert.deepEqual([...g.body], [...JPG]);
  assert.equal((await call(env, '/fb/bg/303063890126415', {})).status, 401);
  assert.equal((await call(env, '/fb/bg/303063890126416', staff)).status, 404, '沒下載到');

  // 隱藏 → 排程發布不列、讀不到圖；改名
  await call(env, '/admin/fb/backgrounds/303063890126415', adm, { show: false, name: '黃橘' });
  assert.ok(!(await call(env, '/fb/backgrounds', staff)).body.data.some((b) => b.id === '303063890126415'));
  assert.equal((await call(env, '/fb/bg/303063890126415', staff)).status, 404);
  assert.equal((await call(env, '/admin/fb/backgrounds/303063890126415/img', adm)).status, 200, '管理頁隱藏的也看得到');
  assert.equal((await call(env, '/admin/fb/backgrounds/303063890126415/img', await auth(env, 'company', false))).status, 401);
  assert.equal((await call(env, '/admin/fb/backgrounds/303063890126415', adm, { name: '' })).status, 400);
  assert.equal((await call(env, '/admin/fb/backgrounds/999999999', adm, { show: true })).status, 404);

  // 再匯入只剩兩個：預覽列出臉書已沒有的；套用保留名稱／顯示；選刪除的連圖一起刪
  const two = { presets: [DATA.presets[2], DATA.presets[0]] };
  const d2 = (await call(env, '/admin/fb/backgrounds', adm, { ...two, dry: true })).body.data;
  assert.equal(d2.add, 0); assert.equal(d2.update, 2);
  assert.deepEqual(d2.gone.map((x) => x.id), ['249307305544279', '303063890126416', '303063890126417']);
  const a2 = (await call(env, '/admin/fb/backgrounds', adm, { ...two, remove: ['303063890126416', '303063890126417'] })).body.data.list;
  assert.deepEqual(a2.map((x) => x.id), ['303063890126415', '106018623298955', '249307305544279'], '這份的順序在前，沒刪的排後面');
  const kept = a2[0];
  assert.equal(kept.name, '黃橘'); assert.equal(kept.show, false); assert.equal(kept.img, true);

  // 刪除一個
  await call(env, '/admin/fb/backgrounds/303063890126415', adm, undefined, 'DELETE');
  assert.ok(!env.FILES.store.has('fbbg/303063890126415'));

  // 權限：一般公司憑證不能進管理；格式錯
  assert.equal((await call(env, '/admin/fb/backgrounds', await auth(env, 'company', false))).status, 401);
  assert.equal((await call(env, '/admin/fb/backgrounds', adm, { presets: [] })).status, 400);
  assert.equal((await call(env, '/admin/fb/backgrounds', adm, 'nope')).status, 400);
});

test('文字背景下載：非圖片、太大、轉址都拒絕；只抓白名單網址', async (t) => {
  const BIG = 2 * 1024 * 1024 + 1;
  const f = installFetch({
    [CDN(10).split('?')[0]]: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    [CDN(11).split('?')[0]]: () => new Response(JPG, { headers: { 'content-type': 'image/jpeg', 'content-length': String(BIG) } }),
    [CDN(12).split('?')[0]]: () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } })
  });
  t.after(f.restore);
  const env = mkEnv();
  const adm = await auth(env, 'admin');
  const p = (id, n) => ({ preset_id: id, type: 'image', background_color: '#000000', text_color: '#FFFFFF', background_image_url: CDN(n) });
  await call(env, '/admin/fb/backgrounds', adm, { presets: [p('1000010', 10), p('1000011', 11), p('1000012', 12), { ...p('1000013', 13), background_image_url: 'https://example.com/a.jpg' }] });
  const r = (await call(env, '/admin/fb/backgrounds/fetch', adm, { since: Date.now() })).body.data;
  assert.deepEqual(r, { done: 0, failed: 3, left: 0 });
  const list = (await call(env, '/admin/fb/backgrounds', adm)).body.data.list;
  assert.deepEqual(list.map((x) => x.err), ['不是圖片', '圖片太大', '臉書回應 302', '']);
  assert.equal(list[3].hasUrl, false, '不在白名單的網址不存');
  assert.ok(!f.calls.some((c) => c.path.includes('example')));
  assert.equal(env.FILES.store.size, 0);
});

test('文字背景下載：每次最多 10 張，left 回剩幾張', async (t) => {
  const f = installFetch({ '*': () => new Response(JPG, { headers: { 'content-type': 'image/jpeg' } }) });
  t.after(f.restore);
  const env = mkEnv();
  const adm = await auth(env, 'admin');
  const presets = Array.from({ length: 23 }, (_, i) => ({ preset_id: String(2000000 + i), type: 'image', background_color: '#000000', text_color: '#FFFFFF', background_image_url: CDN(100 + i) }));
  await call(env, '/admin/fb/backgrounds', adm, { presets });
  const since = Date.now();
  const seq = [];
  for (let k = 0; k < 5; k++) { const d = (await call(env, '/admin/fb/backgrounds/fetch', adm, { since })).body.data; seq.push([d.done, d.left]); if (!d.left) break; }
  assert.deepEqual(seq, [[10, 13], [10, 3], [3, 0]]);
  assert.equal(env.FILES.store.size, 23);
});

test('管理頁層級：文字背景卡片預設給管理者', async () => {
  const { DEFAULT_LEVELS, CARD_KEYS } = await import('../../server/core/levels.js');
  const { cardFor } = await import('../../server/core/adminperm.js');
  assert.ok(CARD_KEYS.includes('bg') && DEFAULT_LEVELS.mgr.includes('bg'));
  for (const p of ['/admin/fb/backgrounds', '/admin/fb/backgrounds/fetch', '/admin/fb/backgrounds/106018623298955', '/admin/fb/backgrounds/106018623298955/img']) assert.equal(cardFor(p), 'bg', p);
  assert.equal(cardFor('/admin/fb/backgrounds/abc'), null);
});

test('圖樣網址到期：從 oe=（16 進位秒）解析；沒有或格式不對回 null；列表與匯入預覽帶 exp', async () => {
  const { urlExpiry } = await import('../../server/fb/bgstore.js');
  assert.equal(urlExpiry('https://scontent.xx.fbcdn.net/v/a.jpg?oh=x&oe=6745A1B0'), 0x6745A1B0);
  assert.equal(urlExpiry('https://scontent.xx.fbcdn.net/v/a.jpg?oh=x'), null);
  assert.equal(urlExpiry('https://scontent.xx.fbcdn.net/v/a.jpg?oe=zzzzzzzz'), null);
  assert.equal(urlExpiry('https://scontent.xx.fbcdn.net/v/a.jpg?oe=1'), null);
  assert.equal(urlExpiry('not a url'), null);
  assert.equal(urlExpiry(null), null);
  const env = mkEnv();
  const adm = await auth(env, 'admin');
  const u = (oe) => `https://scontent.xx.fbcdn.net/v/t39/${oe}.jpg?oe=${oe}`;
  const presets = [
    { preset_id: '300000000000001', type: 'image', background_color: '#000000', text_color: '#FFFFFF', label: 'A', background_image_url: u('6745A1B0') },
    { preset_id: '300000000000002', type: 'image', background_color: '#000000', text_color: '#FFFFFF', label: 'B', background_image_url: u('6745A000') },
    { preset_id: '300000000000003', type: 'solid', background_color: '#FF0000', text_color: '#FFFFFF', label: 'C' }];
  assert.equal((await call(env, '/admin/fb/backgrounds', adm, { presets, dry: true })).body.data.exp, 0x6745A000, '預覽回最早到期');
  const list = (await call(env, '/admin/fb/backgrounds', adm, { presets })).body.data.list;
  assert.deepEqual(list.map((x) => x.exp), [0x6745A1B0, 0x6745A000, null]);
  assert.ok(list.every((x) => !('url' in x)), '不回傳網址');
});

test('列入隨機：預設純色／漸層列入、圖樣不列入；單筆與批次可改，排程發布清單跟著回 rnd', async (t) => {
  const f = installFetch({ [CDN(1).split('?')[0]]: () => new Response(JPG, { headers: { 'content-type': 'image/jpeg' } }) });
  t.after(f.restore);
  const env = mkEnv();
  const adm = await auth(env, 'admin');
  const staff = await auth(env, 'company', true);
  assert.ok((await call(env, '/fb/backgrounds', staff)).body.data.every((b) => b.rnd === true), '內建清單全部列入');
  await call(env, '/admin/fb/backgrounds', adm, { presets: DATA.presets.slice(0, 3) });
  const st = (await call(env, '/admin/fb/backgrounds', adm)).body.data.list;
  assert.deepEqual(st.map((x) => x.rnd), [true, true, false]);
  // 單筆：純色取消、圖樣列入
  await call(env, '/admin/fb/backgrounds/106018623298955', adm, { rnd: false });
  const l2 = (await call(env, '/admin/fb/backgrounds/303063890126415', adm, { rnd: true })).body.data.list;
  assert.deepEqual(l2.map((x) => x.rnd), [false, true, true]);
  await call(env, '/admin/fb/backgrounds/fetch', adm, { since: 0 });
  const pub = (await call(env, '/fb/backgrounds', staff)).body.data;
  assert.deepEqual(pub.map((b) => [b.id, b.rnd]), [['106018623298955', false], ['249307305544279', true], ['303063890126415', true]]);
  // 批次：全部取消；格式不對 400
  const l3 = (await call(env, '/admin/fb/backgrounds/random', adm, { ids: ['249307305544279', '303063890126415', 'bad'], rnd: false })).body.data.list;
  assert.ok(l3.every((x) => x.rnd === false));
  assert.equal((await call(env, '/admin/fb/backgrounds/random', adm, { ids: [], rnd: 'x' })).status, 400);
  assert.equal((await call(env, '/admin/fb/backgrounds/random', {}, { ids: [], rnd: true })).status, 401);
  // 匯入更新不會蓋掉隨機設定
  await call(env, '/admin/fb/backgrounds', adm, { presets: DATA.presets.slice(0, 3) });
  assert.ok((await call(env, '/admin/fb/backgrounds', adm)).body.data.list.every((x) => x.rnd === false));
});
