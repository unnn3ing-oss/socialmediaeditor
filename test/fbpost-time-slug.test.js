const test = require('node:test');
const assert = require('node:assert/strict');

const T = () => import('../tools/fbpost/time.js');
const S = () => import('../tools/fbpost/slug.js');
const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();

test('time：打 4 碼自動補冒號、解析時間', async () => {
  const { typing, parseHM } = await T();
  assert.equal(typing('2130'), '21:30');
  assert.equal(typing('930'), '930');
  assert.equal(typing('21:3'), '21:3');
  assert.deepEqual(parseHM('2130'), { h: 21, m: 30 });
  assert.deepEqual(parseHM('9:05'), { h: 9, m: 5 });
  assert.equal(parseHM('2460'), null);
  assert.equal(parseHM('25:00'), null);
  assert.equal(parseHM('abc'), null);
});

test('time：日期＋時間 ↔ 毫秒；格式化', async () => {
  const { toMs, dateStr, timeStr } = await T();
  const ms = local(2026, 11, 16, 19, 20);
  assert.equal(toMs('2026-11-16', '19:20'), ms);
  assert.equal(toMs('2026-11-16', '1920'), ms);
  assert.equal(toMs('2026-11-16', 'xx'), null);
  assert.equal(toMs('', '19:20'), null);
  assert.equal(dateStr(ms), '2026-11-16');
  assert.equal(timeStr(ms), '19:20');
});

test('time：↑↓ 每次 10 分、+30 分、+1 小時、明天（跨日）', async () => {
  const { step, plus, tomorrow } = await T();
  const ms = local(2026, 11, 16, 23, 55);
  assert.equal(step(ms, 1), local(2026, 11, 17, 0, 5));
  assert.equal(step(ms, -1), local(2026, 11, 16, 23, 45));
  assert.equal(plus(ms, 30), local(2026, 11, 17, 0, 25));
  assert.equal(plus(ms, 60), local(2026, 11, 17, 0, 55));
  assert.equal(tomorrow(ms), local(2026, 11, 17, 23, 55));
});

test('time：範圍 10 分～30 天與說明', async () => {
  const { check } = await T();
  const now = local(2026, 11, 16, 12, 0);
  assert.equal(check(now + 10 * 60000, now).ok, true);
  assert.equal(check(now + 30 * 86400000, now).ok, true);
  assert.match(check(now + 5 * 60000, now).msg, /至少要晚 10 分鐘/);
  assert.match(check(now + 31 * 86400000, now).msg, /30 天內/);
  assert.match(check(null, now).msg, /時間格式/);
});

test('slug：手填只留文字和數字', async () => {
  const { slugOf } = await S();
  assert.equal(slugOf('秋冬 衣櫃！', ''), '秋冬衣櫃');
  assert.equal(slugOf('》颱風/假#2026', ''), '颱風假2026');
});

test('slug：留空依標題（規則 A）', async () => {
  const { slugOf } = await S();
  assert.equal(slugOf('', '藍營大老拋\n兩岸統一「10年計畫」'), '藍營大老');
  assert.equal(slugOf('', '快訊／蔣萬安激戰沈伯洋\nTVBS封關民調出爐！'), '蔣萬安激');
  assert.equal(slugOf('', '快訊/颱風假'), '颱風假');
  assert.equal(slugOf('', '快訊／\n蔣萬安激戰沈伯洋'), '蔣萬安激');
  assert.equal(slugOf('', '快訊\n蔣萬安激戰沈伯洋'), '蔣萬安激');
  assert.equal(slugOf('', '最新！\n颱風假'), '颱風假');
  assert.equal(slugOf('', '\n\n「秋冬」衣櫃大改造'), '秋冬衣櫃');
  assert.equal(slugOf('', 'Buffet離場「偷換人吃」'), 'Buff');
  assert.equal(slugOf('', '標題／'), '標題');
  assert.equal(slugOf('', ''), '');
});

test('slug：文章 ID 與 RD 文字', async () => {
  const { articleId, rdText } = await S();
  assert.equal(articleId('https://news.tvbs.com.tw/sports/4051394'), '4051394');
  assert.equal(articleId('https://news.tvbs.com.tw/life/4046330?utm=x#a'), '4046330');
  assert.equal(articleId('https://example.com/a'), '');
  assert.equal(rdText('4046330', '秋冬衣櫃'), '4046330/圖文/秋冬衣櫃');
  assert.equal(rdText('4046330', '秋冬衣櫃', 'color'), '4046330/圖文/秋冬衣櫃');
  assert.equal(rdText('4046330', '秋冬衣櫃', 'text'), '4046330/文字/秋冬衣櫃', '純文字寫「文字」');
});

test('RD：相同的筆去重，超過 10 筆分批', async () => {
  const { rdBatches } = await S();
  const e = (i, page = 'news') => ({ page, date: '2026-11-16', time: '19:20', text: `40513${String(i).padStart(2, '0')}/圖文/測試` });
  assert.deepEqual(rdBatches([e(1), e(1), e(1, 'ent')]), [[e(1), e(1, 'ent')]]);
  const many = Array.from({ length: 23 }, (_, i) => e(i));
  const b = rdBatches(many);
  assert.deepEqual(b.map((x) => x.length), [10, 10, 3]);
  assert.deepEqual(b.flat(), many);
  assert.deepEqual(rdBatches([]), []);
});
