# 留言只在排程時間觸發，不再每分鐘打臉書
- 狀態：進行中　- 分支：claude/epic-cori-gkqog7　- 最後更新：2026-11-14
- 使用者原始需求：「可以到排程時間才觸發，並且如果有更改時間則抓新排程時間重設觸發時間，失敗兩次就顯示，不反覆重試」（起因：後端與臉書請求過多被限流）

## 已查明的根因（事實，模擬實測）
`syncScheduled`（每分鐘）對每個有待留言的粉專打 `scheduled_posts`，直到貼文發出（最多 30 天）。6 粉專各 1 篇、48 小時後發：8,646 次/天；每篇 3 則留言且換不到貼文 ID：34,566 次/天；用戶 token 再 +2,880。前端 60 秒輪詢只讀 D1，不是原因。repo 的 `server/wrangler.toml` 從未有每分鐘 cron 與 DO 綁定（實際部署狀況未知，待使用者確認）。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 時鐘 | 方案 A：`wrangler.toml` 加 `* * * * *` cron，只查 D1；不用 Durable Object | 簡單；留言最多晚約 1 分鐘 |
| 等待期間 | 完全不打臉書 | 根因 |
| 到點嘗試 | 最多 2 次，第 2 次約 60 秒後；第 2 次失敗 → `failed`，不再自動重試（沿用 UI「重試／知道了」） | 使用者要求 |
| 臉書時間與記錄不同（貼文未發布） | 以新時間重設 due（＋各自 delay）、嘗試次數歸零，不算失敗；單筆最多重設 5 次 | 使用者要求；防迴圈 |
| 貼文已刪除 | 直接 `canceled` | 沿用 |
| 限流碼（4／17／32／613／80001） | 第 1 次就 `failed`，不試第 2 次 | 使用者同意 |
| 換貼文 ID | 只在嘗試時做（photoToPost），不再每分鐘試 | 去掉 25,920 次/天 |
| 版號／部署 | 不升外掛版號；**後端需重新部署**，並確認 Cloudflare 後台 Triggers 有 `* * * * *` | 動了 `server/` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fbqueue.js` | 移除 `syncScheduled`／`syncPage` 的臉書對時（保留 D1 到期處理入口）；`OFFSETS` 改 2 次；`advance` 兩次即失敗；限流直接失敗；重設次數上限（需新欄位或沿用 `step`） | ⬜ |
| `server/index.js` | `scheduled()`：每日 cron 清理，其他 cron 只跑 `processDue`；更新註解 | ⬜ |
| `server/core/fb.js:610` | 註解更新（不再靠 cron 對時補） | ⬜ |
| `server/wrangler.toml` | `crons = ["* * * * *", "17 19 * * *"]` | ⬜ |
| `test/server/fbqueue.test.js` | 改寫 syncScheduled 相關與「3 分鐘」測試；新增：第 2 次失敗即停、限流不重試、重設時間、重設上限、等待期間 0 次 Graph 呼叫 | ⬜ |
| `docs/deploy.md`、規格 §6、`tools/fbpost/TOOL.md`（如有提及） | 同步 | ⬜ |

## 下一步
- [ ] 改 fbqueue.js／index.js／wrangler.toml
- [ ] 改測試並跑 `npm test`、`node build.js --check`
- [ ] 用 scratchpad 模擬腳本驗證「等待期間 0 次 Graph」
- [ ] 獨立審查代理
- [ ] 使用者說「推」才併入 main，同 commit 更新 `CLAUDE.md`「目前進度」

## 測試
`npm test`（重點 `test/server/fbqueue.test.js`）、`node build.js --check`。

## 注意事項
- token 不進 D1／KV／日誌；錯誤訊息先 scrub。
- 不直接推 main。
