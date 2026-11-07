# RD 預設開啟、工作階段關閉與儲存格格式
- 狀態：進行中　- 分支：`codex/rd-session-format`　- 最後更新：2026-11-08
- 使用者已確認開始：排入 Rundown 預設開啟，送出按鈕上方提醒，關閉僅維持本次瀏覽器工作階段；稿件水平置中，新增時間碼 #4285f4 粗體。

## 已定案的決定
- 不再讀寫永久 localStorage 的舊 RD 開關。用無到期日的 session cookie 保存關閉狀態，支援同工作階段重開分頁；瀏覽器結束工作階段後恢復預設。瀏覽器的「還原上次工作階段」可能延續 session cookie，遵循瀏覽器的工作階段定義，不能宣稱強制清除還原資料。
- 提醒放送出按鈕上方，開／關佔相同空間，不影響清空與送出同列位置；送出中以本次送出的開關快照為準。
- 格式在目前已部署的 Google Apps Script 寫入端處理；本倉庫只轉送，不可只改前端就宣稱格式已生效。
- 準備 Apps Script rdAddOne 替換函式與格式 helper，保留既有排程找格／位移／稿件字級顏色，只對實際寫入的格子設樣式，不包含試算表 ID 或金鑰。

## 做法
- tools/fbpost/rundown.js、tool.js、index.html、tool.css、TOOL.md 及單元／e2e：預設、session cookie與提示。
- server/gas/rundown-format.gs、部署說明及測試：對應既有 /tmp/rd-reference-schedulenewnet/gas/rundown.gs 的 rdAddOne。

## 下一步
- [ ] 實作、測試、獨立審查。
- [ ] 更新交接並推開發分支，不併 main、不部署。
- [ ] Apps Script 格式需使用者以現有 Google 帳號更新部署；目前無該服務部署工具或認證。
