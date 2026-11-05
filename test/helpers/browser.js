// 啟動 Chromium：先用 Playwright 預設，找不到就用沙盒內建的 /opt/pw-browsers/chromium。
// 不要執行 playwright install。
const { chromium } = require('playwright');

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

module.exports = { launch };
