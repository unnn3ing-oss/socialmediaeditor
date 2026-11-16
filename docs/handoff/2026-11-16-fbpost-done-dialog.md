# 排程發布：送出成功後跳「再發一則／返回列表」
- 狀態：進行中　- 分支：claude/dreamy-gauss-mzxyof　- 最後更新：2026-11-16
- 使用者原始需求：「把目前的新增發文，改為按送出後，如果成功則彈出『再發一則』並清除頁面、『返回列表』則跳出新增發文彈窗回到『已排程』列表」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 何時跳 | 所有粉專都成功才跳；有任一失敗＝維持現狀（不跳、不清空、結果顯示在頁面） | 使用者選 1A |
| 返回列表 | 清空頁面、關新增發文視窗、切到「已排程」，**不自動查詢** | 使用者選 2B |
| RD 寫入失敗 | 仍算成功、照跳視窗；黃色提醒區，顯示一顆與按鈕同框的「文章ID/圖文/SLUG」按鈕，點一下複製（變「已複製」1.5 秒），下面列各粉專＋時間；同文字只一顆 | 使用者選 3 |
| 沒文章 ID／沒 SLUG | 只顯示原因，不出複製按鈕 | 組不出格式 |
| 沒開 RD／沒 RD 區段 | 不顯示提醒區 | |
| 再發一則 | 清空（不再確認）、視窗留著、焦點到網址欄 | |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/rd.js` | `write()` 回 `{ lines, failed:[{text,label,time}] }` 或改為另附 failed，寫入邏輯不變 | ⬜ |
| `tools/fbpost/send.js` | 全部成功開 `doneDlg`；共用 `clearAll()`；按鈕事件 | ⬜ |
| `tools/fbpost/index.html`、`fbpost.css` | `<dialog id="doneDlg">`、複製按鈕樣式 | ⬜ |
| `tools/fbpost/app.js` | 傳 `dialog.close`、切分頁給 send.js | ⬜ |
| `tests/e2e/fbpost.e2e.js` | 再發一則、返回列表、部分失敗不跳、RD 失敗複製按鈕 | ⬜ |

## 下一步
- [ ] 依上表實作 → fbpost e2e、npm test、build --check → 截圖給使用者 → 獨立審查

## 測試
`npm test`、`npx playwright test tests/e2e/fbpost.e2e.js`、`node build.js --check`

## 注意事項
- 純前端，不需部署 Worker、不升外掛版號。
- 工具內切換一律 hidden；不推 main，使用者說「推」才併。
