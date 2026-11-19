# 臉書：自動延長權杖＋存粉專權杖＋到期提醒
- 狀態：進行中　- 分支：claude/admiring-knuth-ku3kd3　- 最後更新：2026-11-19
- 使用者原始需求：「能用主管的 User token 自動幫我換好粉專權杖並存起來嗎？」→ 選「方案2 開始」（後端用 App ID＋App Secret 自動把短效權杖轉長效）。只有 A 方案（主管個人 User token），沒有系統使用者權杖。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 延長方式 | 方案 2：後端 `GET /oauth/access_token?grant_type=fb_exchange_token`（需 Secrets `FB_APP_ID`、`FB_APP_SECRET`） | 使用者選；主管少一步 |
| 沒設 App 密鑰時 | 不擋功能，照舊接受；但換到的粉專權杖若不是永不過期就拒存，提示先用偵錯工具延長 | 避免存進會過期的權杖 |
| 粉專權杖 | 「驗證並儲存」時換好、AES-GCM 加密存 D1 `fb_settings` k=`page_tokens`；發文優先用存好的 | 長效使用者權杖換到的粉專權杖不過期，60 天後不停擺 |
| 檢查期限 | debug_token 第一個粉專權杖：`expires_at` 必須 0；另記 `data_access_expires_at`（約 90 天資料存取期限）顯示並提醒 | Meta 有兩個時鐘，資料存取期限待實測是否影響發文 |
| 重新整理粉專 | 使用者權杖仍有效 → 重新換並覆蓋；已過期 → 保留舊的粉專權杖 | 新粉專要能加進來，過期不能把好的蓋掉 |
| 改回 Secret | 同時刪存好的粉專權杖 | |
| 提醒 | 剩 ≤14 天或發文遇到權杖失效（190）→ 管理頁黃色提醒；fbpost／fbvideo 只有管理員看得到提醒 | |
| Secret `FB_USER_TOKEN` 路徑 | 不變（不存粉專權杖） | 相容 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/graph.js` | `exchangeToken(env, ut)` | ⬜ |
| `server/fb/tokenstore.js` | 通用加密存取；`savePageTokens`／`storedPageTokens`／`clearPageTokens`；失效旗標 `markBroken`／`brokenAt` | ⬜ |
| `server/fb/pages.js` | `pageTokens` 先讀存好的；`connectToken`（延長→換粉專→檢查期限→存）；`refreshPages`；`tokenStatus` 多回 `stored`、`warn`、`autoExtend` | ⬜ |
| `server/fb/index.js` | `POST /admin/fb/token` 走 `connectToken`；DELETE 清粉專權杖；`/admin/fb/refresh` 走 `refreshPages`；`fbFail` 遇 190 記失效；`/fb/me` 管理員多回 `tokenWarn` | ⬜ |
| `admin/admin.js`、`server/core/admin-page.js` | 狀態列顯示粉專權杖期限、資料存取期限、提醒 | ⬜ |
| `tools/fbpost`、`tools/fbvideo` | 管理員看到黃色提醒 | ⬜ |
| `docs/deploy.md`、README | Secrets `FB_APP_ID`／`FB_APP_SECRET` | ⬜ |
| 測試 | `test/` 相關單元測試；admin、fbpost、fbvideo e2e | ⬜ |

## 下一步
- [ ] 後端實作＋單元測試
- [ ] 管理頁兩份＋工具提醒
- [ ] 文件
- [ ] 獨立審查 → 給使用者看

## 測試
`npm test`、`node build.js --check`、`npx playwright test test/e2e/admin* test/e2e/fbpost* test/e2e/fbvideo*`（沙盒用 `/opt/pw-browsers/chromium`）。

## 注意事項／不能做的事
- 權杖、App Secret 永遠不回傳前端、不寫 log。
- 不推 main，使用者說「推」才併。**後端需重新部署**＋`wrangler secret put FB_APP_ID`／`FB_APP_SECRET`；外掛不升版號。
