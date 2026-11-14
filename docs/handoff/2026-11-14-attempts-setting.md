# 管理後台可設定「留言嘗試次數」
- 狀態：已完成（已併入 main）　- 分支：claude/epic-cori-gkqog7　- 最後更新：2026-11-14
- 使用者原始需求：「那將嘗試次數可在管理後台設定次數好了」→ 確認：「1.可以 2.想改30秒」（接續 `2026-11-14-comment-due-only.md`，該版已併入 main）

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 設定範圍 | 全域一個整數，**1～5，預設 2** | 使用者確認 |
| 間隔 | 固定 **30 秒**（`RETRY_GAP_MS` 50000→30000），不開放設定 | 使用者要求改 30 秒 |
| 限流碼 | 仍第 1 次就停，不受次數影響 | 避免限流時加重 |
| 重設時間上限（5 次） | 不動 | 防迴圈，不是失敗重試 |
| 儲存 | D1 新表 `fb_settings`（key／value，`ensureTables` 自動建表）；管理憑證可寫，公司憑證不能 | 與預設文字同一套 |
| 生效時機 | 到點嘗試時才讀，已排隊的也適用 | 不用重新排程 |
| 讀不到／值不合法 | 退回預設 2，不讓留言停擺 | 安全 |
| 版號／部署 | 外掛不升版；**後端需重新部署**（自動建表） | 動了 `server/` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fbqueue.js` | `fb_settings` 表、`getMaxAttempts`／`setMaxAttempts`；`advance` 用設定值；`RETRY_GAP_MS`＝30000 | ✅ |
| `server/core/fb.js` | `GET`／`POST /admin/fb/settings`（管理憑證；整數 1～5） | ✅ |
| `server/core/admin.js` 或掛載處 | 掛上新路由（比照 `adminCommentPresets`） | ✅ |
| `server/core/admin-page.js` | 新卡片「留言嘗試次數」：數字輸入、儲存、說明（限流不重試、間隔約 30 秒） | ✅ |
| `server/schema.sql` | `fb_settings` 表 | ✅ |
| `test/server/fbqueue.test.js` | 預設 2；設 1／3；範圍與型別驗證；讀取失敗退回 2；限流不受影響；公司憑證不能寫 | ✅ |
| `docs/deploy.md`、規格 §6、`CLAUDE.md` 進度 | 同步 | ✅ |

## 下一步
- [x] 後端（表、讀寫、路由、advance）與測試
- [x] 管理頁卡片（讀取過實際設定才能按儲存，避免用預設值蓋掉）
- [x] `npm test` 372 項、`node build.js --check`
- [x] 獨立審查代理（Sonnet）：通過；已修測試標題／秒界偶發／權限斷言寫死 401
- [x] 使用者說「推」→ 併入 main，同 commit 更新 `CLAUDE.md`「目前進度」
- [ ] 使用者部署後端並在管理頁確認卡片可讀寫（見 `CLAUDE.md` 下一步）

## 測試
`npm test`（重點 `test/server/fbqueue.test.js`）、`node build.js --check`。

## 注意事項
- 不直接推 main；產生檔不手改。
