# Rundown Apps Script 補丁：所有寫入一律置中（影片另加綠色粗體）

排程發布（`tools/fbpost`，`文章ID/圖文/SLUG`、純文字 `文章ID/文字/SLUG`）與影片發布（`tools/fbvideo`，`純影/SLUG`、`Reels/SLUG`，entry 帶 `style: 'video'`）寫進 RD 的格子，**全部要文字置中**；影片另外套綠色 #38761d、粗體。
Apps Script 本身在 `-schedulenewnet` 的 `gas/rundown.gs`，本 repo 不能改，所以要**你自己貼上並重新部署**。

## 沒貼之前會怎樣
- 一樣寫得進去，只是格子維持試算表原本的對齊方式（影片也不會變綠色粗體）。

## 怎麼貼
1. 打開 FB RUNDOWN 試算表 →「擴充功能」→「Apps Script」→ 打開 `rundown.gs`。
2. 搜尋把 entry 文字寫進格子的那一行（通常是 `.setValue(e.text)` 或 `.setValue(entry.text)`，變數名稱以實際程式為準）。
3. 在那一行**後面**加上（`cell` 換成那一行用的格子變數、`e` 換成那一筆 entry 的變數）。之前貼過舊版（只有 `if (e.style === 'video')` 那段）的，整段換成這個：

```js
// 所有寫入 RD 的格子都文字置中（排程發布、影片發布）
cell.setHorizontalAlignment('center');
// 影片發布（tools/fbvideo）：純影／Reels 另外用綠色 #38761d、粗體
if (e.style === 'video') {
  cell.setFontColor('#38761d').setFontWeight('bold');
}
```

4. 有貼過草稿／多文預留格補丁（`docs/rundown-gs/rdslot.js`，見 `docs/rundown-gs-draft-slot.md`）的，把 `rdslot.js` 也整份重貼一次（填預留格那行已加上置中）。
5. 存檔 →「部署」→「管理部署作業」→ 編輯目前的部署 → 版本選「新版本」→「部署」（網址不變，不用改後端 Secrets）。

## 確認
- 用排程發布送一則（圖文或純文字）並勾「排入 RD」，到試算表看那一格是否置中。
- 用影片發布送一支測試影片並勾「排入 RD」，看那一格是否綠色粗體置中。
