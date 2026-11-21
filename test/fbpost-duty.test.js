// 排程發布值班粉專：班段切法與讀寫（純函式）
const test = require('node:test');
const assert = require('node:assert/strict');
let mod;
const load = async () => (mod = mod || (await import('../tools/fbpost/duty.js')));
const at = (h, m, d = 21) => new Date(2026, 10, d, h, m).getTime();
function mem() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }

test('班段：07:30 起早班、16:00 起晚班、00:00 起大夜（換日）', async () => {
  const { shiftOf } = await load();
  assert.equal(shiftOf(at(7, 29)).key, '2026-11-21-night');
  assert.equal(shiftOf(at(7, 30)).key, '2026-11-21-am');
  assert.equal(shiftOf(at(15, 59)).key, '2026-11-21-am');
  assert.equal(shiftOf(at(16, 0)).key, '2026-11-21-pm');
  assert.equal(shiftOf(at(23, 59)).key, '2026-11-21-pm');
  assert.equal(shiftOf(at(0, 0, 22)).key, '2026-11-22-night');
  assert.match(shiftOf(at(16, 0)).name, /^晚班/);
});

test('讀寫：同班段讀得到，換班段或資料壞掉回 null', async () => {
  const { readDuty, writeDuty, DUTY_KEY } = await load();
  const s = mem();
  assert.equal(readDuty(s, at(9, 0)), null);
  writeDuty(s, at(9, 0), ['111', '222']);
  assert.deepEqual(readDuty(s, at(15, 59)), ['111', '222']);
  assert.equal(readDuty(s, at(16, 0)), null, '換班段要重選');
  s.setItem(DUTY_KEY, '{bad');
  assert.equal(readDuty(s, at(9, 0)), null);
  s.setItem(DUTY_KEY, JSON.stringify({ shift: '2026-11-21-am', pages: [1] }));
  assert.equal(readDuty(s, at(9, 0)), null);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(readDuty(broken, at(9, 0)), null);
  writeDuty(broken, at(9, 0), ['1']);   // 不丟錯
});
