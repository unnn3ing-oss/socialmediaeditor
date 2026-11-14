# 管理後台搬到網站 admin 分頁＋依功能分類
- 狀態：已完成（已併入 main）　- 分支：claude/upbeat-mendel-dwdvxi　- 最後更新：2026-11-14
- 使用者原始需求：「幫我將後台頁面依照功能分類整排版。可以將管理後台變成在 https://unnn3ing-oss.github.io/socialmediaeditor/ 的 admin 分頁嗎」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 新網址 | `…/socialmediaeditor/admin/`（`admin/index.html`＋`admin.css`＋`admin.js`） | 靜態頁，後端 CORS 已允許 github.io |
| 分類 | 臉書發文（臉書連線、粉專對應、留言設定：預設文字＋嘗試次數並排）／Rundown／素材／錯誤日誌 | 使用者確認示意圖 |
| 版面 | 電腦左側選單、手機上方橫向分頁；隱藏切換；網址 hash 記分類 | 規則：切換用隱藏 |
| 舊 `/admin` | Worker 302 轉新網址；刪 `admin-page.js` | 舊書籤可用 |
| 登入 | token 只在記憶體 | 同舊版 |
| 防嵌入 | JS frame-busting（Pages 不能設標頭）；保留 noindex | |
| 外掛 | 不升版 | 沒動 extension/ |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| admin/index.html, admin.css, admin.js | 從 admin-page.js 拆出，API 加 API_BASE | ✅ |
| server/core/admin.js | GET /admin → 302 | ✅ |
| test/server/assets.test.js:153 | 改驗轉址 | ✅ |
| test/e2e/admin.e2e.js | 假後端：登入、切分類、各按鈕打對 API | ✅ |
| README.md、docs/deploy.md | 改新網址 | ✅ |

## 測試
`npm test`、`npx playwright test test/e2e/admin.e2e.js`（看 e2e 設定）、`node build.js --check`

## 注意事項
- 後端需重新部署舊網址才會轉址；沒部署前兩邊都能用。

## 進度（2026-11-14）
- 全部完成，等使用者確認。npm test 372 項、admin e2e 3 項、組裝檢查、獨立審查通過。
- 全部 e2e：123 過 1 失敗（`fbpost.e2e.js`「排程時間太近：改時間不送出並提示」），還原本次改動後一樣失敗，與本次無關。
- 推 main 後：更新 CLAUDE.md「目前進度」；提醒使用者重新部署後端（舊 /admin 才會轉址）。
