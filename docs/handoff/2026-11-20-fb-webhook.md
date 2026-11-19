# 臉書 Webhook 回呼網址（最小版 A）
- 狀態：進行中　- 分支：claude/admiring-knuth-ku3kd3　- 最後更新：2026-11-20
- 使用者原始需求：「webhook 回呼網址…但我如果想先拿呢？」→ 選「A開始」（最小版：通過臉書驗證、只記最後收到時間與事件種類，不存內容）。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 回呼網址 | `https://toolbox-api.19jpz-3.workers.dev/fbhook`（不需登入） | 臉書直接打 |
| 驗證權杖 | HMAC-SHA256(SESSION_SECRET, 'fb-webhook-verify') 前 32 hex，不另存 | 免儲存、換 SESSION_SECRET 才變 |
| GET 驗證 | `hub.mode=subscribe` 且 `hub.verify_token` 相符 → 回 `hub.challenge`（純文字，只收英數 _-，≤200 字）；否則 403 | 防反射 |
| POST | 需「App 密鑰」（`appCred`）驗 `X-Hub-Signature-256`，沒密鑰或不對回 403；對的只記 D1 `fb_settings` k=`webhook_last` `{at, object, fields}`，回 200 | 不存內容 |
| 管理頁 | 「臉書發文」分類新卡片「Webhook」：回呼網址、驗證權杖（各有複製）、簽章檢查狀態、最後收到、重新整理；`GET /admin/fb/webhook` 僅管理憑證 | |
| 不做 | Meta 後台訂閱、`/{page}/subscribed_apps`（需 `pages_manage_metadata`） | 使用者選最小版 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/webhook.js`（新） | `handleFbHook`、`verifyToken`、`webhookState` | ✅ |
| `server/index.js` | modules 加 `handleFbHook` | ✅ |
| `server/fb/index.js` | `GET /admin/fb/webhook` | ✅ |
| `admin/`、`server/core/admin-page.js` | Webhook 卡片 | ✅ |
| `privacy/index.html` | 補 Webhook 一句（中英） | ✅ |
| 測試 | `test/server/fb-webhook.test.js`、admin e2e | ✅ |

## 下一步
- [x] 後端＋單元測試（`test/server/fb-webhook.test.js` 3 項）
- [x] 管理頁兩份＋e2e（admin 22 項）
- [x] 隱私權政策（中英各一列）
- [ ] 獨立審查 → 給使用者看；「推」才併 main（同 commit 更新 CLAUDE.md）

## 測試
`npm test`、`node build.js --check`、`node --test test/e2e/admin.e2e.js test/e2e/legal.e2e.js`。

## 注意事項
- 不存事件內容、不寫 log 內容；App Secret 不外流。**後端需重新部署**，外掛不升版號。
