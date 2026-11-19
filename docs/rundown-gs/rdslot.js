// FB RUNDOWN Apps Script 補丁：影片「草稿」與「被多文的粉專」填今天欄右邊的預留格（貼法見 docs/rundown-gs-draft-slot.md）
// 這段貼在 rundown.gs 最後面；用到 rundown.gs 原有的 rdStr、rdFindSection、rdBlocks、rdFindSheetName、rdFindDateCol、rdPad。
// 不插新列、不改格式（預留格本來就是綠色），只把格子文字換成 純影/SLUG（Reels/SLUG）。
//
// 規則（今天欄＝x，看右邊第 1～8 欄；從「現在」所在的時段區塊開始，再往前後相近的區塊找）：
//   橫式草稿：標記「純影已上傳」下面第一格「純影/」；標記「草稿內」下面第一格「純影/」或「網新/」
//   Reels 草稿：標記含「2359」（例：2359、排2359）下面第一格「reels/」（不分大小寫）
//   以上都沒有空格 → 同區塊其他欄（不含「多文」欄）的第一格「純影/」（Reels：「reels/」）
//   多文：標記「多文」或「多文內」下面，最後一格有內容的下面第一格「純影/」（沒有就失敗，不退回別欄）
// 標記＝不含「/」的格子（避免「4042359/文字/…」被當成 2359）；比對前去掉空白。

var RDSL_SPAN = 8;
function rdslNorm(v) { return String(v == null ? '' : v).replace(/\s+/g, ''); }
function rdslMarker(v) {
  var s = rdslNorm(v);
  if (!s || s.indexOf('/') >= 0) return '';
  if (s === '純影已上傳') return 'video';
  if (s === '草稿內') return 'draft';
  if (s === '多文' || s === '多文內') return 'cross';
  if (s.indexOf('2359') >= 0) return 'reel';
  return '';
}
function rdslIs(v, list) { var s = rdslNorm(v).toLowerCase(); return list.indexOf(s) >= 0; }
// 這種標記收哪些預留格；slot 不用這種標記回 null
function rdslAccept(mark, slot, kind) {
  if (slot === 'cross') return mark === 'cross' ? ['純影/'] : null;
  if (kind === 'reel') return mark === 'reel' ? ['reels/'] : null;
  if (mark === 'video') return ['純影/'];
  if (mark === 'draft') return ['純影/', '網新/'];
  return null;
}
// 區塊找的順序：現在所在的區塊、再往後、往前交替
function rdslOrder(blocks, want) {
  var cur = 0;
  blocks.forEach(function (b, i) { if (b.min <= want && (blocks[cur].min > want || b.min > blocks[cur].min)) cur = i; });
  var out = [cur];
  for (var d = 1; out.length < blocks.length; d++) {
    if (cur + d < blocks.length) out.push(cur + d);
    if (cur - d >= 0) out.push(cur - d);
  }
  return out.map(function (i) { return blocks[i]; });
}
// 這一欄在區塊裡的標記（第一個標記格）：{ row, mark } 或 null
function rdslMarkOf(V, blk, c) {
  for (var r = blk.start; r < blk.end; r++) { var m = rdslMarker(V[r][c]); if (m) return { row: r, mark: m }; }
  return null;
}
function rdslInMarked(V, blk, c, m, accept, slot) {
  if (slot === 'cross') {
    var last = m.row;
    for (var r = m.row + 1; r < blk.end; r++) { var s = rdslNorm(V[r][c]); if (s && !rdslIs(s, accept)) last = r; }
    for (var r2 = last + 1; r2 < blk.end; r2++) if (rdslIs(V[r2][c], accept)) return r2;
    return -1;
  }
  for (var r3 = m.row + 1; r3 < blk.end; r3++) if (rdslIs(V[r3][c], accept)) return r3;
  return -1;
}

// V：getDisplayValues()；x：今天欄（0 起算）；hhmm：'HH:MM'；slot：'draft'｜'cross'；kind：'video'｜'reel'
// 回 { row, col }（0 起算）或 { error }
function rdSlotPlan(V, x, page, hhmm, slot, kind) {
  var sec = rdFindSection(V, page);
  if (!sec) return { error: '找不到「' + (RD_SECTIONS[page] || [page])[0] + '」區段' };
  var blocks = rdBlocks(V, sec);
  if (!blocks.length) return { error: '區段裡沒有時段' };
  var want = +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
  var order = rdslOrder(blocks, want), width = V[0] ? V[0].length : 0, i, c, blk;
  for (i = 0; i < order.length; i++) {
    blk = order[i];
    for (c = x + 1; c <= x + RDSL_SPAN && c < width; c++) {
      var m = rdslMarkOf(V, blk, c);
      var accept = m && rdslAccept(m.mark, slot, kind);
      if (!accept) continue;
      var row = rdslInMarked(V, blk, c, m, accept, slot);
      if (row >= 0) return { row: row, col: c };
    }
  }
  if (slot === 'cross') return { error: '找不到「多文」欄下面空的「純影/」' };
  var base = kind === 'reel' ? ['reels/'] : ['純影/'];
  for (i = 0; i < order.length; i++) {
    blk = order[i];
    for (c = x + 1; c <= x + RDSL_SPAN && c < width; c++) {
      var mk = rdslMarkOf(V, blk, c);
      if (mk && mk.mark === 'cross') continue;
      for (var r = blk.start; r < blk.end; r++) if (rdslIs(V[r][c], base)) return { row: r, col: c };
    }
  }
  return { error: kind === 'reel' ? '找不到空的「reels/」' : '找不到空的「純影/」' };
}

// ---- 以下只在 Apps Script 執行（rdAddOne 開頭加：if (en.slot) return rdSlotAdd(ss, names, en);）----
function rdSlotAdd(ss, names, en) {
  var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rdStr(en.date)), text = rdStr(en.text);
  if (!dm || !/^\d{2}:\d{2}$/.test(rdStr(en.time)) || !text) return { ok: false, page: en.page, error: '資料不完整' };
  var y = +dm[1], mo = +dm[2], d = +dm[3];
  var name = rdFindSheetName(names, y, mo);
  if (!name) return { ok: false, page: en.page, error: '找不到 ' + y + '/' + rdPad(mo) + ' 分頁' };
  var sh = ss.getSheetByName(name), V = sh.getDataRange().getDisplayValues();
  var x = rdFindDateCol(V, mo, d);
  if (x < 0) return { ok: false, page: en.page, error: name + ' 找不到 ' + rdPad(mo) + rdPad(d) + ' 欄' };
  var p = rdSlotPlan(V, x, en.page, rdStr(en.time), en.slot, en.kind === 'reel' ? 'reel' : 'video');
  if (p.error) return { ok: false, page: en.page, error: p.error };
  sh.getRange(p.row + 1, p.col + 1).setValue(text);   // 只換文字，保留預留格原本的格式
  return { ok: true, page: en.page, status: 'slot', cell: name + '!' + rdA1(p.row, p.col), time: rdStr(en.time) };
}

if (typeof module !== 'undefined') module.exports = { rdSlotPlan: rdSlotPlan, rdslMarker: rdslMarker };
