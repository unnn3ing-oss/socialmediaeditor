# 留言守門（Webhook 自動隱藏洗版留言）
- 狀態：已完成（2026-11-20 併入 main）　- 分支：claude/dazzling-maxwell-813hs8　- 最後更新：2026-11-20
- 使用者原始需求：「接著做 留言守門」；洗版留言要「隱藏」，對方會先留隨機文字再編輯成標註假理財帳號（〇寶爸的〇〇）；選「A 先觀察再開啟」；App 已上線模式；兩組權杖其中一組有 webhook 與 pages_manage_metadata；關鍵字要能自訂。

## 已定案的決定
見設計 `docs/superpowers/specs/2026-11-20-comment-guard-design.md`（Webhook 即時＋文字預篩、模式 off/observe/hide、規則 r1 標註名稱含名稱關鍵字（預設自動隱藏）、r2 標註＋≥2 引導詞（預設只觀察）、手動取消隱藏＝豁免、無文字通知只計數、守門組別獨立於發文組別、紀錄 30 天）。

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/guard.js`（新） | 規則、設定、紀錄表、事件處理、管理路由 | ✅ |
| `server/fb/webhook.js`、`server/index.js` | 掛點、ctx、cron 清除 | ✅ |
| `server/fb/index.js`、`server/core/adminperm.js`、`server/core/levels.js` | 路由與卡片 `guard` | ✅ |
| `admin/index.html`、`admin/admin.js` | 「留言守門」卡片 | ✅ |
| `privacy/index.html` | 留言內容保存 30 天 | ✅ |
| 測試 | `test/server/fb-guard.test.js`、admin e2e | ✅ |

## 下一步
- [x] Task 1～4（計畫 `docs/superpowers/plans/2026-11-20-comment-guard.md`）
- [ ] 獨立審查 → 給使用者看 →「推」才併 main（同 commit 更新 CLAUDE.md）

## 測試
`npm test`、`node build.js --check`、`node --test test/e2e/admin.e2e.js test/e2e/legal.e2e.js`。

## 注意事項
- 後端需重新部署（正式＋測試），外掛不升版號。部署後主管在 Meta 後台 Webhooks 的 Page 訂閱 `feed`。

## 進度紀錄
- 2026-11-20：Task 1～4 完成（npm test 722、admin e2e 32、legal 6、build --check 通過）。已部署且 D1 已存「層級權限」的環境，管理者預設看不到新卡片 `guard`，要系統管理者在「層級權限」勾給管理者（沒存過的環境預設就有）。

## 第二段：更省呼叫（2026-11-20，使用者回「開始」）
- [x] 1. `prefilter` 改「名稱關鍵字，或 ≥2 個不同引導詞」（與規則一致，不漏抓）
- [x] 2. 紀錄已是 hidden／manual 的留言再編輯 → 直接略過不讀
- [x] 3. `/admin/fb/guard` 預設不查組別權限，`?check=1` 才查；管理頁加「檢查權限」按鈕；沒存過設定時預選發文使用中組別
- 不做：只看文字直接隱藏（會誤判）、每粉專每小時上限（先觀察）
