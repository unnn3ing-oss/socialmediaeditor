# v8.1：排程時間視窗跑版修正＋README 管理後台網址
- 狀態：**已完成**（2026-11-07 併入 main）　- 分支：`claude/modest-dirac-cblt5b`　- 最後更新：2026-11-07
- 使用者原話：「排程時間應該要像第二張圖，你現在做壞掉了，修好他且之後不要再有錯」；「管理後台的網址補在readme」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 原因 | `.fp-modal input { width:100% }`（權重 0,1,1）蓋掉 `.tp-time { width:96px }`，日期欄被擠成 22px（桌機、側邊欄都會） | — |
| 修法 | `tools/fbpost/tool.css`：`.tp-row input.tp-date`（flex 填滿、min-width 0）、`.tp-row input.tp-time`（固定 96px）；`.timepop` 寬 `min(300px, 100% - 16px)` | 提高權重，不動通用規則 |
| 防再錯 | `test/e2e/fbpost.e2e.js` 的 `assertTimeFields()`：1280／400 寬檢查新增發文時間視窗與「改時間」對話框；390 手機寬測試也加；日期欄 ≥140px、時間欄 96px、不超出 | 舊測試只查有沒有橫向捲動，沒查欄位寬 |
| README | 加後端網址與管理後台 `https://toolbox-api.19jpz-3.workers.dev/admin` | 使用者要求 |

## 測試
fbpost＋sidepanel e2e 29 過；`npm test` 316 過；拿掉修正時新測試會失敗（日期欄太窄 22px）。

## 注意事項
- 之後改 `.fp-modal input` 這類通用輸入框樣式，要跑 `--test-name-pattern="時間視窗|手機寬"`。
