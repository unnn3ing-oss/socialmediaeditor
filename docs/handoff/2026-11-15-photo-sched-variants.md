# 有圖排程：回兩步驟（基準）→ 測試一步做法加 SCHEDULED（原因③）→ 不行再測圖片網址（原因②）
- 狀態：進行中　- 分支：claude/dreamy-hawking-mme5c2　- 最後更新：2026-11-15
- 使用者原始需求：排程貼文要出現在臉書後台「已排定」，且列表預覽要有圖片。「先做步驟1，先做原因3測試，如果後面回饋不行則拿掉改測試原因2」。

## 已知事實
| 做法 | 已排定 | 列表預覽 |
|---|---|---|
| 一步：/photos＋published=false＋scheduled_publish_time | ❌（11/15 兩次） | — |
| 兩步：/photos temporary → /feed attached_media＋SCHEDULED | ✅ | ❌ 無法取得預覽（編輯貼文正常） |
| 網新後端（App：TVBS社群自動發文排程） | ✅ | ✅ |
- token 權限齊全（pages_manage_posts 等）。App 模式未知（token 屬主管帳號，使用者看不到 App）。Meta 文件：開發模式建立的內容只有 App 角色看得到。

## 做法（每步一個 commit，可單獨 revert）
| 步驟 | 內容 | 狀態 |
|---|---|---|
| 1 | `git revert 95348a4`：有圖排程回兩步驟（基準）→ `b982e4d` | ✅ |
| 2（原因③） | 有圖排程改一步：/photos 帶 caption、source、published=false、scheduled_publish_time、**unpublished_content_type=SCHEDULED**；留言照片 ID 換貼文 ID 邏輯恢復 → 見下一個 commit | ✅ |
| 3（原因②，③不行才做） | revert 步驟 2 → 兩步驟改用圖片網址（R2 暫存公開網址）上傳；做法另列給使用者確認 | ⬜ |

## 實測結果
- 原因③（`543c0de`）：臉書後台「已排定」列表**沒出現**；工具「已排程」（`/scheduled_posts`）**讀得到**。→ 已 revert，回兩步驟（與 `b982e4d` 相同）。

- 原因②（`cc31865`、`8218868`）：「已排定」列表**有出現**但**仍無預覽**；另發現在臉書後台編輯貼文按「排定時間」會跳「無法編輯貼文」錯誤 → 已 revert，回兩步驟直接上傳（與 `b982e4d` 相同，`fbimg.js` 移除）。
- 剩下線索：App 模式（請主管確認）、網新後端參數。

## 下一步
- [x] 步驟 1、2 commit、npm test 359、build --check
- [x] 使用者「推」→ 部署 → 排有圖排程，看「已排定」與預覽
- [x] ③ 不行：revert 步驟 2（回兩步驟）
- [x] 列原因②做法給使用者確認 → 使用者：「用 toolbox-files，但改一天後刪除就好」
- [x] 原因②實作（cc31865、R2 失敗退回直接上傳）：新模組 `server/core/fbimg.js`（R2 `tmp/fbimg/<32 hex>.<ext>` 暫存、公開 `GET /fbimg/<名>`、每天 03:17 cron 刪超過 24 小時的檔，所以實際保留 1～2 天）；`createPost` 排程＋圖片檔＋有 FILES 時，兩步驟第 1 步改用 `url`（沒 FILES 退回 source）；index.js 掛路由與 cron
- [x] npm test 367、build --check、審查（Sonnet）通過
- [x] 使用者「推」→ 部署 → 實測

## 注意事項
- 後端需重新部署；外掛不升版號。
- ③ 部署期間若排程不出現在「已排定」，貼文仍可能在臉書上（未發布照片），要回報。
