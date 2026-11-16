# 排程發布：套版標題字型／位置改回舊版
- 狀態：完成，待使用者說「推」　- 分支：claude/rebuild-scheduled-publish-3sd0gr　- 最後更新：2026-11-16
- 背景：使用者比對舊工具（`ebce125` editor.js）與目前預覽：字級相同（66px），目前位置低約 40px、字型看起來是 Noto Sans TC Black（舊版是公司字型 WHZ-Heavy）。使用者確認 R2 有 `font-whz-heavy`。使用者說「開始」。

## 已定案
| 項目 | 決定 |
|---|---|
| 位置 | 只排程發布套版：最後一行固定 y=931、往上長、行距 93（66px 時）、左右留白 30（舊版常數）；圖片套版輸出不變 |
| 字型 | 查為何公司字型沒套上，修好 |
| 預覽改標題框 | `titleedit.js` 對齊新排法 |

## 進度
- [x] 查字型：程式路徑正常（e2e 用替身字型確認畫布會套上公司字型）。線上沒套上＝字型檔載入失敗或檔案本身問題；fbpost 加 `#fontWarn` 顯示原因（`ui/compose/assets.js` 多回 `fontError`，`fontLoaded` 仍是布林）
- [x] `render.js` 加 `BOTTOM_TITLE`／`bottomLineHeight`／`drawTitleBottom`，`renderComposite` 第 8 參數 `{ titleAnchor: 'bottom' }`（只有 fbpost 傳）；`titleedit.js` 對齊
- [x] npm test 609、e2e 108（含新測試：最後一行 y 931、行距 93、字型警告）、build --check、獨立審查通過
- [ ] 使用者說「推」才併入；純前端不需部署
- 待使用者回報：線上 `#fontWarn` 顯示的原因
