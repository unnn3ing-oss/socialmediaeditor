const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FIX = path.join(__dirname, 'fixtures', 'livereq');
const read = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');
const load = () => import('../tools/livereq/parse.js');
const OPT = { checked: ['新聞', '國際'], duty: { name: '王小明', contact: '#85001' } };

test('直播需求單：範例一次貼 6 場，拆對、新聞事件與重N正確', async () => {
  const P = await load();
  const list = P.parse(read('batch.txt'));
  assert.deepEqual(list.map((a) => a.event), ['清德巧慧', '伯洋國漳', '蔣萬安', '桃園政見LIVE', '2100看世界', '九點熱話題']);
  assert.equal(list[5].repeat, '重1');
  assert.equal(list[4].lines[0], '2100看世界粉專直播請確認'); // 說明行跟著下一場
  assert.ok(list[3].lines.at(-1).startsWith('●YT內文：'));
  assert.ok(list[5].lines[0].startsWith('**導播好～'));
});

test('沒有 FB：原平台前加 YT:、平台段最後加 FB:＋勾選粉專；值班小編在畫面來源下一行', async () => {
  const P = await load();
  const out = P.build(P.parse(read('batch.txt'))[0], OPT).split('\n');
  const i = out.indexOf('●直播平台：');
  assert.deepEqual(out.slice(i, i + 10), ['●直播平台：', 'YT:', 'TVBS NEWS', '選新聞', '新聞網', '少康', '大白話', 'FB:', '新聞', '國際']);
  const s = out.indexOf('●畫面來源：玉娜4G');
  assert.deepEqual(out.slice(s + 1, s + 3), ['●值班小編：', '王小明 #85001']);
});

test('已有 FB：原行不動、勾選的接後面，「新聞」與「新聞粉」不重複', async () => {
  const P = await load();
  const out = P.build(P.parse(read('batch.txt'))[4], { ...OPT, checked: ['新聞', '少康'] }).split('\n');
  const i = out.indexOf('FB：');
  assert.deepEqual(out.slice(i, i + 4), ['FB：', '新聞粉', '國際粉', '少康']);
  assert.ok(!out.includes('新聞'));
  // 換行式畫面來源：值班小編接在值的後面
  const s = out.indexOf('SUB3 2100看世界直播');
  assert.equal(out[s + 1], '●值班小編：');
});

test('同一行的臉書粉專用「、」接；氣象單的直播形式當畫面來源、符號沿用 ◎', async () => {
  const P = await load();
  const a = P.parse(read('weather.txt'))[0];
  const out = P.build(a, OPT).split('\n');
  assert.ok(out.includes('臉書：新聞粉、氣象粉、國際'));
  const s = out.indexOf('◎直播形式：SNG');
  assert.deepEqual(out.slice(s + 1, s + 3), ['◎值班小編：', '王小明 #85001']);
  assert.equal(a.weather, true);
});

test('九點熱話題：沒有新聞事件欄也算有，YT內文（沒符號）算內文，直播不刪保留在最後', async () => {
  const P = await load();
  const a = P.parse(read('batch.txt'))[5];
  assert.deepEqual(P.check(a, OPT).missing, []);
  const out = P.build(a, OPT).split('\n');
  assert.equal(out.at(-1), '●直播不刪');
  assert.deepEqual(out.slice(-4, -1), ['55台播出 ', '●值班小編：', '王小明 #85001']);
  assert.equal(out.filter((l) => /內文/.test(l)).length, 1);
});

test('畫面來源「待補」只提醒不擋；空白補「待補」；沒有欄位補一行', async () => {
  const P = await load();
  assert.deepEqual(P.check(P.parse(read('batch.txt'))[3], OPT).warnings, ['畫面來源：待補']);
  const empty = P.parse('●新聞事件：A\n●直播平台：\nTVBS NEWS\n●畫面來源：\n●YT標：B｜LIVE')[0];
  assert.ok(P.build(empty, OPT).includes('●畫面來源：待補\n●值班小編：'));
  const none = P.parse('●新聞事件：A\n●直播平台：\nTVBS NEWS\n●YT標：B｜LIVE\n●內文：C')[0];
  const out = P.build(none, OPT);
  assert.match(out, /國際\n●畫面來源：待補\n●值班小編：\n王小明 #85001\n●YT標/);
});

test('沒有內文：標題去掉 LIVE 加上固定句，插在標題後', async () => {
  const P = await load();
  assert.equal(P.titleToBody('賴清德陪同蘇巧慧  板橋慈惠宮參香祈福｜LIVE'), '賴清德陪同蘇巧慧  板橋慈惠宮參香祈福，讓TVBS新聞帶您一起來了解。');
  assert.equal(P.titleToBody('【LIVE】 川普訪台'), '川普訪台，讓TVBS新聞帶您一起來了解。');
  const a = P.parse('●新聞事件：A\n●直播時間：1000\n●直播平台：\nTVBS NEWS\n●畫面來源：X\n●YT標：B｜LIVE')[0];
  assert.match(P.build(a, OPT), /●YT標：B｜LIVE\n●內文：B，讓TVBS新聞帶您一起來了解。$/);
  assert.deepEqual(P.check(a, OPT).missing, []);
});

test('「標」算標題、「文」算內文，內容裡的字不影響', async () => {
  const P = await load();
  assert.equal(P.kindOf('社群標'), 'title');
  assert.equal(P.kindOf('FB小編文'), 'body');
  assert.equal(P.kindOf('標文'), 'title');
  assert.equal(P.fieldOf('李四川表示，目標文化：好'), null);
});

test('缺漏：新聞事件、FB 粉專、值班小編、標題都擋；手動補新聞事件插在最上面', async () => {
  const P = await load();
  const a = P.parse('●直播平台：\nTVBS NEWS\n●畫面來源：X')[0];
  assert.deepEqual(P.check(a, { checked: [], duty: { name: '', contact: '' } }).missing, ['新聞事件', '直播時間', 'FB 粉專', '值班小編', '標題', '內文']);
  assert.deepEqual(P.check(a, { ...OPT, eventOverride: '活動' }).missing, ['直播時間', '標題', '內文']);
  assert.ok(P.build(a, { ...OPT, eventOverride: '活動' }).startsWith('●新聞事件：活動\n'));
  assert.ok(P.check(a, { ...OPT, duty: { name: '王', contact: '' } }).missing.includes('值班小編'));
});

test('18氣象封面提醒：主播與黃色底框標題', async () => {
  const P = await load();
  const w = P.weatherNote(P.parse(read('weather.txt'))[0]);
  assert.equal(w.text, '18氣象直播封面PNG麻煩小幫手，今日主播是吳軒彤，謝謝!\n標題:\n入秋最冷! 週三北東轉濕涼愈晚愈冷\n週四起低溫探13度↓冷到週末五六最凍');
  assert.equal(P.weatherNote(P.parse(read('batch.txt'))[0]), null);
});

test('值班小編到期：早班 16:30、16:00 後晚班到 00:00、凌晨到 08:00', async () => {
  const P = await load();
  const at = (h, m) => new Date(2026, 10, 17, h, m);
  assert.equal(P.dutyExpiry(at(9, 0)), at(16, 30).getTime());
  assert.equal(P.dutyExpiry(at(15, 59)), at(16, 30).getTime());
  assert.equal(P.dutyExpiry(at(16, 0)), new Date(2026, 10, 18, 0, 0).getTime());
  assert.equal(P.dutyExpiry(at(2, 0)), at(8, 0).getTime());
});

test('氣象單後面緊接下一場（沒空行）：封面段留在氣象單', async () => {
  const P = await load();
  const l = P.parse(read('weather.txt').trimEnd() + '\n●新聞事件：下一場\n●YT標：X');
  assert.equal(l.length, 2);
  assert.equal(P.weatherNote(l[0]).ok, true);
  assert.equal(l[1].lines[0], '●新聞事件：下一場');
});

test('直播平台值寫在同一行：拆成欄位名／YT:／值，不把 YT: 插到欄位行前', async () => {
  const P = await load();
  const out = P.build(P.parse('●新聞事件：A\n●直播平台：TVBS NEWS\n●畫面來源：X\n●YT標：B｜LIVE\n●內文：C')[0], OPT).split('\n');
  assert.deepEqual(out.slice(0, 7), ['●新聞事件：A', '●直播平台：', 'YT:', 'TVBS NEWS', 'FB:', '新聞', '國際']);
  const fb = P.parse('●新聞事件：A\n●直播平台：FB 新聞\n●畫面來源：X\n●YT標：B｜LIVE\n●內文：C')[0];
  assert.deepEqual(fb.fbExisting, ['新聞']);
  assert.ok(!P.build(fb, OPT).includes('YT:'));
});

test('直播時間：必填；九點熱話題開頭時間算有；18氣象站自動 18:00 不插行；手補放新聞事件下一行', async () => {
  const P = await load();
  const list = P.parse(read('batch.txt'));
  assert.equal(list[5].time, '21:00~21:XX:XX(第一段廣告前)');
  const w = P.parse(read('weather.txt'))[0];
  assert.equal(w.time, '18:00');
  assert.ok(!P.check(w, OPT).missing.includes('直播時間'));
  assert.doesNotMatch(P.build(w, OPT), /直播時間/);
  const a = P.parse('●新聞事件：記者會\n●直播平台：\nTVBS NEWS\n●畫面來源：X\n●YT標：B｜LIVE')[0];
  assert.deepEqual(P.check(a, OPT).missing, ['直播時間']);
  assert.deepEqual(P.check(a, { ...OPT, timeOverride: '1430' }).missing, []);
  assert.match(P.build(a, { ...OPT, timeOverride: '1430' }), /^●新聞事件：記者會\n●直播時間：1430\n●直播平台：/);
  const b = P.parse('●直播平台：\nTVBS NEWS\n●畫面來源：X\n●YT標：B')[0];
  assert.match(P.build(b, { ...OPT, eventOverride: '活動', timeOverride: '1430' }), /^●新聞事件：活動\n●直播時間：1430\n●直播平台：/);
  const c = P.parse('●新聞事件：A\n●直播時間：\n●直播平台：\nTVBS NEWS\n●YT標：B')[0];
  assert.match(P.build(c, { ...OPT, timeOverride: '0900' }), /●直播時間：0900\n/);
});

test('固定時段節目沒寫直播時間：只提醒、不擋；一般活動照擋', async () => {
  const P = await load();
  const prog = P.parse('**導播好～ 【#TVBS十點不一樣】 直播需要麻煩**\n●直播平台：\nTVBS NEWS\n●畫面來源：X\n●YT標：B')[0];
  assert.equal(prog.program, true);
  const r = P.check(prog, OPT);
  assert.ok(!r.missing.includes('直播時間'));
  assert.ok(r.warnings.includes('直播時間：沒寫（固定時段）'));
  assert.equal(P.parse('●新聞事件：2100 看世界\n●直播平台：\nFB：\n新聞粉\n●YT標：B')[0].program, true);
  assert.equal(P.parse('●新聞事件：21:00直播\n●YT標：B')[0].program, true);
  const ev = P.parse('●新聞事件：記者會\n●直播平台：\nTVBS NEWS\n●YT標：B')[0];
  assert.equal(ev.program, false);
  assert.ok(P.check(ev, OPT).missing.includes('直播時間'));
});

test('時間格式 00:00', async () => {
  const P = await load();
  assert.equal(P.fmtTime('0925'), '09:25');
  assert.equal(P.fmtTime('1430'), '14:30');
  assert.equal(P.fmtTime('21:00開始'), '21:00');
  assert.equal(P.fmtTime('21:00~21:XX:XX(第一段廣告前)'), '21:00');
  assert.equal(P.fmtTime('9:05'), '09:05');
  assert.equal(P.fmtTime('晚間'), '晚間');
});
