const test = require('node:test');
const assert = require('node:assert/strict');

let mod;
const load = async () => (mod = mod || (await import('../tools/fbpost/fontload.js')));
// 假的 document.fonts：記下每次 load 的 (規格, 文字)
function fakeFonts({ failFirst = false, delay = 0 } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    load: async (spec, text) => {
      calls.push([spec, text]);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (failFirst && n++ === 0) throw new Error('network');
      return [{}];
    }
  };
}
const SPECS = () => ['900 50px "Noto Sans TC"', '500 50px "Noto Sans TC"'];

test('只載入非 ASCII 字；每個規格各要求一次，重複的字不再要求', async () => {
  const { createFontLoader } = await load();
  const fonts = fakeFonts();
  const loader = createFontLoader({ fonts, specs: SPECS });
  await loader.ensure('ABC 123 私密處𠮷');
  assert.deepEqual(fonts.calls, [['900 50px "Noto Sans TC"', '私密處𠮷'], ['500 50px "Noto Sans TC"', '私密處𠮷']]);
  await loader.ensure('私密處𠮷私');
  assert.equal(fonts.calls.length, 2, '同樣的字不重複載');
  await loader.ensure('私堃');
  assert.deepEqual(fonts.calls.slice(2).map((c) => c[1]), ['堃', '堃'], '只補新的字');
});

test('純英數字不載入；request 載完才呼叫 onLoaded，沒有新字不呼叫', async () => {
  const { createFontLoader } = await load();
  const fonts = fakeFonts();
  let done = 0;
  const loader = createFontLoader({ fonts, specs: SPECS, onLoaded: () => done++ });
  loader.request('Hello 123');
  await loader.ensure('');
  assert.deepEqual([fonts.calls.length, done], [0, 0]);
  loader.request('𰻞');
  assert.equal(done, 0, '還沒載完不能通知');
  await loader.ensure('𰻞');
  assert.equal(done, 1);
  loader.request('𰻞');
  await loader.ensure('𰻞');
  assert.equal(done, 1, '沒有新字就不重畫');
});

test('ensure 會等先前 request 還在載入的字', async () => {
  const { createFontLoader } = await load();
  const fonts = fakeFonts({ delay: 20 });
  let done = 0;
  const loader = createFontLoader({ fonts, specs: SPECS, onLoaded: () => done++ });
  loader.request('喆');
  await loader.ensure('喆');   // 這個字已在載入中：不重複要求，但要等它載完
  assert.equal(fonts.calls.length, 2);
  assert.equal(done, 1);
});

test('載入失敗不丟錯，下次再試同一個字', async () => {
  const { createFontLoader } = await load();
  const fonts = fakeFonts({ failFirst: true });
  const loader = createFontLoader({ fonts, specs: () => ['900 50px "Noto Sans TC"'] });
  await loader.ensure('龘');   // 第一次失敗：不丟錯
  await loader.ensure('龘');   // 再試一次成功
  assert.equal(fonts.calls.length, 2);
  await loader.ensure('龘');
  assert.equal(fonts.calls.length, 2, '成功後不再要求');
});

test('沒有 document.fonts（舊環境）時安靜略過', async () => {
  const { createFontLoader } = await load();
  const loader = createFontLoader({ fonts: undefined, specs: SPECS });
  await loader.ensure('私密處');
  loader.request('私密處');
});
