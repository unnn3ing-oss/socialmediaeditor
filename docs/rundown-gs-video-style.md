# Rundown Apps Script 補丁：影片發布的 RD 綠色粗體置中

影片發布工具（`tools/fbvideo`）寫 RD 時，每筆 entry 會多帶 `style: 'video'`，文字是 `純影/SLUG`（橫式影片）或 `Reels/SLUG`（Reels／Shorts）。
Apps Script 本身在 `-schedulenewnet` 的 `gas/rundown.gs`，本 repo 不能改，所以要**你自己貼上並重新部署**。

## 沒貼之前會怎樣
- 一樣寫得進去（Apps Script 不認得 `style` 會忽略），只是格子沒有變綠色、粗體、置中。

## 怎麼貼
1. 打開 FB RUNDOWN 試算表 →「擴充功能」→「Apps Script」→ 打開 `rundown.gs`。
2. 搜尋把 entry 文字寫進格子的那一行（通常是 `.setValue(e.text)` 或 `.setValue(entry.text)`，變數名稱以實際程式為準）。
3. 在那一行**後面**加上（`cell` 換成那一行用的格子變數、`e` 換成那一筆 entry 的變數）：

```js
// 影片發布（tools/fbvideo）：純影／Reels 用綠色 #38761d、粗體、置中
if (e.style === 'video') {
  cell.setFontColor('#38761d').setFontWeight('bold').setHorizontalAlignment('center');
}
```

4. 存檔 →「部署」→「管理部署作業」→ 編輯目前的部署 → 版本選「新版本」→「部署」（網址不變，不用改後端 Secrets）。

## 確認
- 用影片發布送一支測試影片並勾「排入 RD」，到試算表看那一格是否變成綠色粗體置中。
- 圖文（排程發布）寫入的格子不受影響（沒有帶 `style`）。
