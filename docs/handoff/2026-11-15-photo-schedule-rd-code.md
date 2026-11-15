# 有圖排程改走 /feed attached_media ＋ RD 區段（code）可在管理頁編輯
- 狀態：已被使用者要求還原（還原 e11700e、a8174bc，回到 c013279 的後端／管理頁狀態）　- 分支：claude/confident-keller-edllg4　- 最後更新：2026-11-15
- 使用者原始需求：「檢查目前 少康 無法寫入RD的問題」；「工具新增在少康的貼文沒有成功排在臉書後台的已排定發布中」；確認後說「開始，用方案 A」。

## 已知事實（調查結果）
- RD：送出完成視窗顯示「RD 未寫入：請檢查粉專對應」＝前端判斷該粉專 `code` 不在新聞／娛樂／少康／國際＋，請求根本沒送到 `/rundown`。`code` 由後端 `/fb/pages` 依粉專「原名完全比對」預設猜出（少康預設名 `少康戰情室`），管理頁沒有任何地方能改 `code`（`server/core/fb.js` 約 206-285 行）。簡稱（label）純顯示，不影響 RD。
- 有圖排程：使用者回報**所有粉專**的有圖排程貼文都不出現在 Meta Business Suite「已排定」，工具自己的「已排程」（查 `/scheduled_posts`）也沒有，但本地紀錄顯示「排程中」（臉書回了成功）。原做法是 `POST /{粉專}/photos` ＋ `published=false` ＋ `scheduled_publish_time`，這條路徑從未打過真臉書（只有假回應的單元測試）。

## 推論（未能直接讀官方文件，環境連不到 developers.facebook.com）
- 搜尋結果轉述 Meta 文件：排程含照片的貼文要先 `/photos` 上傳並帶 `temporary=true`，再 `POST /{粉專}/feed` 用 `attached_media`，並帶 `published=false`、`scheduled_publish_time`、`unpublished_content_type=SCHEDULED`。
- 純文字排程（`/feed`）使用者尚未回報是否正常。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 有圖排程 | 方案 A：兩步驟（上傳暫存照片 → `/feed` attached_media 排程）；立即發布維持 `/photos` | 符合文件轉述；`/feed` 直接回貼文 ID，免「照片 ID 換貼文 ID」 |
| RD 區段 | 管理頁粉專對應表新增獨立欄位「RD 區段」下拉並存進 D1 `code`；簡稱維持純顯示 | 讓影響 RD 的欄位看得見、改得動 |
| 預設名稱比對 | 不放寬 | 避免誤判，使用者同意只做手動設定 |
| 版本 | 外掛不升版號；後端需重新部署 | 只改網站與後端 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fb.js` | `createPost`：有圖＋排程走兩步驟；`attachComments` 排程時直接用貼文 ID | ✅ |
| `test/server/fb.test.js`、`test/server/fbqueue.test.js` | 更新排程發圖測試；第 2 步失敗的處理 | ✅ |
| `server/core/fb.js`（pagemap） | `POST /admin/fb/pagemap` 接收並驗證 `code`（news/ent/shaokang/jkk/intl/weather/空）；沒帶就沿用舊值 | ✅ |
| `admin/index.html`、`admin/admin.js` | 表格加「RD 區段」下拉，空值標紅「未設定，RD 不會寫入」，儲存一併送出 | ✅ |
| `test/server/fbqueue.test.js`（或 fb.test.js）、`test/e2e/admin.e2e.js` | code 可存可改、非法值拒絕、不帶不覆蓋、改簡稱不動 code；下拉預選與標紅 | ✅ |
| `CLAUDE.md` 目前進度 | 併入 main 時同 commit 更新 | ✅ |

## 下一步
- [x] 先做有圖排程（獨立 commit），再做 RD code（獨立 commit）
- [x] 跑 `node --test test/server/fb.test.js test/server/fbqueue.test.js`、`npx playwright` admin e2e、`node build.js --check`
- [ ] 獨立審查
- [ ] 使用者說「推」才併入 main；部署後端後：排一篇有圖貼文確認出現在 Meta Business Suite「已排定」、留言跟著貼文；管理頁把少康 RD 區段設為「少康」再實測寫入 RD

## 測試
單元：`node --test test/server/fb.test.js test/server/fbqueue.test.js`；e2e：`PLAYWRIGHT_BROWSERS_PATH=… node --test test/e2e/admin.e2e.js`（沙盒用 `/opt/pw-browsers/chromium`，不要 `playwright install`）。測試用假臉書，單元測試通過不代表線上成功，需使用者部署後實測。

## 注意事項
- 環境連不到 Cloudflare／臉書，無法驗證線上；不能宣稱已確認有圖排程修好。
- 第 2 步失敗會留下暫存照片（通常自動過期，未能確認），錯誤要正常回報給使用者。
- 不改前端發文工具、外掛、Apps Script。

## 進度紀錄
- 有圖排程 commit：e11700e；RD code 可編輯另一個 commit。npm test 376 項、admin e2e 4 項、`node build.js --check` 通過。
- 實作細節：`createPost` 排程有圖＝/photos(published=false,temporary=true)→/feed(attached_media[0]、published=false、scheduled_publish_time、unpublished_content_type=SCHEDULED)；`attachComments` 排程時 isPhoto=false；pagemap `code` 選填，值限 news/ent/shaokang/jkk/intl/weather/空。

## 還原紀錄（2026-11-15）
- 使用者要求把後端還原到 c013279（昨晚狀態）。做法：`git revert` e11700e（有圖排程改 /feed）與 a8174bc（RD 區段下拉），不動其他功能；保留本交接檔當紀錄。
- 還原後的行為：有圖排程回到 `/photos` 直接排程（最初回報「排不進已排定」的狀態）；管理頁沒有 RD 區段下拉。已在管理頁存進 D1 的 `code` 仍有效（舊版 `mapFor` 同樣讀 `fb_page_map.code`）。
- 已查證：發文（createPost）只用粉專 ID 取 token，不讀簡稱／code／utm。立即發圖 `/photos` 路徑在 94bef59 與還原前完全相同，所以「立即發圖只進相簿」不是這次改動造成的，還原後預期仍會發生；已請使用者做 T1（同圖立即發到其他粉專）、T2（純文字立即發到少康）判斷範圍。
- 兩步驟排程（/feed attached_media）上線後觀察：Meta Business Suite「已排定」有出現（類型相片、火箭圖示），預覽顯示「無法取得預覽」，工具「已排程」讀得到縮圖；準時發布結果未驗證。
