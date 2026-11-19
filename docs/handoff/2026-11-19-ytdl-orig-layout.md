# YT 批量下載：照原版排版（網頁兩欄＋外掛側邊欄分頁）
- 狀態：已完成（已併入 main）　- 分支：claude/ecstatic-goodall-mz65ql　- 最後更新：2026-11-19
- 使用者原始需求：「YT批量下載在外掛程式也要有與原先 影片批量下載器 的功能介面排版，網頁版也是，但介面設計照目前的去設計」；選方案 A（側邊欄內嵌網站頁面）。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 參考來源 | `unnn3ing-oss/videodownload` 的 `index.html`（網頁兩欄）、`extension/sidepanel.html`（側邊欄）只看排版 | 使用者要求 |
| 外觀 | 沿用目前設計（tokens、segmented、btn） | 使用者要求 |
| 網頁 | 左側欄 320px（設定狀態鈕、下載設定、環境檢查、版本與更新），右主區（說明、新增、清單）；設定步驟改彈窗 dialog（三步驟、上一步／下一步） | 照原版 |
| 側邊欄 | 方案 A：外掛側邊欄新增「YT 下載」分頁，iframe 內嵌 `panel.html?tool=ytdl&embed=side`；窄版排版照原版側邊欄（目前分頁卡、增加、清單、間隔、開始全部下載滿版、設定與工具收合） | 使用者選 A |
| 目前分頁 | 外掛背景程式把作用中分頁（只限 YT／IG 網址）推給頁面，不加權限 | 原版功能 |
| 版號 | 外掛 3.00 → 3.10 | 部分小功能 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/ytdl/index.html`、`ytdl.css`、`app.js` | 兩欄＋彈窗；embed=side 窄版 | ✅ |
| `tools/ytdl/ext/index.js` | 推目前分頁 | ✅ |
| `extension/core/sidepanel.*` | 新分頁 | ✅ |
| `extension/core/manifest.base.json`、`extension/changelog.json` | 3.10 | ✅ |
| e2e | 調整 ytdl 測試 | ✅ |

## 下一步
- [x] 實作（網頁兩欄＋彈窗精靈、embed=side 窄版、目前分頁 op／推播、側邊欄分頁、3.10）
- [x] npm test 659、e2e 213、build --check 通過
- [x] 獨立審查（修 dialog close 旗標，`6f617d8`）
- [x] 依使用者要求拿掉 AI 式說明文字（使用前請先確認、環境檢查／診斷／版本說明、設定步驟說明；清單空白改「清單是空的」；TOOL.md 同步）
- [x] 給使用者截圖確認、使用者說「推」併入 main → 使用者說「推」才併 main（同 commit 更新 CLAUDE.md 目前進度）

## 實作重點
- `shell/panel.js`：panel.html 帶 `embed=side` 時傳給工具 iframe（`?v=...&embed=side`）。
- `tools/ytdl/index.html`：`<html class="is-side">` 由內嵌 script 依 `?embed=side` 加；左側欄 `#side` 內是 `<details id="side-tools">`（網頁 JS 設 open、CSS 藏 summary；側邊欄預設收合）。
- 設定步驟 `<dialog id="setup-card">`：自動打開只在「外掛在、下載助手沒在跑」；已連上但缺元件不擋畫面。一次一步，`viewStep` 跟著 `suggested`，進度往前就重設。
- 目前分頁：`ext/index.js` `current_tab` op＋`tabs.onActivated`／`windows.onFocusChanged`／`tabs.onUpdated` 推 `{type:'current_tab', tab}`（150ms 合併）；`bridge-client` `onTab`；只在 is-side 顯示。
- 側邊欄：`extension/core/sidepanel.*` 第二個分頁「YT 下載」，第一次切過去才設 iframe src。

## 測試
`npm test`、`node build.js --check`、`npm run e2e`（ytdl 相關＋整合時全部）。

## 注意事項
- 不改下載邏輯、host、協定、後端。切換分頁一律隱藏不重建。
