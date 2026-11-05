const test = require('node:test');
const assert = require('node:assert/strict');

test('stampName formats YYMMDDHHMM_n', async () => {
  const { stampName } = await import('../sdk/download.js');
  assert.equal(stampName(new Date(2026, 9, 12, 23, 12), 1), '2610122312_1');
  assert.equal(stampName(new Date(2026, 0, 2, 3, 4), 12), '2601020304_12');
});

test('batch waits 500..1000ms between items', async () => {
  const { download } = await import('../sdk/download.js');
  for (const [rng, expected] of [[() => 0, 500], [() => 0.999, 999.5]]) {
    const waits = [];
    const saved = [];
    await download.batch(
      [{ blob: 'a', name: '1' }, { blob: 'b', name: '2' }, { blob: 'c', name: '3' }],
      { rng, wait: async (ms) => { waits.push(ms); }, save: (b, n) => saved.push(n) },
    );
    assert.deepEqual(saved, ['1', '2', '3']);
    assert.equal(waits.length, 2);
    for (const w of waits) assert.ok(Math.abs(w - expected) < 1, `${w} vs ${expected}`);
  }
});

test('buildLogPayload sanitizes code and keeps only four keys', async () => {
  const { buildLogPayload } = await import('../sdk/log.js');
  const p = buildLogPayload('sample', 'Save Failed!', '1.0', 'UA');
  assert.deepEqual(p, { tool: 'sample', code: 'savefailed', ver: '1.0', ua: 'UA' });
  assert.equal(buildLogPayload('s', 'a'.repeat(100), '1', 'u').code.length, 60);
});

test('extra fields never reach the payload', async () => {
  const { buildLogPayload } = await import('../sdk/log.js');
  const p = buildLogPayload('sample', 'x', '1.0', 'UA', { title: 'x' });
  assert.deepEqual(Object.keys(p).sort(), ['code', 'tool', 'ua', 'ver']);
});

test('log.error posts to /logs and never throws', async () => {
  const { createLog } = await import('../sdk/log.js');
  const calls = [];
  createLog('sample', { fetchFn: async (u, o) => { calls.push([u, o]); }, ua: 'UA' }).error('boom');
  assert.match(calls[0][0], /\/logs$/);
  assert.equal(calls[0][1].method, 'POST');
  assert.doesNotThrow(() => createLog('sample', { fetchFn: () => { throw new Error('x'); }, ua: 'UA' }).error('boom'));
  assert.doesNotThrow(() => createLog('sample', { fetchFn: () => Promise.reject(new Error('x')), ua: 'UA' }).error('boom'));
});

test('matchesAccept handles mime wildcard and extensions', async () => {
  const { matchesAccept } = await import('../sdk/files.js');
  assert.ok(matchesAccept({ type: 'image/png', name: 'a.png' }, 'image/*'));
  assert.ok(!matchesAccept({ type: 'text/plain', name: 'a.txt' }, 'image/*'));
  assert.ok(matchesAccept({ type: '', name: 'A.JPG' }, '.jpg,.png'));
});
