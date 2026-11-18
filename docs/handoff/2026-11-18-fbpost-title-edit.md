# 排程發布：藍框被切、貼文開頭空行、預覽點一下編輯標題、標題字數對齊
- 狀態：進行中　- 分支：claude/vigilant-fermi-oqzctf　- 最後更新：2026-11-18
- 使用者原始需求：「框在使用時邊緣被切掉」「貼文內容最上方要空一行做為可以輸入小編文，如果沒輸入最後送出則自動不包含空白行」「預覽的套版/純文字圖都要可以直接在預覽區編輯，並且需要能讓游標準確對位」「右側的字數顯示要完整對應輸入框字行」

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 藍框被切 | 電腦版（≥821px）兩欄內側各留 6px，間距 24→12，外觀寬度不變 |
| 貼文開頭空行 | 帶入時 `'\n' + formatCopy(...)`；送出時拿掉開頭空白行；字數算拿掉開頭空白後 |
| 預覽編輯 | **點一下**標題文字範圍進入（照片其他地方照舊拖曳），游標落在點的字；編輯框用畫布實際字型、縮後字級、每行位置、不折行；拿掉黑底只留虛線框 |
| 標題字數 | 標題 textarea `wrap="off"`；右側字數用 textarea 實際行高與上邊距排，跟著捲動 |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| ui/compose/render.js | 新增只讀的標題排版函式（字型、縮後字級、每行 y） | ✅ |
| tools/fbpost/titleedit.js | 點一下進入、點擊位置→游標、排版用上面函式 | ✅ |
| tools/fbpost/compose.js、send.js | 開頭空行、字數、標題右側字數對齊 | ✅ |
| tools/fbpost/fbpost.css、index.html | 藍框、編輯框樣式、wrap=off | ✅ |
| test/e2e/fbpost*.js | 對應測試 | ✅ |

## 測試
npm test、node build.js --check、fbpost／fbpost-compose／pattern e2e，整合時全部 e2e。

## 結果
- commit `39732d4`。`render.js` 新增 `titleLayout`／`measureTitle`（只讀，圖片套版輸出不變）；`titleedit.js` 點一下（pointerdown capture 擋住拖曳、click 時進入）＋依點擊位置算游標；DOM 與 canvas 基線差用 measureText 的 em／font 高度算 shift。實測編輯框字與畫布白字外框差 1～2px（e2e 比對）。
- 點兩下仍可進入（相容舊習慣）。
- `stripLead` 放在 `util.js`（send.js 不載入做圖模組）。
- npm test 619、全部 e2e 181 通過。
