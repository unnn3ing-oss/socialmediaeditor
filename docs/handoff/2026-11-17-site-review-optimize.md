# 全站審查後的速度與介面優化
- 狀態：進行中　- 分支：claude/sleepy-bardeen-mexjuv　- 最後更新：2026-11-17
- 使用者原始需求：「幫我審查整個網頁有哪邊可以優化、改進，介面有哪邊可以更好、更簡易可操作，網頁反應速度可以提升」→ 審查後回覆「U9位置不要改但要自動聚焦，其他照你建議順序全部都做」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| U9 直播需求單 | 只加貼上框自動聚焦，欄位位置不動 | 使用者指定 |
| 進排程發布頁自動查臉書 | 不做 | 會增加臉書呼叫，與「手動查詢」決定相反 |
| S6 外掛偵測 | 不改外掛：ping 超過 400ms 沒回先顯示「未安裝外掛」，之後有回（3 秒內）再改成已連線 | 不動 `extension/`，不用升版號，舊版外掛也適用 |
| S2 貼圖 | 7 張轉無損 WebP（像素相同，約 750KB→305KB）；排程發布另外延後到開新增發文才載 | 輸出圖不變 |
| U3 頂列 | 工具列放不下時自動改成只顯示圖示（目前開著的工具保留文字） | 1280 寬不換行 |
| 分工 | 外殼與共用（shell/、sdk/、字型連結、貼圖檔）主對話做；工具依資料夾分給 4 個 Sonnet 代理，檔案不重疊 | CLAUDE.md 省 token 規則 |

## 做法（改哪裡）
| 批次 | 項目 | 檔案 | 狀態 |
|---|---|---|---|
| A | S4 安裝教學按了才載 | `shell/main.js`、`index.html` | ⬜ |
| A | S5 字型 CSS 改 `<link>`＋preconnect | `ui/tokens.css`、各 `index.html`、`collage／watermark／resize/base.css` | ⬜ |
| A | S6 外掛偵測先顯示結果 | `shell/status.js` | ⬜ |
| A | U2 網址 `#工具` 記住目前工具、上一頁可用 | `shell/main.js`、`shell/layout.js` | ⬜ |
| A | U3 頂列不換行 | `shell/toolbar.js`、`shell/shell.css` | ⬜ |
| 共用 | `tool.json` 只抓一次；貼圖轉 WebP | `sdk/toolbox.js`、`assets-public/stickers/`、4 個 `tool.json` | ⬜ |
| 代理 P | S3、S7、U1、U4、U5 | `tools/pattern/`、`ui/compose/` | ⬜ |
| 代理 F | S1、U6、U7、U8 | `tools/fbpost/` | ⬜ |
| 代理 G | S8、U5、U13、U14 | `tools/linepush／design／collage／watermark／resize/`、`sdk/download.js` | ⬜ |
| 代理 M | U9、U10、U11、S10、U12、S9、U15 | `tools/livereq／ytdl/`（不動 `ext/`、`host/`）、`shell/install.*`、`admin/` | ⬜ |

項目代號對照見本對話審查報告（S＝速度、U＝介面）：
S1 排程發布開頁 66 請求；S2 貼圖；S3 圖片套版先顯示介面；S4 安裝教學延後；S5 字型 @import；S6 外掛偵測等 3 秒；S7 圖片套版縮圖重建；S8 LINE 推播重畫合併＋ObjectURL；S9 安裝檔並發下載；S10 YT 計時器。
U1 圖片套版上傳區移到每組最上方；U2 網址記工具；U3 頂列；U4「全部完成／完成」改名；U5 六個做圖工具下載／清除用語統一（下載這張／全部下載）；U6 新增發文聚焦文章網址；U7 切粉專清空列表、改時間／取消只更新該列；U8 新增發文 1280×720 塞得下；U9 直播需求單自動聚焦；U10「解析」降為次要；U11 YT 未裝外掛提示合併；U12 安裝教學第 1 步主按鈕；U13 設計「套用」斷行、快捷鍵收進「？」；U14 下載停用原因與批次進度；U15 管理頁密碼框聚焦。

## 下一步
- [ ] 主對話：批次 A＋共用 → commit
- [ ] 派 4 個代理（P／F／G／M）平行 → 各自回報
- [ ] 獨立審查代理 → 修問題
- [ ] 主對話：`node build.js`、`npm test`、`npm run e2e` 一次、截圖給使用者
- [ ] 使用者說「推」才併 main，同 commit 更新 CLAUDE.md「目前進度」

## 測試
`npm test`、`npm run e2e`、`node build.js --check` 全過。

## 注意事項／不能做的事
- 不動 `extension/core/`（不升外掛版號）；`extension/tools/` 等產生檔只用 `node build.js` 產生。
- 做圖輸出的像素不能變（匯出測試以 CI 為準）。
- 工具內切換一律用隱藏，不重建畫面。
- 不改後端。
