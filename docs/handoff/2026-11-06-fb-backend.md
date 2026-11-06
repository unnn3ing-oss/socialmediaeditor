# 臉書粉專後端（toolbox-api 的 fb 模組）
- 狀態：進行中　- 分支：`claude/fb-backend`（從 main `a3c571e` 開出）　- 最後更新：2026-11-06
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

## 下一步
- [x] 改 `http.js`、`index.js`，跑 `npm test` 確認既有測試沒壞
- [x] 寫 `test/server/fb.test.js`，全綠（15 項；全部 211 項通過）
- [x] 管理頁卡片、`wrangler.toml`、`deploy.md`（步驟 6-2）、規格 §6
- [ ] 派獨立代理審查（CLAUDE.md 省 token 規則第 9 條），重點：token 外洩、白名單繞過
- [ ] 給使用者看測試結果；說「推」才併入 main，同時更新 CLAUDE.md「目前進度」
- [ ] 使用者部署後實測：管理頁看 token 狀態 → `/fb/pages` → 發一篇排程貼文再到粉專後台刪掉

## 測試
`npm test`（含 `test/server/*.test.js`）、`node build.js --check`。這版沒動外掛和網頁，不用跑 e2e、不升外掛版號。

## 注意事項／不能做的事
- token 不能出現在：repo、對話、回應本文、錯誤訊息、日誌、KV。
- 這版**只做後端**，沒有網頁介面；之後要做介面，就用 `tb.api.call('/fb/…')`。
- 外掛和網頁沒動 → 不升版號、不改 `extension/changelog.json`。

## 延後的 P2（使用者尚未回覆 4 個決定）
P2a 網新排程、P2b YT 下載。先做共用掛點：build.js 支援 ext 資料夾、外掛推播通道 `tb.ext.on`、`tb.status.set`。待決定事項：
1. 拆兩個對話（推薦）
2. 圖床改用公司憑證（推薦）
3. 送出紀錄保留 localStorage（推薦）
4. YT 佇列整套搬進新外掛（推薦）

來源 repo（公開，可 `git clone --depth 1`）：`unnn3ing-oss/-schedulenewnet`（web/、extension/background.js、worker/index.js）、`unnn3ing-oss/videodownload`（web/、extension/lib/、host/installer.py 的 `allowed_origins`）。
