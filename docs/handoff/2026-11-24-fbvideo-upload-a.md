# 影片上傳方案 A＋自動選上傳方式
- 狀態：進行中　- 分支：claude/modest-carson-8lmfi0　- 最後更新：2026-11-24
- 使用者原始需求：上傳跑到一半失敗；直式沒綁 90 秒（臉書後台已不分直橫、長度共用）；按全部送出沒反應；底部進度文字太長；每支影片要有獨立進度；加快上傳。使用者選「1＋2」：方案 A（維持經 Worker 轉送）＋自動選上傳方式。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 上傳路徑 | 維持瀏覽器 → Worker → 臉書（權杖不出後端）；不用 R2、不直傳 |
| 影片並行 | 同時 2 支 |
| 多粉專 | Worker 內同時轉送（同一段共用一個 Blob，避免記憶體 × 粉專數） |
| 分段 | Reels（rupload）8MB；橫式照臉書回的 end_offset（上限 32MB 不變） |
| 重試 | 前端每段 HTTP／連線錯誤自動重試 2 次；後端單一粉專遇結果不明／5xx／錯誤碼 1、2 再試 1 次 |
| 上傳方式 | 直式（v.kind reel）且 3～90 秒 → /video_reels；其他（含 >90 秒直式、讀不到長度）→ /videos。拿掉 90 秒擋送出；畫面顯示「上傳方式：…」 |
| 使用者看到的類型 | 仍是「橫式影片／Reels」（RD、hashtag、放待排 2359、多文判斷照舊用 v.kind） |
| 送出回饋 | 按鈕「送出中…（第 i／N 支）」；結束 toast「N 支已送出：成功 x、失敗 y」 |
| 底部 | 一行「上傳中 42%・2／3 支」；各粉專細節移到編輯區「上傳狀態」清單 |
| 每支進度 | 左側列表每支自己的進度條＋百分比；失敗顯示粉專＋原因 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/video.js` | REEL_CHUNK 8MB；receiveChunk 多粉專 Promise.all＋共用 Blob＋重試 | ✅ |
| `tools/fbvideo/rules.js` | `routeOf(kind, duration)` | ✅ |
| `tools/fbvideo/app.js` | pump 並行 2 支、每段重試、start/restart 送 route、送出按鈕回饋、底部精簡 | ✅ |
| `tools/fbvideo/editor.js`、`index.html`、`fbvideo.css` | kindInfo 改顯示上傳方式、拿掉 90 秒擋；上傳狀態清單；排程上限用 route | ✅ |
| 測試 | video 單元、rules 單元、fbvideo e2e | ✅ |

## 結果
npm test 815、fbvideo e2e 13（新增：單段失敗自動重試、95 秒直式走一般影片／4 秒走 Reels）、sidepanel e2e、build --check 通過；獨立審查無 Critical／Important，已修 Minor：底部總進度不把失敗算成完成、too_large／unsupported 不重試、transfer 重試限制註解。
測試影片 `test/fixtures/fbvideo/tall-long.mp4`（95 秒、90×160、4KB）。

## 未處理 Minor
- 長直式（走一般影片上傳）通知卡片類型顯示「影片」不是「Reels」（後端只知道 route）。
- e2e 沒有「兩支同時上傳＋其中一支停止」的情境（替身後端）。
- **跑到一半失敗的真正原因仍未確認**（使用者還沒給錯誤訊息）；這次改動讓失敗會顯示粉專＋位置＋原因。

## 下一步
- [ ] 使用者確認後說「推」併入 main（同 commit 更新 CLAUDE.md）
- [ ] 使用者部署後端（正式＋測試）→ 多支影片實測上傳，若仍失敗把左側列表紅字／編輯區上傳狀態的訊息貼回
