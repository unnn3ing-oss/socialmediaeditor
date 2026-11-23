const test = require('node:test');
const assert = require('node:assert/strict');

test('fbPostUrl：粉專_貼文 改 /粉專/posts/貼文；單一 ID 照舊；格式不對回空', async () => {
  const { fbPostUrl } = await import('../shell/notices.js');
  assert.equal(fbPostUrl('111_222'), 'https://www.facebook.com/111/posts/222');
  assert.equal(fbPostUrl('333'), 'https://www.facebook.com/333');
  assert.equal(fbPostUrl(''), '');
  assert.equal(fbPostUrl('abc'), '');
  assert.equal(fbPostUrl('1_2_3'), '');
  assert.equal(fbPostUrl(null), '');
});
