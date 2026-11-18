const test = require('node:test');
const assert = require('node:assert/strict');
let R;
const load = async () => (R = R || (await import('../tools/fbvideo/rules.js')));

test('檔名 → 標題：去副檔名、內建 Reels_／Shorts_、自訂前後綴', async () => {
  const { titleFromName } = await load();
  assert.equal(titleFromName('立法院今三讀通過.mp4'), '立法院今三讀通過');
  assert.equal(titleFromName('Reels_立法院.mp4'), '立法院');
  assert.equal(titleFromName('shorts_立法院.MOV'), '立法院');
  assert.equal(titleFromName('Reels_1118_立法院_v2.mp4', { prefixes: ['1118_'], suffixes: ['_v2'] }), '立法院');
  assert.equal(titleFromName('Reels_.mp4'), 'Reels_', '整個名字都是前綴就不去');
  assert.equal(titleFromName('a.b.c.mp4'), 'a.b.c');
});

test('Reels 判斷與自動 hashtag 條件', async () => {
  const { autoKind, isReelsName } = await load();
  assert.equal(autoKind('Reels_a.mp4', 1920, 1080), 'reel');
  assert.equal(autoKind('Shorts_a.mp4', 1920, 1080), 'reel');
  assert.equal(autoKind('a.mp4', 1080, 1920), 'reel');
  assert.equal(autoKind('a.mp4', 1920, 1080), 'video');
  assert.equal(autoKind('a.mp4', 0, 0), 'video');
  assert.equal(isReelsName('Reels_a.mp4'), true);
  assert.equal(isReelsName('Shorts_a.mp4'), false);
});

test('預設排法與換標題', async () => {
  const { defaultText, setTitle } = await load();
  assert.equal(defaultText('標', '#t', '授權'), '\n【標】\n#t\n授權');
  assert.equal(defaultText('標'), '\n【標】');
  assert.equal(setTitle('', '新'), '\n【新】');
  assert.equal(setTitle('小編\n第二行\n【舊】\n#t', '新'), '小編\n第二行\n【新】\n#t');
  assert.equal(setTitle('只有小編文', '新'), '只有小編文\n【新】');
});

test('hashtag：標題下一行；加、移除、空了刪行；小編文多行不跑位；沒標題退回第 3 行', async () => {
  const { toggleTag, tagsIn } = await load();
  let r = toggleTag('\n【標】', '#a');
  assert.equal(r.text, '\n【標】\n#a');
  r = toggleTag(r.text, '#b');
  assert.equal(r.text, '\n【標】\n#a #b');
  assert.deepEqual(tagsIn(r.text), ['#a', '#b']);
  r = toggleTag(r.text, '#a');
  assert.equal(r.text, '\n【標】\n#b');
  r = toggleTag(r.text, '#b');
  assert.equal(r.text, '\n【標】');
  r = toggleTag('第一行\n第二行\n【標】\n授權', '#a');
  assert.equal(r.text, '第一行\n第二行\n【標】\n#a\n授權');
  r = toggleTag('沒有標題', '#a');
  assert.deepEqual([r.text, r.fallback], ['沒有標題\n\n#a', true]);
});

test('授權：原地換、清空刪行、插在 hashtag 行下；照原樣', async () => {
  const { setLicense } = await load();
  let r = setLicense('\n【標】\n#a', '畫面：A台');
  assert.equal(r.text, '\n【標】\n#a\n畫面：A台');
  r = setLicense(r.text, '畫面：B台', '畫面：A台');
  assert.equal(r.text, '\n【標】\n#a\n畫面：B台');
  r = setLicense(r.text, '', '畫面：B台');
  assert.equal(r.text, '\n【標】\n#a');
  r = setLicense('\n【標】', 'X');
  assert.equal(r.text, '\n【標】\nX');
  r = setLicense('a\nb\nc\n【標】\n#t\n結尾', 'X');
  assert.equal(r.text, 'a\nb\nc\n【標】\n#t\nX\n結尾');
  r = setLicense('沒有標題', 'X');
  assert.deepEqual([r.text, r.fallback], ['沒有標題\n\n\nX', true]);
});

test('RD 與 SLUG、去開頭空行', async () => {
  const { rdText, slugOf, stripLead } = await load();
  assert.equal(rdText('video', '立法院今'), '純影/立法院今');
  assert.equal(rdText('reel', '立法院今'), 'Reels/立法院今');
  assert.equal(slugOf('', '快訊／立法院今三讀'), '立法院今');
  assert.equal(slugOf('手填 SLUG!', '標'), '手填SLUG');
  assert.equal(stripLead('\n\n【標】\n#a'), '【標】\n#a');
});
