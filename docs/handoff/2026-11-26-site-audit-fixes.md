# 全站審查修正（介面／文案／邏輯）
- 狀態：進行中　- 分支：claude/lucid-ride-7o4zf2　- 最後更新：2026-11-26
- 使用者原始需求：「檢查整個網站是否有錯誤、使用介面錯誤、過多贅述或AI Slop、使用邏輯有問題」→ 審查後「A1/C4 不修，其他全修」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| A1 值班班別不一致（直播需求單 16:00、排程發布 14:30） | 不修 | 使用者決定 |
| C4 尺寸／浮水印／拼圖狀態列 📢 | 不修（使用者自己加的） | 使用者決定 |
| A4 數據報表跟著排程發布開關 | 已查證：後端 `/fb/*`（含 `/fb/reports/*`）都經 `fbAccess`，同一個開關確實管三個工具 → 只改管理頁開關名稱與說明，不改行為 | 標籤本身正確，誤會來自開關叫「排程發布」 |
| 後端 | 不動（`server/core/levels.js` 卡片名不改，免部署） | 純網站 |

## 做法（改哪裡）
| # | 檔案 | 內容 | 狀態 |
|---|---|---|---|
| A2 | `tools/linepush/tool.json` | 說明改「LINE 推播圖：六宮格或四格」→ `node build.js` | ⬜ |
| A3 | `tools/watermark/*.js` | 沒照片時不顯示自動挑中的角（`auto-pick`） | ⬜ |
| A4 | `admin/index.html`、`admin/admin.js` | 開關卡片標題「臉書工具開放／關閉」、說明列出三個工具、子分頁名同步 | ⬜ |
| B1 | `tools/design/design.css`（≤820px） | 工具列排在畫布正下方、右側淡出提示可滑、「形狀」橫排 | ⬜ |
| B2 | `tools/design/design.css` | 手機隱藏「? 快捷鍵」 | ⬜ |
| B3 | `tools/livereq/*` | 姓名／分機紅框改成按過複製或離開欄位後才出現 | ⬜ |
| B4 | `tools/livereq/index.html` | 分機 placeholder「分機或手機（必填），例：85001」 | ⬜ |
| C1 | `shell/showcase.js` 或 `index.html` | 刪首頁副標「製圖、整理需求…」 | ⬜ |
| C2 | `tools/fbpost|fbvideo|fbreports/tool.json` | 拿掉 `gate.desc`（說明保留功能介紹，只留標籤） | ⬜ |
| C3 | `admin/index.html` | 管理登入說明改精簡、正確 | ⬜ |
| C5 | `tools/pattern/*` | 「目前展開的那一組」→「目前這一張」 | ⬜ |
| C6 | `tools/collage`、`tools/watermark` | 重複操作說明只留一處、縮成一行 | ⬜ |
| C7 | `tools/fbreports/*` | 「可直接貼回給開發者」「有效樣本」改白話 | ⬜ |
| C8 | `tools/linepush/*` | ✕→×、「四格 A」→「四格」 | ⬜ |

## 下一步
- [ ] 依上表逐項修改
- [ ] `node build.js`、`npm test`、相關 e2e（linepush、watermark、design、livereq、collage、pattern、fbreports、admin、shell、gate）
- [ ] 截圖給使用者確認（不推 main）

## 測試
`npm test`、`node build.js --check`、`node --test test/e2e/<相關>.e2e.js`。e2e 若檢查舊文字要同步改測試。

## 注意事項
- 不改 `server/`。不改直播需求單班別規則、不拿掉 📢。
