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

test('標題同步貼文內容：只換第一個【…】行、沒有就不補、英數斷行補空格', async () => {
  const { syncTitleLine, joinTitle } = await import('../tools/fbpost/title.js');
  assert.equal(joinTitle('史上首次\n美中俄三方會'), '史上首次美中俄三方會');
  assert.equal(joinTitle('新款 iPhone\n17 開賣'), '新款 iPhone 17 開賣');
  assert.equal(joinTitle('\n 標題 \n\n'), '標題');
  assert.equal(syncTitleLine('\n【舊標題】\n圖說\n#tag', '新\n標題'), '\n【新標題】\n圖說\n#tag');
  assert.equal(syncTitleLine('小編\n【A】\n【B】', 'C'), '小編\n【C】\n【B】');
  assert.equal(syncTitleLine('小編文\n圖說', '新標題'), '小編文\n圖說');
  assert.equal(syncTitleLine('句中【不是整行】喔', 'X'), '句中【不是整行】喔');
});
