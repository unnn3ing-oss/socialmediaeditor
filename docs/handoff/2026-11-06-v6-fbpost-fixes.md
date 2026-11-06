# v6：字重調輕＋排程發布排序／文字預覽／載入更多
- 狀態：**已完成**（2026-11-06 併入 main）　- 分支：`claude/tender-mayer-rpct8b`（從 main f953055 起）　- 最後更新：2026-11-06
- 使用者原話：「網頁字型太粗了。排程發布，已排程可更改排序順序「時間最近/時間最遠」。如果已排程中是「純文字」內容，則顯示「文字」在預覽處。成效的「載入更多」無法按下去。」→ 計畫 →「開始」

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 字重 | 按鈕／工具鈕／分段鈕／膠囊／欄位標籤 700→500；卡片名稱、區塊小標 700 不變；大標題 800–900→700；「編」標誌 900→800；畫布字型不動 |
| 排序 | 粉專旁下拉「時間最近／時間最遠」，只重排現有列不重讀，選擇存 localStorage（try/catch） |
| 文字預覽 | 已排程沒圖片的縮圖中間顯示灰色「文字」 |
| 載入更多 | 後端 after 檢查放寬（≤2000 字，允許 % .）；按鈕載入中 disabled；錯誤顯示在按鈕旁；測試長游標 |
| 外掛版號 | 不升；後端要重新部署 |

## 做法（改哪裡）
| # | 檔案 | 狀態 |
|---|---|---|
| 1 | ui/tokens.css、shell/shell.css、shell/install.css、server/core/admin-page.js、tools/{fbpost,design,pattern,linepush}/*.css、collage/resize/watermark 的 base.css、segmented.css | ✅ |
| 2–3 | tools/fbpost/index.html、tool.js、tool.css | ✅ |
| 4 | tools/fbpost/tool.js、server/core/fb.js、test | ✅ |

## 下一步
- [x] 1–4 完成（b380153）
- [x] unit 300、e2e 79；審查有條件通過，修 loadStats 競態（40a0c2a）；截圖已給使用者　- [x] 使用者說「推」併 main（同 commit 更新 CLAUDE.md）

## 注意事項
- 改 tools/ 後跑 `node build.js`。不動畫布繪製、extension/。
