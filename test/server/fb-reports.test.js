// 數據報表 API（server/fb/reports.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkEnv } = require('../helpers/fake-env.js');
const { installFetch, gErr } = require('../helpers/fake-fb.js');

const ORIGIN = 'https://unnn3ing-oss.github.io';
const nowSec = () => Math.floor(Date.now() / 1000);
let worker, tokenMod, repMod;
const load = async () => (worker = worker || (await import('../../server/index.js')).default);
const tok = async () => (tokenMod = tokenMod || (await import('../../server/core/token.js')));
const rep = async () => (repMod = repMod || (await import('../../server/fb/reports.js')));
const ACCOUNTS = { data: [{ id: '111', name: '新聞', access_token: 'PT111' }, { id: '222', name: '少康', access_token: 'PT222' }] };
const taipeiToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() + 8 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
const iso = (sec) => new Date(sec * 1000).toISOString().replace('.000Z', '+0000');

async function setup(t, handlers, { uid = 'SYS1' } = {}) {
  const f = installFetch({ 'GET /me/accounts': () => ACCOUNTS, ...handlers }); t.after(f.restore);
  const env = mkEnv({ FB_USER_TOKEN: 'U' });
  env.SYS_STAFF_ID = 'SYS1';
  const { signToken } = await tok();
  const headers = { origin: ORIGIN, authorization: 'Bearer ' + (await signToken(env.SESSION_SECRET, 'company', nowSec() + 600, false, uid, 1)) };
  const w = await load();
  const call = async (path) => {
    const r = await w.fetch(new Request('https://api.test' + path, { headers }), env, { waitUntil() {} });
    return { status: r.status, headers: r.headers, body: await r.json() };
  };
  return { f, env, call };
}

const post = (id, sec, extra = {}) => ({
  id, created_time: iso(sec), message: '內文 ' + id, permalink_url: 'https://www.facebook.com/' + id,
  attachments: { data: [{ media_type: 'photo', type: 'photo' }] },
  reactions: { summary: { total_count: 10 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 }, ...extra
});
const ins = (views, clicks) => ({ data: [{ name: 'post_media_view', values: [{ value: views }] }, { name: 'post_clicks', values: [{ value: clicks }] }] });

test('分類：Reels＞影片＞圖片＞連結＞文字；多圖歸圖片；證據不足未分類', async () => {
  const { classify } = await rep();
  assert.equal(classify({ permalink_url: 'https://www.facebook.com/reel/1', attachments: { data: [{ media_type: 'video' }] } }), 'reels');
  assert.equal(classify({ attachments: { data: [{ media_type: 'video', type: 'video_inline' }] } }), 'video');
  assert.equal(classify({ attachments: { data: [{ media_type: 'album', type: 'album', subattachments: { data: [{ media_type: 'photo' }, { media_type: 'photo' }] } }] } }), 'image');
  assert.equal(classify({ message: 'x https://news', attachments: { data: [{ media_type: 'photo', type: 'photo' }] } }), 'image', '圖片加網址仍歸圖片');
  assert.equal(classify({ attachments: { data: [{ media_type: 'link', type: 'share' }] } }), 'link');
  assert.equal(classify({ message: '純文字' }), 'text');
  assert.equal(classify({ attachments: { data: [{ type: 'event' }] } }), 'other');
  assert.equal(classify({ attachments: { data: [{}] } }), 'unknown');
  assert.equal(classify({}), 'unknown');
});

test('期間：台北時間左閉右開、未來與超過 31 天拒絕', async () => {
  const { reportWindow, dayStart } = await rep();
  assert.equal(dayStart('2026-11-10'), Date.UTC(2026, 10, 9, 16) / 1000);
  assert.equal(dayStart('2026-02-30'), null);
  const asOf = Date.UTC(2026, 10, 20, 4) / 1000;   // 台北 11/20 12:00
  assert.deepEqual(reportWindow('2026-11-14', '2026-11-20', asOf), { since: dayStart('2026-11-14'), until: asOf });
  assert.deepEqual(reportWindow('2026-11-14', '2026-11-15', asOf), { since: dayStart('2026-11-14'), until: dayStart('2026-11-16') });
  assert.ok(reportWindow('2026-11-14', '2026-11-21', asOf).error);
  assert.ok(reportWindow('2026-10-01', '2026-11-01', asOf).error, '32 天');
  assert.ok(!reportWindow('2026-10-01', '2026-10-31', asOf).error, '31 天可以');
  assert.ok(reportWindow('2026-11-15', '2026-11-14', asOf).error);
});

test('成效：缺值區分；分享欄位不在＝0；心情缺總數時用分項', async () => {
  const { metricsOf } = await rep();
  const m = metricsOf({ reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } } }, ins(100, 7).data, '');
  assert.deepEqual({ ...m, missing: undefined }, { views: 100, reach: null, clicks: 7, reactions: 5, comments: 1, shares: 0, missing: undefined });
  assert.equal(m.missing.reach, 'unverified');
  const n = metricsOf({}, [{ name: 'post_reactions_by_type_total', values: [{ value: { like: 3, love: 2 } }] }], '');
  assert.equal(n.reactions, 5);
  assert.equal(n.comments, null); assert.equal(n.missing.comments, 'no_data');
  assert.equal(n.views, null); assert.equal(n.missing.views, 'no_data');
  const z = metricsOf({ reactions: { summary: { total_count: null } }, comments: { summary: { total_count: 0 } } }, [{ name: 'post_media_view', values: [{ value: null }] }], '');
  assert.equal(z.views, null, 'null 是未知不是 0'); assert.equal(z.reactions, null); assert.equal(z.comments, 0);
  const o = metricsOf({}, null, 'no_permission');
  assert.equal(o.missing.views, 'no_permission');
});

test('第一批：欄位展開一次拿清單＋成效；過濾日期與別的粉專；no-store；權杖不外流', async (t) => {
  const now = nowSec();
  const { f, call } = await setup(t, {
    'GET /111/published_posts': () => ({ data: [
      { ...post('111_1', now - 60), insights: ins(500, 20) },
      { ...post('999_1', now - 70), insights: ins(1, 1) },
      { ...post('111_2', now - 3 * 86400), insights: ins(300, 9) }
    ], paging: { cursors: { after: 'G1' }, next: 'https://graph/next?access_token=PT111' } })
  });
  const r = await call(`/fb/reports/posts?page=111&from=${daysAgo(1)}&to=${taipeiToday()}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const d = r.body.data;
  assert.deepEqual(d.items.map((x) => x.id), ['111_1'], '別的粉專、期間外都不收');
  assert.equal(d.next, null, '看到比起日早的貼文就停');
  const it = d.items[0];
  assert.equal(it.views, 500); assert.equal(it.clicks, 20); assert.equal(it.reactions, 10); assert.equal(it.type, 'image');
  assert.equal(it.url, 'https://www.facebook.com/111_1');
  assert.ok(d.asOf <= nowSec() && d.scope);
  const g = f.calls.filter((c) => c.path === '/111/published_posts');
  assert.equal(g.length, 1, '每批 1 次呼叫');
  assert.match(g[0].query.fields, /insights\.metric\(post_media_view,post_clicks/);
  assert.ok(g[0].query.since && g[0].query.until);
  assert.doesNotMatch(JSON.stringify(r.body), /PT111|graph\/next/, '不回權杖與完整 next 網址');
});

// 臉書替身：帶 since／until 時用時間翻頁（next 帶 until＋__paging_token）；若又混 after 就回 100 Invalid cursor（線上實際遇到）
const timePaged = (pages) => (c) => {
  if (c.query.after && (c.query.since || c.query.until)) return gErr(100, 400, 'Invalid cursor: ' + c.query.after);
  const i = c.query.__paging_token ? Number(c.query.__paging_token.slice(1)) : 0;
  const nx = i + 1 < pages.length ? 'https://graph.facebook.com/v27.0/111/published_posts?limit=5&until=' + (1000 + i) + '&__paging_token=T' + (i + 1) + '&access_token=PT111' : undefined;
  return { data: pages[i], paging: { cursors: { after: 'G' + i }, ...(nx ? { next: nx } : {}) } };
};

test('續頁：照 paging.next 的翻頁參數（不混 after）；竄改拒絕；快取命中不再打臉書；範圍變更回 report_scope', async (t) => {
  const now = nowSec();
  let n = 0;
  const pages = [[{ ...post('111_1', now - 60), insights: ins(1, 1) }], [{ ...post('111_2', now - 120), insights: ins(2, 2) }], [{ ...post('111_3', now - 180), insights: ins(3, 3) }]];
  const tp = timePaged(pages);
  const { f, env, call } = await setup(t, { 'GET /111/published_posts': (c) => { n++; return tp(c); } });
  const q = `/fb/reports/posts?page=111&from=${daysAgo(2)}&to=${taipeiToday()}`;
  const a = (await call(q)).body.data;
  assert.ok(a.next);
  assert.doesNotMatch(Buffer.from(a.next.split('.')[0], 'base64url').toString(), /PT111|access_token/, '游標不含權杖');
  const b = (await call('/fb/reports/posts?cursor=' + encodeURIComponent(a.next))).body;
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual(b.data.items.map((x) => x.id), ['111_2']);
  assert.equal(b.data.asOf, a.asOf, '同一輪共用 asOf');
  const c2 = f.calls.filter((c) => c.path === '/111/published_posts')[1].query;
  assert.equal(c2.__paging_token, 'T1'); assert.equal(c2.until, '1000');
  assert.equal(c2.after, undefined); assert.equal(c2.since, undefined);
  const c3 = (await call('/fb/reports/posts?cursor=' + encodeURIComponent(b.data.next))).body.data;
  assert.deepEqual(c3.items.map((x) => x.id), ['111_3']); assert.equal(c3.next, null);
  // 竄改游標
  const bad = a.next.slice(0, -2) + (a.next.endsWith('AA') ? 'BB' : 'AA');
  assert.equal((await call('/fb/reports/posts?cursor=' + encodeURIComponent(bad))).status, 400);
  // 快取：同條件重查不打臉書、沿用 asOf
  const before = n;
  const a2 = (await call(q)).body.data;
  assert.equal(n, before); assert.equal(a2.asOf, a.asOf); assert.equal(a2.cached, true);
  // 粉專改成不顯示 → 續頁回 report_scope
  env.DB.raw.prepare("INSERT INTO fb_pages (id, short, utm, rd, ord, show, updated) VALUES ('222', '少康', '', '', 0, 0, 1)").run();
  const r = await call('/fb/reports/posts?cursor=' + encodeURIComponent(a.next));
  assert.equal(r.status, 409); assert.equal(r.body.code, 'report_scope');
  assert.equal((await call(`/fb/reports/posts?page=222&from=${daysAgo(1)}&to=${taipeiToday()}`)).body.code, 'report_scope', '隱藏的粉專不能查');
});

test('翻頁參數：只取白名單、不含權杖；只有 cursors.after 時退回 after', async () => {
  const { pagingFrom, readPaging } = await rep();
  const qs = pagingFrom({ paging: { next: 'https://graph.facebook.com/v27.0/1/published_posts?access_token=SECRET&fields=x&limit=5&until=123&__paging_token=enc_AbC-1&since=100' } });
  assert.doesNotMatch(qs, /SECRET|fields|limit/);
  assert.deepEqual(readPaging(qs), { until: '123', __paging_token: 'enc_AbC-1', since: '100' });
  assert.deepEqual(readPaging(pagingFrom({ paging: { next: 'https://x/?access_token=S', cursors: { after: 'QVF-x' } } })), { after: 'QVF-x' });
  assert.equal(pagingFrom({ paging: { cursors: { after: 'A' } } }), null, '沒有 next＝最後一頁');
  assert.equal(readPaging('access_token=S'), null);
  assert.equal(readPaging('until=abc'), null);
});

test('欄位展開成功但沒回 insights（缺 read_insights）：提示 insights_empty', async (t) => {
  const now = nowSec();
  const { call } = await setup(t, { 'GET /111/published_posts': () => ({ data: [post('111_1', now - 60)] }) });
  const d = (await call(`/fb/reports/posts?page=111&from=${taipeiToday()}&to=${taipeiToday()}`)).body.data;
  assert.ok(d.issues.includes('insights_empty'));
  assert.equal(d.items[0].views, null); assert.equal(d.items[0].reactions, 10);
});

test('欄位展開失敗：改逐篇查成效，每批最多 6 次呼叫；缺 read_insights（空資料）標 no_data', async (t) => {
  const now = nowSec();
  const { f, call } = await setup(t, {
    'GET /222/published_posts': (c) => (/insights/.test(c.query.fields) ? gErr(100, 400, 'Invalid field')
      : { data: [1, 2, 3, 4].map((i) => post('222_' + i, now - i * 60)), paging: { cursors: { after: 'G' }, next: 'x' } }),
    '*': (c) => (c.path === '/222_2/insights' ? { data: [] } : c.path === '/222_3/insights' ? gErr(10, 403, 'perm') : ins(9, 1))
  });
  const d = (await call(`/fb/reports/posts?page=222&from=${daysAgo(1)}&to=${taipeiToday()}`)).body.data;
  assert.equal(d.items.length, 4);
  assert.ok(d.issues.includes('expand_fallback'));
  assert.ok(d.issues.includes('insights_empty'));
  assert.ok(d.issues.includes('no_permission'));
  assert.equal(d.items[0].views, 9);
  assert.equal(d.items[1].views, null); assert.equal(d.items[1].missing.views, 'no_data');
  assert.equal(d.items[2].missing.views, 'no_permission');
  assert.equal(d.items[2].reactions, 10, '心情、留言、分享不受 Insights 影響');
  assert.equal(f.calls.filter((c) => c.path.startsWith('/222')).length, 6, '清單試展開 1＋清單 1＋逐篇 4');
  assert.equal(f.calls.find((c) => c.path === '/222/published_posts' && !/insights/.test(c.query.fields)).query.limit, '4');
});

test('限流：當批停止、回原游標；用量高時先不打臉書', async (t) => {
  const now = nowSec();
  let rate = true;
  const { f, env, call } = await setup(t, {
    'GET /111/published_posts': () => (rate ? gErr(32, 400, 'Page request limit reached') : { data: [{ ...post('111_1', now - 60), insights: ins(1, 1) }] })
  });
  const q = `/fb/reports/posts?page=111&from=${taipeiToday()}&to=${taipeiToday()}`;
  const a = (await call(q)).body.data;
  assert.equal(a.status, 'throttled'); assert.deepEqual(a.items, []); assert.ok(a.next);
  rate = false;
  const n = f.calls.length;
  const b = (await call('/fb/reports/posts?cursor=' + encodeURIComponent(a.next))).body.data;
  assert.equal(b.status, 'paused', '10 分鐘內被限流：先不打臉書');
  assert.equal(f.calls.length, n);
  env.DB.raw.prepare("DELETE FROM fb_settings WHERE k = 'rate_usage'").run();
});

test('權限：未登入 401；名單外編號 401；未來日期 400', async (t) => {
  const { call } = await setup(t, {});
  const w = await load();
  const env = mkEnv({ FB_USER_TOKEN: 'U' });
  const r = await w.fetch(new Request('https://api.test/fb/reports/posts?page=111', { headers: { origin: ORIGIN } }), env, { waitUntil() {} });
  assert.equal(r.status, 401);
  assert.equal((await call(`/fb/reports/posts?page=111&from=${taipeiToday()}&to=${daysAgo(-1)}`)).status, 400, '未來日期');
  const t2 = await setup(t, {}, { uid: 'NOBODY' });
  assert.equal((await t2.call('/fb/reports/posts?page=111')).status, 401, '名單沒有的編號');
});

test('欄位檢查：逐項測指標、不回內容與貼文 ID', async (t) => {
  const now = nowSec();
  const { call } = await setup(t, {
    'GET /me/permissions': () => ({ data: [{ permission: 'read_insights', status: 'granted' }] }),
    'GET /111/published_posts': (c) => ({ data: [post('111_1', now - 60), post('111_2', now - 120)].map((p) => (/insights/.test(c.query.fields) ? { id: p.id, insights: ins(1, 1) } : p)) }),
    '*': (c) => (/insights$/.test(c.path) ? (c.query.metric === 'post_impressions' ? gErr(100, 400, 'invalid metric') : { data: [{ name: c.query.metric, values: [{ value: 4 }] }] }) : gErr(803))
  });
  const d = (await call('/fb/reports/probe?page=111')).body.data;
  assert.equal(d.permissions.read_insights, 'granted');
  assert.equal(d.expand.ok, true);
  assert.equal(d.posts[0].metrics.post_media_view.value, 4);
  assert.equal(d.posts[0].metrics.post_impressions.error, 100);
  assert.ok(d.paging && d.paging.ok, JSON.stringify(d.paging));
  assert.doesNotMatch(JSON.stringify(d), /111_1|內文/);
});
