# 切換鈕／開關統一樣式（v2）
- 狀態：進行中　- 分支：claude/vigilant-fermi-oqzctf　- 最後更新：2026-11-18
- 使用者原始需求：「把目前網頁介面的工具內切換或開關改為這種（YT 下載 影片｜音訊、1080p｜720p）」；之後「邊角要更圓弧、對比度增強、切換開關本體與框體再稍微增加些間隔」；「排入RD只需要有獨立開關不用有字」；檢查照片邊緣「一樣」。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 切換鈕（v2） | 底軌實色 `#e7ecf3`、內距 5px、按鈕間距 5px、外框圓角 18px；按鈕高 38px、圓角 13px、13px 字 500、未選 `#475467`；選中白底＋`0 0 0 1px #cfd6e0, 0 1px 3px rgba(16,24,40,.14)`、藍字 600，沒有藍色外框 |
| 開關（排入 RD、檢查照片邊緣） | 保留滑動開關、開關內不放字；52×30 全圓、關 `#c3ccd8`、開 accent、圓鈕 20px 白＋陰影、離框 5px |
| 範圍 | 尺寸、浮水印、拼圖（bg-toggle＋滑塊）、LINE 推播（mode/page tabs＋knob、edgeSwitch）、設計 dz-toggle、圖片套版手機 m-tabs、YT 下載 segmented、排程發布 seg、rd-switch |
| 結構 | 只改 CSS，不改標記與 class |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| tools/{resize,watermark,collage}/base.css、segmented.css | bg-toggle／seg-thumb | ⬜ |
| tools/linepush/*.css | mode/page tabs、seg-knob、dock-switch | ⬜ |
| tools/design/design.css | dz-toggle | ⬜ |
| tools/pattern/pattern.css | m-tabs | ⬜ |
| tools/ytdl/ytdl.css | segmented | ⬜ |
| tools/fbpost/*.css | seg、rd-switch | ⬜ |

## 測試
npm test、npm run e2e、node build.js --check；截圖給使用者（scratchpad）。
