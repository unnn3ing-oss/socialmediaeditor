# 排程發布重寫（第一段：後端＋管理頁＋工具最小發文／管理）
- 狀態：進行中　- 分支：claude/rebuild-scheduled-publish-3sd0gr　- 最後更新：2026-11-16
- 使用者原始需求：「重建新『排程發布』功能」；「全部都不可以參考過往任何紀錄來重寫」。
- 設計（已確認）：`docs/superpowers/specs/2026-11-16-fbpost-rebuild-design.md`。實作計畫：`docs/superpowers/plans/2026-11-16-fbpost-rebuild-phase1.md`（寫好後）。

## 已定案的決定（細節看設計文件，不要重新討論）
| 項目 | 決定 | 理由 |
|---|---|---|
| 舊版排程發布 | **不參考**舊程式、交接檔、規格紀錄；`sdk/news-sched.js` 不用 | 使用者指示 |
| 可用的現役程式 | `tools/pattern/`、`sdk/news-article.js`、`sdk/news-rules.js`、後端 `/fetch/*`；RD 依據 `unnn3ing-oss/-schedulenewnet` 的 `gas/rundown.gs`、`worker/index.js` | 使用者指定 |
| 排程後補留言 | Durable Object 計時器（每則貼文一個實例），migration 用 v3 | 使用者選 1B |
| Token | Secret `FB_USER_TOKEN`，`/me/accounts` 換 page token | 使用者選 2B |
| 開發順序 | 第一段先讓使用者實測臉書；通過＝臉書後台「已排定」與工具「已排程」都看得到圖片預覽；不過就停下來討論 | 使用者選 3A |
| 測試期間權限 | 只有管理密碼登入（`adm:1`）能進 fbpost、呼叫 `/fb/*`、`/rundown` | 使用者 |
| RD 改時間／取消 | 不處理 | 使用者 |
| 粉專設定 | 簡稱、UTM、RD 區段、順序、顯示開關（管理頁） | 使用者 |
| 值班粉專 | 每天第一次開跳選單，第一個＝主要（預設勾選），本機 01:00 失效 | 使用者（第二段做） |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| 實作計畫 | `docs/superpowers/plans/2026-11-16-fbpost-rebuild-phase1.md` | ⬜ |
| 後端臉書模組 | 粉專清單、發文（立即／排程有圖）、列表、改時間、取消、刪除、留言 | ⬜ |
| 後端留言 DO | 排程貼文發布後補第一則留言 | ⬜ |
| 後端 RD 轉送 | `POST /rundown`、管理頁 ping | ⬜ |
| 管理頁 | 臉書連線、粉專設定、Rundown 連線（`admin/` 與後端 `/admin`） | ⬜ |
| 工具 `tools/fbpost/` | 測試期間：adm 才進得去；最小發文（圖＋文字＋粉專＋立即／排程）、已排程／已發佈管理 | ⬜ |
| 文件 | README、deploy.md（Secrets、DO migration v3）、規格、CLAUDE.md | ⬜ |

## 下一步
- [ ] 寫實作計畫（writing-plans），使用者看過再動工
- [ ] 依計畫實作、測試、獨立審查、截圖給使用者

## 測試
`npm test`、`npm run e2e`（Chromium 在 `/opt/pw-browsers/chromium`，不要 `playwright install`）、`node build.js --check`。臉書與 Apps Script 一律用替身測試；真實臉書只能部署後由使用者實測。

## 注意事項／不能做的事
- 不推 main、不開 PR；使用者說「推」才併入。
- 公司素材不進 repo。產生檔不要手改，改來源後跑 `node build.js`。
- DO 類別名稱不可用已刪除的 `CommentHub`；使用者公司電腦 `wrangler.toml` 已有 migrations v1、v2。
