# Skeleton＋排程發布介面五項
- 狀態：進行中　- 分支：claude/vigilant-fermi-oqzctf　- 最後更新：2026-11-18
- 使用者原始需求：送出提示「游標移到送出按鈕才跳提示，不要在下方佔位」（被擋原因選 B＝也只在 hover 顯示）；「？」不需要；貼網址預覽要有 Skeleton，且「整個網頁中有用到預覽區且會有載入的框架都要用上」（LINE 推播不用）；新增發文左邊預覽固定、右邊可捲；純文字圖底色選框高度與方向鈕縮小 1/3。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 送出提示 | `#sendErr` 改浮動泡泡（不佔位）：沒勾粉專＝深色，被擋原因＝紅色；都只在游標停在送出鈕（含 disabled，靠外層 wrapper）／鍵盤焦點時顯示；手機點一下顯示約 3 秒。改任何東西後提示內容照舊邏輯更新 |
| ？ | 刪 `#cvHelp` |
| Skeleton | 共用 `ui/tokens.css` `.sk` 閃光；位置：fbpost 新增發文預覽（pull 讀取到主圖畫好；失敗／確認視窗前收起）、fbpost 已排程／已發佈列表（刷新查詢中 3 列）、圖片套版預覽（quickfill 讀取中）、YT 下載清單列 status=fetching（封面＋標題）。LINE 推播不加 |
| 左右分開捲動 | >820px：`.post-body` 不捲，`.left`、`.right` 各自 overflow-y:auto；≤820px 維持整頁捲 |
| 底色選框 | 電腦版（>820px）色塊 52→35、方向鈕 44→30、框內距 8→5；手機不變 |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| tools/fbpost/index.html、send.js、fbpost.css | 送出提示泡泡、刪 ？、左右捲、底色框 | ⬜ |
| tools/fbpost/compose.js、manage.js | Skeleton | ⬜ |
| tools/pattern/quickfill.js＋css | Skeleton | ⬜ |
| tools/ytdl/web/queue-view.js＋ytdl.css | Skeleton | ⬜ |
| test/e2e | 對應測試 | ⬜ |
