// 網新規則搬到 sdk/news-*.js 後的單元測試（測試內容取自 unnn3ing-oss/schedulenewnet test/*.test.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser } = require('./dom-shim.js');
global.DOMParser = DOMParser;   // parseArticle 用瀏覽器的 DOMParser；Node 用測試用的極簡版

let R, A, S;
test.before(async () => {
  R = await import('../sdk/news-rules.js');
  A = await import('../sdk/news-article.js');
  S = await import('../sdk/news-sched.js');
});

// ---- rules ----

test('charWidth：全形 1、半形 0.5', () => {
  assert.equal(R.charWidth('颱風假'), 3);
  assert.equal(R.charWidth('abc'), 1.5);
  assert.equal(R.charWidth('颱風 A！'), 2 + 0.5 + 0.5 + 1);
  assert.equal(R.charWidth(''), 0);
  assert.equal(R.charWidth(null), 0);
});

test('articleId', () => {
  assert.equal(R.articleId('https://news.tvbs.com.tw/life/3012345'), '3012345');
  assert.equal(R.articleId('https://news.tvbs.com.tw/life/3012345?from=x'), '3012345');
  assert.equal(R.articleId('https://news.tvbs.com.tw/life/3012345#a'), '3012345');
  assert.equal(R.articleId('https://news.tvbs.com.tw/life/12345'), '');
  assert.equal(R.articleId(''), '');
});

test('shortTitle：第一行去空白取前 5 字', () => {
  assert.equal(R.shortTitle(['颱風假 最新！北北基桃', '明天']), '颱風假最新');
  assert.equal(R.shortTitle(['ab', 'x']), 'ab');
  assert.equal(R.shortTitle([]), '');
});

test('buildLink', () => {
  const utm = 'utm_source=facebook&utm_medium=fbarticlepic';
  assert.equal(R.buildLink('', utm), '');
  assert.equal(R.buildLink('https://a.tw/1234567', utm), 'https://a.tw/1234567?' + utm);
  assert.equal(R.buildLink('https://a.tw/1234567?x=1', utm), 'https://a.tw/1234567?x=1&' + utm);
  assert.equal(R.buildLink('https://a.tw/1234567#top', utm), 'https://a.tw/1234567?' + utm + '#top');
  const done = 'https://a.tw/1234567?' + utm;
  assert.equal(R.buildLink(done, utm), done, '已含同參數不重複');
  assert.equal(R.buildLink('https://a.tw/1?utm_medium=fbarticlepic&utm_source=facebook', utm), 'https://a.tw/1?utm_medium=fbarticlepic&utm_source=facebook');
});

test('buildLink：接受問號與 & 前綴，保留既有參數與錨點、不重複附加', () => {
  const utm = 'utm_source=facebook&utm_medium=tvbsteatimenewspic';
  for (const prefix of ['?', '?&', '&']) {
    assert.equal(R.buildLink('https://a.tw/1', prefix + utm), 'https://a.tw/1?' + utm);
    assert.equal(R.buildLink('https://a.tw/1?x=1#top', prefix + utm), 'https://a.tw/1?x=1&' + utm + '#top');
    const done = 'https://a.tw/1?' + utm;
    assert.equal(R.buildLink(done, prefix + utm), done);
  }
  assert.equal(R.buildLink('https://a.tw/1', ' ?& '), 'https://a.tw/1');
});

test('buildLink：氣象大寫 Facebook 原樣帶出、不重複', () => {
  const wx = 'utm_source=Facebook&utm_medium=18weather';
  assert.equal(wx, 'utm_source=Facebook&utm_medium=18weather');
  const link = R.buildLink('https://a.tw/1234567', wx);
  assert.ok(link.includes('utm_source=Facebook'));
  assert.ok(!link.includes('utm_source=facebook'));
  assert.equal(R.buildLink(link, wx), link);
  assert.equal(link.split('utm_source').length - 1, 1);
});


// 以下兩則取自 quickpatterntool/test/quickfill.test.js
test('breakTitle 對改標的換行維持原本行為（回歸）', () => {
  assert.strictEqual(R.breakTitle('蔡英文現身！12萬洋流挺沈伯洋　賴清德：對手認知作戰已開始').length, 3);
});

test('overrideLines：改標有換行就照小編排好的分行，不再重新斷行', () => {
  assert.deepStrictEqual(R.overrideLines('定期保養的 5 個重點\n第 3 項最多人漏掉'), ['定期保養的 5 個重點', '第 3 項最多人漏掉']);
  assert.deepStrictEqual(R.overrideLines('iPhone 17 Pro開賣\n果粉：價格還能接受'), ['iPhone 17 Pro開賣', '果粉：價格還能接受']);
});

test('overrideLines：單行改標交給 breakTitle', () => {
  const t = '蔡英文現身！12萬洋流挺沈伯洋　賴清德：對手認知作戰已開始';
  assert.deepStrictEqual(R.overrideLines(t), R.breakTitle(t));
});

test('breakTitle：強斷點與冒號補斷', () => {
  assert.deepStrictEqual(R.breakTitle('颱風假最新！北北基桃明天照常上班上課'), ['颱風假最新！', '北北基桃明天照常上班上課']);
  assert.deepStrictEqual(R.breakTitle('賴清德：對手認知作戰已開始'), ['賴清德：', '對手認知作戰已開始']);
});

test('frameForUrl：entertainment 網址用娛樂框，其他用新聞框', () => {
  assert.equal(R.frameForUrl('https://news.tvbs.com.tw/entertainment/3012345'), 'ent');
  assert.equal(R.frameForUrl('https://news.tvbs.com.tw/entertainment/3012345?from=x'), 'ent');
  assert.equal(R.frameForUrl('https://news.tvbs.com.tw/life/4044422'), 'news');
  assert.equal(R.frameForUrl(''), 'news');
});

test('autoLines：沒空格沒標點的長標題，在成對引號前後斷開', () => {
  assert.deepEqual(R.autoLines('莫允雯、江宜蓉宣傳「有愛我們床上談」現身聯誼活動'), ['莫允雯、江宜蓉宣傳', '「有愛我們床上談」', '現身聯誼活動']);
  assert.deepEqual(R.autoLines('短標題「引號」'), ['短標題「引號」'], '放得下一行就不動');
  assert.deepEqual(R.autoLines('蔡英文現身！12萬洋流挺沈伯洋　賴清德：對手認知作戰已開始'), R.overrideLines('蔡英文現身！12萬洋流挺沈伯洋　賴清德：對手認知作戰已開始'), '原本就斷得出來的不碰');
  assert.deepEqual(R.autoLines('前面一長串文字「引號內容」\n後面'), R.overrideLines('前面一長串文字「引號內容」\n後面'), '小編自己排的換行不碰');
});

// ---- article ----
const URL0 = 'https://news.tvbs.com.tw/life/3012345';
const IMG = 'https://cc.tvbs.com.tw/img/upload/2026/10/26/20261026101010-aa.jpg';
// 類似 TVBS 文章頁：og:title 帶站名、og:image＝內文第一張圖、figcaption 有（圖／TVBS）、hashtag 是「#颱風」連結
const PAGE = `<!doctype html><html><head>
<meta charset="utf-8">
<title>颱風假最新！北北基桃明天照常上班上課｜TVBS新聞網</title>
<meta property="og:title" content="颱風假最新！北北基桃　明天照常上班上課｜TVBS新聞網">
<meta property="og:image" content="${IMG}">
<meta name="keywords" content="不該用到,關鍵字">
</head><body>
<header><img src="/img/logo.png" alt="TVBS"></header>
<article>
  <h1>颱風假最新！北北基桃　明天照常上班上課</h1>
  <figure><img src="${IMG}?w=800" alt="颱風"><figcaption>北北基桃宣布明天照常上班上課。（圖／TVBS）</figcaption></figure>
  <p>記者 王小明（記者王小明／台北報導）颱風外圍環流影響&hellip;</p>
  <figure><img data-src="https://cc.tvbs.com.tw/img/b.jpg"><figcaption>（示意圖／shutterstock達志影像）</figcaption></figure>
  <div class="article-tags"><a href="/tag/颱風">#颱風</a><a href="/tag/停班停課">#停班停課</a><a href="/tag/氣象署">#氣象署</a><a href="/tag/北北基桃">#北北基桃</a><a href="/tag/颱風假">#颱風假</a></div>
</article></body></html>`;

test('parseArticle：標題去站名、主圖圖說、hashtag 連結', () => {
  const a = A.parseArticle(PAGE, URL0);
  assert.equal(a.title, '颱風假最新！北北基桃 明天照常上班上課');
  assert.equal(a.images[0].url, IMG);
  assert.equal(a.images[0].caption, '（圖／TVBS）');
  assert.deepEqual(a.images.map(i => i.url), [IMG, 'https://cc.tvbs.com.tw/img/b.jpg'], 'logo 不算；和 og:image 同一張不重複');
  assert.equal(a.images[1].caption, '（示意圖／shutterstock達志影像）');
  assert.equal(a.fallbackCaption, '（圖／TVBS）');
  assert.deepEqual(a.tags, ['颱風', '停班停課', '氣象署', '北北基桃', '颱風假']);
  assert.equal(A.mainCaption(a), '（圖／TVBS）');
});

test('parseArticle：沒有 hashtag 連結、標籤區、meta 時用 JSON-LD 的 keywords', () => {
  const html = `<html><head><meta property="og:title" content="測試標題 | TVBS">
<script type="application/ld+json">{"@type":"NewsArticle","keywords":"颱風,停班,氣象署,中央氣象署"}</script></head>
<body><article><p>內文沒有圖。</p></article></body></html>`;
  const a = A.parseArticle(html, URL0);
  assert.equal(a.title, '測試標題');
  assert.deepEqual(a.tags, ['颱風', '停班', '氣象署', '中央氣象署']);
  assert.deepEqual(a.images, []);
  assert.equal(A.mainCaption(a), '');
});

test('parseArticle：主圖不在內文時，主圖沒有圖說 → 用 fallbackCaption', () => {
  const html = `<html><head><meta property="og:image" content="https://cc.tvbs.com.tw/og.jpg"></head>
<body><article><figure><img src="https://cc.tvbs.com.tw/x.jpg"><figcaption>（圖／記者攝）</figcaption></figure></article></body></html>`;
  const a = A.parseArticle(html, URL0);
  assert.equal(a.images[0].caption, '');
  assert.equal(A.mainCaption(a), '（圖／記者攝）');
});

test('pickTags：只留 2～3 字、最多 3 個、互相包含的往後排', () => {
  assert.deepEqual(A.pickTags(['颱風', '停班停課', '氣象署', '北北基桃', '颱風假']), ['氣象署', '颱風', '颱風假']);
  assert.deepEqual(A.pickTags(['沈伯洋', '政治', '民進黨主席', '柯', '國民黨', '立法院']), ['沈伯洋', '政治', '國民黨']);
  assert.deepEqual(A.pickTags(['停班停課', '中央氣象署']), []);
  assert.deepEqual(A.pickTags(undefined), []);
});

test('formatCopy：【標題】／圖說／#標籤，缺的行就不出現', () => {
  assert.equal(A.formatCopy({ title: '颱風假最新！北北基桃 明天照常上班上課', caption: '（圖／TVBS）', tags: ['颱風', '停班停課', '氣象署'] }),
    '【颱風假最新！北北基桃 明天照常上班上課】\n（圖／TVBS）\n#颱風 #氣象署');
  assert.equal(A.formatCopy({ title: '標題', caption: '', tags: [] }), '【標題】');
  assert.equal(A.formatCopy({ title: '', caption: '（圖／TVBS）', tags: ['颱', '中央氣象署'] }), '（圖／TVBS）');
});

test('learnSeps／titleAsOneLine：沒改過的相鄰兩行接回原標題，新的用空格接', () => {
  const t = '蔡英文現身！12萬洋流挺沈伯洋　賴清德：對手認知作戰已開始';
  const lines = R.breakTitle(t);
  const el = { value: lines.join('\n') };
  A.bindTitle(el);
  A.learnSeps(A.overrideOneLine(t), lines);
  assert.equal(A.titleAsOneLine(), t);
  el.value = lines.slice(0, 2).join('\n') + '\n賴清德：已開始';
  assert.equal(A.titleAsOneLine(), '蔡英文現身！12萬洋流挺沈伯洋 賴清德：已開始');
  A.learnSeps('', []);
  el.value = '颱風假最新！\n北北基桃\n\n明天照常上班';
  assert.equal(A.titleAsOneLine(), '颱風假最新！ 北北基桃 明天照常上班');
});

test('replaceTitleLine：不論在第幾行都只換【…】那一行', () => {
  const cap = 'AI 寫的開頭\n【舊標題】\n（圖／TVBS）\n#颱風';
  assert.deepEqual(A.replaceTitleLine(cap, '新標題', '舊標題'), { text: 'AI 寫的開頭\n【新標題】\n（圖／TVBS）\n#颱風', index: 1 });
  // 上次同步的標題找不到（小編改過【】裡面的字）→ 找第一個【…】行
  assert.deepEqual(A.replaceTitleLine('小編改的\n【小編改過的標題】\n#颱風', '新標題', '舊標題').text, '小編改的\n【新標題】\n#颱風');
  // AI 文字裡也有【…】：優先換上次同步的那一行
  assert.equal(A.replaceTitleLine('【快訊】AI 的開頭\n【舊標題】\n#颱風', '新', '舊標題').text, '【快訊】AI 的開頭\n【新】\n#颱風');
  assert.equal(A.replaceTitleLine('【快訊】\n【舊標題】', '新', '舊標題').text, '【快訊】\n【新】');
  // 【】那一行被刪掉：不補回來
  assert.deepEqual(A.replaceTitleLine('只有小編文\n#颱風', '新標題', '舊標題'), { text: '只有小編文\n#颱風', index: -1 });
  // 標題清空：留下【】，之後還接得上
  const empty = A.replaceTitleLine('【舊】\n#颱風', '', '舊');
  assert.equal(empty.text, '【】\n#颱風');
  assert.equal(A.replaceTitleLine(empty.text, '再打', '').text, '【再打】\n#颱風');
  assert.equal(A.replaceTitleLine('', 'x', null).index, -1);
});

test('parseArticle：h1 與 og:title 不同時以頁面顯示的 h1 為準', () => {
  const html = `<html><head><meta property="og:title" content="莫允雯、江宜蓉宣傳「有愛我們床上談」現身松山奉天宮聯誼｜TVBS新聞網"></head>
<body><article><h1>莫允雯、江宜蓉宣傳「有愛我們床上談」現身聯誼活動</h1></article></body></html>`;
  assert.equal(A.parseArticle(html, URL0).title, '莫允雯、江宜蓉宣傳「有愛我們床上談」現身聯誼活動');
});

// ---- sched ----
const NOW = new Date(2026, 9, 25, 14, 3, 27);   // 2026-10-25 14:03:27（本機時區）

test('formatTyping：剛好 4 碼補冒號，其他原樣', () => {
  assert.equal(S.formatTyping('2130'), '21:30');
  assert.equal(S.formatTyping('0905'), '09:05');
  assert.equal(S.formatTyping('213'), '213');
  assert.equal(S.formatTyping('21:30'), '21:30');
  assert.equal(S.formatTyping(''), '');
  assert.equal(S.formatTyping('ab12'), 'ab12');
});

test('parseTime', () => {
  assert.deepEqual(S.parseTime('2130'), { h: 21, m: 30 });
  assert.deepEqual(S.parseTime('21:30'), { h: 21, m: 30 });
  assert.deepEqual(S.parseTime('930'), { h: 9, m: 30 });
  assert.deepEqual(S.parseTime('0:00'), { h: 0, m: 0 });
  assert.equal(S.parseTime('2430'), null);
  assert.equal(S.parseTime('2160'), null);
  assert.equal(S.parseTime('21'), null);
  assert.equal(S.parseTime('21:3'), null);
  assert.equal(S.parseTime(null), null);
});

test('combine：日期字串或 Date＋時間', () => {
  const d = S.combine('2026-10-26', '2130');
  assert.equal(d.getFullYear(), 2026); assert.equal(d.getMonth(), 9); assert.equal(d.getDate(), 26);
  assert.equal(d.getHours(), 21); assert.equal(d.getMinutes(), 30); assert.equal(d.getSeconds(), 0);
  assert.equal(S.combine(NOW, '21:30').getDate(), 25);
  assert.equal(S.combine('2026-10-26', '25:00'), null);
  assert.equal(S.combine('bad', '21:30'), null);
});

test('defaultAt：現在＋30 分並取到 10 分整', () => {
  const d = S.defaultAt(NOW);   // 14:33:27 → 14:40
  assert.equal(S.fmtTime(d), '14:40');
  assert.ok(d - NOW >= 30 * 60000);
  assert.equal(S.fmtTime(S.defaultAt(new Date(2026, 9, 25, 14, 10, 0))), '14:40');   // 剛好整 10 分不再進位
  const late = S.defaultAt(new Date(2026, 9, 25, 23, 45, 0));
  assert.equal(late.getDate(), 26); assert.equal(S.fmtTime(late), '00:20');
});

test('validate：最早 現在＋10 分（不取整）、最晚 30 天', () => {
  const plus = m => new Date(NOW.getTime() + m * 60000);
  assert.equal(S.validate(plus(10), NOW), null);
  assert.equal(S.validate(plus(9.9), NOW).code, 'too_soon');
  assert.match(S.validate(plus(5), NOW).msg, /10 分鐘/);
  assert.equal(S.validate(plus(30 * 1440), NOW), null);
  assert.equal(S.validate(plus(30 * 1440 + 1), NOW).code, 'too_late');
  assert.equal(S.validate(null, NOW).code, 'bad_time');
  assert.equal(S.validate(S.combine('2026-10-25', '2130'), NOW), null);
  assert.equal(S.validate(S.combine('2026-10-25', '1412'), NOW).code, 'too_soon');
});

test('step：↑↓ ±10 分，跨日', () => {
  const d = S.combine('2026-10-25', '2355');
  assert.equal(S.fmtTime(S.step(d, 1)), '00:05');
  assert.equal(S.step(d, 1).getDate(), 26);
  assert.equal(S.fmtTime(S.step(d, -1)), '23:45');
});

test('toScheduleString 與 fmtWhen', () => {
  const d = S.combine('2026-10-26', '0905');
  assert.equal(S.toScheduleString(d), '2026-10-26T09:05');
  assert.equal(S.fmtWhen(S.combine('2026-10-25', '2130'), NOW), '21:30');
  assert.equal(S.fmtWhen(d, NOW), '10/26 09:05');
});
