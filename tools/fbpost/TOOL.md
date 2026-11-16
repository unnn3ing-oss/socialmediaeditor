# fbpost（排程發布，測試版）

只給管理員：進頁先呼叫 `/auth/status`，`data.admin === true` 才顯示測試畫面並讀 `/fb/*`；其他情況只顯示「功能停用」區塊，不呼叫 `/fb/*`。

- `app.js`：新增發文（`POST /fb/post` FormData）、已排程（`/fb/scheduled`、改時間、取消）、已發佈（`/fb/published`、刪除）。
- 工具內切換用 `hidden`，不重建畫面；查詢只在按「刷新」時進行。
- 排程時間範圍：10 分鐘～30 天（本機時間），前端先檢查，後端再擋一次。
- 錯誤直接顯示後端回的 `error` 文字。
