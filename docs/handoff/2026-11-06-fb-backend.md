# 臉書粉專後端（toolbox-api 的 fb 模組）
- 狀態：**已完成**（2026-11-06 併入 main）　- 分支：`claude/fb-backend`（從 main `a3c571e` 開出）　- 最後更新：2026-11-06
- 使用者原始需求：「目前我有拿到 Graph API token，可以幫我做一個我這工具的專屬連接臉書後台的後端」
- 使用者選擇：功能 **A（粉專清單＋貼文成效）＋ B（發文／排程到粉專）**；token 是**粉專長效 token**；**先做 fb 後端，P2 延後**。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 放哪 | **後端核心模組** `server/core/fb.js`，路由 `/fb/*`（不是 `tools/fb/`） | 之後網新排程、圖片套版都可能共用；做成工具會在櫥窗多出一個空工具。已告知使用者 |
| 權限 | `/fb/*` 要公司憑證（`bearer(request, env, 'company')`）；`/admin/fb` 要管理憑證 | 粉專是公司資產 |
| token | 只存在 Cloudflare Secret `FB_TOKEN`（可放多組，逗號／空白／換行分隔），**絕不進 repo、不進回應、不貼在對話** | repo 公開 |
| 白名單 | 網頁只能呼叫下面列的動作，不能指定任意 Graph 路徑 | 同網新排程外掛的端點白名單 |
| Graph 版本 | 預設 `v26.0`（2026-07-29 發布，查證於 2026-11-06），可用 `FB_GRAPH_VERSION` 變數覆蓋 | 固定版本，避免臉書改版悄悄出錯 |
| 成效指標 | `post_media_view`、`post_total_media_view_unique`、`post_clicks`、`post_reactions_by_type_total`；整批失敗（code 100）就逐一重問，回 `missing` | `post_impressions*` 已在 2025-11／2026-06 停用 |
| 排程範圍 | 10 分鐘後～30 天內（Unix 秒） | 保守取臉書限制 |
| 稽核 | 發文成功／失敗寫進 `logs`（tool=`fb`，code 例如 `post-published`、`post-failed-190`），不記內文 | 規格「日誌不含內容」 |
| 網新排程 | **放到最後再考慮**（2026-11-06 使用者指示）。若之後搬進來，**管理頁要保留「發文方式」模式切換**：Graph API 直發（本模組）／網新後台（舊流程，經外掛）| 兩條發文路線並存，由管理者切換 |
| appsecret_proof | 有設 `FB_APP_SECRET` 就自動帶 | 臉書建議；沒設也能跑 |

## 路由
| 路由 | 說明 | 回傳 data |
|---|---|---|
| `GET /fb/pages[?refresh=1]` | 各 token 對應的粉專（KV 快取 10 分，只存「第幾組 token」，不存 token） | `[{id,name,link,picture,followers}]` |
| `GET /fb/posts?page=&limit=&after=` | 已發布貼文＋分享／留言／心情數（快取 60 秒） | `{items:[{id,message,created,url,picture,type,shares,comments,reactions}], next}` |
| `GET /fb/scheduled?page=` | 已排程貼文 | `{items:[{id,message,created,picture,at}]}` |
| `GET /fb/insights?post=<粉專ID_貼文ID>` | 單篇成效（快取 10 分） | `{post, metrics:{…}, missing:[…]}` |
| `POST /fb/post` | JSON 或 multipart：`page`、`message`、`link`、`imageUrl`、`image`（檔案 ≤10MB，jpg/png/gif/webp）、`scheduledAt` | `{id, scheduled, at}` |
| `GET /admin/fb` | 每組 token：粉專、是否有效、類型、到期（0＝不會過期）、權限、缺少的權限 | `{configured, version, appSecret, needed, tokens:[…]}` |

錯誤代碼：`fb_not_configured`、`fb_token_invalid`、`fb_permission`、`fb_rate_limited`、`fb_bad_request`、`fb_error`、`fb_unreachable`、`fb_unknown_page`。

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/graph.js` | Graph 用戶端：`pageTokens`、`appsecretProof`、`scrub`（抹掉 token）、`classify`、`graphGet`、`graphPost`、`GraphError` | ✅ 完成，測試通過 |
| `server/core/fb.js` | `handleFb`、`adminFb`、`loadPages`、`checkPost`（純函式，可單測） | ✅ 完成，測試通過 |
| `server/core/http.js` | `MESSAGES`／`STATUS` 加上 fb 錯誤代碼（訊息見上；狀態碼：not_configured 503、token_invalid 502、permission 403、rate_limited 429、bad_request 400、error 502、unreachable 502、unknown_page 404） | ✅ |
| `server/index.js` | `modules` 加 `handleFb`；`adminExtras.push(adminFb)` | ✅ |
| `server/core/admin-page.js` | 加「臉書連線」卡片：按鈕呼叫 `/admin/fb`，表格列出每組 token 狀態，缺權限標紅 | ✅ |
| `server/wrangler.toml` | `[vars]` 加 `FB_GRAPH_VERSION = "v26.0"`；Secrets 註解加 `FB_TOKEN`、`FB_APP_ID`、`FB_APP_SECRET`（後兩個選填） | ✅ |
| `docs/deploy.md` | 新增「步驟：連接臉書粉專」：`npx wrangler secret put FB_TOKEN` → 部署 → 管理頁按「檢查臉書連線」 | ✅ |
| `test/server/fb.test.js` | 假 `globalThis.fetch` 模擬 Graph（參考 `test/server/fetch.test.js`）：沒憑證 401、沒設 token 503、粉專清單、未知粉專 404、發文（feed／photos／排程）參數正確、排程超出範圍 400、token 失效 → 清快取＋502、**回應與錯誤訊息都不含 token**、insights 逐一重問、admin 不含 token | ✅ |
| 規格 §6 表格 | 加一列 fb 模組 | ✅ |

## B 版：FB_TOKEN 支援用戶 token（2026-11-06 使用者確認「開始，做 B」）
背景：使用者拿到的是**用戶 token**（類型 User、永不過期、權限齊全），臉書規定發文／成效要用粉專 token。
| 項目 | 做法 | 狀態 |
|---|---|---|
| 判斷 token 類型 | `loadPages` 先打 `/me`（粉專欄位）；回 code 100（User 節點沒有這些欄位）就當用戶 token，改打 `/me/accounts`（含 `access_token`、`tasks`，最多翻 5 頁） | ✅ |
| 換出的粉專 token | **只放 Worker 記憶體**（`graph.js` 的 `remember()`，10 分鐘），**不寫 KV**；記憶體沒有就重打 `/me/accounts`；`scrub` 也會抹掉這些 token | ✅ |
| 重複粉專 | 同一粉專同時有直接粉專 token 和用戶 token 換出的，**優先用直接的** | ✅ |
| KV 快取 | 每個粉專記 `idx`（第幾組 token）＋`via: 'page'|'user'`＋`tasks`，不記 token | ✅ |
| 管理頁 | 每組 token 一列，「粉專」欄列出它能管的所有粉專；沒有 `CREATE_CONTENT` 的標「無發文權限」；用戶 token 顯示「資料存取到期」 | ✅ |
| 測試 | 用戶 token 換粉專、發文用換出的 token、KV／回應都不含任何 token、混放與重複 | ✅ |
| deploy.md 6-2 | 改成「貼用戶 token 或粉專 token 都可以」 | ✅ |

> B 版實作備註：快取鍵改為 `fb:pages:<FB_TOKEN 的 SHA-256 前 16 碼>`；`/me/accounts` 用 `after` 游標翻頁（不跟 `paging.next`，網址裡有 token）；`/me/accounts` 回空陣列是正常結果（管理頁顯示「沒有授權任何粉專」）；**這版不改 `server/wrangler.toml`**（使用者 Mac 上有填 ID 的未提交改動）。測試 24 項，全部 220 項通過。獨立審查（token 外洩、去重、快取鍵、管理頁 XSS）通過，無需修改。下一步：使用者 `git pull` → `secret put FB_TOKEN`（用戶 token）→ 部署 → 檢查臉書連線。

## 版本 1：粉專 ID 備援（2026-11-06 使用者確認「開始」）
背景（已知事實）：使用者的用戶 token 有效、權限齊全，但粉專屬企業管理平台、token 缺 `business_management`，`/me/accounts` 回空陣列 → 管理頁顯示「沒有授權任何粉專」。`debug_token` 的 `granular_scopes` 列得出 6 個粉專 ID。規格與版本 2 決定見 `docs/superpowers/specs/2026-11-06-fb-page-token.md`。
| 項目 | 做法 | 狀態 |
|---|---|---|
| 共用換 token 函式 `derivePages(env, userToken)` | `/me/accounts` ＋ `debug_token` 的 `granular_scopes` 粉專 ID（聯集）；後者逐一打 `/<id>?fields=…,access_token`；`scanTokens` 與 `tokenFor` 都用它 | ✅ |
| debug_token 身分 | 有 `FB_APP_ID`＋`FB_APP_SECRET` 用 App token，否則用 token 自己查 | ✅ |
| 權限標示 | 走 granular 路線時沒有 `tasks`；改用 `pages_manage_posts`／`read_insights` 的 `target_ids` 判斷能否發文／看成效 | ✅ |
| 讀不到授權範圍 | 管理頁顯示「讀不到授權範圍，請設定 FB_APP_ID／FB_APP_SECRET」，不只說「沒有授權任何粉專」 | ✅ |
| 安全 | 換出的 token 先 `rememberSecret` 再使用；KV／回應／日誌不含任何 token | ✅ |
| 測試、deploy.md | 假 `debug_token`（含 granular_scopes）、假 `/<id>`；發文用換出的 token | ✅ |
| 不動 | `wrangler.toml`、外掛、網站 | — |

> 版本 1 實作備註：`derivePages()` 回 `{ pages, hint, skipped }`；`tokenFor` 記憶體沒有時重跑 `derivePages`。單一粉專換不到 token（權限不足等）只略過並計入 `skipped`；token 失效、限流、連不上、臉書暫時錯誤（code 1／2、5xx）才算整組失敗（`isFatal`），會一直出現的錯誤（如 803）只略過該粉專。獨立審查通過（補了暫時錯誤不快取）。測試 33 項，全部 229 項。下一步：使用者 `git pull` → `npx wrangler deploy` → 管理頁檢查應看到 6 個粉專 → 實測排程一篇再刪掉 → 說「推」併入 main（同時更新 CLAUDE.md 目前進度，版本 2 列入待辦）。

## 下一步
- [x] 改 `http.js`、`index.js`，跑 `npm test` 確認既有測試沒壞
- [x] 寫 `test/server/fb.test.js`，全綠（15 項；全部 211 項通過）
- [x] 管理頁卡片、`wrangler.toml`、`deploy.md`（步驟 6-2）、規格 §6
- [x] 派獨立代理審查：token 外洩、白名單繞過、驗證都通過；修 1 項（`loadPages` 遇到限流或連不上時不寫快取，避免粉專消失 10 分鐘），測試 16 項
- [ ] 給使用者看測試結果；說「推」才併入 main，同時更新 CLAUDE.md「目前進度」
- [ ] 使用者部署後實測：管理頁看 token 狀態 → `/fb/pages` → 發一篇排程貼文再到粉專後台刪掉

## 測試
`npm test`（含 `test/server/*.test.js`）、`node build.js --check`。這版沒動外掛和網頁，不用跑 e2e、不升外掛版號。

## 注意事項／不能做的事
- token 不能出現在：repo、對話、回應本文、錯誤訊息、日誌、KV。
- 這版**只做後端**，沒有網頁介面；之後要做介面，就用 `tb.api.call('/fb/…')`。
- 外掛和網頁沒動 → 不升版號、不改 `extension/changelog.json`。

## 延後的 P2（使用者尚未回覆 4 個決定）
> **2026-11-06 使用者指示：網新排程最後再考慮。** 若搬進來，管理頁（`server/core/admin-page.js`）要加「發文方式」切換：`graph`（本 fb 模組直發）／`newsnet`（網新後台，經外掛）。設定值建議存 KV `fb:mode`，`GET /fb/mode` 讓工具讀取、`PUT /admin/fb/mode` 讓管理頁修改。這版**不做**，只記錄。

P2a 網新排程、P2b YT 下載。先做共用掛點：build.js 支援 ext 資料夾、外掛推播通道 `tb.ext.on`、`tb.status.set`。待決定事項：
1. 拆兩個對話（推薦）
2. 圖床改用公司憑證（推薦）
3. 送出紀錄保留 localStorage（推薦）
4. YT 佇列整套搬進新外掛（推薦）

來源 repo（公開，可 `git clone --depth 1`）：`unnn3ing-oss/-schedulenewnet`（web/、extension/background.js、worker/index.js）、`unnn3ing-oss/videodownload`（web/、extension/lib/、host/installer.py 的 `allowed_origins`）。
