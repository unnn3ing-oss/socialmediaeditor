# 排程發布重寫・第一段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後端能用 `FB_USER_TOKEN` 對粉專立即／排程發有圖貼文、排程發布後自動補第一則留言、列出／改時間／取消／刪除、轉送 Rundown；管理頁能看臉書連線與設定粉專；`fbpost` 工具給管理員一個最小的發文與管理畫面，讓使用者實測臉書。

**Architecture:** 後端新資料夾 `server/fb/`（核心層模組，路徑 `/fb/*`、`/rundown`，管理路由掛 `adminExtras`）；Graph 呼叫集中在 `graph.js`；排程留言用 Durable Object `FbCommentTimer`（每則貼文一個實例，以貼文 ID 命名）。前端 `tools/fbpost/` 先問 `/auth/status`，只有 `admin:true` 才顯示測試畫面，其餘維持「功能停用」。

**Tech Stack:** Cloudflare Workers（D1、KV、Durable Objects SQLite）、Graph API v27.0、原生 JS（ES module）、`node --test`、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-16-fbpost-rebuild-design.md`

## Global Constraints
- 不參考舊版排程發布任何程式、交接檔或 git 歷史；不用 `sdk/news-sched.js`。
- 繁體中文（台灣）介面文字與註解；不用 emoji。
- 測試期間 `/fb/*`、`/rundown` 只接受 `company` 憑證且 `adm === true`；開關集中在 `server/fb/access.js` 的 `FB_ACCESS`（`'admin-front'`｜`'company'`），正式開放只改這一處。
- 管理路由一律管理憑證（`bearer(request, env, 'admin')`）。
- Graph 基底 `https://graph.facebook.com/v27.0`。
- 排程範圍：發布時間 ≥ 現在＋10 分鐘、≤ 現在＋30 天（前後端都檢查）。
- 留言文字：`看更多新聞內容\n` ＋ 連結；連結規則：UTM 去掉開頭的 `?`／`&`；網址沒有 `?` → `網址 + '?&' + utm`；已有 `?` → 以 `&` 接（網址已以 `?`／`&` 結尾就直接接）；UTM 空白 → 只放網址；`#` 錨點保留在最後。
- RD：`page` 只能 `news|ent|shaokang|intl`；`date` `YYYY-MM-DD`；`time` `HH:mm`；`text` ≤100 字、不可換行；一次 1～10 筆；`RUNDOWN_URL` 必須符合 `^https://script\.google\.com/macros/s/[\w-]+/exec$`，`RUNDOWN_TOKEN` 至少 12 字。
- 新 Secrets：`FB_USER_TOKEN`、`RUNDOWN_URL`、`RUNDOWN_TOKEN`。DO 類別名 `FbCommentTimer`、綁定 `FB_TIMER`、migration tag `v3`（不可用 `CommentHub`）。
- 依序（不並行）對各粉專送出。
- 產生檔不手改；改完跑 `node build.js`。外掛不升版號。

## Review Focus
- 同一則貼文的留言在重試或 alarm 重跑時被留兩次 → 只能留一次（Task 3 測試「posting 狀態重跑先查留言」）。
- 排程貼文在工具內改時間後，DO 仍在舊時間留言 → 必須跟著新時間（Task 3「到點未發布且臉書時間變了→重設」＋ Task 4 reschedule 呼叫 DO）。
- 粉專 UTM 套錯（多粉專一次送出時串到別的粉專）→ 每個粉專用自己的 UTM（Task 2「兩個粉專各自 UTM」）。
- `FB_USER_TOKEN` 過期／缺權限 → 管理頁與工具顯示明確原因，不是空白清單（Task 1「token 錯誤回 fb_token」）。
- 公司密碼（非管理員）憑證打 `/fb/*` → 403，工具顯示「功能停用」（Task 1、Task 7）。

---

### Task 1: Graph 呼叫、存取權限、粉專清單與設定

**Files:**
- Create: `server/fb/graph.js`、`server/fb/access.js`、`server/fb/pages.js`、`server/fb/index.js`
- Modify: `server/index.js`（modules 加 `handleFb`；`adminExtras.push(adminFb)`）、`server/schema.sql`、`server/core/http.js`（新錯誤碼）
- Test: `test/server/fb-pages.test.js`

**Interfaces:**
- Produces:
  - `graph(env, method, path, params?: object|FormData, token: string) -> Promise<object>`：成功回 JSON；失敗 throw `GraphError { code:number, subcode?:number, message, status }`。GET 參數放 query，其他放 body（FormData 原樣，物件轉 URLSearchParams）。
  - `isRateLimit(err) -> boolean`：code ∈ {4, 17, 32, 613, 80001}。
  - `fbAccess(request, env) -> Promise<Response|null>`：不通過回 `fail(...,'unauthorized')`（無憑證）或 `fail(...,'fb_forbidden')`（403，非管理員）；通過回 null。
  - `pageTokens(env) -> Promise<Map<pageId,{id,name,token}>>`：`GET /me/accounts?fields=id,name,access_token&limit=100`（翻頁），KV 快取 `fb:accounts` 3600 秒；沒設 `FB_USER_TOKEN` throw `fb_off`；token 錯誤 throw `fb_token`。
  - `listPages(env, {all}) -> Promise<Array<{id,name,short,utm,rd,order,show}>>`：合併 accounts 與 D1 `fb_pages`；新粉專預設 `short=name, utm='', rd='', order=999, show=1`；依 order、name 排序；`all=false` 只回 `show=1`。
  - `pageUtm(env, pageId) -> Promise<string>`、`pageRd(env, pageId) -> Promise<''|'news'|'ent'|'shaokang'|'intl'>`。
  - 路由：`GET /fb/pages`（fbAccess）→ `[{id, short, order}]`（不回 token、utm）；`GET /admin/fb/status` → `{ configured, valid, expires?: number|null, missing: string[], pages: n }`（`/me/permissions` 與 `debug_token`，後者失敗 `expires:null`）；`GET /admin/fb/pages` → listPages all；`POST /admin/fb/pages` body `{ pages:[{id, short, utm, rd, order, show}] }` 整份 upsert（D1 batch），驗證：short 1～20 字、utm ≤200 字且只含 URL 安全字元、rd ∈ 五值、order 0～999 整數；`POST /admin/fb/refresh` 清 KV 快取。
  - 錯誤碼（`http.js` MESSAGES／STATUS）：`fb_off`（503，「後端尚未設定 FB_USER_TOKEN。」）、`fb_token`（502，「臉書 token 無效或過期。」）、`fb_forbidden`（403，「目前只有管理員可以使用排程發布。」）、`fb_error`（502）、`fb_bad_time`（400，「排程時間必須在 10 分鐘到 30 天之間。」）、`rundown_off`（503）、`rundown_failed`（502）。
  - D1：`CREATE TABLE IF NOT EXISTS fb_pages (id TEXT PRIMARY KEY, short TEXT NOT NULL, utm TEXT NOT NULL DEFAULT '', rd TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL DEFAULT 999, show INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL);`

- [ ] **Step 1: 寫失敗測試**（以 `globalThis.fetch` 替身模擬 graph.facebook.com）
  - `GET /fb/pages`：無憑證 401；公司憑證（非 adm）403 `fb_forbidden`；adm 憑證 200，只含 `show=1`，依 order 排，回傳物件沒有 `token`、`utm` 欄位。
  - 沒設 `FB_USER_TOKEN` → 503 `fb_off`；Graph 回 `{error:{code:190}}` → 502 `fb_token`。
  - `/me/accounts` 第二次呼叫走 KV 快取（fetch 次數 1）；`POST /admin/fb/refresh` 後重抓。
  - `POST /admin/fb/pages`：非管理憑證 401；short 21 字 → 400；rd `'bad'` → 400；正常存入後 `GET /admin/fb/pages` 讀回相同值。
  - `GET /admin/fb/status`：`/me/permissions` 缺 `pages_manage_posts` → `missing` 含它；`debug_token` 失敗 → `expires:null`。
- [ ] **Step 2: 跑 `node --test test/server/fb-pages.test.js`，預期 FAIL（模組不存在）**
- [ ] **Step 3: 實作上述介面**
- [ ] **Step 4: 再跑，預期 PASS；`npm test` 全過**
- [ ] **Step 5: Commit** `feat(fb): 臉書粉專清單、存取權限與管理頁粉專設定 API`

### Task 2: 發文（立即／排程）＋立即留言

**Files:**
- Create: `server/fb/post.js`、`server/fb/comment.js`
- Modify: `server/fb/index.js`（路由）
- Test: `test/server/fb-post.test.js`

**Interfaces:**
- Consumes: Task 1 的 `graph`、`pageTokens`、`pageUtm`、`fbAccess`。
- Produces:
  - `commentLink(url: string, utm: string) -> string`、`commentText(url, utm) -> string`（見 Global Constraints）。
  - `postComment(env, token, postId, message) -> Promise<string /*commentId*/>`：`POST /{postId}/comments`。
  - `POST /fb/post`（fbAccess，multipart，上限 8 MB）：欄位 `message`（≤ 63206 字）、`link`（選填，http(s)）、`image`（選填，jpeg/png ≤ 8 MB）、`targets`（JSON：`[{page, at: number|null /*秒；null=立即*/}]`，1～20 筆）。
    - 依序對每個 target：有圖立即 → `POST /{page}/photos`（source、caption=message、published=true）→ 取 `post_id`（無則 `id`）；有圖排程 → `POST /{page}/photos`（source、published=false、temporary=true）→ `POST /{page}/feed`（message、`attached_media[0]={"media_fbid":id}`、published=false、scheduled_publish_time、unpublished_content_type=SCHEDULED）；無圖 → `POST /{page}/feed`（message［、published=false、scheduled_publish_time］）。
    - 立即成功且有 link → 馬上 `postComment`；排程成功且有 link → 呼叫 Task 3 的 `armTimer(env, {pageId, postId, message: commentText, at})`。
    - 回 `{ results: [{ page, ok, postId?, scheduled: boolean, at?, comment: 'done'|'armed'|'none'|'failed', commentError?, error? }] }`；單一粉專失敗不中斷其他粉專；`at` 不在範圍 → 該筆 `error:'fb_bad_time'` 不呼叫臉書。
- [ ] **Step 1: 寫失敗測試**
  - `commentLink`：`('https://news.tvbs.com.tw/sports/4051394','?&utm_source=facebook&utm_medium=2100roomcomments')` → `https://news.tvbs.com.tw/sports/4051394?&utm_source=facebook&utm_medium=2100roomcomments`；網址已有 `?a=1` → `…?a=1&utm_source=…`；網址帶 `#x` → utm 插在 `#x` 前；utm 空白 → 原網址。
  - 有圖立即：fetch 依序 `/photos`（含 caption）→ `/{post_id}/comments`，留言內容第一行 `看更多新聞內容`。
  - 有圖排程：fetch 依序 `/photos`（temporary=true、published=false）→ `/feed`（含 `attached_media[0]`、`unpublished_content_type=SCHEDULED`）；不呼叫 comments；`armTimer` 被呼叫一次且 `at` 相同。
  - 兩個粉專各自 UTM（D1 設不同 utm）→ 兩則留言連結各自正確。
  - 第一個粉專 Graph 失敗、第二個成功 → results 兩筆，第二筆 ok。
  - `at` = 現在＋5 分鐘 → 該筆 `fb_bad_time`，fetch 沒被呼叫。
  - 沒 link → `comment:'none'`。
- [ ] **Step 2: 跑 `node --test test/server/fb-post.test.js`，預期 FAIL**
- [ ] **Step 3: 實作**（`armTimer` 先以 Task 3 介面呼叫；Task 3 完成前測試用替身綁定）
- [ ] **Step 4: 預期 PASS**
- [ ] **Step 5: Commit** `feat(fb): 立即／排程發文與第一則留言`

### Task 3: 排程留言 Durable Object

**Files:**
- Create: `server/fb/timer.js`
- Modify: `server/index.js`（`export { FbCommentTimer } from './fb/timer.js'`）、`server/wrangler.toml`（綁定＋migration v3）
- Test: `test/server/fb-timer.test.js`（自製假 `state.storage`：`get/put/delete/setAlarm/getAlarm/deleteAlarm`）

**Interfaces:**
- Consumes: `graph`、`isRateLimit`、`pageTokens`、`postComment`。
- Produces:
  - `class FbCommentTimer { constructor(state, env); fetch(request); alarm() }`，storage 鍵 `rec`：`{ pageId, postId, message, at /*秒*/, status:'pending'|'posting'|'done'|'failed'|'canceled', attempts, retimes, commentId?, error? }`。
  - 內部路由（`https://timer/…`，POST JSON）：`/arm {pageId,postId,message,at}` → 存 rec、`setAlarm((at+60)*1000)`；`/retime {at}` → 更新 at、attempts=0、重設 alarm（status 必須 pending）；`/cancel` → status=canceled、deleteAlarm；`/status` → 回 rec（沒有回 `{status:'none'}`）。
  - 外部輔助（`timer.js` 匯出）：`armTimer(env, rec)`、`retimeTimer(env, postId, at)`、`cancelTimer(env, postId)`、`timerStatus(env, postId)`，皆 `env.FB_TIMER.get(env.FB_TIMER.idFromName(postId))`。
  - `alarm()` 規則：
    - status 不是 pending／posting → 結束。
    - `GET /{postId}?fields=is_published,scheduled_publish_time`：GraphError code 100 或 status 404 → canceled；`is_published=false` → 若 `scheduled_publish_time` 與 at 不同且 `retimes < 20` → at=新值、retimes+1、alarm=(at+60)s；否則 alarm=現在+60s（同樣計入 retimes，超過 20 → failed「貼文遲遲未發布」）。
    - 已發布：status 為 posting（上次中斷）→ 先 `GET /{postId}/comments?fields=from{id},message&limit=50`，找到 from.id=pageId 且 message 相同 → done，不再留言。否則 put status=posting **後**才 `postComment`，成功 → done＋commentId。
    - 失敗：`isRateLimit` → failed（原因寫入）；否則 attempts+1，`attempts >= 5` → failed，不然 alarm=現在＋[30,60,120,240][attempts-1] 秒，status 回 pending。
  - `wrangler.toml` 新增：
    ```toml
    [[durable_objects.bindings]]
    name = "FB_TIMER"
    class_name = "FbCommentTimer"

    [[migrations]]
    tag = "v3"
    new_sqlite_classes = ["FbCommentTimer"]
    ```
- [ ] **Step 1: 寫失敗測試**：arm 後 alarm 時間＝(at+60)×1000；到點已發布 → 留言一次、status done；到點未發布且臉書時間變了 → at 更新、alarm 重設、未留言；貼文不存在（code 100）→ canceled；posting 狀態重跑且臉書上已有相同留言 → done、留言 API 沒被呼叫；一般錯誤 5 次後 failed、間隔 30/60/120/240；限流碼 4 → 立刻 failed；cancel 後 alarm 觸發不呼叫臉書；retime 在 status done 時回錯誤。
- [ ] **Step 2: 跑，預期 FAIL**
- [ ] **Step 3: 實作**
- [ ] **Step 4: 預期 PASS；把 Task 2 測試改用真 `FbCommentTimer`＋假 namespace 也通過**
- [ ] **Step 5: Commit** `feat(fb): 排程貼文發布後補留言（Durable Object）`

### Task 4: 已排程／已發佈列表、改時間、取消、刪除

**Files:**
- Create: `server/fb/manage.js`
- Modify: `server/fb/index.js`
- Test: `test/server/fb-manage.test.js`

**Interfaces:**
- Consumes: `graph`、`pageTokens`、`retimeTimer`、`cancelTimer`、`timerStatus`、`fbAccess`。
- Produces（皆 fbAccess；`page` 必須是 pageTokens 裡的粉專，否則 400）：
  - `GET /fb/scheduled?page=ID` → `GET /{page}/scheduled_posts?fields=id,message,scheduled_publish_time,full_picture,created_time&limit=50` → `[{id, message, at, picture, comment}]`（`comment` 來自 timerStatus 的 status，沒有＝`'none'`）。
  - `GET /fb/published?page=ID&after=cursor` → `GET /{page}/published_posts?fields=id,message,created_time,full_picture,permalink_url&limit=25` → `{ items:[{id,message,time,picture,url,comment}], next }`。
  - `POST /fb/posts/:id/reschedule {page, at}` → 範圍檢查 → `POST /{id}`（scheduled_publish_time=at）→ retimeTimer（DO 沒有紀錄時忽略）。
  - `POST /fb/posts/:id/cancel {page}` → `DELETE /{id}` → cancelTimer。
  - `POST /fb/posts/:id/delete {page}` → `DELETE /{id}` → cancelTimer。
  - `:id` 只允許 `^\d+(_\d+)?$`。
- [ ] **Step 1: 寫失敗測試**：scheduled 列表欄位對應且含 `picture`；comment 狀態帶出；reschedule 範圍外 400 不呼叫臉書；reschedule 成功後 DO at 更新；cancel／delete 呼叫 `DELETE` 且 DO canceled；`page` 不在清單 400；`:id` 含 `/` 404。
- [ ] **Step 2–4: FAIL → 實作 → PASS**
- [ ] **Step 5: Commit** `feat(fb): 已排程／已發佈列表與改時間、取消、刪除`

### Task 5: Rundown 轉送

**Files:**
- Create: `server/fb/rundown.js`
- Modify: `server/fb/index.js`、`server/index.js`（adminExtras）
- Test: `test/server/fb-rundown.test.js`

**Interfaces:**
- Produces:
  - `rundownBody(body) -> {action:'add', entries}|null`（Global Constraints 的格式；其他欄位丟掉）。
  - `POST /rundown`（fbAccess）`{entries}` → 轉送 `{token: env.RUNDOWN_TOKEN, action:'add', entries}`（`Content-Type: text/plain;charset=utf-8`、`redirect:'follow'`）→ 回 `{results}`。
  - `GET /admin/rundown` → `{ configured: boolean }`（不回網址與金鑰）；`POST /admin/rundown/ping` → `{title, sheets}`。
  - 錯誤：未設定 503 `rundown_off`；Apps Script 非 JSON 或 `ok:false` → 502 `rundown_failed`（附 Apps Script 的 error，截 200 字）。
- [ ] **Step 1: 寫失敗測試**：page `'gkk'` → 400；text 含換行 → 400；11 筆 → 400；轉送內容含 token 且 entries 原樣；RUNDOWN_URL 不是 script.google.com → 503；ping 只給管理憑證；`/admin/rundown` 回應不含網址字串。
- [ ] **Step 2–4: FAIL → 實作 → PASS**
- [ ] **Step 5: Commit** `feat(rundown): 後端轉送 Rundown Apps Script`

### Task 6: 管理頁（網站 `admin/` 與後端 `/admin`）

**Files:**
- Modify: `admin/index.html`、`admin/admin.js`、`admin/admin.css`、`server/core/admin-page.js`
- Test: `test/e2e/admin.e2e.js`（新增案例）

**Interfaces:**
- Consumes: `GET /admin/fb/status`、`GET|POST /admin/fb/pages`、`POST /admin/fb/refresh`、`GET /admin/rundown`、`POST /admin/rundown/ping`。
- Produces: 網站管理頁新分類「臉書發文」（卡片：臉書連線［狀態、到期日或「不明」、缺少權限、「重新讀取粉專」］、粉專設定［表格：序號、臉書名稱、簡稱、UTM、RD 區段下拉（不寫入／主粉／娛樂粉／少康粉／國際＋粉）、顯示勾選、上移／下移；「儲存」整份送出］）、「Rundown」（是否已設定、「測試連線」結果顯示試算表名稱與分頁）。分類切換用既有的 `hidden` 方式。後端 `/admin` 頁加同樣兩張卡（可較陽春，但功能相同）。
- [ ] **Step 1: 寫失敗 e2e**：登入後切「臉書發文」→ 看到狀態與粉專表；改簡稱與 RD 後儲存 → 送出的 body 含新值；按「測試連線」顯示試算表名稱；390px 寬沒有橫向捲動。
- [ ] **Step 2–4: FAIL → 實作 → PASS（`node --test test/e2e/admin.e2e.js`）**
- [ ] **Step 5: Commit** `feat(admin): 臉書連線、粉專設定與 Rundown 連線`

### Task 7: `fbpost` 工具測試畫面（只給管理員）

**Files:**
- Modify: `tools/fbpost/index.html`、`tools/fbpost/tool.json`（`desc` 改「測試中，僅管理員可用」；tier 維持 public、api 維持 null）
- Create: `tools/fbpost/app.js`、`tools/fbpost/fbpost.css`、`tools/fbpost/TOOL.md`
- Modify: `test/e2e/fbpost.e2e.js`（改寫）
- 跑 `node build.js`

**Interfaces:**
- Consumes: `tb.api.call('/auth/status')`（`data.admin`）、`/fb/pages`、`/fb/post`、`/fb/scheduled`、`/fb/published`、`/fb/posts/:id/{reschedule,cancel,delete}`。
- Produces（畫面，全部用 `hidden` 切換）：
  - 非管理員或 `/auth/status` 失敗 → 只顯示現有「排程發布 功能停用」區塊（文字不變），不呼叫 `/fb/*`。
  - 管理員 → 分頁「新增發文／已排程／已發佈」，頂部標示「測試模式（僅管理員）」。
  - 新增發文：選圖（顯示預覽）、貼文內容 textarea、文章網址（留言用）、粉專列表（勾選＋序號＋簡稱＋立即／排程＋`datetime-local`，預設現在＋30 分鐘，`min`／`max` 依 10 分鐘～30 天）、「全部送出（N 個粉專）」；送出後每個粉專一列結果（成功／失敗＋原因、留言狀態）。
  - 已排程／已發佈：選粉專＋「刷新」才查；每列縮圖（`picture`）、內文前 60 字、時間、留言狀態；已排程有「改時間」（`datetime-local`＋確認）、「取消」；已發佈有「刪除」與「開啟」連結；取消／刪除前確認。
- [ ] **Step 1: 改寫 e2e（以 `page.route` 模擬後端）**：非管理員 → 只顯示停用且沒有 `/fb/` 呼叫；管理員 → 看到三個分頁；勾兩個粉專、一個排程 → `/fb/post` 的 `targets` 正確（排程者 `at` 為秒）；結果列顯示；已排程列表有 `img[src]` 縮圖；改時間送出 `at`；取消先跳確認；390px 無橫向捲動。
- [ ] **Step 2–4: FAIL → 實作 → PASS（`node --test test/e2e/fbpost.e2e.js`）**；`node build.js`、`node build.js --check`
- [ ] **Step 5: Commit** `feat(fbpost): 管理員測試用發文與管理畫面`

### Task 8: 文件與整合驗證

**Files:**
- Modify: `docs/deploy.md`（Secrets `FB_USER_TOKEN`／`RUNDOWN_URL`／`RUNDOWN_TOKEN`；`wrangler.toml` 加 DO 綁定與 migration v3，**公司電腦既有 v1、v2 保留**；`schema.sql` 重跑建 `fb_pages`）、`README.md`、`docs/superpowers/specs/2026-11-05-toolbox-design.md`（工具表與路由表）、`docs/handoff/2026-11-16-fbpost-rebuild.md`（狀態與給使用者的實測清單）
- [ ] **Step 1: 全部驗證**：`npm test`、`npm run e2e`、`node build.js --check` 全過
- [ ] **Step 2: 截圖（scratchpad）**：工具測試畫面（桌機、手機）、管理頁臉書發文分類
- [ ] **Step 3: 獨立審查**（另派代理，只改有問題處）
- [ ] **Step 4: Commit＋推開發分支**；回報使用者並附「第一段實測清單」：設 Secrets 部署 → 管理頁看到粉專並設定 → 工具對測試粉專：立即有圖、排程有圖（看臉書後台「已排定」與工具「已排程」是否都有圖片預覽）、改時間、取消、刪除、發布後第一則留言＋UTM、Rundown 測試連線。
