const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../shell/layout.js');

test('initial is showcase', async () => {
  const L = await load();
  const s = L.initial();
  assert.equal(s.view, 'showcase');
  assert.deepEqual(L.visible(s), []);
});

test('openSingle from showcase gives single on left', async () => {
  const L = await load();
  const s = L.openSingle(L.initial(), 'a');
  assert.deepEqual([s.view, s.mode, s.left, s.right], ['work', 'single', 'a', null]);
  assert.deepEqual(L.visible(s), ['a']);
});

test('openSingle in single replaces', async () => {
  const L = await load();
  const s = L.openSingle(L.openSingle(L.initial(), 'a'), 'b');
  assert.deepEqual([s.mode, s.left, s.right], ['single', 'b', null]);
});

test('dropOnSide from single splits', async () => {
  const L = await load();
  const s = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right');
  assert.deepEqual([s.mode, s.left, s.right, s.last], ['split', 'a', 'b', 'right']);
  const t = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'left');
  assert.deepEqual([t.mode, t.left, t.right, t.last], ['split', 'b', 'a', 'left']);
});

test('dropOnSide in showcase behaves like openSingle', async () => {
  const L = await load();
  const s = L.dropOnSide(L.initial(), 'a', 'right');
  assert.deepEqual([s.view, s.mode, s.left], ['work', 'single', 'a']);
});

test('dropOnSide same tool in single is unchanged', async () => {
  const L = await load();
  const a = L.openSingle(L.initial(), 'a');
  assert.deepEqual(L.dropOnSide(a, 'a', 'right'), a);
});

test('third tool replaces last-operated side', async () => {
  const L = await load();
  let s = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right');
  s = L.focus(s, 'left');
  s = L.openSingle(s, 'c');
  assert.deepEqual([s.left, s.right, s.last], ['c', 'b', 'left']);
});

test('openSingle of a visible tool only sets last', async () => {
  const L = await load();
  let s = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right');
  s = L.openSingle(s, 'a');
  assert.deepEqual([s.left, s.right, s.last], ['a', 'b', 'left']);
});

test("dragging the other side's tool swaps sides", async () => {
  const L = await load();
  const s = L.dropOnSide(L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right'), 'a', 'right');
  assert.deepEqual([s.left, s.right, s.last], ['b', 'a', 'right']);
});

test('drop onto the side it already occupies only sets last', async () => {
  const L = await load();
  let s = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right');
  s = L.dropOnSide(s, 'a', 'left');
  assert.deepEqual([s.left, s.right, s.last], ['a', 'b', 'left']);
});

test('drop a new tool on a side in split replaces that side', async () => {
  const L = await load();
  let s = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right');
  s = L.dropOnSide(s, 'c', 'left');
  assert.deepEqual([s.left, s.right, s.last], ['c', 'b', 'left']);
});

test('never more than two visible', async () => {
  const L = await load();
  let s = L.initial();
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    s = L.dropOnSide(s, id, id < 'c' ? 'left' : 'right');
    assert.ok(L.visible(s).length <= 2);
  }
  s = L.openSingle(s, 'f');
  assert.ok(L.visible(s).length <= 2);
  assert.equal(new Set(L.visible(s)).size, L.visible(s).length);
});

test('home then openSingle starts single', async () => {
  const L = await load();
  let s = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right');
  s = L.home(s);
  assert.equal(s.view, 'showcase');
  assert.deepEqual(L.visible(s), []);
  s = L.openSingle(s, 'c');
  assert.deepEqual([s.view, s.mode, s.left, s.right], ['work', 'single', 'c', null]);
});

test('close in split leaves single on left', async () => {
  const L = await load();
  let s = L.dropOnSide(L.openSingle(L.initial(), 'a'), 'b', 'right');
  const r = L.closePane(s, 'left');
  assert.deepEqual([r.mode, r.left, r.right, r.last], ['single', 'b', null, 'left']);
  const t = L.closePane(s, 'right');
  assert.deepEqual([t.mode, t.left, t.right, t.last], ['single', 'a', null, 'left']);
});

test('close in single goes to showcase', async () => {
  const L = await load();
  const s = L.closePane(L.openSingle(L.initial(), 'a'), 'left');
  assert.equal(s.view, 'showcase');
});

test('inputs are not mutated', async () => {
  const L = await load();
  const deep = (o) => Object.freeze(o);
  const a = deep(L.openSingle(L.initial(), 'a'));
  const sp = deep(L.dropOnSide(a, 'b', 'right'));
  L.openSingle(sp, 'c'); L.dropOnSide(sp, 'a', 'right'); L.focus(sp, 'left');
  L.closePane(sp, 'left'); L.home(sp); L.visible(sp);
  assert.ok(true);
});
