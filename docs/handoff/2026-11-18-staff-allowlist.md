# 排程發布授權名單（員工編號＋姓名＋權限組）
- 狀態：進行中　- 分支：claude/zen-wozniak-y8862m　- 最後更新：2026-11-18
- 使用者原始需求：「在管理頁建構使用者授權頁，可新增有授權的人才可排程發布功能，作為撤銷授權」→ 方案 1，「因為我們有公司個人編號，想直接可在管理頁有授權頁，直接增加對應 ID 與人名、權限組」→「開始」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 登入 | **只輸入員工編號**（不另發個人代碼） | 使用者：同事不會特別知道彼此編號 |
| 權限組 | 預設 3 組（管理／發文／檢視）＋可自訂（名稱＋勾選權限） | 使用者選 a+b |
| 權限 | `view` 檢視列表、`post` 新增發文（含排入 Rundown）、`edit` 改排程時間、`delete` 刪除貼文、`bypass` 關閉時仍可使用 | |
| 開放／關閉 | 關閉＝只有管理員密碼登入與有 `bypass` 的人能用；開放＝名單內依權限組 | 使用者：「關閉一樣在管理才可不受限制，其他同事會被擋」 |
| 公司密碼登入 | 其他工具照用；**排程發布一律擋**（`fb_need_staff`） | 只有名單內的人能用 |
| 撤銷 | 移除／停用後下一次請求就擋（`bearer()` 每次查 D1），連公司素材也失效 | |
| 粉專限制 | 不限 | 使用者選 a |
| 操作紀錄 | 記發文、改時間、刪除（編號、姓名、動作、粉專、貼文 ID、時間），保存 90 天，管理頁可查 | 使用者選 a |
| 管理頁 | 網站 `admin/` 與後端 `/admin` 兩份都加「授權名單」分類 | 兩份功能相同（既有慣例） |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/staff.js`（新） | `staff`、`staff_groups`、`fb_audit` 三表（自動建立＋預設 3 組）；查詢、管理 API `/admin/staff*`、`/admin/audit`；稽核清理 | ✅ |
| `server/core/token.js` | 憑證帶 `uid` | ✅ |
| `server/core/auth.js` | `/auth` 接受 `{ staffId }`；`bearer()` 有 uid 就查名單；`/auth/status` 回 `staff`、續期保留 uid | ✅ |
| `server/core/http.js` | 錯誤碼 `bad_staff`、`fb_need_staff`、`fb_no_perm` | ✅ |
| `server/fb/access.js`、`server/fb/index.js` | 每條路由標所需權限；`GET /fb/me`；寫操作紀錄 | ✅ |
| `server/index.js`、`server/schema.sql` | 掛管理路由、cron 清 90 天紀錄 | ✅ |
| 子代理 A：`admin/`、`server/core/admin-page.js` | 「授權名單」分類（名單、權限組、操作紀錄）；開放／關閉說明文字 | ✅ |
| 子代理 B：`shell/company.js`、`tools/fbpost/`、`sdk/` | 登入視窗「員工編號／公司密碼」分頁、頂列顯示姓名；排程發布依 `/fb/me` 隱藏按鈕、`fb_need_staff` 提示 | ✅ |
| `privacy/`、`data-deletion/` | 加授權名單與操作紀錄兩列 | ✅ |

## 下一步
- [x] 後端＋單元測試 → commit `3999fd1`（npm test 631）
- [x] 派子代理 A、B（sonnet，背景執行）
- [x] 隱私權政策更新（授權名單、操作紀錄兩列）
- [x] 整合：npm test 631、全部 e2e 200、build --check 通過（`80d3ac1`）
- [x] 獨立審查：修正後通過（`/admin/staff/<id>` 壞掉的 % 編碼改回 404）
- [x] 截圖給使用者
- [ ] 使用者說「推」→ 併入 main、更新 CLAUDE.md
- [ ] 使用者部署後端 → 管理頁新增同事 → 實測員工編號登入
- [ ] 待使用者決定：排程發布卡片說明「測試中，僅管理員可用」與「管理員測試」標籤是否改掉

## 測試
`npm test`、`npm run e2e`、`node build.js --check`

## 注意事項
- 後端要重新部署（自動建表，不用手動 SQL）。外掛不升版號。
- 只用員工編號登入：猜到編號就能登入（失敗每次延遲 1 秒），已告知使用者。
