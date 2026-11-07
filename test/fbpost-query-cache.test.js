const test = require('node:test');
const assert = require('node:assert/strict');
let C;
test.before(async () => { C = await import('../tools/fbpost/query-cache.js'); });
const memory = () => {
  const data = new Map();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const scheduled = (message = '排程') => ({ at: 123, items: [{ id: '111_1', message, at: 456, comment: { status: 'pending', error: '', message: '留言' } }] });
const published = () => ({ at: 124, generation: 'g1', items: [{ id: '111_2', message: '已發布', reactions: 3, comments: 2, shares: 1 }], next: 'cursor' });

test('查詢快取：按粉專與種類隔離，重新開啟可讀，空列表也有效', () => {
  const storage = memory(), cache = C.createQueryCache(storage);
  assert.equal(cache.set('scheduled', '111', scheduled()), true);
  cache.set('scheduled', '222', scheduled('另一粉專'));
  cache.set('published', '111', published());
  cache.set('scheduled', 'empty', { items: [] });
  const again = C.createQueryCache(storage);
  assert.equal(again.get('scheduled', '111').items[0].message, '排程');
  assert.equal(again.get('scheduled', '222').items[0].message, '另一粉專');
  assert.equal(again.get('published', '111').items[0].message, '已發布');
  assert.equal(again.get('published', '111').next, 'cursor');
  assert.deepEqual(again.get('scheduled', 'empty').items, []);
  assert.equal(again.persistent, true);
});

test('查詢快取：get 深拷貝，set 不保存呼叫端的可變參照', () => {
  const cache = C.createQueryCache(memory()), source = scheduled();
  cache.set('scheduled', '111', source);
  source.items[0].message = '改來源';
  const first = cache.get('scheduled', '111'); first.items[0].message = '改回傳';
  assert.equal(cache.get('scheduled', '111').items[0].message, '排程');
});

test('查詢快取：逐欄白名單，URL只留https參照，不存token、圖片二進位或body', () => {
  const storage = memory(), cache = C.createQueryCache(storage);
  cache.set('scheduled', '111', { ...scheduled(), token: 'secret', body: 'request-body', image: 'image-bytes',
    items: [{ ...scheduled().items[0], access_token: 'item-secret', picture: 'data:image/png;base64,private', comment: { status: 'pending', token: 'comment-secret' } }] });
  cache.set('published', '111', { ...published(), items: [{ ...published().items[0], url: 'https://a.test/?access_token=url-secret', picture: 'http://a.test/x', token: 'published-secret' }] });
  const raw = [...storage.data.values()].join('');
  for (const text of ['secret', 'request-body', 'image-bytes', 'data:image', 'http://a.test']) assert.equal(raw.includes(text), false, text);
  assert.equal(cache.get('published', '111').items[0].url, '');
  cache.set('published', '111', { ...published(), items: [{ id: 'x', picture: 'https://a.test/x', url: 'https://facebook.com/x' }] });
  assert.equal(cache.get('published', '111').items[0].picture, 'https://a.test/x');
});

test('查詢快取：成效只留數字與數字心情，保存查詢版本', () => {
  const cache = C.createQueryCache(memory());
  cache.set('insights', '111/post', { generation: 'g1', data: { post: 'post', metrics: { post_clicks: 12, token: 'secret', access_token: 123, body: {}, post_reactions_by_type_total: { like: 5, love: 2, token: 456 } }, missing: ['post_media_view', null], access_token: 'secret' } });
  const value = cache.get('insights', '111/post');
  assert.equal(value.generation, 'g1');
  assert.deepEqual(value.data, { post: 'post', metrics: { post_clicks: 12, post_reactions_by_type_total: { like: 5, love: 2 } }, missing: ['post_media_view'] });
});

test('查詢快取：quota失敗後用新記憶體資料，不被舊storage蓋掉，其他粉專仍可讀', () => {
  const storage = memory(), cache = C.createQueryCache(storage);
  cache.set('scheduled', '111', scheduled('舊'));
  cache.set('scheduled', '222', scheduled('其他粉專'));
  const original = storage.setItem;
  storage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.equal(cache.set('scheduled', '111', scheduled('新')), false);
  assert.equal(cache.get('scheduled', '111').items[0].message, '新');
  assert.equal(cache.get('scheduled', '222').items[0].message, '其他粉專');
  assert.equal(cache.persistent, false);
  storage.setItem = original;
  cache.set('scheduled', '111', scheduled('再查詢'));
  assert.equal(cache.persistent, true);
  assert.equal(C.createQueryCache(storage).get('scheduled', '111').items[0].message, '再查詢');
});

test('查詢快取：其他分頁更新會讀到，個別key更新不會覆蓋別的粉專', () => {
  const storage = memory(), a = C.createQueryCache(storage), b = C.createQueryCache(storage);
  a.set('scheduled', '111', scheduled('原'));
  b.set('scheduled', '111', scheduled('更新'));
  assert.equal(a.get('scheduled', '111').items[0].message, '更新');
  a.set('published', '222', published());
  assert.equal(b.get('scheduled', '111').items[0].message, '更新');
});

test('查詢快取：壞JSON、無效資料與未知種類不使介面崩潰', () => {
  const storage = memory(), cache = C.createQueryCache(storage);
  const key = C.CACHE_PREFIX + 'scheduled:111';
  for (const raw of ['{', 'null', '[]', '{"at":1,"items":[{}]}']) {
    storage.setItem(key, raw); assert.equal(cache.get('scheduled', '111'), null);
  }
  assert.equal(cache.get('other', '111'), null);
  assert.equal(cache.set('other', '111', scheduled()), false);
  assert.equal(cache.set('scheduled', '111', { items: 'not-array' }), false);
});

test('查詢快取：storage讀取被拒或不存在時，保留本次頁面的成功結果', () => {
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  for (const storage of [denied, null]) {
    const cache = C.createQueryCache(storage);
    assert.equal(cache.set('scheduled', '111', scheduled()), false);
    assert.equal(cache.get('scheduled', '111').items[0].message, '排程');
    assert.equal(cache.persistent, false);
  }
});
