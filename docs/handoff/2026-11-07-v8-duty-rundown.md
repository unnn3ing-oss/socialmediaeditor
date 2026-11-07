# v8：值班粉專＋排入 Rundown（排程發布 fbpost）
- 狀態：進行中　- 分支：`claude/modest-dirac-cblt5b`（從 main ae1abd9 起）　- 最後更新：2026-11-07
- 使用者原話：「在當前瀏覽器初次點入排程發布功能時，會跳出值班負責粉專，讓新增發文、已排程、成效都預設選擇或顯示都為該選擇的粉專（其他的不會優先顯示但是還在）」；「把原本網新快速排程我做的『排入RD』搬過來」。Microsoft OAuth：使用者說「放棄」。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 值班粉專數量 | 1～3 個，其中一個「主要」（預設第一個勾的，可點 ☆ 改） |
| 後台 | 不用分主要／次要，後台與 D1 都不改 |
| 新增發文晶片 | 排序：主要 → 其他值班 → 其餘原順序；**只預勾主要**；其他照樣可勾 |
| 已排程／成效 | 預設主要；值班粉專排在下拉前面；「全部粉專」與其他粉專都還在 |
| 記憶 | localStorage（只存粉專 ID＋到期時間），使用者同意 |
| 到期 | 下一個本機 05:00；到期後跳視窗**全部空白重選**（不預選上次） |
| 跨 05:00 | 回到分頁（visibilitychange）或按「新增發文」時檢查 |
| 先不選 | 這次照原本預設；下次進來再問 |
| Rundown 來源 | `unnn3ing-oss/-schedulenewnet`（網新快速排程）`web/rundown.js`、`worker/index.js` 的 `/rundown`；Apps Script `gas/rundown.gs` 沿用使用者已部署的，不改 |
| Rundown 類型 | 純文字底圖＋「無底色」或「臉書原生背景（實驗）」→ `/文字/`；其他 → `/圖文/` |
| Rundown 粉專 | 依 /fb/pages 的 `code`：news、ent、shaokang、intl；其他略過 |
| Rundown 後端 | toolbox-api `POST /rundown`（公司憑證），Secrets `RUNDOWN_URL`、`RUNDOWN_TOKEN`（同舊 Worker 的值） |
| 開關 | localStorage（同舊版），SLUG 欄空白＝標題前 4 字（規則照搬） |
| 外掛版號 | 不升（只改網站與後端） |

## 做法（改哪裡）
| # | 檔案 | 狀態 |
|---|---|---|
| 1 | `server/core/rundown.js`（新）、`server/index.js` 掛路由、`test/server/rundown.test.js` | ✅ |
| 2 | `tools/fbpost/rundown.js`（純函式＋開關）、`test/` 單元測試（照搬 rundown.test.js 相關部分） | ✅ |
| 3 | `tools/fbpost/index.html`／`tool.js`／`tool.css`：Rundown 開關、SLUG、⚙ 視窗、送出後寫入 | ✅ |
| 4 | `tools/fbpost/*`：值班粉專（頂列按鈕、選擇視窗、排序／預勾／下拉預設、05:00 到期） | ✅ |
| 5 | e2e：值班＋Rundown | ✅ |
| 6 | 文件：`tools/fbpost/TOOL.md`、後端部署說明加 Secrets | ✅ |

## 下一步
- [x] 依上表 1→6（unit 316 過；fbpost e2e 新增 4 支：值班×2、Rundown×2，舊「Rundown 尚未連接」測試換掉；舊測試用 open() 預設按「先不選」）
- [ ] 全部 e2e、`node build.js --check`
- [ ] 審查代理 → 截圖給使用者 → 等「推」

## 測試
`npm test`、`npm run e2e`（沙盒 chromium `/opt/pw-browsers/chromium`）、`node build.js --check`

## 注意事項
- 不能把試算表 ID／金鑰寫進 repo（試算表 ID 只在 Apps Script 內）。
- localStorage 只存偏好（值班 ID、Rundown 開關），不存發文內容。
