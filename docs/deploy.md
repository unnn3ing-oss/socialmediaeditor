# 後端部署說明（toolbox-api）

這份說明帶你把「小編工具箱」的後端放到 Cloudflare。全部照順序做，每一步都有「看到什麼代表成功」。
做完大約 30 分鐘。**只需要做一次**，以後換素材在管理頁操作就好，不用再部署。

> 後端用到你現有的 Cloudflare 帳號。舊的 `snn-images` 不會被動到。

## 事前準備

| 需要什麼 | 怎麼確認 |
|---|---|
| 電腦裝了 Node.js 22 以上 | 開終端機輸入 `node -v`，看到 `v22.` 開頭的數字 |
| 有這個專案的資料夾 | 終端機進到專案資料夾，裡面看得到 `server/` |
| 一個 Cloudflare 帳號 | 能登入 https://dash.cloudflare.com |

**成功的樣子：** `node -v` 印出 `v22.x.x` 或更新的版本。

以下所有指令，**都在專案裡的 `server` 資料夾**執行：

```
cd server
```

第一次用要先登入 Cloudflare：

```
npx wrangler login
```

瀏覽器會跳出授權頁，按「Allow」。

**成功的樣子：** 終端機印出 `Successfully logged in.`

---

## 步驟 1：建立資料庫、檔案空間、快取

三個都在終端機建立，依序執行：

```
npx wrangler d1 create toolbox
npx wrangler r2 bucket create toolbox-files
npx wrangler kv namespace create toolbox-cache
```

**成功的樣子：**
- 第一個指令會印出一段設定，裡面有一行 `database_id = "xxxxxxxx-xxxx-..."`，把那串英數字複製起來。
- 第二個指令印出 `Created bucket 'toolbox-files'`。
- 第三個指令印出一段設定，裡面有一行 `id = "xxxxxxxx..."`，把那串英數字複製起來。

接著用文字編輯器打開 `server/wrangler.toml`，把兩個「填入你的 ID」換掉：

| 找到這一段 | 把「填入你的 ID」換成 |
|---|---|
| `[[d1_databases]]` 底下的 `database_id` | 第一個指令的 `database_id` |
| `[[kv_namespaces]]` 底下的 `id` | 第三個指令的 `id` |

**成功的樣子：** 存檔後，`wrangler.toml` 裡搜尋「填入你的 ID」找不到任何結果。

> 也可以在 Cloudflare 網頁後台建立（左側選單的 Storage & databases），名稱要一樣：D1 `toolbox`、R2 `toolbox-files`、KV `toolbox-cache`。ID 在各自的詳細頁。

---

## 步驟 2：建立資料表

```
npx wrangler d1 execute toolbox --remote --file schema.sql
```

**成功的樣子：** 印出 `Executed 3 queries`（或類似文字），沒有紅色錯誤。重複執行也沒關係，不會弄壞資料。

---

## 步驟 3：設定三組密碼（Secrets）

要設三個，每個指令執行後，終端機會請你貼上值，貼完按 Enter（貼上時畫面不會顯示字，這是正常的）。

| 名稱 | 用途 | 怎麼決定 |
|---|---|---|
| `COMPANY_PASSWORD` | 同事在工具箱「公司素材」輸入的密碼 | 自己決定，至少 8 個字 |
| `ADMIN_PASSWORD` | 管理頁的密碼，只有你知道 | 自己決定，**要和上面不同** |
| `SESSION_SECRET` | 簽發登入憑證用的金鑰，不用記 | 用下面的指令產生一組 |

先產生金鑰（Mac 或 Linux；Windows 請用 Git Bash）：

```
openssl rand -hex 32
```

**成功的樣子：** 印出一串 64 個字的英數字，複製它。

然後依序執行：

```
npx wrangler secret put COMPANY_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` 貼剛剛產生的那串。

如果出現「There doesn't seem to be a Worker called "toolbox-api". Do you want to create a new Worker...」，輸入 `y` 再按 Enter。

**成功的樣子：** 每個指令都印出 `Success! Uploaded secret ...`。

> 想讓所有人的公司登入立刻失效：重新執行 `npx wrangler secret put COMPANY_PASSWORD`（換密碼）或 `SESSION_SECRET`（換金鑰）。

---

## 步驟 4：部署

```
npx wrangler deploy
```

**成功的樣子：** 最後幾行印出 `Deployed toolbox-api triggers` 與一個網址，長得像
`https://toolbox-api.19jpz-3.workers.dev`。下面的步驟都用這個網址（以下簡稱「後端網址」）。

---

## 步驟 5：自我檢查

用瀏覽器打開：

```
後端網址/assets/manifest
```

**成功的樣子：** 畫面出現 `{"ok":true,"data":[]}`（還沒上傳素材，所以清單是空的）。

如果看到 `"code":"misconfigured"`：代表步驟 3 的 Secrets 沒設好，回去重做。
如果看到 `Error 1101` 或空白：回到步驟 4 確認部署有成功。

---

## 步驟 6：上傳公司素材

1. 用瀏覽器打開 `後端網址/admin`。
   **成功的樣子：** 看到「素材管理」和「管理登入」。
2. 輸入 `ADMIN_PASSWORD` 按「登入」。
   **成功的樣子：** 出現「上傳或替換素材」和「目前的素材」。密碼打錯會顯示「密碼不正確。」
3. 填「素材名稱」（小寫英文、數字、點、底線、減號，例如 `logo-white.png`），等級選 `company`，選檔案，按「上傳」。
   **成功的樣子：** 顯示「已上傳「logo-white.png」。」，下方清單多一列。
4. 要換 Logo 就用同一個名稱再上傳一次，或按那一列的「替換」。要移除就按「刪除」，再按「刪除這個素材」確認。

> 素材名稱要和各工具 `tool.json` 裡 `assets.<key>.company` 寫的代號一致。公司素材只放在這裡，**不要放進 GitHub**。

**成功的樣子（全部）：** 重新整理 `後端網址/assets/manifest`，沒登入時看不到 `company` 的素材，只看到 `public` 的。

---

## 步驟 6-2：連接臉書粉專（選做）

讓工具箱可以讀粉專貼文成效、發文和排程。token **只存在 Cloudflare**，不要貼到 GitHub、聊天或任何文件裡。

1. 準備 token。**用戶 token 或粉專 token 都可以**，推薦用戶 token：

   | 放哪一種 | 後端會怎麼做 | 新增粉專時 |
   |---|---|---|
   | **用戶 token**（推薦） | 自動找出你授權的所有粉專，換成各粉專的 token | 不用動，最多 10 分鐘後自動出現 |
   | 粉專 token | 直接用 | 要重設 `FB_TOKEN` |

   在「存取權杖偵錯工具」（https://developers.facebook.com/tools/debug/accesstoken/ ）確認：到期是「永不」，權限包含：

   | 權限 | 用途 |
   |---|---|
   | `pages_show_list` | 列出粉專 |
   | `pages_read_engagement` | 讀貼文、留言數、心情數 |
   | `read_insights` | 讀貼文成效 |
   | `pages_manage_posts` | 發文、排程 |

2. 在 `server` 資料夾執行，出現提示時貼上 token（**多組用逗號隔開，貼在同一行**，兩種可以混放）：

   ```
   npx wrangler secret put FB_TOKEN
   ```

   **成功的樣子：** 印出 `Success! Uploaded secret FB_TOKEN`。

3. （選填，建議）如果臉書 App 有開「要求 App 密鑰」，或想讓管理頁用 App 身分檢查 token，也設定這兩個（在 Meta 開發者後台 → 你的 App → 設定 → 基本資料）：

   ```
   npx wrangler secret put FB_APP_ID
   npx wrangler secret put FB_APP_SECRET
   ```

4. 重新部署：`npx wrangler deploy`
5. 打開 `後端網址/admin` 登入，按「臉書連線」的「檢查臉書連線」。

   **成功的樣子：** 每組 token 一列；用戶 token 那列的「粉專」會列出所有授權的粉專；狀態「有效」；「缺少的權限」是「—」；上方顯示「全部正常。」

> **用戶 token 的「資料存取到期」**：到期日寫「永不」，但臉書另有「資料存取權」期限（通常約 90 天）。管理頁「到期」欄會寫「資料存取到 某日」，快到時用同一個臉書帳號回 Graph API 工具重新產生一次 token、重設 `FB_TOKEN` 即可。
>
> **粉專屬於企業管理平台（Business Manager）時**：用戶 token 的「我的粉專清單」（`me/accounts`）可能是空的。後端會自動改從 token 的「授權範圍」讀出你授權的粉專，再一個個換成粉專 token，**不用另外設定**。管理頁若顯示「讀不到授權範圍」，照第 3 步設定 `FB_APP_ID`、`FB_APP_SECRET` 後重新部署、再檢查一次。
>
> 粉專名稱後面出現「無發文權限」或「無成效權限」：代表你的臉書帳號在那個粉專的角色不夠，請粉專管理員調整你的權限。

---

## 步驟 6-3：連接 Rundown（選做）

「排程發布」的「排入 Rundown」會把 `文章ID/圖文/SLUG`（純文字底圖選「無底色」或「臉書原生背景」時寫 `/文字/`）寫進 FB RUNDOWN 試算表。寫入由網新快速排程那份 Apps Script（`-schedulenewnet` 的 `gas/rundown.gs`）處理，基本連線沿用已部署的那一份。若要套用「稿件置中、時間碼藍色粗體」，請依[更新 Rundown 寫入格式](rundown-format.md)替換指定函式，並更新原 Apps Script 部署版本；只推網站不會改變儲存格格式。

1. 在 `server/` 資料夾執行，填入跟舊圖床 Worker 一樣的值：
   ```
   npx wrangler secret put RUNDOWN_URL
   ```
   貼上 Apps Script 網頁應用程式的 `/exec` 網址（`https://script.google.com/macros/s/…/exec`）。
   ```
   npx wrangler secret put RUNDOWN_TOKEN
   ```
   貼上 Apps Script 指令碼屬性 `TOKEN` 的值（至少 12 字）。
2. 重新部署：`npx wrangler deploy`
3. 打開排程發布 →「＋ 新增發文」→ Rundown 區塊的 ⚙ →「測試連線」。

   **成功的樣子：** 顯示「連線成功：FB RUNDOWN…（分頁 2026/11…）」。顯示「後端還沒設定 Rundown」＝第 1 步沒設好；顯示「沒有回 JSON」＝Apps Script 部署的「誰可以存取」要選「所有人」。

---

## 步驟 7：開啟網站（併入 main 之後才做）

這一步等程式併入 `main` 之後再做：

1. 到 GitHub 專案頁 → **Settings** → **Pages**。
2. **Source** 選 `Deploy from a branch`，Branch 選 `main`、資料夾 `/ (root)`，按 **Save**。
3. 等 1～2 分鐘，重新整理這頁。

**成功的樣子：** 頁面上方出現 `Your site is live at https://unnn3ing-oss.github.io/socialmediaeditor/`，點開看得到小編工具箱。

---

## 之後的日常

| 想做的事 | 怎麼做 |
|---|---|
| 換 Logo、版型 | `後端網址/admin` 上傳同名檔案 |
| 看有沒有人回報錯誤 | 登入 `後端網址/admin`，按「錯誤日誌」的「查看最近 7 天」（日誌只保留 30 天，不含任何內容） |
| 更新後端程式 | 在 `server` 資料夾再執行一次 `npx wrangler deploy` |
| 臉書 token 換了、新增粉專 | 用戶 token：新粉專會自動出現，不用動。粉專 token：照步驟 6-2 第 2 步重設 `FB_TOKEN`、再部署。都可以到管理頁按「檢查臉書連線」確認 |
| 網站網址改了 | 修改 `wrangler.toml` 的 `ALLOWED_ORIGIN`，再部署一次 |

每天台灣時間 03:17 後端會自動清掉 30 天前的日誌，不用管。

## 出問題時

| 看到什麼 | 可能原因 | 怎麼辦 |
|---|---|---|
| 工具箱顯示公司素材載不到、瀏覽器主控台有 CORS 錯誤 | 網站網址和 `ALLOWED_ORIGIN` 不一致 | 檢查 `wrangler.toml` 的 `ALLOWED_ORIGIN`（不要結尾斜線），重新部署 |
| 輸入公司密碼一直失敗 | 密碼設錯，或 Secrets 沒設 | 重新執行步驟 3 對應的指令 |
| `/assets/manifest` 出現 `misconfigured` | `SESSION_SECRET` 少於 32 字，或密碼沒設 | 重新產生金鑰並重設 |
| 工具箱說「臉書 token 失效或過期」 | token 被撤銷，或擁有者改了密碼、拿掉權限 | 管理頁按「檢查臉書連線」看哪一組，重新產生 token 後照步驟 6-2 重設 |
| 工具箱說「臉書 token 缺少需要的權限」 | 產生 token 時沒勾到權限 | 管理頁看「缺少的權限」，重新產生 token 時勾上 |
| 步驟 2 說找不到資料庫 | `database_id` 填錯 | 回步驟 1 檢查 `wrangler.toml` |
