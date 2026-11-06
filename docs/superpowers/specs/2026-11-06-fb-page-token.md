# FB 粉專權杖取得與續期（定案方案 B，交接待實作）

> 狀態：**定案方案 B**（2026-11-06）：主管沒有方案 A 所需的企業管理平台管理員權限。使用者要先做 B，尚未實作，歸屬 P2「外掛＋發文工具」（主規格 §9）。
> 權杖、App Secret、粉專 ID 一律不進 repo（repo 公開），只存在後端 Secrets／KV。

## 1. 現況（2026-11-06 實測）

| 項目 | 結果 |
|---|---|
| 權杖類型 | 一般使用者權杖（`type: USER`，來源 Graph API Explorer） |
| `expires_at` | `0`：權杖本身不因時間過期 |
| `data_access_expires_at` | 約 **2027-02-03**（發出後約 90 天）：資料存取權到期日 |
| 權限 | `pages_show_list`、`pages_read_engagement`、`pages_read_user_content`、`pages_manage_posts`、`pages_manage_engagement`、`read_insights` |
| 授權粉專 | 6 個（`granular_scopes.target_ids`） |
| `GET /me/accounts` | 回 `{"data":[]}` |

- **推論**：粉專屬於企業管理平台，權杖缺 `business_management`，所以 `/me/accounts` 列不出清單。
- **繞過**：直接用粉專 ID 查詢。

```bash
curl -sG "https://graph.facebook.com/<粉專ID>" -d "fields=id,name,access_token" -d "access_token=$USER_TOKEN"
```

## 2. 限制（已知事實）

- 資料存取權只能由**真人重新走一次 Facebook 登入授權**來續期；後端單純呼叫 API 不會延長。
- 因此「後端全自動重新授權」做不到。

## 3. 方案比較

| 方案 | 做法 | 優點 | 缺點 |
|---|---|---|---|
| **A. 系統使用者權杖** | 企業管理平台建系統使用者 → 指派 6 個粉專 → 產生權杖 → 存後端 Secret | 完全免維護，沒有資料存取期限 | 需要粉專所屬企業管理平台的**管理員權限**（可能要公司管理員協助） |
| **B. 半自動續期** | 後端 cron 每日檢查 `debug_token`；剩 14 天時提醒，附「重新授權」連結 → Facebook 登入 → 回呼頁換長效權杖 → 依粉專 ID 換粉專權杖 → 存 KV | 不需管理員權限 | 每約 90 天點一次；要做 OAuth 回呼與排程 |
| C. 純手動 | 行事曆提醒，自己去 Explorer 重拿並貼到後端 | 零開發 | 容易忘，忘了就中斷 |

**決定**：方案 B。原因：主管沒有企業管理平台管理員權限，A 暫時做不到；日後若取得權限，可再改走 A。

## 4. 方案 B 草案（實作前會先列計畫給使用者確認）

- 後端模組 `fbtoken`（`toolbox-api`）：
  - `GET /fb/auth/start`：導向 Facebook 登入（管理密碼保護）。
  - `GET /fb/auth/callback`：code → 使用者權杖 → 長效 → 依粉專 ID 換粉專權杖 → 存 KV。
  - cron（沿用每日排程）：`debug_token` 檢查 `data_access_expires_at`，剩 14 天以內發提醒。
- 必要 Secrets：`FB_APP_ID`、`FB_APP_SECRET`；粉專 ID 清單放 KV 或 Secret。
- 提醒管道：待定（Email／LINE／外掛通知）。

## 5. 待確認

| # | 問題 | 狀態 |
|---|---|---|
| 1 | 使用者在粉專所屬企業管理平台是否為管理員（決定 A 或 B） | ✅ 主管無此權限，定案 B |
| 2 | 資料存取權到期後，粉專權杖的「發文」是否一起失效 | 推論：當作會失效設計；實作時實測 |
| 3 | 方案 B 的提醒管道 | 待定 |
| 4 | 現有權杖在 2027-02-03 前要重新授權（若未完成 A 或 B） | 行事曆提醒 2027/1 底 |

## 6. 交接給實作對話

> 本節給接手實作的對話：照 `CLAUDE.md` 流程，**先列計畫（改哪些檔、畫面）給使用者確認，說「開始」才實作**。

### 6.1 現有後端掛點（已查，2026-11-06 的 main）

| 位置 | 用途 |
|---|---|
| `server/index.js` 的 `scheduled()` | 每日 cron（`server/wrangler.toml`：`17 19 * * *`），續期檢查掛這裡 |
| `server/core/admin.js` | 管理密碼登入（`ADMIN_PASSWORD`）、`adminExtras` 可加管理頁項目；授權入口用管理密碼保護 |
| `server/wrangler.toml` | 已有 `DB`（D1）、`FILES`（R2）、`CACHE`（KV） |
| `tools/<id>/api.js` | 工具專屬路由，`build.js` 掛到 `/t/<id>/`（主規格 §6） |

### 6.2 實作前要決定

| # | 問題 | 選項 |
|---|---|---|
| 1 | 模組放哪 | 核心 `server/core/fbtoken.js`（多個工具共用權杖）／工具路由 `tools/<id>/api.js`（只給發文工具用） |
| 2 | 權杖存哪 | KV `CACHE`（簡單）／D1（可留更換紀錄） |
| 3 | 提醒管道 | Email／LINE／外掛通知／管理頁顯示到期日 |
| 4 | 粉專 ID 清單 | Secret／KV／管理頁可編輯 |

### 6.3 使用者要在 Meta／Cloudflare 做的事

1. Meta App（`DEV-TOOL`）加入「Facebook 登入」產品，把後端回呼網址填進「有效的 OAuth 重新導向 URI」。
2. Cloudflare Worker 設 Secrets：`FB_APP_ID`、`FB_APP_SECRET`。
3. 授權時勾選 6 個粉專與目前同一組權限（§1）；可考慮加 `business_management`，讓 `/me/accounts` 列得出清單。

### 6.4 測試注意

- 沙盒連不到 Graph API：單元測試用假 `fetch` 模擬 Graph 回應（`debug_token`、`oauth/access_token`、`/<粉專ID>?fields=access_token`）。
- 實際授權流程由使用者部署後實測，並驗證 §5 第 2 項（資料存取到期後發文是否失效）。
