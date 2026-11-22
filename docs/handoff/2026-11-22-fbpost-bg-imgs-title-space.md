# 交接：文字背景圖樣直接顯示＋標題換行補空格（2026-11-22）

- 分支：`claude/sharp-einstein-n8ng5f`
- 需求（使用者已說「開始」）：
  1. 純文字「文字背景」：圖樣不收起來，有圖樣時直接顯示在最前面（無｜圖樣｜純色｜漸層，同一列左右滑），拿掉「圖樣 N ▾」與 `#bgImgs` 第二列；第一次切到純文字就讀圖（併發 6、骨架）；預設隨機仍只從純色／漸層挑。
  2. 選套版、純文字圖：標題框（＝預覽）每個換行處，內文【標題】補一個空格（`title.js` `joinTitle`）；貼網址帶入後內文【標題】也照預覽分行補空格。純文字不受影響。
- 改的檔案：`tools/fbpost/compose.js`、`tools/fbpost/index.html`、`tools/fbpost/title.js`；測試 `test/fbpost-*.test.js`（joinTitle）、`test/e2e/fbpost-compose.e2e.js`。
- 結果：npm test 763、fbpost-compose 25＋fbpost 46＋sidepanel 3 e2e、build --check、獨立審查通過（審查建議：骨架期間不套 cover，已改）。純網站，不需部署後端、外掛不升版號。
- 狀態：已併入 main（2026-11-22）。
