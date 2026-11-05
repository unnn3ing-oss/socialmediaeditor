// 工具 e2e 共用：用「沒密碼」或「有密碼」兩種模式開工具頁。
// 公司素材一律用假圖（fakeAsset），絕不放真的公司素材。
const API_BASE = 'https://toolbox-api.19jpz-3.workers.dev';

// 單色 PNG（1×1 放大用）；color 是 [r,g,b]
function fakeAsset(color = [255, 0, 255]) {
  const zlib = require('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.from([0, ...color, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 回傳 { page, frame }：frame 是工具頁（沒密碼時就是 page.mainFrame()）。
// opts.company = true 時：注入假憑證、假外殼，後端 /assets/<key> 回 opts.assets[key]（Buffer，預設洋紅假圖）。
async function openTool(browser, srvUrl, id, { company = false, assets = {}, viewport } = {}) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  const requested = [];
  await page.route(API_BASE + '/**', (route) => {
    const m = /\/assets\/([^/?]+)/.exec(route.request().url());
    if (!m) return route.fulfill({ status: 404, body: '' });
    const key = decodeURIComponent(m[1]);
    requested.push(key);
    if (!company) return route.fulfill({ status: 401, body: '' });
    const body = assets[key] || fakeAsset();
    return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body });
  });
  if (!company) {
    await page.goto(srvUrl + 'tools/' + id + '/index.html');
    return { page, frame: page.mainFrame(), requested };
  }
  await page.addInitScript(() => {
    try { localStorage.setItem('tbx.company', JSON.stringify({ token: 'test', exp: Math.floor(Date.now() / 1000) + 3600 })); } catch {}
  });
  await page.goto(srvUrl + 'test/fixtures/company-host.html?tool=' + encodeURIComponent(id));
  const handle = await page.waitForSelector('iframe[name=tool]');
  const frame = await handle.contentFrame();
  await frame.waitForLoadState('load');
  return { page, frame, requested };
}

module.exports = { openTool, fakeAsset, API_BASE };
