const test = require('node:test');
const assert = require('node:assert/strict');

test('標題字數：每行 15 字（全形 1、半形 0.5）、最多 4 行；只提醒不擋', async () => {
  const { titleCheck } = await import('../tools/fbpost/title.js');
  const ok = titleCheck('Buffet離場「偷換人吃」會被抓？\n員工曝驚人內幕：\n恐背詐欺罪');
  assert.deepEqual(ok.widths, [15, 8, 5]);
  assert.equal(ok.ok, true);
  assert.equal(ok.text, '每行 15 字（全形 1、半形 0.5），最多 4 行・目前 15／8／5');
  const long = titleCheck('一二三四五六七八九十一二三四五六\n短');
  assert.equal(long.ok, false);
  assert.match(long.text, /第 1 行 16 字，超過 15 字（仍可送出）/);
  const many = titleCheck('一\n二\n三\n四\n五');
  assert.equal(many.ok, false);
  assert.match(many.text, /5 行，超過 4 行（第 5 行起不會畫在圖上）/);
  assert.equal(titleCheck('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234').widths[0], 15);
  assert.equal(titleCheck('\n\n標題\n').widths.join(), '2', '頭尾空行不算');
  assert.equal(titleCheck('').text, '每行 15 字（全形 1、半形 0.5），最多 4 行');
});
