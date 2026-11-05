# 工具 SDK

**工具只能用這裡列出的功能。** 工具頁一開始 `import { tb } from '../../sdk/toolbox.js'; tb.init('工具id');`。

## 內容保留規則

- 工具內切換功能（分頁、模式）一律用 `hidden` 隱藏切換，**不重建畫面**，內容才不會消失。
- 不要把使用者填的內容寫進 localStorage 或硬碟；重新整理或關閉分頁可以清除內容。
- 只有工具自己的「清空」按鈕可以刪除內容。範例見 `tools/sample/`。

## 基礎

| 函式 | 說明 | 範例 |
|---|---|---|
| `tb.init(toolId)` | 設定工具 id，日誌、素材、後端呼叫都帶這個 id | `tb.init('sample')` |
| `tb.files.bind(el, opts)` | 點擊選檔、拖曳放入、Ctrl+V 貼上；`opts = { accept, multiple, max, onFiles(files, { truncated }) }` | `tb.files.bind(drop, { accept: 'image/*', max: 20, onFiles })` |
| `tb.stampName(date, n)` | 產生下載檔名 `YYMMDDHHMM_n` | `tb.stampName(new Date(), 1)` |
| `tb.download(blob, name)` | 下載單一檔案 | `tb.download(blob, tb.stampName(new Date(), 1) + '.png')` |
| `tb.download.batch(items, { rng })` | 批次下載，每張間隔 500～1000ms | `await tb.download.batch([{ blob, name }])` |
| `tb.log.error(code)` | 回報錯誤代碼（只留小寫英數與 `_.-`，最長 60 字），失敗靜默 | `tb.log.error('save-failed')` |
