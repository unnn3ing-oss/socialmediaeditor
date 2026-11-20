# Webhook 省 D1 讀寫
- 狀態：進行中　- 分支：claude/determined-carson-u9hy3c　- 最後更新：2026-11-20
- 使用者原始需求：Cloudflare 寄信「Workers 每日請求達 75%」；D1 查詢統計顯示 `SELECT v FROM fb_settings` 31 萬次、`INSERT INTO fb_settings` 7.9 萬次、`CREATE TABLE IF NOT EXISTS` 8.3 萬次。使用者已關掉所有粉專訂閱與 Meta 後台 Page feed。「開始，三項都做」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 範圍 | 只省 D1 讀寫；Worker 請求數不在這次（之後另議輪詢或付費） | 使用者選的三項 |
| 最後收到時間 | 每個執行個體每 60 秒最多寫一次 | 管理頁 Webhook 卡片最多慢 1 分鐘，可接受 |
| 設定快取 | 記憶體快取 60 秒（依 D1 綁定），同一執行個體存檔時立即清掉 | 其他執行個體最多慢 60 秒生效 |
| 建表 | 同一個 D1 綁定、同一句 SQL 每個執行個體只跑一次；失敗不記，下次再試 | 結果不變 |
| 順手 | 留言管理：新留言（add）預篩沒中就直接結束，不先讀紀錄表 | 結果相同，少一次讀 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/once.js`（新） | `ensureOnce(db, sql)`、`ensureSettings(env)`、`cached(db,key,ms,load)`、`forget(db,key)` | ✅ |
| `server/fb/webhook.js` | `saveLast` 60 秒節流；`allAppCreds` 走快取 | ✅ |
| `server/fb/tokenstore.js` | 建表用 `ensureSettings`；寫入／刪除後 `forget` App 密鑰快取 | ✅ |
| `server/fb/guard.js` | 建表用 `ensureOnce`；`guardEvent` 讀設定走快取、`saveGuard` 清快取；add 預篩先做 | ✅ |
| `access.js`、`videoset.js`、`usage.js`、`levels.js` | fb_settings 建表改 `ensureSettings` | ✅ |
| `test/server/` | 加節流、快取、建表一次的測試 | ✅ |

## 下一步
- [x] 寫 once.js 與各檔替換（新測試 `test/server/d1-savings.test.js`）
- [x] npm test 727、build --check 通過
- [x] 獨立審查通過（Minor：saveLast 寫入失敗 60 秒內不重試；noText 統計仍每則寫一次，量大再節流）
- [ ] 給使用者看結果，等「推」

## 測試
`npm test`（伺服器相關：`node --test test/server/`）、`node build.js --check`。不動前端，不跑 e2e。

## 注意事項
- 不改 Webhook 回應內容與驗證邏輯；不改資料格式。
- **後端需重新部署（正式＋測試）**；外掛不改。

## 附帶：管理頁左側分類放大（同分支）
- 使用者：「左邊分類按鈕可以增大」→ 確認「開始」。
- 只改 `admin/admin.css` 電腦版 `nav.side`：按鈕高 34→44、字 14→16、左右內距 12→16、間距 2→4、分隔線留白 8→12；手機（≤820px）分類切換列不動。純網站。
- [x] 改 CSS（`@media (min-width:821px)`）　- [x] admin e2e 35 通過　- [x] 電腦版截圖給使用者
