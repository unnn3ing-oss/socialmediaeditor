# 影片一次傳一支＋列表開啟貼文＋側邊欄載入更多
- 狀態：已完成（待使用者確認與「推」）　- 分支：claude/trusting-clarke-h20olv　- 最後更新：2026-11-27
- 使用者原始需求：「影片發布上傳改成一次一隻（兩隻長影片同時就會失敗）」「排程、已發布列表增加可以開啟貼文的連結按鈕」「外掛的已排程已發布列表下方出現【載入更多】，也要在背景預先載好」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 影片上傳 | A：`PARALLEL` 2→1，全部一次一支；/start 不改 | 使用者實測兩支長影片同時傳會失敗 |
| 開啟貼文 | 已排程、已發佈每列「開啟貼文 ↗」，網頁與側邊欄都有；已發佈用 `it.url` 否則 `fbPostUrl`，已排程用 `fbPostUrl`（方案 1，打不開再改） | 使用者選 1 |
| 側邊欄載入更多 | 只在 `is-side`：不用分頁，先顯示 20、按一次 +20（用快取）；未顯示 <20 且有 next 時背景再讀一批（一次一批、`document.hidden` 不讀、失敗不提示）；讀完灰字「已經到底了」；刷新／換粉專回 20；網頁版不變 | 使用者確認 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbvideo/app.js` | PARALLEL=1 | ✅ |
| `tools/fbpost/manage.js` | 開啟貼文按鈕、makeList 側邊欄模式 | ✅ |
| `tools/fbpost/fbpost.css`、`index.html` | 載入更多／到底樣式 | ✅ |
| `test/e2e/fbpost.e2e.js` 等 | 連結、側邊欄載入更多測試 | ✅ |

## 測試
`npm test`、`node build.js --check`、fbpost／fbvideo／sidepanel e2e。

## 注意事項
純網站，不部署後端、外掛不升版號。

## 結果
- npm test 857、fbpost＋sidepanel e2e 66、fbpost-compose 26、fbvideo 全過、build --check 通過；獨立審查通過（修 openBtn title 被註解吃掉）。
- 側邊欄窄：按鈕文字「開啟 ↗」、五顆一列。
- 審查 Minor 未修：背景先讀中按刷新，刷新後那次不預讀；背景先讀回應可能放回剛刪的貼文（與「讀取更多」既有 Minor 同類）。
