# 管理頁暫時停用排程發布
- 狀態：進行中　- 分支：claude/tender-carson-pl5eze　- 最後更新：2026-11-15
- 使用者原始需求：「先幫我在管理頁中增加可以暫時停用排程發布的功能」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 停用範圍 | 整個工具停用：所有 `/fb/*` 與 `/rundown` 回 `fb_paused`（503），前端只顯示公告 | 使用者選 |
| 已排定貼文／留言佇列 | 不動，cron／CommentHub 照常送 | 使用者選 |
| 恢復方式 | 只能管理頁手動恢復 | 使用者選 |
| 說明文字 | 管理員可填原因（≤100 字），沒填顯示預設 | 使用者選 |
| 本地紀錄／補留言 | 停用時也隱藏／擋 | 使用者同意預設 |
| 讀設定失敗 | 視為未停用（不讓 D1 問題擋死工具） | 比照 getMaxAttempts |
| 儲存位置 | 既有 D1 `fb_settings`（鍵 `paused`、`pause_reason`、`paused_at`） | 不建新表 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fbqueue.js` | `getPause()`／`setPause()` | ⬜ |
| `server/core/fb.js` | `handleFb` 驗證後檢查開關；`GET/POST /admin/fb/pause`（管理憑證） | ⬜ |
| `server/core/rundown.js` | `/rundown` 也檢查開關 | ⬜ |
| `server/core/http.js` | `fb_paused` 訊息與 503 | ⬜ |
| `admin/index.html`、`admin/admin.js` | 臉書發文分類最上方「暫停排程發布」卡片（先讀取才可操作、停用前確認） | ⬜ |
| `tools/fbpost/tool.js`、`tool.css` | 收到 `fb_paused` 隱藏內容顯示公告＋「重新檢查」 | ⬜ |
| 測試 | fb.test.js、fbpost.e2e.js、admin.e2e.js | ⬜ |

## 下一步
- [ ] 後端＋單元測試
- [ ] 管理頁卡片＋e2e
- [ ] 工具公告＋e2e
- [ ] `node build.js`、`npm test`、相關 e2e、獨立審查、截圖給使用者

## 測試
`npm test`；`npx playwright test test/e2e/fbpost.e2e.js test/e2e/admin.e2e.js`；`node build.js --check`。

## 注意事項／不能做的事
- 不改 cron／留言佇列；不升外掛版號（只動 tools/，extension/ 產生檔由 build.js 更新）。
- 後端需重新部署才生效。
