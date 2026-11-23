// 排程發布值班粉專：班段切法與讀寫（純函式）
const test = require('node:test');
const assert = require('node:assert/strict');
let mod;
const load = async () => (mod = mod || (await import('../tools/fbpost/duty.js')));
const at = (h, m, d = 21) => new Date(2026, 10, d, h, m).getTime();
function mem() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }

test('班段：14:30 前選＝早班、14:30 起＝晚班（沒有大夜）', async () => {
  const { shiftOf } = await load();
  assert.equal(shiftOf(at(0, 30)).key, '2026-11-21-am');
  assert.equal(shiftOf(at(7, 30)).key, '2026-11-21-am');
  assert.equal(shiftOf(at(14, 29)).key, '2026-11-21-am');
  assert.equal(shiftOf(at(14, 30)).key, '2026-11-21-pm');
  assert.equal(shiftOf(at(23, 59)).key, '2026-11-21-pm');
  assert.match(shiftOf(at(15, 0)).name, /^晚班/);
});

test('有效期限：早班到當天 16:30、晚班到隔天 00:00；晚班 15:00 選好 16:00／16:30 都不重問', async () => {
  const { readDuty, writeDuty, DUTY_KEY } = await load();
  const s = mem();
  assert.equal(readDuty(s, at(9, 0)), null);
  writeDuty(s, at(9, 0), ['111', '222']);
  assert.deepEqual(readDuty(s, at(16, 29)), ['111', '222']);
  assert.equal(readDuty(s, at(16, 30)), null, '早班 16:30 失效');
  writeDuty(s, at(15, 0), ['333']);
  assert.deepEqual(readDuty(s, at(16, 0)), ['333']);
  assert.deepEqual(readDuty(s, at(16, 30)), ['333']);
  assert.deepEqual(readDuty(s, at(23, 59)), ['333']);
  assert.equal(readDuty(s, at(0, 0, 22)), null, '晚班 00:00 失效');
  s.setItem(DUTY_KEY, JSON.stringify({ shift: '2026-11-21-night', pages: ['1'] }));
  assert.deepEqual(readDuty(s, at(7, 0)), ['1'], '舊版大夜紀錄到 07:30');
  assert.equal(readDuty(s, at(7, 30)), null);
  s.setItem(DUTY_KEY, JSON.stringify({ shift: '2026-11-25-am', pages: ['1'] }));
  assert.equal(readDuty(s, at(9, 0)), null, '未來日期的怪資料不算');
  s.setItem(DUTY_KEY, '{bad');
  assert.equal(readDuty(s, at(9, 0)), null);
  s.setItem(DUTY_KEY, JSON.stringify({ shift: '2026-11-21-am', pages: [1] }));
  assert.equal(readDuty(s, at(9, 0)), null);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(readDuty(broken, at(9, 0)), null);
  writeDuty(broken, at(9, 0), ['1']);   // 不丟錯
});
