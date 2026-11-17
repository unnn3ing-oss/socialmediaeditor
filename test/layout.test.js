const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../shell/layout.js');

test('initial is showcase', async () => {
  const L = await load();
  const s = L.initial();
  assert.equal(s.view, 'showcase');
  assert.deepEqual(L.visible(s), []);
});

test('open shows one tool; opening another replaces it', async () => {
  const L = await load();
  const a = L.open(L.initial(), 'a');
  assert.deepEqual([a.view, a.tool], ['work', 'a']);
  assert.deepEqual(L.visible(a), ['a']);
  const b = L.open(a, 'b');
  assert.deepEqual(L.visible(b), ['b']);
});

test('home keeps tool but shows showcase; inputs not mutated', async () => {
  const L = await load();
  const a = L.open(L.initial(), 'a');
  const h = L.home(a);
  assert.deepEqual([h.view, h.tool], ['showcase', 'a']);
  assert.deepEqual(L.visible(h), []);
  assert.equal(a.view, 'work');
});

test('並排已停用：沒有 split／dropOnSide／closePane', async () => {
  const L = await load();
  for (const k of ['dropOnSide', 'closePane', 'focus', 'openSingle']) assert.equal(L[k], undefined, k);
});
