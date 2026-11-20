# 數據報表（tools/fbreports，第一版只做臉書）
- 狀態：進行中　- 分支：claude/sleepy-albattani-xtbkpg　- 最後更新：2026-11-20
- 使用者原始需求：「依 CLAUDE.md 與本規格開發『數據報表』。先核對目前分支、公司權限與 Graph 實際可回傳欄位，按第 4 節實作第一版。保留既有發文與單篇成效入口的行為。」
- 規格：使用者上傳的 `2026-11-20-fb-reports-design.md`（基準 `d477b09`），已複製為 `docs/superpowers/specs/2026-11-20-fb-reports-design.md`。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 欄位實測 | 沙盒連不到 graph.facebook.com 與測試 Worker（代理 403），改做「欄位檢查」按鈕（只有系統管理者看得到）讓使用者在測試 Worker 一鍵實測 | 規格步驟 1 需要真實權杖 |
| 觸及 | 後端常數 `REACH_METRIC = null`：觸及與互動率先顯示「—」；Meta 文件只說 `post_total_media_view_unique` 是「不重複觀看者」。實測與 Business Suite 對得上再改成該指標 | 規格：只能驗證不重複瀏覽時觸及顯示 — |
| 期間 | 參數帶 since／until（文件沒寫），另外依 created_time 過濾，看到比起日早的貼文就停 | since／until 不被支援時仍正確 |
| Insights | 先試清單欄位展開 `insights.metric(...)`；失敗記在執行個體記憶體，改逐篇 `/{post}/insights`（清單 4 篇＋4 次＝每批 ≤6 次） | 文件沒寫欄位展開 |
| 分享 | Graph 沒回 `shares` 欄位＝0（Graph 0 分享時省略欄位，待實測） | |
| 缺 read_insights | 文件：回空資料不報錯 → 該篇成效 `null`，原因 `no_data` | |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/reports.js` | `GET /fb/reports/posts`、`GET /fb/reports/probe`、游標簽章、範圍代碼、分類、快取、用量暫停 | ✅ |
| `server/fb/usage.js` | 新增 `usageBusy`（guard.js 沒改，仍用自己的那份） | ✅ |
| `server/fb/index.js`、`pages.js`、`core/http.js`、`core/token.js` | `registerReports(route)`；`listPages({withToken})`；錯誤碼 `report_scope`（409）；匯出 `b64urlDecode` | ✅ |
| `tools/fbreports/` | 工具頁（index.html、app.js、calc.js、fbreports.css、tool.json、TOOL.md、icon、thumb） | ✅ |
| `tools/registry.json` | 加 `fbreports`（排在 fbvideo 後）、`node build.js` | ✅ |
| 測試 | `test/server/fb-reports.test.js`（9）、`test/fbreports-calc.test.js`（4）、`test/e2e/fbreports.e2e.js`（6） | ✅ |
| 文件 | `docs/deploy.md`、`privacy/` 中英補 read_insights 與報表快取 | ✅ |

## 下一步
- [x] 後端 reports.js＋單元測試
- [x] 前端工具＋calc 單元測試＋e2e
- [x] 全部 e2e（251 項：249 過，admin「臉書連線」與 fbpost-compose「圖完全相同」兩項在全體並跑時逾時，單獨重跑皆過，相關檔案未改）、npm test 740、build --check、獨立審查（無 Critical／Major，2 個 Minor 已修）
- [ ] 使用者：部署測試 Worker → 系統管理者開「數據報表」按「欄位檢查」→ 回報結果 → 決定 REACH_METRIC

## 測試
`npm test`、`npm run e2e`、`node build.js --check`。

## 注意事項
- 不改 `/fb/published`、`manage.js`、排程發布與影片發布。
- 成效回應 `Cache-Control: no-store`；KV 鍵含組別、範圍代碼、粉專、Graph 版本、資料版本。

## 已知限制（第一版）
- 批次部分失敗（逐篇成效讀取錯誤）時，該批結果照樣顯示但不快取；前端不會自動回頭補那幾篇，要重新查詢。
- 欄位檢查約 30 次 Graph 呼叫（只有系統管理者、手動按）。
- 分類規則（Reels 用 permalink `/reel/` 或附件 type 含 reel）未經實測。

## 追加：粉專／發文類型改多選下拉（2026-11-20，使用者確認「開始」）
- 做法：`index.html` 兩排晶片 → 兩個 `<details class="dd">`（內含勾選框）；按鈕文字＝1～2 個列名稱、3 個以上「X 等 N 個」、全選「全部粉專／全部類型」、沒選「未選擇」；點外面／Esc 關閉、焦點回按鈕；電腦一列、手機各一行。行為不變（類型只篩已載入結果）。
- 狀態：🚧 進行中（`app.js`、`fbreports.css`、`fbreports.e2e.js`）
