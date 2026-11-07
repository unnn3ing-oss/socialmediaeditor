# v7：外掛側邊欄做成「網新快速排程」一樣的介面（後端用 toolbox-api）
- 狀態：進行中　- 分支：`claude/epic-carson-tbq8e0`（從 main 5f2fd55 起）　- 最後更新：2026-11-07
- 使用者原話：「幫我將外掛插件做出與目前「網新快速排程」一樣的介面，但後端都是目前這個工具的，與原有「網新快速排程」的後端及相關功能都不要。」→ 計畫 →「A」（版號 2.00、側邊欄內可輸入公司密碼）

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 版面 | 照 -schedulenewnet `extension/sidepanel.html`：頂列「網頁版」＋分頁「發文／狀態與更新」（有新版顯示「新」） | 使用者要一樣 |
| 不帶過來 | 網新 cookie、網新後台、Rundown、「舊版」按鈕、連線驗證／自製圖測試連結 | 使用者要求 |
| 發文分頁 | iframe 嵌入 `shell/panel.html?tool=fbpost`（簡化外殼，提供 tbxShell、公司密碼解鎖） | 工具單獨開會判成非公司模式 |
| 狀態分頁 | 公司模式狀態、一鍵檢測（後端／憑證／粉專清單／外掛橋接，由嵌入頁 postMessage 回報）、版本更新 | — |
| 權限 | host_permissions 加 `https://unnn3ing-oss.github.io/*`（iframe 共用網站 localStorage） | 舊外掛同做法 |
| 版號 | 1.01 → 2.00，更新 changelog | 選 A |
| 窄版 | tools/fbpost/tool.css 加 ≤640px 單欄 | 側邊欄約 400px |

## 做法（改哪裡）
| # | 檔案 | 狀態 |
|---|---|---|
| 1 | panel.html（根目錄，catalog 相對路徑才對）、shell/panel.js、shell/panel.css；shell/config.js 加 EXT_ORIGIN | ✅ |
| 2 | extension/core/sidepanel.{html,css,js} | ✅ |
| 3 | extension/core/manifest.base.json、extension/changelog.json → `node build.js` | ✅ |
| 4 | tools/fbpost/tool.css 窄版 | ✅ 不用改（既有 ≤820px 單欄，e2e 驗證） |
| 5 | 測試：test/extension.test.js、test/e2e/sidepanel.e2e.js（真的載入外掛） | ✅ |
| 6 | 文件：tools/fbpost/TOOL.md、規格 §8 側邊欄 | ✅ |

## 下一步
- [x] 1→6 完成；unit 301、e2e 82 全過
- [ ] 審查代理審查 → 截圖給使用者確認
- [ ] 使用者說「推」才併 main（同 commit 更新 CLAUDE.md 目前進度）

## 測試
`npm test`、`node build.js --check`、`npm run e2e`（沙盒 chromium `/opt/pw-browsers/chromium`）。

## 注意事項／不能做的事
- 產生檔不要手改；不動 server/、不動畫布繪製。
- postMessage 一律檢查 origin／source。
