# YT 批量下載：照原版排版（網頁兩欄＋外掛側邊欄分頁）
- 狀態：進行中　- 分支：claude/ecstatic-goodall-mz65ql　- 最後更新：2026-11-19
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
| `tools/ytdl/index.html`、`ytdl.css`、`app.js` | 兩欄＋彈窗；embed=side 窄版 | ⬜ |
| `tools/ytdl/ext/index.js` | 推目前分頁 | ⬜ |
| `extension/core/sidepanel.*` | 新分頁 | ⬜ |
| `extension/core/manifest.base.json`、`extension/changelog.json` | 3.10 | ⬜ |
| e2e | 調整 ytdl 測試 | ⬜ |

## 下一步
- [ ] 讀 app.js、panel.html、ext/index.js，實作

## 測試
`npm test`、`node build.js --check`、`npm run e2e`（ytdl 相關＋整合時全部）。

## 注意事項
- 不改下載邏輯、host、協定、後端。切換分頁一律隱藏不重建。
