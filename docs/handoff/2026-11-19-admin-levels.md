# 管理頁權限分層＋管理頁改版
- 狀態：進行中　- 分支：claude/determined-ptolemy-en5fr5　- 最後更新：2026-11-19
- 使用者原始需求：「管理頁權限分層＋管理頁改版成前台設計：系統管理者／管理者／普通，下層不能看到也不能改上層的功能；首頁登入後直接進管理頁」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 系統管理者 | 只有管理員密碼 | 員工編號登入沒密碼 |
| 卡片分配 | 見規格 §四（預設），「層級權限」卡片可調 | 使用者要可調 |
| 管理頁只留一份 | 網站版 `admin/`，後端 `/admin` 302、刪 `admin-page.js` | 避免兩份 |
| 進入方式 | 做法 A：`/admin/*` 接受首頁公司憑證 | 停用立即生效 |
| 敏感卡片 | 方案甲：`adm:1` 不能用 ⚠ 卡片，要在管理頁輸入管理員密碼解鎖（記憶體） | localStorage 外流風險 |

規格：`docs/superpowers/specs/2026-11-19-admin-levels-design.md`；計畫：`docs/superpowers/plans/2026-11-19-admin-levels.md`。

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/adminperm.js`（新）、`admin.js`、`staff.js`、`auth.js`、`http.js`、`fb/index.js` | 後端權限 | ⬜ |
| `shell/`、`admin/` | 首頁按鈕、管理頁權限 | ⬜ |
| `admin/admin.css` | 改版（先截圖給使用者確認） | ⬜ |
| README、`docs/deploy.md` | 網址 | ⬜ |

## 下一步
- [ ] Task 1 後端
- [ ] Task 2 前端
- [ ] Task 3 截圖確認 → 改版
- [ ] Task 4 文件、審查

## 測試
`npm test`、`npm run e2e`、`node build.js --check`。

## 注意事項
- 改版外觀前一定先給使用者截圖確認。
- 後端需重新部署（正式＋測試），不用手動 SQL。外掛不改。
