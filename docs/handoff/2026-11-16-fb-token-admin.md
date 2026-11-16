# 排程發布：管理頁可換臉書權杖
- 狀態：進行中　- 分支：claude/rebuild-scheduled-publish-3sd0gr　- 最後更新：2026-11-16
- 背景：實測立即發圖只出現在相簿（貼文 is_published、公開、有 page_story_id，App＝DEV-TOOL `901534349620430`），推論 App 被切回開發模式；主管明天確認，使用者想到時在管理頁直接換權杖。
- 使用者選方案 A，說「開始」。

## 已定案
| 項目 | 決定 |
|---|---|
| 存放 | D1 `fb_settings`（k,v,updated）一列 `user_token`，用 SESSION_SECRET 衍生 AES-GCM 金鑰加密；表自動建立（schema.sql 也加） |
| 讀取順序 | 管理頁存的 → Secret `FB_USER_TOKEN` |
| 儲存前驗證 | debug_token：USER 類型、有效、有 pages_manage_posts、換得到 ≥1 粉專；不合格不存 |
| 路由 | `POST /admin/fb/token {token}`、`DELETE /admin/fb/token`（管理憑證）；永不回傳權杖 |
| 狀態 | `/admin/fb/status` 多回 `source`（admin／secret）、`app`（App 名稱） |
| 不做 | 短期換長期（需 App 密鑰，已刪） |

## 進度
- [ ] 後端 tokenstore＋pages 讀取順序＋路由＋測試
- [ ] 管理頁兩份＋e2e
- [ ] 審查、截圖；使用者說「推」才併入；後端需部署
