# 影片發布送出紀錄附貼文連結
- 狀態：進行中　- 分支：claude/beautiful-cannon-2vsihi　- 最後更新：2026-11-26
- 使用者原始需求：「影片發布送出紀錄也附上貼文連結」；選方案 B（前端＋後端多文 ID）

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 顯示 | 每粉專一行後面「開啟貼文 ↗」（另開分頁），樣式同管理頁操作紀錄 `.au-open` | 一致 |
| 哪些狀態顯示 | 原粉專：published／scheduled／processing／draft 且有 videoId；多文：done 且有 videoId | 失敗等沒有貼文 |
| 網址 | 共用 `shell/notices.js` `fbPostUrl` | 同一套規則 |
| 多文 ID | 後端 `refreshStatus` 寫回 xpost 時存 `videoId`，`view()` 回傳 | 方案 B；舊紀錄沒有 ID 不顯示 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/video.js` | `refreshStatus` 多文帶 videoId；`view()` cross 回 videoId | ✅ |
| `tools/fbvideo/app.js` `loadLog` | 加連結 | ✅ |
| `tools/fbvideo/fbvideo.css` | `.log-open` 樣式 | ✅ |
| 測試 | `test/server/fb-video.test.js`、`test/e2e/fbvideo.e2e.js` | ✅ |

## 下一步
- [x] 實作與測試（npm test 826、fbvideo e2e 17、build --check）
- [x] 獨立審查通過
- [ ] 給使用者看、等「推」

## 測試
`npm test`、`npx playwright test test/e2e/fbvideo.e2e.js`、`node build.js --check`

## 注意事項
後端需重新部署（正式＋測試）；外掛不升版號。
