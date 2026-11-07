const test = require('node:test');
const assert = require('node:assert/strict');
let D, W;
const load = async () => { D = D || (await import('../tools/fbpost/duty.js')); W = W || (await import('../tools/fbpost/rundown.js')); };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('值班：下一個 05:00', async () => {
  await load();
  assert.equal(D.nextReset(at(2026, 11, 7, 3)), at(2026, 11, 7, 5), '凌晨選 → 當天 05:00');
  assert.equal(D.nextReset(at(2026, 11, 7, 9)), at(2026, 11, 8, 5), '早上選 → 隔天 05:00');
  assert.equal(D.nextReset(at(2026, 11, 7, 5)), at(2026, 11, 8, 5), '剛好 05:00 → 隔天');
  assert.equal(D.nextReset(at(2026, 11, 30, 23)), at(2026, 12, 1, 5), '跨月');
});

test('值班：1～3 個、主要預設第一個', async () => {
  await load();
  assert.equal(D.normalize([]), null);
  assert.deepEqual(D.normalize(['a', 'b', 'a', 'c', 'd'], 'c'), { ids: ['a', 'b', 'c'], main: 'c' });
  assert.deepEqual(D.normalize(['a', 'b'], 'z'), { ids: ['a', 'b'], main: 'a' });
});

test('值班：存讀、05:00 後失效、壞資料當沒選', async () => {
  await load();
  const s = mem();
  const v = D.saveDuty(['a', 'b'], 'b', at(2026, 11, 7, 9), s);
  assert.deepEqual(D.loadDuty(at(2026, 11, 8, 4, 59), s), v);
  assert.equal(D.loadDuty(at(2026, 11, 8, 5), s), null);
  s.setItem('tbx.fbpost.duty.v1', '{壞掉');
  assert.equal(D.loadDuty(at(2026, 11, 7, 9), s), null);
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.equal(D.loadDuty(Date.now(), bad), null);
  assert.ok(D.saveDuty(['a'], 'a', Date.now(), bad), '存不了也回這次的選擇');
});

test('值班：排序主要 → 其他值班 → 其餘', async () => {
  await load();
  const pages = ['n', 'e', 's', 'j', 'i', 'w'].map((id) => ({ id }));
  assert.deepEqual(D.orderPages(pages, { ids: ['j', 'e'], main: 'e' }).map((p) => p.id), ['e', 'j', 'n', 's', 'i', 'w']);
  assert.deepEqual(D.orderPages(pages, { ids: ['x', 'w', 'n'], main: 'w' }).map((p) => p.id), ['w', 'n', 'e', 's', 'j', 'i']);
  assert.deepEqual(D.orderPages(pages, null).map((p) => p.id), ['n', 'e', 's', 'j', 'i', 'w']);
  assert.equal(D.mainOf(pages, { ids: ['x'], main: 'x' }), '');
  assert.equal(D.mainOf(pages, { ids: ['s'], main: 's' }), 's');
});

test('Rundown：類型依模式', async () => {
  await load();
  assert.equal(W.typeOf('text', 'plain'), '文字');
  assert.equal(W.typeOf('text', 'native'), '文字');
  assert.equal(W.typeOf('text', 'card'), '圖文');
  assert.equal(W.typeOf('frame', 'plain'), '圖文');
});

test('Rundown：SLUG 預設標題前 4 字（照快速排程）', async () => {
  await load();
  const cases = [[['颱風假 最新！北北基桃', '明天照常'], '颱風假最'], [['', 'a/b c d'], 'bcd'], [['快訊/颱風假北北基桃'], '颱風假北'],
    [['最新／颱風假北北基桃'], '颱風假北'], [['新/ 颱風假北北基桃'], '颱風假北'], [['新聞快訊颱風假'], '新聞快訊'],
    [['颱風假最新/北北基桃'], '北北基桃'], [['》颱風假，北北基桃'], '颱風假北'], [['「天氣」！要降溫#'], '天氣要降'],
    [['ＡＢ１２》３４'], 'ＡＢ１２'], [['快訊/'], '快訊'], [['快訊', '颱風假北北基桃'], '颱風假北'], [['最新/', '', '颱風假北北基桃'], '颱風假北'],
    [['快訊', '新/颱風假北北基桃'], '颱風假北'], [['快訊颱風假', '第二行'], '快訊颱風'], [['', '快訊/颱風假北北基桃', '第二行'], '颱風假北'],
    ['快訊\n颱風假北北基桃', '颱風假北']];
  for (const [lines, want] of cases) assert.equal(W.defaultSlug(lines), want, JSON.stringify(lines));
  assert.equal(W.cleanSlug(' 颱風》/假！ '), '颱風假');
});

test('Rundown：有區段的粉專各寫一筆；排程用排程時間、立即用送出時間；擠看看、氣象略過', async () => {
  await load();
  const sched = Math.floor(new Date(2026, 9, 27, 8, 5).getTime() / 1000);
  const { entries, skipped } = W.entries({ articleId: '4041548', slug: '', lines: ['颱風假最新'], type: '圖文' },
    [{ code: 'news', at: sched }, { code: 'ent', at: new Date(2026, 9, 27, 21, 3) }, { code: 'jkk', at: sched }, { code: 'weather', at: sched }, { code: '', at: sched }]);
  assert.deepEqual(entries, [
    { page: 'news', date: '2026-10-27', time: '08:05', text: '4041548/圖文/颱風假最' },
    { page: 'ent', date: '2026-10-27', time: '21:03', text: '4041548/圖文/颱風假最' }]);
  assert.deepEqual(skipped, ['jkk', 'weather', '']);
  assert.equal(W.entries({ articleId: '1', slug: '自訂', lines: ['x'], type: '文字' }, [{ code: 'intl', at: sched }]).entries[0].text, '1/文字/自訂');
});

test('Rundown：結果文字、開關', async () => {
  await load();
  assert.equal(W.describe({ ok: true, status: 'insert', cell: '2026/10!AB107', time: '08:10' }, '新聞'), '新聞 08:10 → AB107（插入）');
  assert.equal(W.describe({ ok: true, status: 'write', cell: '2026/10!AE256', time: '15:55', addedRow: true }, '新聞'), '新聞 15:55 → AE256（新增一列）');
  assert.equal(W.describe({ ok: true, status: 'exists', cell: '2026/10!AB109' }, '新聞'), '新聞：已在 AB109（不重複寫）');
  assert.equal(W.describe({ ok: false, error: '時段已滿' }, '娛樂'), '娛樂：時段已滿');

});

function cookieDoc() {
  let value = '', last = '';
  return { get cookie() { return value; }, set cookie(v) { last = v; value = v.includes('Max-Age=0') ? '' : v.split(';')[0]; }, get last() { return last; } };
}
test('Rundown：預設開啟，session cookie保留關閉，重開工作階段恢復預設', async () => {
  await load();
  const doc = cookieDoc(), pref = W.createRundownSession(doc, 'https:');
  assert.equal(pref.on(), true);
  assert.equal(pref.set(false), true);
  assert.equal(pref.on(), false);
  assert.match(doc.last, /Secure; SameSite=None; Partitioned/);
  assert.ok(!/Expires|Max-Age/i.test(doc.last), '關閉狀態不可持久保存');
  assert.equal(W.createRundownSession(doc).on(), false, '同一工作階段重新開頁仍關閉');
  assert.equal(W.createRundownSession(cookieDoc()).on(), true, '新工作階段預設開啟');
  pref.set(true); assert.equal(pref.on(), true);
  assert.match(doc.last, /Max-Age=0/);
});
test('Rundown：cookie被拒絕時保留本頁選擇，不影響發文', async () => {
  await load();
  const blocked = { get cookie() { return ''; }, set cookie(v) {} };
  const pref = W.createRundownSession(blocked, 'http:');
  assert.equal(pref.on(), true);
  assert.equal(pref.set(false), false);
  assert.equal(pref.on(), false);
  assert.equal(pref.persistent, false);
  pref.set(true); assert.equal(pref.on(), true);
  const denied = W.createRundownSession({ get cookie() { throw Error('denied'); } });
  assert.equal(denied.on(), true);
  denied.set(false); assert.equal(denied.on(), false);
});
