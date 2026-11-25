# 按鈕回饋與動畫（影片發布＋全站高優先）
- 狀態：已併入 main　- 分支：claude/adoring-newton-hl37xe　- 最後更新：2026-11-24
- 使用者原始需求：「把這介面的按鈕都改成要能讓使用者知道當前發生什麼，不能按下去後按鈕沒有其他反應，反而會誤會沒傳、當掉等」「有動畫效果可以適當使用」；看過示範頁（scratchpad `fbvideo-feedback-demo.html`）後說「開始」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 範圍 | 方案 A：共用 `ui/fx.js`＋`ui/fx.css`；本批＝影片發布＋高優先（排程發布、管理頁、首頁登入／帳號彈窗／通知）；中、低優先之後另批 | 使用者選 A、高優先一起做 |
| 共通規則 | 按下縮 0.97／0.1s；處理中轉圈＋文字淡入淡出＋不能重複按（aria-disabled／aria-busy）；成功綠勾 1.5s；失敗紅色抖動＋寫原因；移除那列收合；進度條平滑；讀取用骨架；`prefers-reduced-motion` 全關 | 示範頁 |
| 送出後 | 按鈕「已送出，等上傳完成 N 支…」（方案 A） | 使用者未選 B |
| 送出主鈕寬度 | 固定不跳 | 示範頁 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `ui/fx.js`／`ui/fx.css`（新） | busy／idle／ok／fail／shake／flash／collapse、`window.tbxFx`；樣式 class `fx-busy`、`fx-ok`、`fx-bad`、`fx-skrow`… | ✅ |
| `tools/fbvideo/` | 加影片、全部送出（等上傳完成 N 支…）、停止、移除收合、重新上傳、封面、全套用、刷新 | ✅ |
| `tools/fbpost/` | 全部送出、列表改時間／刪除／重新留言／再發一次、刷新、重新整理粉專 | ✅ |
| `admin/` | 各儲存／驗證／讀取／上傳按鈕 | ✅ |
| `shell/company.js`、`shell/notices.js`、`index.html` | 登入下一步／登入／變更密碼、通知重留言／完成 | ✅ |

## 下一步
- [x] 整合：npm test 823、全部 e2e 296、build --check 通過（`5ecc297`）
- [x] 獨立審查（無 Critical）修正後：fbvideo＋fbpost＋admin＋company e2e 128、npm test 823、build --check 通過
  - 已修：fbpost 失敗紅色被 updateButton 洗掉；fbvideo 移除收合中那列彈回；打勾／抖動期間按鈕仍可按（`ok`／`fail` 加 `opts.disabled`）；底列 holdFoot 計時器互相打架；`button.danger` 處理中改紅字
  - 未修（Minor）：fbpost 刪除收合中按刷新，數量文字可能短暫不同步；fbpost 送出沒有逐粉專「第 i／N」；管理頁列表刪除是重畫表格、沒有收合動畫
- [x] 進度條加粗（列表 6px、底部 10px，使用者選）
- [x] 使用者說「推」→ 已併 main（同 commit 更新 CLAUDE.md 目前進度）
- [ ] 之後另批：中優先（數據報表、YT 下載、圖片工具下載鈕、圖片套版快速填入）、低優先（直播需求單複製、全站按下縮放、toast 滑入）

## 測試
`npm test`、`npx playwright test test/e2e/fbvideo*.e2e.js`、`node build.js --check`。

## 注意事項
- 純網站，不需部署後端、外掛不升版號。
- 工具內切換用隱藏，不重建畫面。
