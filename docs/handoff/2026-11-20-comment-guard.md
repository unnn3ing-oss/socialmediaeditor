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

## 第三段：紀錄單行表格＋管理頁分 6 類（使用者選 紀錄 A、分類 A，回「開始」）
- [x] 紀錄改單行表格（色點：黃觀察／綠已隱藏／紅失敗；點列展開全文、標註、留言者 ID、連結；≤820px 兩行）
- [x] 管理頁分類：發文設定（access、pages、presets、video）／留言守門（guard）／人員與權限（staff、groups、levels）／連線（profiles、fbconn、webhook、usage、rundown）／素材／紀錄（audit、logs）；沒卡片的分類隱藏；舊 hash `#fb`→發文設定、`#staff`→人員與權限、`#rd`→連線、`#logs`→紀錄
- 只改 `admin/`＋e2e；後端不動

## 第四段：進階設定分類＋改名＋縮小（使用者確認）
- [ ] 「敏感設定」改「進階設定」：左側最下面、只有系統管理者看得到；點進去先輸入管理員密碼，解鎖後才顯示；卡片＝排程發布開關、權杖組別、臉書連線、Webhook、權限組、層級權限（只在這一類）；拿掉頁頂 unlockBar
- [ ] 排程發布開關（access）改只有系統管理者（levels.js locked＋sensitive，管理者不能被勾）
- [ ] 改名：紀錄→使用紀錄、留言守門→留言管理（含 levels 名稱、隱私權政策）、連線→連接狀態
- [ ] 連接狀態最上方新卡片「臉書粉專連線狀態」（不打臉書：使用中組別、粉專名單、權杖失效／到期提醒）
- [ ] 卡片／輸入框／文字縮小（電腦 36px 控制項、手機 ≥40）
