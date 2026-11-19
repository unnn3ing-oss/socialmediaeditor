# 測試後端（toolbox-api-dev）＋管理員入口
- 狀態：已完成（已併入 main）　- 分支：claude/dazzling-tesla-2kscqv　- 最後更新：2026-11-19
- 使用者原始需求：「我想嘗試將目前這整個專案複製一份，用我自己創的粉專做開發測試」→ 選方案 B＋管理員入口。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 做法 | 同一個 repo，另部署測試後端 `toolbox-api-dev`（`wrangler.toml` 的 `[env.dev]`，自己的 D1／KV／R2） | 一份程式、正式不受影響 |
| 切換入口 | **只有正式後端用管理員密碼登入（adm）時**，登出確認視窗多「切到測試後端」；不支援網址參數 | 同事看不到入口；任意網址會被拿來釣密碼 |
| 切換記在哪 | localStorage `tbx.api`＝`dev`；切換後整頁重新載入 | iframe 工具同網域共用 |
| 切回正式 | 測試模式頂列一直顯示「測試後端」膠囊（登出也在），點了確認後切回 | 不會困在測試模式 |
| 憑證 | 測試用 `tbx.company.dev`、正式 `tbx.company`；測試後端要用它自己的管理員密碼再登入 | 兩邊憑證不互相送錯 |
| 外掛 | 不改、不升版；側邊欄（`panel.html` 或祖先是 chrome-extension://）一律正式 | 使用者說外掛不需要 |
| 測試後端網址 | `https://toolbox-api-dev.19jpz-3.workers.dev`（同一個 Cloudflare 帳號） | 使用者選 |
| 管理頁顯示 | 維持現狀（Secret／權杖不回傳） | 使用者選方案 1 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `shell/config.js` | `PROD_API_BASE`／`DEV_API_BASE`／`API_ENV_KEY`／`readApiEnv()`／`API_ENV`；`API_BASE` 依環境 | ✅ |
| `sdk/api.js` | `COMPANY_KEY` 依 `API_ENV` | ✅ |
| `shell/company.js` | 登出視窗加「切到測試後端」（admin 且正式才顯示） | ✅ |
| `shell/apienv.js`（新）＋`shell/status.js` | 「測試後端」膠囊＋切回正式確認視窗 | ✅ |
| `admin/index.html`／`admin.js` | 測試模式頁首標「測試後端」 | ✅ |
| `server/wrangler.toml` | `[env.dev]` | ✅ |
| `docs/deploy.md` | 「測試後端」一節 | ✅ |
| 測試 | 單元 `test/apienv.test.js`；e2e `test/e2e/company.e2e.js` 加案例 | ✅ |

## 下一步
- [x] 依上表實作（另：`shell/shell.css` 測試後端膠囊橘底填色）
- [x] npm test 677、build --check、全部 e2e 221 通過
- [x] 獨立審查：Important「env.dev 沒 migrations」查證不成立（wrangler `migrations` 是 inheritable，dry-run 無警告）；Minor 修掉無效 waitForFunction
- [x] 使用者說「推」，併入 main（同 commit 更新 CLAUDE.md 目前進度）
- [ ] 使用者部署：docs/deploy.md 步驟 6-3

## 測試
`npm test`、`node build.js --check`、`npx playwright test test/e2e/company.e2e.js test/e2e/shell.e2e.js test/e2e/admin.e2e.js test/e2e/sidepanel.e2e.js --trace off`（依實際設定檔）。

## 注意事項／不能做的事
- 不改 `server/` 程式（只改 `wrangler.toml`）、不改外掛。
- 正式網站沒切換過的人行為必須完全不變。
