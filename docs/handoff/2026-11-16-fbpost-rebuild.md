# 排程發布重寫（第一段：後端＋管理頁＋工具最小發文／管理）
- 狀態：第一段追加進行中（共用畫圖核心＋帶入＋留言文字），計畫 `docs/superpowers/plans/2026-11-16-fbpost-rebuild-phase1b.md`　- 分支：claude/rebuild-scheduled-publish-3sd0gr　- 最後更新：2026-11-16
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
| 實作計畫 | `docs/superpowers/plans/2026-11-16-fbpost-rebuild-phase1.md`（Task 1～8） | ✅ 待使用者確認 |
| 後端臉書模組 | `server/fb/`（graph、access、pages、post、comment、manage、index） | ✅ |
| 後端留言 DO | `server/fb/timer.js` `FbCommentTimer`，`wrangler.toml` 綁 `FB_TIMER`＋migration v3 | ✅ |
| 後端 RD 轉送 | `server/fb/rundown.js` | ✅ |
| 管理頁 | 臉書連線、粉專設定、Rundown 連線（`admin/` 與後端 `/admin`） | ✅ |
| 工具 `tools/fbpost/` | 測試期間：adm 才進得去；最小發文、已排程／已發佈管理；token 問題在停用頁顯示原因 | ✅ |
| 文件 | deploy.md 步驟 6-2、規格路由表（CLAUDE.md 進度等併入 main 時更新） | ✅ |

## 下一步
- [x] 寫實作計畫（writing-plans）
- [x] 使用者確認計畫與執行方式（A 混合）
- [x] 第一段實作、測試（npm test 578、e2e 87、build --check）、獨立審查（3 Important＋1 升級已修）、截圖
- [ ] 第一段追加（使用者 11/16 要求：測試期就能帶入＋套版、留言文字可改、全部模組化）：Task A～E 見 phase1b 計畫
- [ ] 使用者部署並實測（清單見下）；結果回報後決定第二段或調整
- [ ] 使用者說「推」才併入 main，同 commit 更新 CLAUDE.md「目前進度」

## 測試
`npm test`、`npm run e2e`（Chromium 在 `/opt/pw-browsers/chromium`，不要 `playwright install`）、`node build.js --check`。臉書與 Apps Script 一律用替身測試；真實臉書只能部署後由使用者實測。

## 注意事項／不能做的事
- 不推 main、不開 PR；使用者說「推」才併入。
- 公司素材不進 repo。產生檔不要手改，改來源後跑 `node build.js`。
- DO 類別名稱不可用已刪除的 `CommentHub`；使用者公司電腦 `wrangler.toml` 已有 migrations v1、v2。

## 第一段實測清單（使用者）
1. 部署：`docs/deploy.md` 步驟 6-2（schema、三個 Secrets、本機 `wrangler.toml` 加 `FB_TIMER`＋v3）→ `npx wrangler deploy`
2. 管理頁「臉書發文」：狀態正常、沒有缺少權限 → 填簡稱、UTM、RD 區段、順序、顯示 → 儲存；「Rundown」測試連線
3. 網站用**管理密碼**登入 → 排程發布：
   - 立即＋有圖（作圖框）→ 貼文出現、第一則留言連結＋UTM 正確
   - 排程＋作圖框、排程＋純文字底圖 → **臉書後台「已排定」與工具「已排程」都看得到圖片預覽**（通過標準）
   - 改時間、取消、刪除已發佈
   - 排程時間到後約 1 分鐘內補第一則留言
4. 用公司密碼登入 → 只看到「功能停用」

## 已知未處理（審查 Minor，使用者決定是否要修）
token 無效時管理頁仍列五項缺權限；Safari 解析 `+0000` 時間；開啟連結未檢查 https；重查留言只看 50 則；逾時重按送出可能重複發文；「遲遲未發布」失敗後改時間不會復活。
