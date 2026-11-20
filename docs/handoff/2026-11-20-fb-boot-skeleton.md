# 排程發布／影片發布：開啟時先顯示骨架（不再閃「功能停用」）
- 狀態：進行中　- 分支：claude/practical-hamilton-inqpbo　- 最後更新：2026-11-20
- 使用者原始需求：「關閉重開會短暫出現這畫面（排程發布 功能停用），可以修正為載入中或小動畫嗎?」→ 選 A（列表頁骨架），影片發布一起改

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 載入畫面 | A：列表頁骨架（`ui/tokens.css` `.sk` 光帶），`#bootSk` 預設顯示 |
| 停用卡片 | 預設隱藏，確定不能用（沒登入／關閉／需員工編號／錯誤）才顯示 |
| 範圍 | `tools/fbpost/`、`tools/fbvideo/` |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/index.html`、`app.js`、`fbpost.css` | 骨架＋啟動流程收掉骨架 | ⬜ |
| `tools/fbvideo/index.html`、`app.js`、`fbvideo.css` | 同上 | ⬜ |
| `test/e2e/fbpost.e2e.js`、`fbvideo*.e2e.js` | 延遲回應時先看到骨架、沒有停用字樣 | ⬜ |

## 下一步
- [ ] 實作、測試、審查、截圖，使用者說「推」才併 main
