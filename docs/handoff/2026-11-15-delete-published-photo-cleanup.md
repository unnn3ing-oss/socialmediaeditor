# 已發布貼文刪除＋管理頁清理未發布照片
- 狀態：進行中　- 分支：claude/confident-keller-edllg4　- 最後更新：2026-11-15
- 使用者原始需求：「做一個清理未發布照片的功能，我需要能在已發布中也能刪除已發布的」；確認「開始，用方案 A」。

## 背景（已知事實）
- 立即發圖（`/photos` 單步驟）只在粉專相簿留下照片，後台與前台貼文列都看不到，相簿點開顯示「目前無法查看此內容」，介面也刪不掉。根因未明（不是 c013279 之後的改動造成），本項只做「清得掉」，不解決根因。
- 目前後端只有 `POST /fb/cancel`：只刪未發布（先查 `is_published`），已發布一律拒絕。照片 ID 不是 `粉專ID_貼文ID` 格式，cancel 吃不進。
- 未驗證（推論）：列出粉專未發布照片的端點（`/{粉專}/photos?type=uploaded`）是否包含未發布者，環境連不到臉書無法驗證，所以清理功能另提供「手動貼照片 ID」保底。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 刪除已發布貼文 | 方案 A：公司憑證即可＋確認視窗（顯示粉專名稱＋貼文前 30 字、寫明無法復原） | 使用者要在工具「已發布」直接刪 |
| 刪除守門 | 後端先查 `is_published`，必須 true 才刪；未發布請用取消排程 | 避免與取消排程混用 |
| 清理照片位置 | 管理頁「臉書發文」分類新卡片，僅管理憑證 | 影響大，只給管理者 |
| 清理照片防呆 | 一次最多 10 張、不做「全部刪除」；已屬於某篇貼文（有 `page_story_id`）的照片一律拒絕，提示改用已發布／已排程刪除 | 避免誤刪公開內容 |
| 版本 | 外掛不升版號；後端需重新部署 | 只改網站與後端 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fb.js`、`server/index.js` | `deletePost`＋路由 `POST /fb/delete`；`adminFbPhotos`：`GET /admin/fb/photos`、`POST /admin/fb/photos/delete` | ⬜ |
| `tools/fbpost/tool.js`、`TOOL.md` | 已發布列表「刪除貼文」按鈕、確認視窗、移出快取、本地紀錄同步 | ⬜ |
| `admin/index.html`、`admin/admin.js` | 「清理未發布照片」卡片 | ⬜ |
| `test/server/fb.test.js`、`test/e2e/fbpost.e2e.js`、`test/e2e/admin.e2e.js` | 守門、送出／取消、ID 驗證 | ⬜ |
| 規格路由表、`CLAUDE.md` | 併入 main 時同 commit 更新 | ⬜ |

## 下一步
- [ ] 後端：`deletePost`、`adminFbPhotos`、路由與測試
- [ ] 前端：已發布刪除按鈕；管理頁卡片；測試
- [ ] `npm test`、`node --test test/e2e/fbpost.e2e.js`、admin e2e、`node build.js --check`
- [ ] 獨立審查；使用者說「推」才併入 main

## 注意事項
- 不打真臉書，所有測試用假回應；上線後需使用者實測（先用一張殘留照片確認列表與刪除）。
- 刪除不可復原：確認視窗與稽核紀錄（`post-deleted`、`photo-deleted`）要有。
- 公司素材不得進 repo；token 不得出現在回應或日誌。
