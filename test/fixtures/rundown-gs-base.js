// 從 unnn3ing-oss/-schedulenewnet gas/rundown.gs 複製的 helper（只給 rdslot 補丁測試用；那邊改了這裡要跟著改）
var RD_SECTIONS = { news: ['主粉'], ent: ['娛樂粉'], shaokang: ['少康粉'], intl: ['國際＋粉', '國際+粉'] };
function rdStr(v) { return String(v == null ? '' : v).trim(); }
function rdIsLabel(v) { return /^\d{4}$/.test(rdStr(v)); }
function rdLabelMin(v) { var s = rdStr(v); return +s.slice(0, 2) * 60 + +s.slice(2); }
function rdFindSection(V, page) {
  var names = RD_SECTIONS[page];
  if (!names) return null;
  for (var r = 0; r < V.length; r++) {
    if (names.indexOf(rdStr(V[r][0])) < 0) continue;
    var end = r + 1;
    while (end < V.length && (rdStr(V[end][0]) === '' || rdIsLabel(V[end][0]))) end++;
    return { start: r + 1, end: end };
  }
  return null;
}
function rdBlocks(V, sec) {
  var starts = [];
  for (var r = sec.start; r < sec.end; r++) if (rdIsLabel(V[r][0]) && !(r > sec.start && rdIsLabel(V[r - 1][0]))) starts.push(r);
  return starts.map(function (s, i) { return { start: s, end: i + 1 < starts.length ? starts[i + 1] : sec.end, min: rdLabelMin(V[s][0]) }; });
}
