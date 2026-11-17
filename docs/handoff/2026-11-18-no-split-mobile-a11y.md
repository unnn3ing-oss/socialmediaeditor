# 停用並排＋手機跑版＋無障礙修正（方案 A）
- 狀態：進行中（實作完成，待審查與使用者確認）　- 分支：claude/zealous-hopper-p48pli　- 最後更新：2026-11-18
- 使用者原始需求：「可同時開兩個工具的分割功能停用，並把當前工具關閉的按鈕列也拿掉」「修復手機版無法顯示完整，按鈕過大的問題」，再依使用者提供的跨裝置設計規格（RESPONSIVE_DESIGN_HANDOFF，未進 repo）審查，使用者選方案 A。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 並排 | 整個拿掉（刪 `shell/drag.js`、`#dropzones`、layout 的 split），不留開關 | 使用者要停用；git 有歷史 |
| × 直條 | 拿掉（`.pane-close`、`padding-right:48px`）；回櫥窗＝點品牌／上一頁 | 使用者要求 |
| 舊網址 `#甲+乙` | 只開甲，網址改成 `#甲`（replaceState） | 相容舊書籤 |
| iPhone 整頁撐寬 | iframe 用 `width:1px; min-width:100%`；不用整頁 overflow-x:hidden 掩蓋 | 規格 §2.2 MUST NOT |
| 手機頂列 | ≤820px：品牌＋狀態＋登入一列，工具列一列可左右滑；按鈕高 34px、字 13px | 使用者嫌按鈕大；≥24px 符合 AA 2.5.8，未達 44px 建議（使用者要求） |
| 斷點 | 沿用 820／560，不改成 768／1024 | 規格允許沿用既有值 |
| 輸入框邊框對比（1.4.11） | 方案 A 不做（使用者選 A 非 B） | 待使用者之後決定 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `index.html`、`shell/drag.js`、`shell/main.js`、`shell/layout.js`、`shell/panes.js`、`shell/toolbar.js`、`shell/shell.css` | 拿掉並排、×、拖曳；iframe 寬度修正；手機頂列縮小；跳至主要內容 | ✅ |
| `ui/tokens.css` | `.field` 輸入框 `min-width:0` | ✅ |
| `tools/livereq/tool.css` | `.lr-duty` 用 `minmax(0,1fr)` | ✅ |
| `tools/linepush` | 320px 分頁列不超出；快速填入 × 放大；`quickfillText` 標籤；圖片 alt | ✅ |
| `tools/collage` | 320px 按鈕列不超出；滑桿可按高度 ≥24 | ✅ |
| `tools/watermark` | 滑桿可按高度 ≥24 | ✅ |
| `tools/pattern` | `gen-tag`、批次標題輸入等標籤；圖片 alt | ✅ |
| `tools/design` | 尺寸預設／寬／高／底色標籤；寬高欄位窄螢幕不擠成 22px | ✅ |
| 測試 | `test/layout.test.js`、`test/e2e/shell.e2e.js` 改寫；新增手機寬度 e2e（無水平溢位、無 ×、拖曳不並排、頂列高度上限） | ✅ |
| 文件 | README、規格 §並排標記停用、CLAUDE.md 進度 | ✅ |

## 下一步
- [x] 外殼改動＋layout 單元測試（`layout.js` 只剩 initial／open／home／visible；`panes.sync(tool)`；跳至主要內容＝`.skip`，JS 攔截不改網址）
- [x] 各工具 CSS／標籤（livereq minmax、linepush 頂列換行＋貼圖列可捲＋× 32px＋標籤／alt、pattern 標籤／alt、design `row()` 用 label for＋寬高可換行、collage／watermark 滑桿 24px、collage 按鈕不斷字）
- [x] 手機 e2e、npm test 618、e2e 136、build --check 通過；量測腳本 7 寬度 × 11 頁 0 項問題
- [x] 獨立審查：通過，無修改（小遺憾：設計「弧度」列第二個數字框沒名稱，原本就有）
- [ ] 截圖給使用者，等「推」

## 測試
`npm test`、`npm run e2e`、`node build.js --check`。審查腳本（scratchpad）：7 種寬度量 scrollWidth、超出元素、<24px 目標、無標籤欄位。

## 注意事項／不能做的事
- 沙盒只有 Chromium；iPhone 實機要使用者確認。
- 不動後端、外掛（不升版號）。

## 實作結果
- 頂列高度：≤820px 沒登入 89px、已解鎖且窄於 430px 時 119px（狀態換到第 2 列，不截字）；>820px 69px。
- 工具按鈕手機高 34px（≥24px AA；未達 44px 建議，使用者要求變小）。
- `shell/catalog.json` 的 `?v=` 變動是 build 依內容產生，正常。
