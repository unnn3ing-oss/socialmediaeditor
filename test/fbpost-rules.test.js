const test = require('node:test');
const assert = require('node:assert/strict');

test('排程發布框規則：sports／entertainment → 娛樂粉框，其他 → 新聞藍框', async () => {
  const { frameForUrl } = await import('../tools/fbpost/rules.js');
  assert.equal(frameForUrl('https://news.tvbs.com.tw/sports/4051394'), 'entertainment');
  assert.equal(frameForUrl('https://news.tvbs.com.tw/entertainment/123?x=1'), 'entertainment');
  assert.equal(frameForUrl('https://news.tvbs.com.tw/SPORTS/1'), 'entertainment');
  assert.equal(frameForUrl('https://news.tvbs.com.tw/politics/4046330'), 'news');
  assert.equal(frameForUrl('https://news.tvbs.com.tw/life/1'), 'news');
  assert.equal(frameForUrl('不是網址'), 'news');
  assert.equal(frameForUrl(''), 'news');
});
