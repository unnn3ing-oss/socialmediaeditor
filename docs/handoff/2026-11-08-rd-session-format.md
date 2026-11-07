# RD 預設開啟、工作階段關閉與儲存格格式
- 狀態：實作、測試及獨立審查完成，待使用者確認；GAS尚未部署　- 分支：`codex/rd-session-format`　- 最後更新：2026-11-08
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
- 本分支另已完成五分鐘刷新間隔，接手時一併讀`2026-11-08-refresh-cooldown.md`，之後併main須包含兩項。
- [x] RD預設開啟，忽略舊localStorage；session cookie共用同工作階段，儲存被拒時保留本頁並提示。
- [x] 按鈕上方固定高度提醒，送出中鎖定開關與快照；focus／visible／新增發文重讀偏好但不干擾送出。
- [x] 新增GAS替換片段與部署說明，保留既有規劃與樣式、只格式化實際寫入格子。
- [x] 前端與GAS各項獨立審查通過。
- [x] 更新交接並推開發分支，不併 main、不部署。
- [ ] 使用者說「推」後才併 main，並更新 CLAUDE.md 目前進度；前端不需部署Worker。
- [ ] Apps Script 格式需使用者以現有 Google 帳號更新部署；目前無該服務部署工具或認證。

## 測試與部署產物
- 完整fbpost瀏覽器測試44項通過，含預設／舊偏好忽略、同工作階段新頁、全新context、cookie受阻仍正常發文、提醒位置不跳動及送出鎖定。
- `node --test test/fbpost-duty-rundown.test.js test/server/rundown.test.js test/server/rundown-format.test.js`：23項通過，含GAS格式6項mock測試。
- `node build.js`、`node build.js --check`、`git diff --check`通過。
- GAS片段：`server/gas/rundown-format.gs`，不可獨立部署；步驟見`docs/rundown-format.md`，替換既有rdAddOne並加入rdWriteTimeCode，更新原部署新增版本。
- 無正式試算表寫入／Apps Script部署。環境雖有通用Google ADC檔，但未連接或確認此Apps Script專案與部署權限；不可宣稱完全沒有任何Google憑證。
- 畫面：`/tmp/rd-notice-on-400.png`、`/tmp/rd-notice-off-400.png`。
