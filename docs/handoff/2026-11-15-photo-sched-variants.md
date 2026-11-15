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
| 1 | `git revert 95348a4`：有圖排程回兩步驟（基準） | ⬜ |
| 2（原因③） | 有圖排程改一步：/photos 帶 caption、source、published=false、scheduled_publish_time、**unpublished_content_type=SCHEDULED**；留言照片 ID 換貼文 ID 邏輯恢復 | ⬜ |
| 3（原因②，③不行才做） | revert 步驟 2 → 兩步驟改用圖片網址（R2 暫存公開網址）上傳；做法另列給使用者確認 | ⬜ |

## 下一步
- [ ] 步驟 1、2 commit、npm test、build --check
- [ ] 使用者「推」→ 部署 → 排有圖排程，看「已排定」與預覽
- [ ] ③ 不行：revert 步驟 2（回兩步驟）並列原因②做法

## 注意事項
- 後端需重新部署；外掛不升版號。
- ③ 部署期間若排程不出現在「已排定」，貼文仍可能在臉書上（未發布照片），要回報。
