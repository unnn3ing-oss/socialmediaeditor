# 按鈕回饋與動畫（影片發布＋全站高優先）
- 狀態：進行中　- 分支：claude/adoring-newton-hl37xe　- 最後更新：2026-11-24
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
| `tools/fbvideo/` | 加影片、全部送出（等上傳完成 N 支…）、停止、移除收合、重新上傳、封面、全套用、刷新 | 🚧 主對話 |
| `tools/fbpost/` | 全部送出、列表改時間／刪除／重新留言／再發一次、刷新、重新整理粉專 | 🚧 子代理 |
| `admin/` | 各儲存／驗證／讀取／上傳按鈕 | 🚧 子代理 |
| `shell/company.js`、`shell/notices.js`、`index.html` | 登入下一步／登入／變更密碼、通知重留言／完成 | 🚧 子代理 |

## 下一步
- [ ] 各段完成 → 跑相關 e2e → 整合跑全部 e2e、npm test、build --check
- [ ] 截圖、獨立審查、回報使用者

## 測試
`npm test`、`npx playwright test test/e2e/fbvideo*.e2e.js`、`node build.js --check`。

## 注意事項
- 純網站，不需部署後端、外掛不升版號。
- 工具內切換用隱藏，不重建畫面。
