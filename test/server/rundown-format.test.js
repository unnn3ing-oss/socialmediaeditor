const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '../../server/gas/rundown-format.gs'), 'utf8');
const entry = { page: 'news', date: '2026-11-08', time: '15:13', text: '1234567/圖文/測試' };

function run(plan = {}, options = {}) {
  const calls = [];
  const range = (coords) => {
    const r = {};
    for (const method of ['setValue', 'setFontSize', 'setFontWeight', 'setFontColor', 'setHorizontalAlignment', 'clearContent']) {
      r[method] = (...args) => { calls.push({ cell: coords, method, args }); return r; };
    }
    r.moveTo = (to) => { calls.push({ cell: coords, method: 'moveTo', target: to.coords }); return r; };
    r.coords = coords;
    return r;
  };
  const sheet = {
    getDataRange: () => ({ getDisplayValues: () => [['fixture']] }),
    getRange: (...coords) => range(coords),
    insertRowAfter: (row) => calls.push({ method: 'insertRowAfter', row })
  };
  const context = {
    RD_STYLE: { size: 12, bold: true, color: '#9900ff' },
    rdStr: (s) => String(s == null ? '' : s).trim(),
    rdPad: (n) => String(n).padStart(2, '0'),
    rdFindSheetName: () => options.noSheet ? null : '2026/11',
    rdFindDateCol: () => options.noDate ? -1 : 4,
    rdPlan: () => ({ row: 9, time: '15:13', status: 'write', ...plan }),
    rdA1: (row, col) => { assert.equal(row, 9); assert.equal(col, 4); return 'E10'; }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'rundown-format.gs' });
  const result = context.rdAddOne({ getSheetByName: () => sheet }, ['2026/11'], { ...entry, ...options.entry });
  return { calls, result: JSON.parse(JSON.stringify(result)) };
}

const cellCalls = (calls, row, col) => calls.filter((c) => c.cell?.length === 2 && c.cell[0] === row && c.cell[1] === col);
const values = (calls, method) => calls.filter((c) => c.method === method).map((c) => c.args[0]);

test('RD 格式：稿件置中，沿用原有字級／粗體／紫色；補碼是藍色粗體', () => {
  const { calls, result } = run({ codeCol: 5, code: '13' });
  const article = cellCalls(calls, 10, 5), time = cellCalls(calls, 10, 6);
  assert.deepEqual(values(article, 'setValue'), [entry.text]);
  assert.deepEqual(values(article, 'setFontSize'), [12]);
  assert.deepEqual(values(article, 'setFontWeight'), ['bold']);
  assert.deepEqual(values(article, 'setFontColor'), ['#9900ff']);
  assert.deepEqual(values(article, 'setHorizontalAlignment'), ['center']);
  assert.deepEqual(values(time, 'setValue'), ['13']);
  assert.deepEqual(values(time, 'setFontColor'), ['#4285f4']);
  assert.deepEqual(values(time, 'setFontWeight'), ['bold']);
  assert.deepEqual(values(time, 'setHorizontalAlignment'), ['center']);
  assert.deepEqual(result, { ok: true, page: 'news', status: 'write', cell: '2026/11!E10', time: '15:13', addedRow: false });
});

test('RD 格式：插列後原稿件／分鐘碼連同格式 moveTo，僅新碼套用藍色粗體', () => {
  const { calls, result } = run({ status: 'insert', codeCol: 5, code: '-5', shiftTo: 12, addRow: 12 });
  assert.deepEqual(calls[0], { method: 'insertRowAfter', row: 12 });
  assert.deepEqual(calls.filter((c) => c.method === 'moveTo'), [
    { cell: [10, 5, 3, 1], method: 'moveTo', target: [11, 5] },
    { cell: [10, 6, 3, 1], method: 'moveTo', target: [11, 6] }
  ]);
  assert.deepEqual(values(cellCalls(calls, 10, 6), 'setValue'), ['-5']);
  assert.deepEqual(values(cellCalls(calls, 10, 6), 'setFontColor'), ['#4285f4']);
  assert.ok(calls.filter((c) => c.method.startsWith('set')).every((c) => c.cell.length === 2 && c.cell[0] === 10 && [5, 6].includes(c.cell[1])));
  assert.equal(result.addedRow, true);
});

test('RD 格式：插入但沒有新碼時只清空該格，不套格式或填假碼', () => {
  const { calls } = run({ status: 'insert', codeCol: 5, code: null, shiftTo: 11 });
  assert.deepEqual(cellCalls(calls, 10, 6), [{ cell: [10, 6], method: 'clearContent', args: [] }]);
});

test('RD 格式：沒有碼欄不寫旁邊的格子，數字0時間碼仍正常寫入', () => {
  const noCode = run();
  assert.ok(noCode.calls.every((c) => c.cell[0] === 10 && c.cell[1] === 5));
  const zero = run({ codeCol: 5, code: 0 });
  assert.deepEqual(values(cellCalls(zero.calls, 10, 6), 'setValue'), [0]);
  assert.deepEqual(values(cellCalls(zero.calls, 10, 6), 'setFontWeight'), ['bold']);
});

test('RD 格式：已存在稿件維持既有回傳，不插入或改動其他時間碼', () => {
  const { calls, result } = run({ status: 'exists' });
  assert.equal(result.status, 'exists');
  assert.equal(calls.some((c) => c.method === 'moveTo' || c.method === 'insertRowAfter'), false);
  assert.deepEqual(values(cellCalls(calls, 10, 5), 'setHorizontalAlignment'), ['center']);
  assert.ok(calls.every((c) => c.cell[1] === 5));
});

test('RD 格式：找不到日期／分頁、規劃失敗或輸入不完整時不動試算表', () => {
  for (const [plan, options] of [
    [{ error: '時段已滿' }, {}], [{}, { noSheet: true }], [{}, { noDate: true }],
    [{}, { entry: { date: '' } }], [{}, { entry: { time: '' } }], [{}, { entry: { text: '' } }]
  ]) {
    const { calls, result } = run(plan, options);
    assert.equal(result.ok, false);
    assert.deepEqual(calls, []);
  }
});
