// 罕見字補載：Google Fonts 把 Noto Sans TC 切成一百多段（unicode-range），瀏覽器只下載「頁面上出現的字」所在的段；
// canvas 畫字不會觸發下載，所以只載入「標題」兩個字的話，罕見字所在的段沒載入，就退回系統字型，系統也沒有就留白。
// 這裡用「實際要畫的字」去 document.fonts.load，載好再重畫；輸出圖片前用 ensure 等載完。
// 只載入沒要求過的非 ASCII 字（ASCII 一律在第一段）；載入失敗（網路）不丟錯，下次還會再試。
const isWide = (ch) => ch.codePointAt(0) > 0x7f;
// ensure 最多等這麼久：網路掛住時 document.fonts.load 可能很久才結束，不能卡住送出（逾時就用現有的字型畫）
export const ENSURE_TIMEOUT_MS = 5000;

export function createFontLoader({ fonts = globalThis.document && globalThis.document.fonts, specs, onLoaded } = {}) {
  const asked = new Map();   // 字型規格 → 已要求（載入中或已載入）的字
  const pending = new Set();

  const fresh = (text, spec) => {
    const seen = asked.get(spec) || new Set();
    asked.set(spec, seen);
    const out = [];
    for (const ch of String(text || '')) if (isWide(ch) && !seen.has(ch)) { seen.add(ch); out.push(ch); }
    return out;
  };

  // 回傳 Promise（一律成功，不丟錯）；載入了新字才會呼叫 onLoaded
  function load(text) {
    if (!fonts || typeof fonts.load !== 'function') return Promise.resolve(false);
    const jobs = [];
    for (const spec of specs()) {
      const chars = fresh(text, spec);
      if (!chars.length) continue;
      const p = Promise.resolve()
        .then(() => fonts.load(spec, chars.join('')))
        .then(() => true, () => { const seen = asked.get(spec); chars.forEach((ch) => seen.delete(ch)); return false; });
      pending.add(p);
      p.then(() => pending.delete(p));
      jobs.push(p);
    }
    return Promise.all(jobs).then((r) => {
      const any = r.some(Boolean);
      if (any && typeof onLoaded === 'function') onLoaded();
      return any;
    });
  }

  return {
    // 不等待：載完後呼叫 onLoaded（讓畫面重畫）
    request(text) { load(text); },
    // 等這段文字要用的字都載完（含先前已在載入中的）；最多等 timeoutMs，逾時直接放行
    async ensure(text, timeoutMs = ENSURE_TIMEOUT_MS) {
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
      try { await Promise.race([load(text).then(() => Promise.all([...pending])), timeout]); }
      finally { clearTimeout(timer); }
    }
  };
}
