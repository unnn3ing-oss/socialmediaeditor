// Apps Script 局部更新，不能單獨部署：
// 用下方 rdAddOne 替換既有同名函式，另外加入 rdWriteTimeCode。
// 保留既有 rdPlan、RD_STYLE、驗證入口及指令碼屬性；步驟見 docs/rundown-format.md。

function rdWriteTimeCode(range, code) {
  range.setValue(code).setHorizontalAlignment('center').setFontColor('#4285f4').setFontWeight('bold');
}

function rdAddOne(ss, names, en) {
  var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rdStr(en.date)), text = rdStr(en.text);
  if (!dm || !/^\d{2}:\d{2}$/.test(rdStr(en.time)) || !text) return { ok: false, page: en.page, error: '資料不完整' };
  var y = +dm[1], m = +dm[2], d = +dm[3];
  var name = rdFindSheetName(names, y, m);
  if (!name) return { ok: false, page: en.page, error: '找不到 ' + y + '/' + rdPad(m) + ' 分頁' };
  var sh = ss.getSheetByName(name), V = sh.getDataRange().getDisplayValues();
  var x = rdFindDateCol(V, m, d);
  if (x < 0) return { ok: false, page: en.page, error: name + ' 找不到 ' + rdPad(m) + rdPad(d) + ' 欄' };
  var p = rdPlan(V, x, en.page, en.time, text);
  if (p.error) return { ok: false, page: en.page, error: p.error };
  var cell = name + '!' + rdA1(p.row, x);
  if (p.addRow != null) sh.insertRowAfter(p.addRow);
  if (p.status === 'insert') {
    // moveTo 沿用原本位移規則，讓既有稿件與時間碼連同格式一起移動。
    sh.getRange(p.row + 1, x + 1, p.shiftTo - p.row, 1).moveTo(sh.getRange(p.row + 2, x + 1));
    if (p.codeCol != null) {
      var cc = p.codeCol + 1;
      sh.getRange(p.row + 1, cc, p.shiftTo - p.row, 1).moveTo(sh.getRange(p.row + 2, cc));
      if (p.code != null) rdWriteTimeCode(sh.getRange(p.row + 1, cc), p.code);
      else sh.getRange(p.row + 1, cc).clearContent();
    }
  } else if (p.codeCol != null && p.code != null) {
    rdWriteTimeCode(sh.getRange(p.row + 1, p.codeCol + 1), p.code);
  }
  sh.getRange(p.row + 1, x + 1).setValue(text).setFontSize(RD_STYLE.size).setFontWeight(RD_STYLE.bold ? 'bold' : 'normal').setFontColor(RD_STYLE.color).setHorizontalAlignment('center');
  return { ok: true, page: en.page, status: p.status, cell: cell, time: p.time, addedRow: p.addRow != null };
}
