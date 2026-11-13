# 排程發布「本地紀錄」改成卡片樣式
- 狀態：進行中　- 分支：claude/exciting-euler-q4b38p　- 最後更新：2026-11-13（卡片已完成並推開發分支，等使用者看截圖說「推」）
- 使用者原始需求：「幫我做成卡片樣式的方法來表列，需要將個別資訊都清楚顯示」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 版面 | 單欄、每張卡片滿寬 | 內文有換行與連結，雙欄太窄（使用者回「開始」，採建議方案） |
| 內文長度 | 全部展開，不收合 | 小編要檢查發文內容 |
| 卡片結構 | 卡片頭（時間＋整體狀態＋刪除）／內容區（標題、內文、連結各有小標）／粉專列表（粉專、狀態、排程時間、RD、錯誤） | 資訊分欄清楚 |
| 整體狀態 | 失敗＞待確認＞排程中＞已發布＞已取消 取最需注意者 | 多粉專時一眼可見 |
| 狀態色 | 排程中藍、待確認橘、已發布綠、失敗紅、已取消灰 | 沿用 `ui/tokens.css` 的 ok／warn／bad／accent |
| 重送內容 | 與原送出不同時才出現，收進 `<details>`，摘要文字含「重送內容：」 | 避免卡片過長；既有 e2e 以文字比對 |
| 不動 | `records.js` 資料結構、篩選、七天清除、刪除確認、`data-record` | 只改呈現 |
| 版號／部署 | 純前端，不升外掛版號、不部署 Worker | 沒動 `extension/`、`server/` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/tool.js`（`renderRecords`） | 改成卡片 DOM；新增整體狀態計算 | ✅ |
| `tools/fbpost/tool.css` | 卡片、狀態標籤、粉專列表樣式，窄螢幕堆疊 | ✅ |
| `tools/fbpost/TOOL.md` | 補「本地紀錄以卡片顯示」 | ✅ |
| `shell/catalog.json` | `node build.js` 重新產生（entry 版本雜湊） | ✅ |
| `test/e2e/fbpost.e2e.js` | 新增卡片結構測試（欄位、狀態、RD、重送內容）；既有 `#recordsList [data-record]` 選擇器不變 | ✅ |

## 下一步
- [x] 改 `renderRecords`（保留 `li[data-record]`，刪除按鈕行為不變）
- [x] 寫 CSS
- [x] 補 e2e、跑相關測試（npm test 339、fbpost e2e 43 全過、build --check 通過）
- [x] 截圖給使用者確認（桌面＋手機）
- [ ] 另一個需求「隱藏／刪除示範工具 `sample`」待使用者確認做法（見對話；測試依賴 `tools/sample`）
- [ ] 使用者說「推」才併入 main，同 commit 更新 `CLAUDE.md`「目前進度」

## 測試
- `node --test test/fbpost-records.test.js`
- `npx playwright test`／`npm run e2e` 只跑 `test/e2e/fbpost.e2e.js`
- `node build.js --check`

## 注意事項／不能做的事
- 不直接推 main；不開 PR。
- 既有 e2e 以 `textContent` 比對「重送內容：」「重送改成這段小編文」「待確認」等字樣，改版後要保留。
