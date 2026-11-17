// 直播需求單：拆場、抓欄位、補 FB 粉專／畫面來源／值班小編／內文、檢查缺漏、18氣象封面提醒。
// 純函式，不碰 DOM。規則見 docs/superpowers/specs/2026-11-17-livereq-design.md。

export const PAGES = ['新聞', '少康', '娛樂', '國際'];
// 固定時段節目：沒寫直播時間只提醒、不擋
export const PROGRAMS = ['九點熱話題', '十點不一樣', '最前線新聞', '21直播', '20直播', '2100看世界', '18氣象站'];
const progKey = (s) => String(s).replace(/[\s:：]/g, '').replace(/(\d{1,2})00/g, '$1');
export function isProgram(event, lines = []) {
  const hay = progKey([event, ...lines.slice(0, 3)].join(' '));
  return PROGRAMS.some((p) => hay.includes(progKey(p)));
}
export const BODY_TAIL = '，讓TVBS新聞帶您一起來了解。';
const KEYWORD_RE = /(事件|平台|畫面來源|直播形式|訊號|時間|標|文|值班)/;
const HEADER_RE = /導播好|直播需求|直播單/;

// 欄位名稱 → 種類（「標」先於「文」）
export function kindOf(name) {
  const n = String(name).replace(/\s+/g, '');
  if (n.includes('值班')) return 'duty';
  if (n.includes('事件')) return 'event';
  if (n.includes('平台')) return 'platform';
  if (/畫面來源|直播形式|訊號/.test(n)) return 'source';
  if (n.includes('時間')) return 'time';
  if (n.includes('標')) return 'title';
  if (n.includes('文')) return 'body';
  return 'other';
}

// 一行是不是欄位行：●／◎ 開頭，或沒有符號但「短欄位名稱：」且名稱含關鍵字（例如「YT內文：」）
export function fieldOf(line) {
  const m = /^\s*([●◎])\s*(.*)$/.exec(line);
  if (m) {
    const rest = m[2];
    const c = /^([^：:]*?)\s*[：:]\s*(.*)$/.exec(rest);
    const name = c ? c[1] : rest.trim();
    return { sym: m[1], name, inline: c ? c[2] : '', colon: !!c, kind: c ? kindOf(name) : 'other' };
  }
  const b = /^\s*([^\s：:，。、！？「」()（）#]{1,8})\s*[：:]\s*(.*)$/.exec(line);
  if (b && KEYWORD_RE.test(b[1]) && !/^\d/.test(b[1])) {
    return { sym: '', name: b[1], inline: b[2], colon: true, kind: kindOf(b[1]) };
  }
  return null;
}

const blank = (s) => !String(s).trim();

// 氣象單（事件或開場行含「氣象」）最後一個欄位是內文，且內文只有「正文＋封面」兩段 → 最後一段是封面
function isWeatherCover(cur) {
  const fs = fieldsOf(cur);
  const last = fs[fs.length - 1];
  if (!last || last.kind !== 'body') return false;
  const head = cur.slice(0, fs[0].line).join('\n') + '\n' + fs.filter((f) => f.kind === 'event').map((f) => f.text).join('\n');
  if (!/氣象/.test(head)) return false;
  let groups = 0, inGroup = false;
  for (const v of last.values) {
    if (blank(v)) inGroup = false;
    else if (!inGroup) { inGroup = true; groups++; }
  }
  return groups === 2;
}

// 整份文字 → 每場的行陣列
export function splitBlocks(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let cur = [];
  let seen = new Set();
  const startNew = () => {
    // 把緊貼在新開頭前面（中間沒有空行）的非欄位行一起帶到新的一場
    let k = cur.length;
    while (k > 0 && !blank(cur[k - 1]) && !fieldOf(cur[k - 1])) k--;
    if (k < cur.length && isWeatherCover(cur)) k = cur.length; // 氣象單最後的封面段不帶去下一場
    const carry = cur.slice(k);
    blocks.push(cur.slice(0, k));
    cur = carry;
    seen = new Set();
  };
  for (const line of lines) {
    const f = fieldOf(line);
    if (seen.size) {
      if (f && ['event', 'platform', 'source'].includes(f.kind) && seen.has(f.kind)) startNew();
      else if (f && f.kind === 'event') startNew();
      else if (!f && HEADER_RE.test(line)) startNew();
    }
    cur.push(line);
    if (f) seen.add(f.kind);
  }
  blocks.push(cur);
  return blocks
    .map((b) => { let s = 0, e = b.length; while (s < e && blank(b[s])) s++; while (e > s && blank(b[e - 1])) e--; return b.slice(s, e); })
    .filter((b) => b.some((l) => fieldOf(l)));
}

// 一場的欄位：{ ...fieldOf, line, end(不含), last(最後一個非空行), values:[值的行] }
export function fieldsOf(lines) {
  const fields = [];
  lines.forEach((line, i) => {
    const f = fieldOf(line);
    if (f) fields.push({ ...f, line: i });
  });
  fields.forEach((f, k) => {
    f.end = k + 1 < fields.length ? fields[k + 1].line : lines.length;
    f.values = [f.inline, ...lines.slice(f.line + 1, f.end)];
    let last = f.line;
    for (let i = f.line + 1; i < f.end; i++) if (!blank(lines[i])) last = i;
    f.last = last;
    f.text = f.values.map((v) => v.trim()).filter(Boolean).join('\n');
  });
  return fields;
}

const first = (fields, kind) => fields.find((f) => f.kind === kind) || null;
const firstLine = (s) => (String(s).split('\n').find((l) => l.trim()) || '').trim();

function bracketEvent(lines, fields) {
  const stop = fields.length ? fields[0].line : lines.length;
  for (let i = 0; i < stop; i++) {
    const m = /【([^】]*)】|《([^》]*)》/.exec(lines[i]);
    if (!m) continue;
    const s = (m[1] ?? m[2]).replace(/[#＃*]/g, '').replace(/TVBS/gi, '').replace(/\d{1,2}[:：]\d{2}/g, '').trim();
    if (s) return s;
  }
  return '';
}

function repeatMark(lines, fields) {
  const scan = [];
  const stop = fields.length ? fields[0].line : lines.length;
  scan.push(...lines.slice(0, stop));
  for (const f of fields) if (f.kind === 'event' || f.kind === 'time') scan.push(f.text);
  const m = /重\s*(\d+)/.exec(scan.join('\n'));
  return m ? '重' + m[1] : '';
}

// 粉專名稱比對：去掉空白與結尾的「粉專」「粉」
export const pageKey = (s) => String(s).replace(/\s+/g, '').replace(/(粉專|粉)$/, '');
const splitList = (s) => String(s).split(/[、,，/／]+/).map((x) => x.trim()).filter(Boolean);

// 平台欄位 → { fb:[名稱], fbHead, fbInline, fbLast, yt:[...], ytHead, plainFirst }
function platformInfo(lines, f) {
  const info = { fb: [], fbHead: -1, fbInline: false, fbLast: -1, ytHead: -1, plainFirst: -1 };
  if (!f) return info;
  let mode = null; // 'fb' | 'yt' | null
  const rows = [{ i: f.line, text: f.inline }];
  for (let i = f.line + 1; i < f.end; i++) rows.push({ i, text: lines[i] });
  for (const { i, text } of rows) {
    const t = text.trim();
    if (!t) continue;
    const h = /^(FB|臉書|YT)\s*[：:]?\s*(.*)$/i.exec(t);
    if (h && (/[：:]/.test(t) || !h[2] || /^(FB|臉書|YT)\s/i.test(t))) {
      mode = /^YT$/i.test(h[1]) ? 'yt' : 'fb';
      if (mode === 'fb') {
        info.fbHead = i; info.fbLast = i;
        if (h[2].trim()) { info.fbInline = true; info.fb.push(...splitList(h[2])); }
      } else info.ytHead = i;
      continue;
    }
    if (mode === 'fb') { info.fb.push(t); info.fbLast = i; }
    else if (mode === null && info.plainFirst < 0) info.plainFirst = i;
  }
  return info;
}

export function titleToBody(title) {
  let t = firstLine(title)
    .replace(/[｜|]\s*LIVE\s*$/i, '')
    .replace(/【\s*LIVE\s*】/gi, '')
    .replace(/[｜|]\s*LIVE\s*[｜|]/gi, '｜')
    .replace(/\bLIVE\b/gi, '')
    .replace(/[\s，、｜|]+$/, '')
    .trim();
  return t ? t + BODY_TAIL : '';
}

// 解析一場
export function analyze(lines) {
  const fields = fieldsOf(lines);
  const ev = first(fields, 'event');
  const titleF = first(fields, 'title');
  const bodyF = fields.find((f) => f.kind === 'body' && f.text) || first(fields, 'body');
  const srcF = first(fields, 'source');
  const timeF = first(fields, 'time');
  const platF = first(fields, 'platform');
  const sym = (fields.find((f) => f.sym) || {}).sym || '●';
  let event = ev ? firstLine(ev.text) : '';
  if (!event) event = bracketEvent(lines, fields);
  const repeat = repeatMark(lines, fields);
  let time = timeF ? firstLine(timeF.text) : '';
  if (!time) {
    const stop = fields.length ? fields[0].line : lines.length;
    const m = /(\d{1,2}[:：]\d{2})/.exec(lines.slice(0, stop).join('\n'));
    if (m) time = m[1];
  }
  // 18氣象站沒寫時間：固定 18:00，只算有，不插行
  if (!time && /18\s*氣象/.test(event)) time = '18:00';
  const title = titleF ? firstLine(titleF.text) : '';
  const titles = fields.filter((f) => f.kind === 'title').flatMap((f) => f.text.split('\n')).filter(Boolean);
  const source = srcF ? srcF.text.trim() : '';
  const plat = platformInfo(lines, platF);
  return {
    lines, fields, sym, event, eventFromField: !!(ev && firstLine(ev.text)), repeat, time,
    title, titles, body: bodyF ? bodyF.text : '', source,
    sourcePending: !source || source === '待補', fbExisting: plat.fb,
    weather: /氣象/.test(event),
    program: isProgram(event, lines),
  };
}

// 勾選中、但需求單還沒有的粉專
export function pagesToAdd(fbExisting, checked) {
  const have = new Set(fbExisting.map(pageKey));
  const out = [];
  for (const p of checked) { const k = pageKey(p); if (!have.has(k)) { have.add(k); out.push(p); } }
  return out;
}

// 缺漏（擋複製）與提醒
export function check(a, { checked = [], duty = {}, eventOverride = '', timeOverride = '' } = {}) {
  const missing = [];
  if (!(a.event || eventOverride.trim())) missing.push('新聞事件');
  const noTime = !(a.time || timeOverride.trim());
  if (noTime && !a.program) missing.push('直播時間');
  if (!a.fbExisting.length && !checked.length) missing.push('FB 粉專');
  if (!String(duty.name || '').trim() || !String(duty.contact || '').trim()) missing.push('值班小編');
  if (!a.title) missing.push('標題');
  if (!a.body.trim() && !a.title) missing.push('內文');
  const warnings = [];
  if (noTime && a.program) warnings.push('直播時間：沒寫（固定時段）');
  if (a.sourcePending) warnings.push('畫面來源：待補');
  return { missing, warnings };
}

// 組出完整需求單
export function build(a, { checked = [], duty = {}, eventOverride = '', timeOverride = '' } = {}) {
  const { lines, fields, sym } = a;
  const L = lines.slice();
  const ins = new Map(); // 行號（插在這行之後；-1＝最前面）→ 要插的行
  const replace = new Map(); // 行號 → 新內容
  const drop = new Set();
  const add = (at, arr) => { if (!ins.has(at)) ins.set(at, []); ins.get(at).push(...arr); };

  if (!a.event && eventOverride.trim()) {
    const ev = first(fields, 'event');
    if (ev) replace.set(ev.line, L[ev.line].replace(/[：:]\s*.*$/, '：' + eventOverride.trim()));
    else add(-1, [sym + '新聞事件：' + eventOverride.trim()]);
  }

  // 直播時間（沒有才補）：有空的時間欄就填它，否則放在新聞事件下一行
  if (!a.time && timeOverride.trim()) {
    const t = timeOverride.trim();
    const tf = first(fields, 'time');
    const ev = first(fields, 'event');
    if (tf) replace.set(tf.line, L[tf.line].replace(/\s*$/, '') + t);
    else if (ev) add(ev.last, [sym + '直播時間：' + t]);
    else if (!a.event && eventOverride.trim()) add(-1, [sym + '直播時間：' + t]);
    else add(fields.length ? fields[0].line - 1 : -1, [sym + '直播時間：' + t]);
  }

  // 直播平台
  const platF = first(fields, 'platform');
  const extra = pagesToAdd(a.fbExisting, checked);
  const plat = platformInfo(L, platF);
  if (platF && extra.length) {
    if (plat.fbHead >= 0) {
      if (plat.fbInline) {
        const at = plat.fbHead;
        const base = at === platF.line ? L[at] : L[at];
        replace.set(at, base.replace(/\s+$/, '') + '、' + extra.join('、'));
      } else add(plat.fbLast, extra);
    } else {
      if (plat.ytHead < 0 && plat.plainFirst === platF.line) {
        // 值寫在欄位行同一行：拆成 欄位名：／YT:／值
        replace.set(platF.line, L[platF.line].replace(/^(\s*[●◎]?[^：:]*[：:]).*$/, '$1'));
        add(platF.line, ['YT:', platF.inline.trim()]);
      } else if (plat.ytHead < 0 && plat.plainFirst >= 0) add(plat.plainFirst - 1, ['YT:']);
      add(platF.last, ['FB:', ...extra]);
    }
  }

  // 畫面來源＋值班小編
  const srcF = first(fields, 'source');
  const dutyLines = [];
  const name = String(duty.name || '').trim(), contact = String(duty.contact || '').trim();
  if (name || contact) dutyLines.push(sym + '值班小編：', [name, contact].filter(Boolean).join(' '));
  for (const f of fields) if (f.kind === 'duty') for (let i = f.line; i < f.end; i++) if (!blank(L[i]) || i === f.line) drop.add(i);
  if (srcF) {
    if (!srcF.text.trim()) replace.set(srcF.line, L[srcF.line].replace(/\s*$/, '') + '待補');
    if (dutyLines.length) add(srcF.last, dutyLines);
  } else {
    const newSrc = [sym + '畫面來源：待補', ...dutyLines];
    if (!platF && extra.length) newSrc.unshift(sym + '直播平台：', 'FB:', ...extra);
    const anchor = platF ? platF.last : (fields.length ? fields[fields.length - 1].last : L.length - 1);
    add(anchor, newSrc);
  }
  if (srcF && !platF && extra.length) add(srcF.line - 1, [sym + '直播平台：', 'FB:', ...extra]);

  // 內文（沒有才補）
  if (!a.body.trim() && a.title) {
    const body = titleToBody(a.title);
    const bodyF = first(fields, 'body');
    if (bodyF) replace.set(bodyF.line, L[bodyF.line].replace(/\s*$/, '') + body);
    else {
      const titleF = first(fields, 'title');
      add(titleF.last, [sym + '內文：' + body]);
    }
  }

  const out = [];
  if (ins.has(-1)) out.push(...ins.get(-1));
  L.forEach((line, i) => {
    if (!drop.has(i)) out.push(replace.has(i) ? replace.get(i) : line);
    if (ins.has(i)) out.push(...ins.get(i));
  });
  return out.join('\n');
}

// 18氣象封面提醒：主播＝內文的「主播 XXX」，封面標題＝最後一個內文段落之後（空行隔開）的那段
export function weatherNote(a) {
  if (!a.weather) return null;
  const all = a.lines.join('\n');
  const m = /主播\s*[：:]?\s*([一-鿿]{2,4})/.exec(all);
  const anchor = m ? m[1] : '';
  let cover = [];
  const bodyFs = a.fields.filter((f) => f.kind === 'body');
  const lastF = a.fields[a.fields.length - 1];
  const f = bodyFs.length ? bodyFs[bodyFs.length - 1] : null;
  if (f && f === lastF) {
    const rows = a.lines.slice(f.line + 1, f.end);
    let k = rows.length;
    while (k > 0 && blank(rows[k - 1])) k--;
    let s = k;
    while (s > 0 && !blank(rows[s - 1])) s--;
    if (s > 0) cover = rows.slice(s, k).map((x) => x.trim());
  }
  const text = `18氣象直播封面PNG麻煩小幫手，今日主播是${anchor || 'XXX'}，謝謝!\n標題:\n${cover.join('\n')}`;
  return { anchor, cover, text, ok: !!anchor && cover.length > 0 };
}

// 值班小編到期時間：早班 08:00～16:30、晚班 16:00～00:00；16:00 後填的算晚班；00:00～08:00 填的到 08:00
export function dutyExpiry(now = new Date()) {
  const t = now.getHours() * 60 + now.getMinutes();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (t < 480) return new Date(d.getTime() + 8 * 3600e3).getTime();
  if (t < 960) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16, 30).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0).getTime();
}

export function parse(text) {
  return splitBlocks(text).map(analyze);
}

// 時間統一寫成 HH:MM：0925→09:25、21:00開始→21:00、1430→14:30；認不出就原樣
export function fmtTime(s) {
  const t = String(s || '');
  const ok = (h, m) => +h < 24 && +m < 60;
  const pad = (h, m) => String(+h).padStart(2, '0') + ':' + m;
  let m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(t);
  if (m && ok(m[1], m[2])) return pad(m[1], m[2]);
  m = /(?<!\d)(\d{1,2})(\d{2})(?!\d)/.exec(t);
  if (m && ok(m[1], m[2])) return pad(m[1], m[2]);
  return t.trim();
}
