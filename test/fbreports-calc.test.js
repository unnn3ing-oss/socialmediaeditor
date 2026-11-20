// 數據報表計算口徑（tools/fbreports/calc.js）
const test = require('node:test');
const assert = require('node:assert/strict');
let C;
const load = async () => (C = C || (await import('../tools/fbreports/calc.js')));
const it = (o) => ({ page: '1', id: '1_' + Math.random(), time: '2026-11-10T02:00:00+0000', type: 'image', views: null, reach: null, clicks: null, reactions: null, comments: null, shares: null, ...o });

test('規格驗收範例：34 互動、觸及小計 250、互動率 12.00%（2／3 篇）', async () => {
  const { summarize, fmtAgg } = await load();
  const items = [
    it({ reactions: 10, comments: 5, shares: 5, reach: 200 }),
    it({ reactions: 6, comments: 2, shares: 2, reach: 50 }),
    it({ reactions: 2, comments: 1, shares: 1, reach: null })
  ];
  const s = summarize(items);
  assert.equal(s.engagement.value, 34);
  assert.equal(s.reach.value, 250); assert.equal(s.reach.known, 2);
  assert.equal(s.rate.value, 12); assert.equal(s.rate.known, 2); assert.equal(s.rate.total, 3);
  assert.equal(fmtAgg('rate', s.rate), '12.00%（2／3 篇有資料）');
  assert.equal(fmtAgg('reach', s.reach), '250（2／3 篇有資料）');
  assert.equal(fmtAgg('engagement', s.engagement), '34');
});

test('互動數任一分量未知＝null；0 與未知分開', async () => {
  const { engagement, summarize, fmtAgg } = await load();
  assert.equal(engagement(it({ reactions: 0, comments: 0, shares: 0 })), 0);
  assert.equal(engagement(it({ reactions: 1, comments: null, shares: 0 })), null);
  const none = summarize([it({})]);
  assert.equal(fmtAgg('views', none.views), '—');
  const empty = summarize([]);
  assert.equal(fmtAgg('views', empty.views), '0', '當天沒貼文＝0');
  assert.equal(fmtAgg('rate', empty.rate), '—');
  assert.equal(fmtAgg('posts', empty.posts), '0');
});

test('依台北發布日分組（跨午夜）、空日子也列出', async () => {
  const { byDate } = await load();
  const rows = byDate([it({ time: '2026-11-10T15:59:00+0000' }), it({ time: '2026-11-10T16:00:00+0000' })], '2026-11-10', '2026-11-12');
  assert.deepEqual(rows.map((r) => [r.date, r.items.length]), [['2026-11-10', 1], ['2026-11-11', 1], ['2026-11-12', 0]]);
});

test('類型成效、排序（未知放最後）、去重', async () => {
  const { typeRows, sortItems, mergeItems, presetRange, dayCount } = await load();
  const a = it({ id: 'a', type: 'video', views: 5, reactions: 1, comments: 1, shares: 1 });
  const b = it({ id: 'b', type: 'image', views: null });
  const c = it({ id: 'c', type: 'image', views: 9 });
  const rows = typeRows([a, b, c]);
  assert.deepEqual(rows.map((r) => [r.type, r.items.length]), [['image', 2], ['video', 1]]);
  assert.equal(Math.round(rows[0].share), 67);
  assert.equal(rows[1].avgEngagement, 3);
  assert.deepEqual(sortItems([a, b, c], 'views').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(sortItems([a, b, c], 'views', 'asc').map((x) => x.id), ['a', 'c', 'b']);
  const m = new Map();
  assert.equal(mergeItems(m, [a, b]), 2);
  assert.equal(mergeItems(m, [a, c]), 1);
  assert.deepEqual(presetRange(7, '2026-11-20'), { from: '2026-11-14', to: '2026-11-20' });
  assert.equal(dayCount('2026-10-01', '2026-10-31'), 31);
});
