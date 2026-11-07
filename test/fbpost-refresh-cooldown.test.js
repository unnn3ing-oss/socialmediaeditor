const test = require('node:test');
const assert = require('node:assert/strict');
let C;
test.before(async () => { C = await import('../tools/fbpost/refresh-cooldown.js'); });
const memory = () => {
  const data = new Map();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test('刷新間隔：粉專與種類獨立，五分鐘邊界可再次刷新', async () => {
  let time = 1000000;
  const storage = memory(), c = C.createRefreshCooldown({ storage, now: () => time, locks: null });
  assert.equal(c.remaining('scheduled', ['111']), 0);
  assert.deepEqual(await c.start('scheduled', ['111']), { ok: true, remaining: C.COOLDOWN_MS });
  assert.equal(c.remaining('published', ['111']), 0);
  assert.equal(c.remaining('scheduled', ['222']), 0);
  time += 299999;
  assert.deepEqual(await c.start('scheduled', ['111']), { ok: false, remaining: 1 });
  time++;
  assert.deepEqual(await c.start('scheduled', ['111']), { ok: true, remaining: C.COOLDOWN_MS });
  assert.equal(c.persistent, true);
});

test('刷新間隔：全部粉專取最大剩餘時間，被擋時不消耗其他粉專額度', async () => {
  let time = 1000000;
  const c = C.createRefreshCooldown({ storage: memory(), now: () => time, locks: null });
  await c.start('scheduled', ['111']);
  time += 60000;
  await c.start('scheduled', ['222']);
  assert.equal(c.remaining('scheduled', ['111', '222']), 300000);
  assert.deepEqual(await c.start('scheduled', ['111', '222', '333']), { ok: false, remaining: 300000 });
  assert.equal(c.remaining('scheduled', ['333']), 0);
  time += 300000;
  assert.equal((await c.start('scheduled', ['111', '222', '333'])).ok, true);
});

test('刷新間隔：重新建立與另一個分頁讀到相同時間，不可重設倒數', async () => {
  let time = 1000000;
  const storage = memory(), options = { storage, now: () => time, locks: null };
  const first = C.createRefreshCooldown(options), other = C.createRefreshCooldown(options);
  await first.start('published', ['111']);
  time += 60000;
  assert.equal(other.remaining('published', ['111']), 240000);
  assert.equal(C.createRefreshCooldown(options).remaining('published', ['111']), 240000);
  assert.equal((await other.start('published', ['111'])).ok, false);
  assert.equal(first.remaining('published', ['111']), 240000);
});

test('刷新間隔：Web Locks 保護同粉專的並行取得，只准一個成功', async () => {
  let tail = Promise.resolve(), requests = 0;
  const locks = { request: (name, fn) => {
    assert.equal(name, 'tbx.fbpost.refresh-cooldown.v1'); requests++;
    const result = tail.then(fn); tail = result.catch(() => {}); return result;
  } };
  const storage = memory(), options = { storage, now: () => 1000000, locks };
  const a = C.createRefreshCooldown(options), b = C.createRefreshCooldown(options);
  const results = await Promise.all([a.start('scheduled', ['111']), b.start('scheduled', ['111'])]);
  assert.deepEqual(results.map((r) => r.ok), [true, false]);
  assert.equal(requests, 2);
});

test('刷新間隔：儲存拒絕或超額仍限制本頁，不被舊 storage 蓋掉', async () => {
  let time = 1000000, blocked = false;
  const backing = memory();
  const storage = { getItem: backing.getItem, setItem: (key, value) => { if (blocked) throw new Error('quota'); backing.setItem(key, value); } };
  const c = C.createRefreshCooldown({ storage, now: () => time, locks: null });
  await c.start('scheduled', ['111']);
  time += 300000; blocked = true;
  assert.equal((await c.start('scheduled', ['111'])).ok, true);
  time += 1000;
  assert.equal(c.remaining('scheduled', ['111']), 299000);
  assert.equal(c.persistent, false);
  assert.equal((await c.start('scheduled', ['111'])).ok, false);
  const unavailable = C.createRefreshCooldown({ storage: null, now: () => time, locks: null });
  await unavailable.start('published', ['222']);
  assert.equal((await unavailable.start('published', ['222'])).ok, false);
  assert.equal(unavailable.persistent, false);
});

test('刷新間隔：壞資料不崩潰，異常未來時間重新計時後可正常到期', async () => {
  let time = 1000000;
  const storage = memory(), key = C.STORAGE_PREFIX + 'scheduled:111';
  const c = C.createRefreshCooldown({ storage, now: () => time, locks: null });
  for (const raw of ['bad json', '{}', '{"until":"later"}', '{"until":-1}', '{"until":null}']) {
    storage.data.set(key, raw); assert.equal(c.remaining('scheduled', ['111']), 0);
  }
  storage.data.set(key, JSON.stringify({ until: time + 86400000 }));
  assert.equal(c.remaining('scheduled', ['111']), 300000);
  time += 1000;
  assert.equal(c.remaining('scheduled', ['111']), 299000);
  time += 299000;
  assert.equal((await c.start('scheduled', ['111'])).ok, true);
});

test('刷新間隔：空目標、錯誤種類與無效 ID 不寫資料，重複 ID 只存一次', async () => {
  const storage = memory(), c = C.createRefreshCooldown({ storage, now: () => 1000000, locks: null });
  for (const [kind, ids] of [['scheduled', []], ['insights', ['111']], ['scheduled', [1]], ['scheduled', ['']], ['scheduled', [' 111']]]) {
    assert.deepEqual(await c.start(kind, ids), { ok: false, remaining: 0 });
  }
  assert.equal(storage.data.size, 0);
  await c.start('scheduled', ['111', '111']);
  assert.equal(storage.data.size, 1);
  assert.deepEqual([...storage.data.values()].map(JSON.parse), [{ until: 1300000 }]);
});

test('刷新間隔：Web Locks 被拒時仍以本機同步檢查保護', async () => {
  const c = C.createRefreshCooldown({ storage: memory(), now: () => 1000000, locks: { request: async () => { throw new Error('denied'); } } });
  assert.equal((await c.start('scheduled', ['111'])).ok, true);
  assert.equal((await c.start('scheduled', ['111'])).ok, false);
});
