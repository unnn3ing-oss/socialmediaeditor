# 影片發布按鈕回饋與動畫
- 狀態：進行中　- 分支：claude/adoring-newton-hl37xe　- 最後更新：2026-11-24
- 使用者原始需求：「把這介面的按鈕都改成要能讓使用者知道當前發生什麼，不能按下去後按鈕沒有其他反應，反而會誤會沒傳、當掉等」「有動畫效果可以適當使用」；看過示範頁（scratchpad `fbvideo-feedback-demo.html`）後說「開始」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 範圍 | 只改 `tools/fbvideo/`（前端），不改後端、外掛 | 使用者指定影片發布介面 |
| 共通規則 | 按下縮 0.97／0.1s；處理中轉圈＋文字淡入淡出＋不能重複按（aria-disabled／aria-busy）；成功綠勾 1.5s；失敗紅色抖動＋寫原因；移除那列收合；進度條平滑；讀取用骨架；`prefers-reduced-motion` 全關 | 示範頁 |
| 送出後 | 按鈕「已送出，等上傳完成 N 支…」（方案 A） | 使用者未選 B |
| 送出主鈕寬度 | 固定不跳 | 示範頁 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbvideo/fx.js`（新） | 共用 `busy`／`ok`／`fail`／`idle`／`shake`／`collapse` | ⬜ |
| `tools/fbvideo/fbvideo.css` | 按下縮放、轉圈、打勾、抖動、呼吸點、收合、進度條 transition、reduced-motion | ⬜ |
| `tools/fbvideo/app.js` | 加影片、全部送出、停止上傳、移除、送出紀錄刷新、重新上傳 | ⬜ |
| `tools/fbvideo/editor.js`／`cover.js` | 封面使用這一格、上傳圖片、加入標籤等 | ⬜ |

## 下一步
- [ ] 讀 app.js／editor.js／cover.js 按鈕處理，建 fx.js
- [ ] 接上各按鈕＋CSS
- [ ] fbvideo e2e 補檢查（送出中鈕 aria-busy、文字）、跑 fbvideo e2e＋npm test
- [ ] 截圖給使用者、獨立審查

## 測試
`npm test`、`npx playwright test test/e2e/fbvideo*.e2e.js`、`node build.js --check`。

## 注意事項
- 純網站，不需部署後端、外掛不升版號。
- 工具內切換用隱藏，不重建畫面。
