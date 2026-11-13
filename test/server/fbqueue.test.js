const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const TOKEN_A = 'EAAPageTokenAAAAAAAAAAAAAAAAAAAAAAAA111';
const TOKEN_B = 'EAAPageTokenBBBBBBBBBBBBBBBBBBBBBBBB222';
const PAGES = { [TOKEN_A]: { id: '111', name: ' TVBS 新聞 ' }, [TOKEN_B]: { id: '222', name: '隨便粉專' } };
let worker, tokenMod, fbMod, qMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const loadToken = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const Q = async () => (qMod = qMod || (await import('../../server/core/fbqueue.js')));
const nowSec = () => Math.floor(Date.now() / 1000);
const mk = (extra = {}) => mkEnv({ FB_TOKEN: `${TOKEN_A},${TOKEN_B}`, ...extra });

let calls, realFetch, routes;
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fbErr = (code, message, status = 400) => reply({ error: { code, message } }, status);
const body = (init) => (init && init.body instanceof FormData ? init.body : null);

test.beforeEach(async () => {
  fbMod = fbMod || (await import('../../server/core/fb.js'));
  fbMod._resetFbMemory();
  calls = []; routes = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    const u = new URL(url);
    const tok = u.searchParams.get('access_token') || (body(init) && body(init).get('access_token'));
    calls.push({ url, init, tok, path: u.pathname, q: u.searchParams, method: init.method || 'GET' });
    for (const [re, fn] of routes) if (re.test(u.pathname)) return fn(url, init, tok, u);
    if (u.pathname.endsWith('/me')) return PAGES[tok] ? reply({ ...PAGES[tok], followers_count: 5 }) : fbErr(190, 'bad ' + tok);
    return reply({ data: [] });
  };
});
test.afterEach(() => { globalThis.fetch = realFetch; });

async function call(path, init = {}, env) {
  const w = await load();
  return w.fetch(new Request('https://api.test' + path, { ...init, headers: { origin: ORIGIN, ...(init.headers || {}) } }), env, { waitUntil() {} });
}
async function auth(env, kind = 'company') {
  const { signToken } = await loadToken();
  return { authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, kind, nowSec() + 600)) };
}
async function api(env, method, path, b, kind) {
  const headers = { ...(await auth(env, kind)), ...(b !== undefined ? { 'content-type': 'application/json' } : {}) };
  const res = await call(path, { method, headers, body: b !== undefined ? JSON.stringify(b) : undefined }, env);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}
const rows = (env) => env.DB.raw.prepare('SELECT * FROM fb_comments ORDER BY id').all().map((r) => ({ ...r }));
async function enqueue(env, o = {}) {
  const q = await Q();
  const due = o.due ?? nowSec() - 5;
  return q.enqueueComment(env, { page: '111', post: '111_5', message: '留言內容', due, nextCheck: o.nextCheck ?? (due + 1) * 1000, ...o });
}
const states = (map) => (url, init, tok, u) => {
  const ids = (u.searchParams.get('ids') || '').split(',');
  const out = {};
  for (const id of ids) if (map[id]) out[id] = { id, ...map[id] };
  return reply(out);
};

// ---- 粉專對應 ----
test('pages：名稱比對預設（去空白、大小寫）、未比對到的排後面；D1 列優先', async () => {
  const env = mk();
  let r = await api(env, 'GET', '/fb/pages');
  assert.equal(r.res.status, 200);
  const [a, b] = r.body.data;
  assert.deepEqual([a.id, a.code, a.label, a.sort, a.utm], ['111', 'news', '新聞', 1, 'utm_source=facebook&utm_medium=fbarticlepic']);
  assert.deepEqual([b.id, b.code, b.label, b.utm, b.sort], ['222', '', '隨便粉專', '', 100]);
  env.DB.raw.prepare("INSERT INTO fb_page_map VALUES ('222','x','自訂','utm_a=1',0,1)").run();
  r = await api(env, 'GET', '/fb/pages');
  assert.deepEqual(r.body.data.map((p) => [p.id, p.label, p.utm, p.sort]), [['222', '自訂', 'utm_a=1', 0], ['111', '新聞', 'utm_source=facebook&utm_medium=fbarticlepic', 1]]);
});

test('pages：全形＋與半形＋都比對得到國際＋；D1 沒綁定時退回預設', async () => {
  PAGES[TOKEN_B] = { id: '222', name: 'TVBS國際＋' };
  try {
    const env = mk();
    delete env.DB;
    const r = await api(env, 'GET', '/fb/pages');
    assert.equal(r.res.status, 200);
    assert.equal(r.body.data.find((p) => p.id === '222').code, 'intl');
  } finally { PAGES[TOKEN_B] = { id: '222', name: '隨便粉專' }; }
});

test('admin pagemap：列出粉專、驗證、儲存', async () => {
  const env = mk();
  const g = await api(env, 'GET', '/admin/fb/pagemap', undefined, 'admin');
  assert.equal(g.res.status, 200);
  assert.deepEqual(g.body.data.items.map((i) => [i.id, i.name, i.code, i.saved]), [['111', ' TVBS 新聞 ', 'news', false], ['222', '隨便粉專', '', false]]);
  assert.equal((await api(env, 'GET', '/admin/fb/pagemap')).res.status, 401);
  const bad = (it) => api(env, 'POST', '/admin/fb/pagemap', { items: [{ id: '111', label: '新', utm: 'a=1', sort: 1, ...it }] }, 'admin');
  for (const it of [{ label: '' }, { label: 'x'.repeat(21) }, { utm: 'a b' }, { utm: 'a=<script>' }, { utm: 'a'.repeat(301) }, { sort: 1000 }, { sort: -1 }, { sort: 1.5 }, { id: 'abc' }]) {
    const r = await bad(it);
    assert.equal(r.res.status, 400, JSON.stringify(it));
  }
  assert.equal(rows(env).length, 0);
  const ok = await api(env, 'POST', '/admin/fb/pagemap', { items: [{ id: '111', label: '新聞2', utm: 'utm_source=Facebook&utm_medium=a-b_c.d~e%20+', sort: 7 }] }, 'admin');
  assert.equal(ok.res.status, 200);
  const row = env.DB.raw.prepare('SELECT * FROM fb_page_map').get();
  assert.deepEqual([row.page_id, row.code, row.label, row.sort], ['111', 'news', '新聞2', 7]);
  const g2 = await api(env, 'GET', '/admin/fb/pagemap', undefined, 'admin');
  assert.equal(g2.body.data.items.find((i) => i.id === '111').saved, true);
});

test('pagemap：接受 ? 與 ?& 開頭的 utm，儲存後可讀回', async () => {
  const env = mk();
  for (const prefix of ['?', '?&']) {
    const utm = prefix + 'utm_source=facebook&utm_medium=tvbsteatimenewspic';
    const result = await api(env, 'POST', '/admin/fb/pagemap', { items: [{ id: '111', label: '新聞', utm, sort: 1 }] }, 'admin');
    assert.equal(result.res.status, 200);
    const get = await api(env, 'GET', '/admin/fb/pagemap', undefined, 'admin');
    assert.equal(get.body.data.items.find((p) => p.id === '111').utm, utm);
  }
  const bad = await api(env, 'POST', '/admin/fb/pagemap', { items: [{ id: '111', label: '新聞', utm: 'utm_source=face?book', sort: 1 }] }, 'admin');
  assert.equal(bad.res.status, 400);
});

// ---- 發文時留言 ----
const post = (env, b) => api(env, 'POST', '/fb/post', b);

test('post：沒有 comment → status none；留言太長拒絕', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_5' })]);
  assert.deepEqual((await post(env, { page: '111', message: 'x' })).body.data.comment, { status: 'none' });
  assert.deepEqual((await post(env, { page: '111', message: 'x', comment: '   ' })).body.data.comment, { status: 'none' });
  const r = await post(env, { page: '111', message: 'x', comment: 'a'.repeat(8001) });
  assert.equal(r.res.status, 400);
});

test('post：立即發布＋留言成功 → done，留言照字面送到貼文 ID', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_5' })]);
  routes.push([/\/111_5\/comments$/, () => reply({ id: '111_5_99' })]);
  const r = await post(env, { page: '111', message: 'x', comment: ' 看更多\nhttps://a.tw/?utm=1 ' });
  assert.deepEqual(r.body.data.comment, { status: 'done', id: '111_5_99' });
  const c = calls.find((x) => x.path.endsWith('/comments'));
  assert.equal(c.init.body.get('message'), '看更多\nhttps://a.tw/?utm=1');
  assert.equal(rows(env).length, 0);
});

test('post：立即發布但留言失敗 → 發文仍成功，留言入列 due=現在', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_5' })]);
  routes.push([/\/111_5\/comments$/, () => fbErr(200, 'no permission ' + TOKEN_A)]);
  const r = await post(env, { page: '111', message: 'x', comment: 'hi' });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.data.id, '111_5');
  assert.deepEqual(r.body.data.comment, { status: 'queued' });
  assert.ok(!r.text.includes(TOKEN_A));
  const [row] = rows(env);
  assert.deepEqual([row.page_id, row.post_id, row.message, row.status, row.step], ['111', '111_5', 'hi', 'pending', 0]);
  assert.ok(Math.abs(row.due - nowSec()) <= 2);
  assert.ok(row.next_check <= Date.now());
});

test('post：排程發布 → 入列等發布（due＝排程時間，鬧鐘 due+1 秒）', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_6' })]);
  const at = nowSec() + 3600;
  const r = await post(env, { page: '111', message: 'x', scheduledAt: at, comment: 'hi' });
  assert.deepEqual(r.body.data.comment, { status: 'queued' });
  assert.ok(!calls.some((c) => c.path.endsWith('/comments')));
  const [row] = rows(env);
  assert.deepEqual([row.post_id, row.due, row.next_check, row.status], ['111_6', at, (at + 1) * 1000, 'pending']);
});

test('post：圖片貼文只有照片 ID → 用 page_story_id 換貼文 ID；換不到就記 photo_id', async () => {
  const env = mk();
  routes.push([/\/111\/photos$/, () => reply({ id: '900' })]);
  routes.push([/\/900$/, () => reply({ id: '900', page_story_id: '111_77' })]);
  const at = nowSec() + 3600;
  await post(env, { page: '111', message: 'x', imageUrl: 'https://e.com/a.jpg', scheduledAt: at, comment: 'hi' });
  assert.equal(rows(env)[0].post_id, '111_77');
  routes.length = 0;
  routes.push([/\/111\/photos$/, () => reply({ id: '901' })]);
  routes.push([/\/901$/, () => fbErr(100, 'nope')]);
  await post(env, { page: '111', message: 'x', imageUrl: 'https://e.com/a.jpg', scheduledAt: at, comment: 'hi' });
  const r2 = rows(env)[1];
  assert.deepEqual([r2.post_id, r2.photo_id], [null, '901']);
});

test('post：multipart 也收 comment', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_5' })]);
  routes.push([/\/111_5\/comments$/, () => reply({ id: 'c1' })]);
  const fd = new FormData();
  fd.append('page', '111'); fd.append('message', 'x'); fd.append('comment', '連結');
  const res = await call('/fb/post', { method: 'POST', headers: await auth(env), body: fd }, env);
  assert.deepEqual((await res.json()).data.comment, { status: 'done', id: 'c1' });
});

// ---- processDue ----
test('processDue：已發布 → 留言成功 done', async () => {
  const env = mk(); const q = await Q();
  await enqueue(env);
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: true } })]);
  routes.push([/\/111_5\/comments$/, () => reply({ id: 'cm1' })]);
  await q.processDue(env, Date.now());
  const [r] = rows(env);
  assert.deepEqual([r.status, r.comment_id, r.error], ['done', 'cm1', null]);
  assert.equal(calls.filter((c) => c.path === '/v26.0/').length, 1);
});

test('processDue：兩個處理者同時跑同一筆只留言一次（搶租約）', async () => {
  const env = mk(); const q = await Q();
  await enqueue(env);
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: true } })]);
  routes.push([/\/111_5\/comments$/, () => reply({ id: 'cm1' })]);
  await Promise.all([q.processDue(env, Date.now()), q.processDue(env, Date.now())]);
  assert.equal(calls.filter((c) => c.path === '/111_5/comments' || /\/111_5\/comments$/.test(c.path)).length, 1);
  assert.equal(rows(env)[0].status, 'done');
});

test('processDue：同粉專多篇合併成一次 ids 查詢；不同粉專各一次', async () => {
  const env = mk(); const q = await Q();
  await enqueue(env, { post: '111_1' }); await enqueue(env, { post: '111_2' }); await enqueue(env, { page: '222', post: '222_1' });
  routes.push([/\/v26\.0\/$/, states({ '111_1': { is_published: false }, '111_2': { is_published: false }, '222_1': { is_published: false } })]);
  await q.processDue(env, Date.now());
  const idCalls = calls.filter((c) => c.path === '/v26.0/');
  assert.equal(idCalls.length, 2);
  assert.deepEqual(idCalls.map((c) => c.q.get('ids')).sort(), ['111_1,111_2', '222_1']);
  assert.deepEqual(idCalls.map((c) => c.tok).sort(), [TOKEN_A, TOKEN_B].sort());
});

test('processDue：還沒到時間的不處理；未發布就排下一個檢查點（第 3 秒）', async () => {
  const env = mk(); const q = await Q();
  const due = nowSec() - 1;
  await enqueue(env, { due, nextCheck: Date.now() + 60000 });
  await q.processDue(env, Date.now());
  assert.equal(calls.length, 0);
  env.DB.raw.prepare('UPDATE fb_comments SET next_check=?').run(Date.now() - 1);
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: false, scheduled_publish_time: due } })]);
  await q.processDue(env, Date.now());
  const [r] = rows(env);
  assert.deepEqual([r.status, r.step, r.next_check], ['pending', 1, due * 1000 + 3000]);
});

test('processDue：後台改晚了 → 重設 due，不算失敗；改早也一樣', async () => {
  const env = mk(); const q = await Q();
  const due = nowSec() - 2;
  await enqueue(env, { due });
  const later = nowSec() + 7200;
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: false, scheduled_publish_time: later } })]);
  await q.processDue(env, Date.now());
  let [r] = rows(env);
  assert.deepEqual([r.status, r.due, r.step, r.next_check, r.error], ['pending', later, 0, (later + 1) * 1000, null]);
  routes.length = 0;
  const earlier = nowSec() + 600;
  env.DB.raw.prepare('UPDATE fb_comments SET next_check=?').run(Date.now());
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: false, scheduled_publish_time: earlier } })]);
  await q.processDue(env, Date.now());
  [r] = rows(env);
  assert.deepEqual([r.due, r.next_check], [earlier, (earlier + 1) * 1000]);
});

test('processDue：貼文被刪（ids 缺該 id）→ canceled 貼文已刪除；錯誤碼 100 也一樣', async () => {
  const env = mk(); const q = await Q();
  await enqueue(env, { post: '111_1' });
  routes.push([/\/v26\.0\/$/, states({})]);
  await q.processDue(env, Date.now());
  assert.deepEqual([rows(env)[0].status, rows(env)[0].error], ['canceled', '貼文已刪除']);
  // 批次遇到不存在的 ID 整批回 100 → 逐篇問
  routes.length = 0;
  await enqueue(env, { post: '111_2' }); await enqueue(env, { post: '111_3' });
  routes.push([/\/v26\.0\/$/, () => fbErr(100, 'Object does not exist')]);
  routes.push([/\/111_2$/, () => reply({ id: '111_2', is_published: false, scheduled_publish_time: nowSec() - 5 })]);
  routes.push([/\/111_3$/, () => fbErr(100, 'Unsupported get request')]);
  await q.processDue(env, Date.now());
  const rs = rows(env);
  assert.equal(rs[1].status, 'pending');
  assert.deepEqual([rs[2].status, rs[2].error], ['canceled', '貼文已刪除']);
});

test('processDue：超過 due+180 秒仍未發布 → failed（3 分鐘內沒偵測到貼文發布）', async () => {
  const env = mk(); const q = await Q();
  const due = nowSec() - 200;
  await enqueue(env, { due, nextCheck: 1 });
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: false, scheduled_publish_time: due } })]);
  await q.processDue(env, Date.now());
  const [r] = rows(env);
  assert.deepEqual([r.status, r.error], ['failed', '3 分鐘內沒偵測到貼文發布']);
});

test('processDue：留言失敗 → 先排下一次；超過 3 分鐘 failed 並寫「留言失敗：」，訊息不含 token', async () => {
  const env = mk(); const q = await Q();
  const due = nowSec() - 5;
  await enqueue(env, { due });
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: true } })]);
  routes.push([/\/111_5\/comments$/, () => fbErr(200, 'denied ' + TOKEN_A)]);
  await q.processDue(env, Date.now());
  let [r] = rows(env);
  assert.equal(r.status, 'pending');
  assert.match(r.error, /denied/);
  assert.ok(!r.error.includes(TOKEN_A));
  env.DB.raw.prepare('UPDATE fb_comments SET due=?, next_check=1').run(nowSec() - 300);
  await q.processDue(env, Date.now());
  [r] = rows(env);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /^留言失敗：/);
  assert.ok(!r.error.includes(TOKEN_A));
});

test('processDue：只有照片 ID → 先換貼文 ID 再處理', async () => {
  const env = mk(); const q = await Q();
  await enqueue(env, { post: null, photo: '900' });
  routes.push([/\/900$/, () => reply({ id: '900', page_story_id: '111_77' })]);
  routes.push([/\/v26\.0\/$/, states({ '111_77': { is_published: true } })]);
  routes.push([/\/111_77\/comments$/, () => reply({ id: 'cm' })]);
  await q.processDue(env, Date.now());
  const [r] = rows(env);
  assert.deepEqual([r.status, r.post_id], ['done', '111_77']);
});

// ---- syncScheduled ----
test('syncScheduled：時間被改 → 更新 due；只查有待留言的粉專', async () => {
  const env = mk(); const q = await Q();
  const at = nowSec() + 3600, newAt = at + 1800;
  await enqueue(env, { due: at });
  routes.push([/\/111\/scheduled_posts$/, () => reply({ data: [{ id: '111_5', scheduled_publish_time: newAt }] })]);
  await q.syncScheduled(env, Date.now());
  const [r] = rows(env);
  assert.deepEqual([r.due, r.step, r.next_check], [newAt, 0, (newAt + 1) * 1000]);
  assert.equal(calls.filter((c) => c.path.endsWith('/scheduled_posts')).length, 1);
  assert.ok(!calls.some((c) => c.path.startsWith('/v26.0/222')));
});

test('syncScheduled：從清單消失且已發布 → 立刻留言；已刪除 → canceled', async () => {
  const env = mk(); const q = await Q();
  const at = nowSec() + 3600;
  await enqueue(env, { due: at, post: '111_5' });
  await enqueue(env, { due: at, post: '111_6' });
  routes.push([/\/111\/scheduled_posts$/, () => reply({ data: [] })]);
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: true, scheduled_publish_time: at } })]);
  routes.push([/\/111_5\/comments$/, () => reply({ id: 'cmx' })]);
  await q.syncScheduled(env, Date.now());
  const rs = rows(env);
  assert.equal(rs[0].status, 'done');
  assert.deepEqual([rs[1].status, rs[1].error], ['canceled', '貼文已刪除']);
});

test('syncScheduled：沒有待留言項目就不打 Graph；沒設 DO 也不報錯', async () => {
  const env = mk(); const q = await Q();
  await q.syncScheduled(env, Date.now());
  assert.equal(calls.length, 0);
  await q.syncScheduled({ ...env, DB: undefined }, Date.now());
});

test('scheduled()：每日 cron 照舊清理，其他字串跑對時', async () => {
  const w = await load(); const env = mk();
  const at = nowSec() + 3600;
  await enqueue(env, { due: at });
  routes.push([/\/111\/scheduled_posts$/, () => reply({ data: [{ id: '111_5', scheduled_publish_time: at + 60 }] })]);
  env.DB.raw.prepare("INSERT INTO fb_comments (page_id, post_id, message, due, next_check, status, created, updated) VALUES ('1','1_1','m',1,1,'done',1,1)").run();
  let p; await w.scheduled({ cron: '17 19 * * *' }, env, { waitUntil: (x) => { p = x; } }); await p;
  assert.equal(calls.length, 0);
  assert.equal(rows(env).length, 1);   // 30 天前已結束的被清掉
  await w.scheduled({ cron: '* * * * *' }, env, { waitUntil: (x) => { p = x; } }); await p;
  assert.equal(rows(env)[0].due, at + 60);
});

// ---- 路由 ----
test('reschedule：改時間、更新佇列、稽核；已發布拒絕；時間範圍檢查', async () => {
  const env = mk();
  await enqueue(env, { post: '111_9', due: nowSec() + 4000 });
  const t = nowSec() + 7200;
  routes.push([/\/111_9$/, (u, init) => (init.method === 'POST' ? reply({ success: true }) : reply({ id: '111_9', is_published: false }))]);
  const r = await api(env, 'POST', '/fb/reschedule', { post: '111_9', time: t });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body.data, { post: '111_9', time: t });
  const pc = calls.find((c) => c.method === 'POST');
  assert.equal(pc.init.body.get('scheduled_publish_time'), String(t));
  assert.deepEqual([rows(env)[0].due, rows(env)[0].next_check], [t, (t + 1) * 1000]);
  assert.ok(env.DB.raw.prepare('SELECT code FROM logs').all().some((x) => x.code === 'post-rescheduled'));
  for (const time of [nowSec() + 60, nowSec() + 31 * 86400, 'abc']) assert.equal((await api(env, 'POST', '/fb/reschedule', { post: '111_9', time })).res.status, 400);
  assert.equal((await api(env, 'POST', '/fb/reschedule', { post: '../x', time: t })).res.status, 400);
  routes.length = 0;
  routes.push([/\/111_9$/, () => reply({ id: '111_9', is_published: true })]);
  const n = calls.length;
  const bad = await api(env, 'POST', '/fb/reschedule', { post: '111_9', time: t });
  assert.equal(bad.body.code, 'already_published');
  assert.ok(!calls.slice(n).some((c) => c.method === 'POST'));
});

test('cancel：連帶取消該貼文待留言', async () => {
  const env = mk();
  await enqueue(env, { post: '111_9' }); await enqueue(env, { post: '111_8' });
  routes.push([/\/111_9$/, (u, init) => (init.method === 'DELETE' ? reply({ success: true }) : reply({ id: '111_9', is_published: false }))]);
  assert.equal((await api(env, 'POST', '/fb/cancel', { post: '111_9' })).res.status, 200);
  assert.deepEqual(rows(env).map((r) => r.status), ['canceled', 'pending']);
});

test('scheduled：每篇帶 comment 狀態，沒有就是 null', async () => {
  const env = mk();
  await enqueue(env, { post: '111_9', message: '連結留言' });
  routes.push([/\/111\/scheduled_posts$/, () => reply({ data: [{ id: '111_9', message: 'a', scheduled_publish_time: 5 }, { id: '111_10', message: 'b', scheduled_publish_time: 6 }] })]);
  const r = await api(env, 'GET', '/fb/scheduled?page=111');
  assert.deepEqual(r.body.data.items[0].comment, { id: 1, status: 'pending', error: '', message: '連結留言' });
  assert.equal(r.body.data.items[1].comment, null);
});

test('comments 清單、retry、dismiss', async () => {
  const env = mk();
  const id1 = await enqueue(env, { post: '111_1' });
  const id2 = await enqueue(env, { post: '222_2', page: '222' });
  env.DB.raw.prepare("UPDATE fb_comments SET status='failed', error='留言失敗：x', due=?, updated=? WHERE id=?").run(nowSec() - 3600, Date.now(), id1);
  const old = Date.now() - 8 * 86400000;
  const id3 = await enqueue(env, { post: '111_3' });
  env.DB.raw.prepare("UPDATE fb_comments SET status='failed', updated=? WHERE id=?").run(old, id3);
  let r = await api(env, 'GET', '/fb/comments?status=failed');
  assert.deepEqual(r.body.data.items.map((i) => [i.id, i.page, i.post, i.status, i.error, i.dismissed]), [[id1, '111', '111_1', 'failed', '留言失敗：x', false]]);
  assert.equal((await api(env, 'GET', '/fb/comments?status=all')).body.data.items.length, 2);
  assert.deepEqual((await api(env, 'GET', '/fb/comments?status=pending&page=222')).body.data.items.map((i) => i.id), [id2]);
  assert.equal((await api(env, 'GET', '/fb/comments?status=zzz')).res.status, 400);
  // retry：只有 failed；due 太舊 → 重設為現在-1
  assert.equal((await api(env, 'POST', '/fb/comment/retry', { id: id2 })).res.status, 400);
  r = await api(env, 'POST', '/fb/comment/retry', { id: id1 });
  assert.deepEqual(r.body.data, { status: 'pending' });
  const row = rows(env).find((x) => x.id === id1);
  assert.deepEqual([row.status, row.step, row.error], ['pending', 0, null]);
  assert.ok(Math.abs(row.due - (nowSec() - 1)) <= 2);
  assert.ok(row.next_check <= Date.now());
  // dismiss
  r = await api(env, 'POST', '/fb/comment/dismiss', { id: id1 });
  assert.equal(r.res.status, 200);
  assert.equal(rows(env).find((x) => x.id === id1).dismissed, 1);
  assert.equal((await api(env, 'POST', '/fb/comment/dismiss', { id: 'x' })).res.status, 400);
});

test('新路由都需要公司憑證', async () => {
  const env = mk();
  for (const [m, p] of [['GET', '/fb/comments'], ['POST', '/fb/reschedule'], ['POST', '/fb/comment/retry'], ['POST', '/fb/comment/dismiss']]) {
    assert.equal((await call(p, { method: m }, env)).status, 401, p);
  }
});

// ---- 總管 ----
test('CommentHub：鬧鐘設在最早的待檢查時間；沒有待檢查就取消；alarm 會處理到期項目', async () => {
  const q = await Q(); const env = mk();
  const st = { alarm: null, storage: { setAlarm: async (t) => { st.alarm = t; }, deleteAlarm: async () => { st.alarm = null; } } };
  const hub = new q.CommentHub(st, env);
  await hub.fetch();
  assert.equal(st.alarm, null);
  const at = nowSec() + 3600;
  await enqueue(env, { due: at, post: '111_1' });
  await enqueue(env, { due: at - 1000, post: '111_2' });
  await hub.fetch();
  assert.equal(st.alarm, (at - 1000 + 1) * 1000);
  // 到期處理
  env.DB.raw.prepare('UPDATE fb_comments SET next_check=? WHERE post_id=?').run(Date.now() - 1, '111_2');
  routes.push([/\/v26\.0\/$/, states({ '111_2': { is_published: true } })]);
  routes.push([/\/111_2\/comments$/, () => reply({ id: 'k' })]);
  await hub.alarm();
  assert.equal(rows(env).find((r) => r.post_id === '111_2').status, 'done');
  assert.equal(st.alarm, (at + 1) * 1000);
});

test('kickHub：沒有 COMMENT_HUB 不報錯；有就呼叫 /kick；失敗吞掉', async () => {
  const q = await Q();
  await q.kickHub({});
  let hit = '';
  await q.kickHub({ COMMENT_HUB: { idFromName: (n) => n, get: () => ({ fetch: async (u) => { hit = u; return new Response('ok'); } }) } });
  assert.match(hit, /kick$/);
  await q.kickHub({ COMMENT_HUB: { idFromName: () => { throw new Error('x'); }, get: () => ({}) } });
});

test('cleanupComments：只刪 30 天前已結束的，待留言不動', async () => {
  const q = await Q(); const env = mk();
  const old = Date.now() - 40 * 86400000;
  const a = await enqueue(env, { post: '111_1' }); const b = await enqueue(env, { post: '111_2' });
  env.DB.raw.prepare("UPDATE fb_comments SET status='done', updated=? WHERE id=?").run(old, a);
  env.DB.raw.prepare('UPDATE fb_comments SET updated=? WHERE id=?').run(old, b);
  await q.cleanupComments(env, Date.now());
  assert.deepEqual(rows(env).map((r) => r.id), [b]);
});

// ---- 第 N 則留言（發布後延遲） ----
test('post：排程＋第 2、3 則 → 各入列，due＝排程時間＋延遲、seq 依序、第一則照舊', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_6' })]);
  const at = nowSec() + 3600;
  const r = await post(env, { page: '111', message: 'x', scheduledAt: at, comment: '第一則', extraComments: [{ message: ' 活動連結 https://a.tw ', delay: 5 }, { message: '第三則😀', delay: 30 }] });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body.data.comment, { status: 'queued' });
  assert.deepEqual(r.body.data.extras, [{ seq: 2, status: 'queued' }, { seq: 3, status: 'queued' }]);
  const rs = rows(env);
  assert.deepEqual(rs.map((x) => [x.seq, x.delay, x.due, x.next_check, x.message]), [
    [1, 0, at, (at + 1) * 1000, '第一則'],
    [2, 300, at + 300, (at + 301) * 1000, '活動連結 https://a.tw'],
    [3, 1800, at + 1800, (at + 1801) * 1000, '第三則😀']
  ]);
});

test('post：立即發布、沒有第一則，只有第 2 則 → 只入列第 2 則，從現在起算', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_5' })]);
  const r = await post(env, { page: '111', message: 'x', extraComments: JSON.stringify([{ message: 'later', delay: 10 }]) });
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body.data.comment, { status: 'none' });
  assert.ok(!calls.some((c) => c.path.endsWith('/comments')));
  const [row] = rows(env);
  assert.deepEqual([row.seq, row.delay, row.status], [2, 600, 'pending']);
  assert.ok(Math.abs(row.due - (nowSec() + 600)) <= 2);
});

test('post：第 N 則驗證（延遲範圍、則數上限、格式、太長；空白略過）', async () => {
  const env = mk();
  routes.push([/\/111\/feed$/, () => reply({ id: '111_5' })]);
  const bad = async (extraComments) => assert.equal((await post(env, { page: '111', message: 'x', extraComments })).res.status, 400, JSON.stringify(extraComments));
  await bad([{ message: 'a', delay: 4 }]);
  await bad([{ message: 'a', delay: 1441 }]);
  await bad([{ message: 'a', delay: 5.5 }]);
  await bad([{ message: 'a', delay: 5 }, { message: 'b', delay: 10 }, { message: 'c', delay: 15 }]);
  await bad([{ message: 'a'.repeat(8001), delay: 5 }]);
  await bad('not json');
  await bad({ message: 'a', delay: 5 });
  assert.equal(rows(env).length, 0);
  const ok = await post(env, { page: '111', message: 'x', extraComments: [{ message: '   ', delay: 99999 }, { message: 'a', delay: 1440 }] });
  assert.equal(ok.res.status, 200);
  assert.deepEqual(rows(env).map((x) => [x.seq, x.delay]), [[2, 86400]]);
});

test('reschedule：第 N 則跟著新發布時間移動（保留各自延遲）', async () => {
  const env = mk();
  const at = nowSec() + 4000;
  await enqueue(env, { post: '111_9', due: at });
  await enqueue(env, { post: '111_9', due: at + 300, seq: 2, delay: 300 });
  const t = nowSec() + 7200;
  routes.push([/\/111_9$/, (u, init) => (init.method === 'POST' ? reply({ success: true }) : reply({ id: '111_9', is_published: false }))]);
  assert.equal((await api(env, 'POST', '/fb/reschedule', { post: '111_9', time: t })).res.status, 200);
  assert.deepEqual(rows(env).map((x) => [x.seq, x.due, x.next_check]), [[1, t, (t + 1) * 1000], [2, t + 300, (t + 301) * 1000]]);
});

test('syncScheduled：後台改時間 → 第 N 則 due＝新時間＋延遲；沒改就不動', async () => {
  const env = mk(); const q = await Q();
  const at = nowSec() + 3600, newAt = at + 1800;
  await enqueue(env, { due: at + 600, seq: 2, delay: 600 });
  routes.push([/\/111\/scheduled_posts$/, () => reply({ data: [{ id: '111_5', scheduled_publish_time: at }] })]);
  await q.syncScheduled(env, Date.now());
  assert.equal(rows(env)[0].due, at + 600);
  routes.length = 0;
  routes.push([/\/111\/scheduled_posts$/, () => reply({ data: [{ id: '111_5', scheduled_publish_time: newAt }] })]);
  await q.syncScheduled(env, Date.now());
  assert.deepEqual([rows(env)[0].due, rows(env)[0].next_check], [newAt + 600, (newAt + 601) * 1000]);
});

test('syncScheduled：後台提早發布 → 有延遲的從現在起算延遲，不馬上留', async () => {
  const env = mk(); const q = await Q();
  const at = nowSec() + 3600, now = Date.now();
  await enqueue(env, { due: at + 300, seq: 2, delay: 300 });
  routes.push([/\/111\/scheduled_posts$/, () => reply({ data: [] })]);
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: true, scheduled_publish_time: at } })]);
  await q.syncScheduled(env, now);
  const [r] = rows(env);
  assert.equal(r.status, 'pending');
  assert.ok(Math.abs(r.due - (Math.floor(now / 1000) + 300)) <= 1);
  assert.ok(!calls.some((c) => c.path.endsWith('/comments')));
});

test('processDue：第 N 則到期且貼文已發布 → 留言成功；列表回 extras 與 seq', async () => {
  const env = mk(); const q = await Q();
  await enqueue(env, { due: nowSec() - 5, seq: 2, delay: 300, message: '第二則' });
  routes.push([/\/v26\.0\/$/, states({ '111_5': { is_published: true } })]);
  routes.push([/\/111_5\/comments$/, () => reply({ id: 'c2' })]);
  await q.processDue(env, Date.now());
  assert.deepEqual([rows(env)[0].status, rows(env)[0].comment_id], ['done', 'c2']);
  const ex = await q.extraCommentsForPosts(env, ['111_5']);
  assert.deepEqual(ex.get('111_5'), [{ id: 1, seq: 2, delay: 5, status: 'done', error: '', message: '第二則' }]);
  assert.equal((await q.commentsForPosts(env, ['111_5'])).size, 0);   // 第一則的狀態不被第 2 則蓋掉
  const l = await q.listComments(env, {});
  assert.deepEqual([l[0].seq, l[0].delay], [2, 5]);
});

test('舊資料表（沒有 seq／delay）會自動補欄位，舊資料視為第一則、延遲 0', async () => {
  const env = mk(); const q = await Q();
  env.DB.raw.exec('DROP TABLE fb_comments');   // 假 D1 照 schema.sql 建表，這裡換回舊版結構
  env.DB.raw.exec(`CREATE TABLE fb_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL, post_id TEXT, photo_id TEXT, message TEXT NOT NULL,
    due INTEGER NOT NULL, next_check INTEGER NOT NULL, step INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', error TEXT, comment_id TEXT,
    dismissed INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
  env.DB.raw.prepare("INSERT INTO fb_comments (page_id, post_id, message, due, next_check, created, updated) VALUES ('111','111_5','old',1,1,1,1)").run();
  await q.ensureTables(env);
  assert.deepEqual([rows(env)[0].seq, rows(env)[0].delay], [1, 0]);
});

test('前後端第 N 則留言常數一致', async () => {
  const q = await Q();
  const c = await import('../../tools/fbpost/comments.js');
  assert.deepEqual([c.MAX_COMMENTS, c.DELAY_MIN, c.DELAY_MAX], [q.MAX_COMMENTS, q.EXTRA_DELAY_MIN, q.EXTRA_DELAY_MAX]);
});
