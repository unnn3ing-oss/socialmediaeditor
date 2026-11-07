# LINE 推播（linepush）

- **用途**：做 LINE 推播圖（搬自舊 LinePushPatternTool 的做圖部分）：輸入標題、放照片、加貼圖、輸出 PNG。
  - 沒密碼：「六宮格」（1040×800，套 `assets/template-plain.png`）＋「四格 A」（白底 2×2，1040×1040，每格可加說明、底色與說明字色可選）。
  - 有密碼：「新聞」（黃色標題條）、「娛樂」（拍立得四格）（不提供「四格 A」）。
- **資料存哪**：只在記憶體；切換版面、頁面、步驟時保留，重新整理會清除。
- **素材**：`line.header`、`line.grid4`、`sticker.*`、`font.line` 走 `tb.assets.get`；沒密碼時不加標題條、四格改畫「四格 A」、字型用 Noto Sans TC 900（Google Fonts）；有密碼時用台北黑體粗體（同舊工具）。
- **呼叫後端**：快速填入的文章首圖仍呼叫舊 Worker `og-image-proxy.19jpz-3.workers.dev`（P1 不搬 worker）。
- **沒搬（P1）**：LINE／S8 推播、排程、訊息中心、試驗功能密碼、拼圖（另有拼圖工具）、操作提示與範例圖。
- **注意事項**：版面切換一律用 `hidden`，每個版面的格子編輯面板只建一次。

- **複製推播連結**：最後「畫面檢查」步驟，滑鼠停在格子會反灰並在中央顯示複製鈕；觸控先點格子、再點按鈕。只複製該格網址，移除舊參數後，新聞使用 `utm_source=LineNewsPush&utm_medium=push`、娛樂／四格 A 使用 `utm_source=LineNewsPush&utm_medium=enewsline`。無網址或複製遭拒會提示；返回編輯、換頁或換版型會清除按鈕狀態。覆層不會輸出到圖片。
