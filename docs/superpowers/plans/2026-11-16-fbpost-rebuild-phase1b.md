# 排程發布第一段追加：共用畫圖核心＋帶入＋留言文字 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把「圖片套版」的畫圖抽成共用模組 `ui/compose/`，排程發布測試畫面直接貼網址帶入＋套版＋貼圖／馬賽克；留言開頭文字可改（預設「看更多新聞內容」）。

**Architecture:** `ui/compose/render.js`（純畫圖，素材由呼叫端傳入）、`ui/compose/fx.js`（貼圖／馬賽克編輯器與畫法）。「圖片套版」改呼叫共用模組、畫面與輸出不變。排程發布前端拆成 `rules.js`、`compose.js`、`targets.js`、`send.js`、`manage.js`、`app.js`（組裝）。

**Spec:** `docs/superpowers/specs/2026-11-16-fbpost-rebuild-design.md`（§3.2、§3.3、§3.7、§10 模組）

## Global Constraints
- 共用模組不讀任何工具的 DOM id、不寫死任何工具的規則（框的判斷由工具傳入）。
- 「圖片套版」畫面、行為、輸出像素不變：改前存基準（scratchpad 腳本，同一環境），改後逐像素相同；`test/e2e/pattern.e2e.js` 全過。
- 排程發布的框規則：`news.tvbs.com.tw/<類別>/…` 類別 `sports`／`entertainment` → 娛樂粉框，其他 → 新聞藍框。
- 留言＝`commentLead`（預設「看更多新聞內容」，≤200 字，可空白）＋換行＋連結＋該粉專 UTM；空白時只放連結。
- 工具內切換一律 `hidden`。公司素材只寫代號。

## Review Focus
- 「圖片套版」重構後輸出走樣（字級、標題位置、貼圖位置）→ 像素比對。
- 帶入覆蓋小編已改的內容 → 已有內容時先確認。
- 留言文字清空時仍帶「\n」開頭 → 只放連結。
- 沒有公司素材（素材讀不到）時排程發布仍可用通用畫法或上傳圖。
- 排程發布與「圖片套版」同輸入畫出不同圖 → e2e 比對兩邊像素。

### Task A: 基準圖（改前）
- [ ] scratchpad 腳本：開「圖片套版」（公司模式假素材），以全域 `renderComposite` 畫 6 種情境（新聞框 1/3/4 行、娛樂框、純色紅＋深色淺色、通用框）＋ UI 加 1 貼圖 1 馬賽克，存每張 `getImageData` 的 SHA-256。

### Task B: 抽出 `ui/compose/render.js`、`fx.js`，「圖片套版」改接
- Produces: `createRenderer({ ribbonEnt, ribbonNews, logo, fontLoaded }) -> { ready: Promise, render(ctx, { source, title, fontSize, frame, fx, gen }), titleRows, parseLines, layout: {...常數} }`；`createFxEditor({ canvas, stickers, items, ready, changed, redraw, onLayout }) -> { sync, ... }`、`drawFx(list) -> { photo, mosaic, stickers }`、`buildFxRow(editor) -> { row, tiles, setGray }`。
- [ ] 改完跑 Task A 腳本：雜湊全相同；`node --test test/e2e/pattern.e2e.js` 全過。Commit。

### Task C: 後端 commentLead
- [ ] 測試：`commentText(url, utm, lead)`；lead 預設、自訂、空白（只放連結）；>200 字 400。實作 `parsePostForm` 收 `commentLead`。Commit。

### Task D: 排程發布前端拆模組＋做圖
- [ ] 拆 `app.js` → `rules.js`（`frameForUrl`）、`targets.js`、`send.js`、`manage.js`、`app.js`（現有 e2e 不改仍過）。
- [ ] `compose.js`：網址＋帶入（`/fetch/article`、`/fetch/image` 前 3 張）、作圖框／純文字底圖、新聞／娛樂框、純色選色、標題（`autoLines`）、預覽（拖曳縮放）、貼圖／馬賽克列、貼文內容自動組（`formatCopy`，小編文行空白時省略）、「改用自己的圖」；送出時輸出 PNG。
- [ ] 留言文字框（預設「看更多新聞內容」）。
- [ ] `tool.json` 加和 pattern 相同的 assets 代號。
- [ ] e2e：帶入後標題／圖／內容／框正確；sports 網址切娛樂框；已有內容時帶入先確認；送出 FormData 含 image（PNG）與 commentLead；同輸入 pattern 與 fbpost 畫布像素相同。Commit。

### Task E: 整合
- [ ] npm test、npm run e2e、build --check；截圖；獨立審查；文件與交接檔；推開發分支。
