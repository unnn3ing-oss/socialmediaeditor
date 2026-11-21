# 排程發布「純文字」加臉書文字背景
- 狀態：第 1 階段已完成並併入 main；2026-11-21 臉書實測通過（立即／排程皆顯示背景）　- 分支：claude/zen-davinci-9rdqf4　- 最後更新：2026-11-21
- 使用者原始需求：「以 Publer 這個網頁上關於臉書貼文文字背景色，加到目前排程發布中的『純文字』，讓排程發文可以更像臉書前台發文一樣可選背景色。」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 參數 | `/{page}/feed` 多帶 `text_format_preset_id`（只在沒附圖時） | Publer 文件；Meta 官方 Posts 文件（v27.0）沒列，屬非官方參數，需實測 |
| 清單來源 | ①A：先寫死在後端 `server/fb/bgpresets.js`；之後補 ①B 管理頁可增刪 | 使用者選；`listBackgrounds(env)`／`findBackground(env,id)` 為 async，B 只換資料來源 |
| 超過 130 字 | ②A：擋送出 | 使用者選；臉書背景貼文上限 130 字（Publer） |
| 第一版範圍 | 只放純色＋漸層（Publer 清單中描述為 Solid／Gradient 者，同描述只取一個），插畫類之後再加 | CSS 畫得出近似預覽 |
| 預覽 | 近似色，標示「實際以臉書為準」 | 臉書沒公開色碼 |
| 清空頁面 | 背景回「無」 | 避免下一則誤帶 |
| **清單改用臉書實際資料（第 1 階段，2026-11-21）** | 使用者從自己粉專發文框擷取 77 組（7 純色／4 漸層／66 圖樣），存 `server/fb/bgpresets.data.js`（JSON 原樣）；只開放純色＋漸層 11 個，用實際色碼、文字色、漸層方向；移除 Publer 清單中臉書選單已沒有的 7 個代號 | Publer 清單有 7 個疑似下架 |
| 圖樣類（第 3 階段，實測成功後另開對話） | 擷取腳本輸出完整圖片網址 → 管理頁貼上 → 後端分批（每批 10，免費方案 50 個子請求上限）下載存 R2 `fbbg/<代號>.jpg` → 登入才可讀；與 ①B 合併 | 臉書 CDN 網址帶 oh／oe 簽章會過期；圖不進 repo |

Publer 原始清單（75 個）存在 scratchpad，不進 repo；ID 已抄進 `bgpresets.js`。

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/bgpresets.js`（新） | 預設清單 15 個＋`listBackgrounds`／`findBackground` | ✅ |
| `server/fb/index.js` | `GET /fb/backgrounds` | ✅ |
| `server/fb/post.js` | `parsePostForm` 收 `bg`（有圖或 >130 字或不在清單 → 400）；`publishOne` 純文字帶 `text_format_preset_id`；計字前 CRLF→LF（審查修正） | ✅ |
| `tools/fbpost/index.html`／`compose.js`／`fbpost.css` | 純文字模式顯示背景區（預覽＋色塊，第一個「無」），隱藏切換 | ✅ |
| `tools/fbpost/send.js` | 送 `bg`；>130 字擋送出 | ✅ |
| 測試 | `test/server/fb-post.test.js`、`test/e2e/fbpost-compose.e2e.js` | ✅ |

## 下一步
- [x] 第 1 階段（`47bb649`，npm test 745、fbpost e2e 60、build --check、獨立審查通過）：`bgpresets.data.js`＋`bgpresets.js` 改讀資料（回 id、name、type、css、text）、前端套文字色與分組、擷取腳本放 `docs/fb-text-backgrounds/`、測試
- [x] 後端＋單元測試
- [x] 前端＋e2e、截圖（npm test 743、fbpost e2e 60、build --check 通過）
- [x] 獨立審查（修正後通過：後端計字 CRLF 修正 `2b65ccc`）
- [x] 使用者部署實測：立即／排程都正常、臉書都顯示背景
- [ ] 第 3 階段（另開對話）：圖樣 66 個存 R2＋管理頁清單（併 ①B）

## 測試
`npm test`、`npx playwright test test/e2e/fbpost-compose.e2e.js test/e2e/fbpost.e2e.js --trace off`、`node build.js --check`。

## 注意事項
- 非官方參數：臉書可能忽略（發成白底）或回錯誤，實測結果要回報。
- 不動有圖發文、留言、RD、外掛（不升版）。**後端需重新部署。**
