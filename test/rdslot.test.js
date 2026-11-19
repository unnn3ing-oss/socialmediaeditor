// Apps Script 補丁 docs/rundown-gs/rdslot.js：草稿／多文填預留格
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
for (const f of ['fixtures/rundown-gs-base.js', '../docs/rundown-gs/rdslot.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
const plan = (...a) => ctx.rdSlotPlan(...a);

// 欄：0＝A，1＝今天（1119），2～9＝右邊；10＝超過 8 欄
const W = 11;
const row = (a, cells = {}) => { const r = Array(W).fill(''); r[0] = a; for (const [k, v] of Object.entries(cells)) r[+k] = v; return r; };
function sheet() {
  return [
    row('', { 1: '1119', 2: '1120' }),                                   // 0 日期列
    row('主粉'),                                                          // 1
    row('0800', { 1: '4041/圖文/a', 6: '純影已上傳', 7: '草稿內', 8: '排2359', 9: '多文內', 10: '純影已上傳' }),   // 2 區塊開頭
    row('0810', { 1: '4042359/文字/b', 6: '純影/x', 7: '網新/', 8: 'reels/', 9: '純影/y', 10: '純影/' }),          // 3
    row('0820', { 6: '純影/', 7: '純影/', 8: 'Reels/', 9: '純影/', 10: '純影/' }),                               // 4
    row('0830', { 6: '純影 /', 9: '純影/' }),                                                                    // 5
    row(''),                                                              // 6
    row('0900', { 6: '純影已上傳', 9: '多文' }),                           // 7 下一個區塊
    row('0910', { 6: '純影/', 9: '純影/' }),                              // 8
    row('少康粉'),                                                        // 9
    row('0800', { 4: '草稿內', 5: '多文內' }),                             // 10
    row('0810', { 4: '網新/', 5: '純影/z' }),                              // 11
    row('0820', { 4: '網新/', 5: '純影/' })                                // 12
  ];
}

test('橫式草稿：純影已上傳下面第一格「純影/」（跳過已填的）', () => {
  assert.deepEqual({ ...plan(sheet(), 1, 'news', '08:15', 'draft', 'video') }, { row: 4, col: 6 });
});

test('純影已上傳滿了 → 草稿內的「網新/」也可以覆蓋', () => {
  const V = sheet(); V[4][6] = '純影/q'; V[5][6] = '純影/r';
  assert.deepEqual({ ...plan(V, 1, 'news', '08:15', 'draft', 'video') }, { row: 3, col: 7 });
});

test('Reels 草稿：標記含 2359 的欄，reels/ 不分大小寫；內容裡的 4042359 不算標記', () => {
  assert.deepEqual({ ...plan(sheet(), 1, 'news', '08:15', 'draft', 'reel') }, { row: 3, col: 8 });
  const V = sheet(); V[3][8] = 'Reels/a';
  assert.deepEqual({ ...plan(V, 1, 'news', '08:15', 'draft', 'reel') }, { row: 4, col: 8 });
  assert.equal(ctx.rdslMarker('4042359/文字/b'), '');
  assert.equal(ctx.rdslMarker('排2359'), 'reel');
});

test('從現在所在的區塊開始找：09:05 先找 0900 區塊', () => {
  assert.deepEqual({ ...plan(sheet(), 1, 'news', '09:05', 'draft', 'video') }, { row: 8, col: 6 });
});

test('目前區塊沒有空位 → 找相近的區塊', () => {
  const V = sheet(); V[8][6] = '純影/full';
  // 0900 區塊滿了 → 往前到 0800 區塊
  assert.deepEqual({ ...plan(V, 1, 'news', '09:05', 'draft', 'video') }, { row: 4, col: 6 });
});

test('多文：多文內欄最後一格有內容的下面第一格「純影/」', () => {
  // 欄 9：純影/y（有內容）→ 純影/（空）→ 純影/（空）
  assert.deepEqual({ ...plan(sheet(), 1, 'news', '08:15', 'cross', 'video') }, { row: 4, col: 9 });
  const V = sheet(); V[4][9] = ''; V[5][9] = '純影/';   // 中間空一格，仍找有內容之後的第一個 純影/
  assert.deepEqual({ ...plan(V, 1, 'news', '08:15', 'cross', 'video') }, { row: 5, col: 9 });
});

test('多文沒有空格就失敗，不退回其他欄', () => {
  const V = sheet(); V[4][9] = '純影/a'; V[5][9] = '純影/b'; V[8][9] = '純影/c';
  assert.ok(plan(V, 1, 'news', '08:15', 'cross', 'video').error);
});

test('優先欄都沒空位 → 同區塊其他欄的「純影/」（不碰多文欄、不超過右邊 8 欄）', () => {
  const V = sheet();
  V[4][6] = '純影/a'; V[5][6] = '純影/b'; V[3][7] = '網新/x'; V[4][7] = '純影/c'; V[8][6] = '純影/d';
  V[3][3] = '純影/';   // 沒標記的欄
  assert.deepEqual({ ...plan(V, 1, 'news', '08:15', 'draft', 'video') }, { row: 3, col: 3 });
  V[3][3] = '';
  // 多文欄（9）和第 10 欄（超過 8 欄）都有空的 純影/，不能用
  assert.ok(plan(V, 1, 'news', '08:15', 'draft', 'video').error);
});

test('依粉專區段：少康粉的草稿內收網新/', () => {
  assert.deepEqual({ ...plan(sheet(), 1, 'shaokang', '08:15', 'draft', 'video') }, { row: 11, col: 4 });
  assert.deepEqual({ ...plan(sheet(), 1, 'shaokang', '08:15', 'cross', 'video') }, { row: 12, col: 5 });
});
