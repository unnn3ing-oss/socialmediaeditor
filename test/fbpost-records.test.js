const test = require('node:test');
const assert = require('node:assert/strict');
let R;
test.before(async () => { R = await import('../tools/fbpost/records.js'); });
const DAY = 86400000, NOW = Date.UTC(2026, 10, 7, 12);
const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
};
const record = (extra = {}) => ({ id: 'r1', at: NOW, updatedAt: NOW, title: '標題', caption: '小編文', url: 'https://a.test/1',
  pages: [{ page: '111', label: '少康', scheduledAt: null, sentAt: NOW, status: 'ok', postId: '111_1' }], ...extra });

test('本地紀錄：保存、重開、同筆重送更新，不複製紀錄', () => {
  const storage = memory(), store = R.createStore(storage);
  assert.equal(store.save(record()), true);
  const changed = record({ pages: [{ ...record().pages[0], status: 'fail', error: '失敗', rundown: { ok: false, msg: '未寫入' } }] });
  store.save(changed);
  const reopened = R.createStore(storage);
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].pages[0].error, '失敗');
  assert.deepEqual(reopened.list()[0].pages[0].rundown, { ok: false, msg: '未寫入' });
  assert.equal(reopened.persistent, true);
});

test('本地紀錄：新到舊排序，回傳資料不能改動儲存內容', () => {
  const store = R.createStore(memory());
  store.save(record()); store.save(record({ id: 'r2', at: NOW + 1 }));
  const list = store.list();
  assert.deepEqual(list.map((r) => r.id), ['r2', 'r1']);
  list[0].pages[0].label = 'changed';
  assert.equal(store.list()[0].pages[0].label, '少康');
  store.remove('r1');
  assert.deepEqual(store.list().map((r) => r.id), ['r2']);
});

test('本地紀錄：白名單不保存 token、圖片或送出請求', () => {
  const storage = memory(), store = R.createStore(storage);
  store.save({ ...record(), token: 'secret-token', image: 'image-data', body: { secret: true },
    pages: [{ ...record().pages[0], access_token: 'another-secret', image: 'private-image', rundown: { ok: true, msg: 'A1', token: 'rd-secret' } }] });
  const raw = storage.getItem(R.KEY);
  for (const x of ['secret-token', 'image-data', 'another-secret', 'private-image', 'rd-secret', 'body']) assert.equal(raw.includes(x), false);
});

test('本地紀錄：各粉專保存送出時的內容，舊資料與非文字欄位相容', () => {
  const store = R.createStore(memory());
  store.save(record({ pages: [
    { ...record().pages[0], title: '首次標題', caption: '首次內文', url: 'https://a.test/old' },
    { ...record().pages[0], page: '222', status: 'fail', title: '修改標題', caption: '重送內容', url: 'https://a.test/new' },
    { ...record().pages[0], page: '333', title: null, caption: {}, url: 1 }
  ] }));
  const pages = store.list()[0].pages;
  assert.deepEqual([pages[0].title, pages[0].caption, pages[0].url], ['首次標題', '首次內文', 'https://a.test/old']);
  assert.deepEqual([pages[1].title, pages[1].caption, pages[1].url], ['修改標題', '重送內容', 'https://a.test/new']);
  for (const key of ['title', 'caption', 'url']) assert.equal(Object.hasOwn(pages[2], key), false);
});

test('七天清除：最後活動超過七天才清，未來排程、失敗與空紀錄保留', () => {
  const store = R.createStore(memory());
  const old = NOW - 10 * DAY;
  const add = (id, page, updatedAt = old) => store.save(record({ id, at: old, updatedAt, pages: page ? [{ ...record().pages[0], sentAt: old, ...page }] : [] }));
  add('published', {});
  add('due-old', { scheduledAt: (NOW - 8 * DAY) / 1000 });
  add('due-recent', { scheduledAt: (NOW - 3 * DAY) / 1000 });
  add('future', { scheduledAt: (NOW + DAY) / 1000 });
  add('failed', { status: 'fail' });
  add('empty', null);
  add('recent-retry', {}, NOW - DAY);
  add('boundary', {}, NOW - 7 * DAY);
  assert.equal(store.clean(NOW), 2);
  assert.deepEqual(store.list().map((r) => r.id).sort(), ['boundary', 'due-recent', 'empty', 'failed', 'future', 'recent-retry']);
});

test('七天清除：混合成功／失敗與未來排程整筆保留', () => {
  const old = NOW - 20 * DAY;
  const base = { ...record().pages[0], sentAt: old };
  const store = R.createStore(memory());
  store.save(record({ at: old, updatedAt: old, pages: [base, { ...base, page: '222', status: 'fail' }] }));
  assert.equal(store.clean(NOW), 0);
  store.save(record({ at: old, updatedAt: old, pages: [base, { ...base, page: '222', scheduledAt: (NOW + DAY) / 1000 }] }));
  assert.equal(store.clean(NOW), 0);
});

test('本地紀錄：儲存不可用或超額時保留記憶體資料，可回報未持久化', () => {
  let quota = true;
  const storage = memory(), set = storage.setItem;
  storage.setItem = (k, v) => { if (quota) throw new Error('QuotaExceeded'); set(k, v); };
  const store = R.createStore(storage);
  assert.equal(store.save(record()), false);
  assert.equal(store.persistent, false);
  assert.equal(store.list().length, 1);
  quota = false;
  assert.equal(store.save(record({ id: 'r2' })), true);
  assert.equal(store.persistent, true);
  assert.equal(R.createStore(storage).list().length, 2);
  const none = R.createStore(null);
  assert.equal(none.save(record()), false);
  assert.equal(none.list().length, 1);
});

test('本地紀錄：壞 JSON／型別不會使頁面崩潰，不丟掉已載入記憶體資料', () => {
  for (const raw of ['{', '{}', 'null', '[null]', '[{"id":"x","at":0,"pages":[null]}]']) {
    const storage = memory(); storage.setItem(R.KEY, raw);
    const store = R.createStore(storage);
    assert.deepEqual(store.list(), []);
    assert.equal(store.persistent, false);
    assert.equal(store.save(record()), true);
    assert.equal(store.list().length, 1);
  }
  const storage = memory(), store = R.createStore(storage);
  store.save(record()); storage.setItem(R.KEY, '{');
  assert.equal(store.list().length, 1);
  assert.throws(() => store.save({ id: 'bad' }), TypeError);
});

test('儲存恢復：合併其他分頁新增資料，相同 id 保留較新更新', () => {
  const storage = memory(), set = storage.setItem;
  let quota = false;
  storage.setItem = (k, v) => { if (quota) throw new Error('QuotaExceeded'); set(k, v); };
  const a = R.createStore(storage);
  a.save(record({ id: 'a' }));
  quota = true;
  a.save(record({ id: 'local-only' }));
  a.save(record({ id: 'a', updatedAt: NOW + 1, caption: '較舊本頁' }));
  quota = false;
  const b = R.createStore(storage);
  b.save(record({ id: 'other-tab' }));
  b.save(record({ id: 'a', updatedAt: NOW + 2, caption: '較新分頁' }));
  assert.equal(a.save(record({ id: 'next' })), true);
  const list = R.createStore(storage).list();
  assert.deepEqual(list.map((r) => r.id).sort(), ['a', 'local-only', 'next', 'other-tab']);
  assert.equal(list.find((r) => r.id === 'a').caption, '較新分頁');
});

test('儲存恢復：移除與七天清除不會合併回舊紀錄，也不影響其他分頁的新紀錄', () => {
  for (const operation of ['remove', 'clean']) {
    const storage = memory(), set = storage.setItem;
    let quota = false;
    storage.setItem = (k, v) => { if (quota) throw new Error('QuotaExceeded'); set(k, v); };
    const a = R.createStore(storage), old = NOW - 10 * DAY;
    a.save(record({ id: 'old', at: old, updatedAt: old, pages: [{ ...record().pages[0], sentAt: old }] }));
    quota = true;
    if (operation === 'remove') assert.equal(a.remove('old'), false);
    else assert.equal(a.clean(NOW), 1);
    assert.equal(a.list().length, 0);
    quota = false;
    const b = R.createStore(storage);
    b.save(record({ id: 'other-tab' }));
    assert.equal(a.save(record({ id: 'next' })), true);
    assert.deepEqual(R.createStore(storage).list().map((r) => r.id).sort(), ['next', 'other-tab']);
  }
});

test('本地紀錄：七天自動清除預設開啟，偏好跨重開保留，關閉不會執行清除', () => {
  const storage = memory(), store = R.createStore(storage);
  assert.equal(store.autoClean(), true);
  assert.equal(store.setAutoClean(false), true);
  assert.equal(R.createStore(storage).autoClean(), false);
  store.setAutoClean(true);
  assert.equal(R.createStore(storage).autoClean(), true);
});

test('儲存恢復：待寫入的刪除只適用原版本，保留其他分頁更新的紀錄', () => {
  for (const operation of ['remove', 'clean']) {
    const storage = memory(), set = storage.setItem;
    let quota = false;
    storage.setItem = (k, v) => { if (quota) throw new Error('QuotaExceeded'); set(k, v); };
    const a = R.createStore(storage), old = NOW - 10 * DAY;
    a.save(record({ id: 'changed', at: old, updatedAt: old, pages: [{ ...record().pages[0], sentAt: old }] }));
    quota = true;
    if (operation === 'remove') a.remove('changed'); else a.clean(NOW);
    quota = false;
    const b = R.createStore(storage);
    b.save(record({ id: 'changed', at: old, updatedAt: NOW,
      pages: [{ ...record().pages[0], scheduledAt: (NOW + DAY) / 1000 }] }));
    a.save(record({ id: 'next' }));
    const changed = R.createStore(storage).list().find((r) => r.id === 'changed');
    assert.ok(changed, operation);
    assert.equal(changed.pages[0].scheduledAt, (NOW + DAY) / 1000);
  }
});

test('儲存恢復：清除舊紀錄遇到同時間版本的未來排程或失敗，保守保留', () => {
  for (const pageChange of [{ scheduledAt: (NOW + DAY) / 1000 }, { status: 'fail' }]) {
    const storage = memory(), set = storage.setItem;
    let quota = false;
    storage.setItem = (k, v) => { if (quota) throw new Error('QuotaExceeded'); set(k, v); };
    const old = NOW - 10 * DAY;
    const oldRecord = record({ id: 'changed', at: old, updatedAt: old, pages: [{ ...record().pages[0], sentAt: old }] });
    const a = R.createStore(storage); a.save(oldRecord);
    quota = true; assert.equal(a.clean(NOW), 1);
    quota = false;
    const b = R.createStore(storage);
    b.save({ ...oldRecord, pages: [{ ...oldRecord.pages[0], ...pageChange }] });
    a.save(record({ id: 'next' }));
    const changed = R.createStore(storage).list().find((r) => r.id === 'changed');
    assert.ok(changed, JSON.stringify(pageChange));
    for (const [key, value] of Object.entries(pageChange)) assert.equal(changed.pages[0][key], value);
  }
});
