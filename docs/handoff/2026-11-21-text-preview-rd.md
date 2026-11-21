# 素材設定改名＋純文字預覽編輯／字級／11 字＋RD 文字／置中
- 狀態：進行中　- 分支：claude/eloquent-thompson-4zwayi　- 最後更新：2026-11-21
- 使用者原始需求：「管理後台的『素材』改名為『素材設定』」「純文字在預覽也可以直接編輯」「純文字預覽文字大小自適應，單行上限 11 全形字跳提醒但不擋」「純文字 RD 寫入為『文章ID/文字/SLUG』」「RD 寫入表格時都使用文字置中」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 改名範圍 | 分類按鈕、h1、層級權限卡片名（`server/core/levels.js`）、`docs/deploy.md`、e2e；卡片內「素材名稱」等指檔案的字不改 | 使用者確認 |
| 純文字預設背景 | 開新增發文／清空／送出完成都隨機一個純色或漸層（不含圖樣）；「無」仍可選；再發一次用紀錄 | 使用者選 |
| 11 字提醒 | 只在有選背景時；輸入框右側每行 `N/11`（同套版 titleLines 欄），有背景時 wrap=off；選無時 soft、不顯示 | 使用者選 2A＋右側對齊 |
| 字級 | 不自動換行，依最長行與行數算最大字級 30～14px | |
| 預覽編輯 | `#bgText` contenteditable plaintext-only，和 `#title` 雙向同步 | |
| RD 文字 | 純文字模式 `ID/文字/SLUG`，其他 `ID/圖文/SLUG` | |
| 置中 | Apps Script 不在 repo → 更新補丁文件 `docs/rundown-gs-video-style.md`、`docs/rundown-gs/rdslot.js`，使用者自己貼 | |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| admin/index.html、server/core/levels.js、docs/deploy.md、test/e2e/admin.e2e.js | 改名 | ✅ |
| tools/fbpost/compose.js、index.html、fbpost.css、title.js | 預覽編輯、字級、11 字、隨機背景 | ✅ |
| tools/fbpost/slug.js、rd.js、send 呼叫處 | RD 文字 | ✅ |
| docs/rundown-gs-video-style.md、docs/rundown-gs/rdslot.js | 置中補丁 | ✅ |

## 下一步
- [x] 改名 → 預覽 → RD → 補丁 → 測試（npm test 754、fbpost＋compose＋admin e2e 100）
- [x] 全部 e2e 260 通過、獨立審查通過（Minor 未修：預覽顯示未 trim 的標題、背景清單載入前按再發一次會改隨機）
- [ ] 使用者確認後說「推」才併 main（併入時更新 CLAUDE.md 目前進度）

## 實作細節
- 預覽 `#bgText` contenteditable plaintext-only；結尾換行瀏覽器會多放一個 \n，讀回時去掉一個、寫入時補一個
- `fitBg()`：white-space: pre，從 30 往下找塞得進 bgPrev 內框的字級（最小 14）
- `textCheck`（title.js）依 split('\n') 逐行，不去頭尾空行（和輸入框行對齊）
- 隨機背景 `randomBg()`：載入清單後、reset；snapshot 多存 bg，restore 帶回

## 測試
npm test、`npx playwright test` 相關：admin、fbpost、fbpost-compose；`node build.js --check`。

## 注意事項
純前端（levels.js 只是顯示名稱）；外掛不升版號。沒說「推」不併 main。
