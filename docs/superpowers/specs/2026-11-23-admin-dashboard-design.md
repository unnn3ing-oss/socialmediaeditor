# 管理頁首頁儀表板 — 設計

日期：2026-11-23　狀態：待使用者確認

## 目的
管理頁（`admin/`）一打開就知道兩件事：**有沒有東西壞了**、**有沒有東西快過期／已過期**，需要人處理。現在要逐一點進 7 個分類才看得到。

## 目標／非目標／反目標
- 目標：新增分類「首頁」（排第一、沒有 hash 時預設），一頁顯示各項狀態與「需要處理」清單；進頁查一次，手動「重新整理」。
- 非目標：不能在首頁改任何設定（只顯示狀態，點了跳到對應分類）；不自動輪詢；首頁查詢**不呼叫臉書**。
- 反目標：前端拿到使用者看不到的項目或細節（權杖、名單、原因全文以外的資料）；為了首頁大量增加 D1 讀寫或 Worker 請求。

## 做法（使用者選 A＋暫存，5 分鐘）
| 方案 | 內容 | 結果 |
|---|---|---|
| A＋暫存（**選定**） | 新 API `GET /admin/dash`：後端呼叫現有函式讀全部項目，完整結果存 Worker 記憶體 5 分鐘全站共用，依使用者權限篩選後只回傳狀態 | 選定 |
| B 前端打現有各 API | 不改後端 | 不採用：資料會進瀏覽器、敏感卡片未解鎖被擋、7～8 個請求 |
| C 定時任務預先算好 | cron 寫 D1 | 不採用：不是打開才查、增加 D1 寫入 |

## 項目（key → 狀態來源，皆不呼叫臉書）
| key | 名稱 | 來源（沿用現有函式） | 等級規則 | 點了跳到 |
|---|---|---|---|---|
| `access` | 排程發布 | `fb/access.js` `accessState` | 開放＝ok；關閉＝info（附原因前 30 字） | 進階設定 |
| `profile` | 使用中權杖組別 | `tokenstore.js` `readProfiles` | 只顯示名稱＝info | 進階設定 |
| `fbtoken` | 臉書權杖 | `pages.js` `quickWarn` | null＝ok；warn／bad 照 `tokenWarn`（14 天內黃、到期／失效紅） | 進階設定 |
| `webhook` | Webhook | `webhook.js` `webhookState` 用到的資料（有無 App 密鑰、最後收到時間） | 有密鑰＝ok（附「N 小時前收到」或「未收到」）；沒密鑰＝info（留言管理目前關閉，不算壞） | 進階設定 |
| `groups` | 權限組 | D1 `staff_groups`、`staff` 計數 | info：「N 組、名單 M 人（停用 K）」 | 進階設定 |
| `logs` | 未處理錯誤 | D1 `logs` state=`open` 計數 | 0＝ok；>0＝bad「N 則未處理」 | 使用紀錄→錯誤紀錄 |
| `rundown` | Rundown 連線 | `rundown.js` `rundownState` | ok＝ok；其他＝bad（附細分原因文字） | 連接狀態 |
| `usage` | 速率用量 | `usage.js` `readUsage` | 最高 % ≥75 黃、≥90 或 10 分鐘內被限流紅，其餘 ok（附最高 %） | 連接狀態 |
| `online` | 目前在線 | D1 `staff.last_seen` 5 分鐘內計數 | info：「N 人」（不列姓名） | 人員與權限 |
| `bg` | 文字背景圖樣 | D1 `fb_backgrounds`：圖樣類型、**還沒下載**、`urlExpiry` | 有已過期＝bad、1 天內到期＝warn、其餘 ok | 發文設定 |

- 每項回傳 `{ key, name, level: 'ok'|'info'|'warn'|'bad', text, tab }`，`text` ≤ 60 字，不含 ID、權杖、姓名。
- 單一項目讀取失敗不影響其他項：該項回 `level:'warn'`、`text:'讀取失敗'`。

## 權限（兩層，取交集）
1. **全站開關**（進階設定新卡片「儀表板顯示項目」，card key `dashcfg`，`sensitive`，只有已解鎖系統管理者）：每項一個勾選，存 D1 `fb_settings` k=`dash`（`{"items":[...]}`）；沒存過＝全部開。`GET`／`POST /admin/dash/config`。
2. **權限組**：`staff.js` 新權限 `dash:<key>`（10 個），`PERM_SECTIONS` 新增「管理頁：首頁儀表板」一區。預設權限組「管理」補全部 `dash:*`；「發文」「檢視」不給。**舊資料**：已存在的「管理」組（名稱相同）第一次讀時補上，其他組不動（照 `migratePerms` 方式，加旗標 `fb_settings` k=`perms_v3` 只跑一次）。
- 系統管理者（不論解鎖與否）＝全站開關開著的全部項目。
- 員工＝全站開關 ∩ 自己權限組的 `dash:*`。
- 看得到「首頁」分類的條件：系統管理者，或權限組至少有一個 `dash:*`。都沒有就不顯示首頁分類，預設分類維持原本第一個看得到的。
- `/admin/dash` 不走 `cardFor` 的單卡判斷，路由自己判斷（加進 `ROUTES` 時標特殊值 `dash`，`adminWho` 後在 handler 內篩選；沒權限回 `forbidden`）。`/admin/dash/config` 對應 `dashcfg`。
- `/admin/me` 多回 `dash: [可看的 key]`，前端據以決定是否顯示「首頁」。

## 暫存（5 分鐘）
- 新檔 `server/core/dash.js` 模組層變數 `{ at, items }`：5 分鐘內共用，**只在記憶體**（Cloudflare 每個執行個體各一份，不同執行個體可能各讀一次；不寫 D1／KV）。
- `GET /admin/dash?fresh=1`（「重新整理」）：略過暫存重讀並更新暫存；同一使用者 10 秒內再按回上一份（不報錯，回應帶 `at`）。
- 存 `/admin/dash/config`、`/admin/fb/access`、權杖組別切換等**同執行個體**的寫入不主動清暫存（最多 5 分鐘後更新，按重新整理立即）。← 實作者決定是否順手呼叫 `forget`。
- 回應 `Cache-Control: no-store`，帶 `at`（資料讀取時間），前端顯示「資料時間 HH:MM」。

## 畫面（`admin/` 新分類「首頁」，panel id `panel-home`、tab `home`）
```
首頁                                資料時間 14:32  [重新整理]
┌ 需要處理 ───────────────────────────────────┐
│ ● 未處理錯誤：2 則未處理              › 使用紀錄 │
│ ● 臉書權杖：9 天後到期                › 進階設定 │
└─────────────────────────────────────────────┘
（全部正常時：「目前沒有需要處理的項目」綠字）
[排程發布 開放] [權杖組別 主管權杖] [臉書權杖 正常] [Webhook 3 小時前]
[權限組 3 組、12 人] [Rundown 已設定] [速率 最高 12%] [目前在線 3 人] [文字背景 正常]
```
- 「需要處理」＝level bad（紅點）在前、warn（黃點）在後。
- 下方小卡格線：電腦 4 欄、≤820px 2 欄、≤420px 1 欄；每張卡＝名稱＋色點＋text，可點（跳 tab；跳到進階設定時照原流程要解鎖）。
- 載入中用 `ui/tokens.css` `.sk` 骨架；讀取失敗顯示錯誤列＋重新整理。
- 沒有 hash 進管理頁時預設「首頁」（有權限時）；舊 hash 照舊。
- 樣式沿用 `admin/admin.css` 既有 card／token，不新增顏色。

## 影響檔案
- 後端：新 `server/core/dash.js`；`server/core/adminperm.js`（ROUTES、`meInfo` 加 dash）；`server/core/levels.js`（新卡片 `dashcfg` sensitive）；`server/core/staff.js`（`dash:*` 權限、PERM_SECTIONS、預設組、一次性補權限）；路由掛點（`server/core/admin.js` 或 `index.js` 現有 admin 分派處）。
- 前端：`admin/index.html`（tab＋panel-home＋進階設定卡片）、`admin/admin.js`（載入、渲染、設定卡片、權限組勾選區自動跟 PERM_SECTIONS）、`admin/admin.css`。
- 測試：`test/` 單元（等級規則、權限交集、暫存 5 分鐘與 fresh 10 秒、未授權 403、回應不含敏感欄位）；`test/e2e/admin*.e2e.js` 加首頁（系統管理者看全部、員工只看到被勾項目、點卡片切 tab）。
- 文件：隱私權政策不需改（不新增資料）；`docs/deploy.md` 不需改（無新 Secret、無手動 SQL）。

## 部署
後端需重新部署（正式＋測試），不用手動 SQL，外掛不改、不升版。

## 審查後補充（實作者問題的答案；★＝Claude 的決定，使用者可改）
- **現有函式已查證**：`accessState`、`readProfiles`、`quickWarn`、`rundownState`、`readUsage`、`urlExpiry` 皆已 export；`webhookState(request, env)` 是給管理頁的 handler 形式，需要時抽出不讀 request 的內部函式（只抽、不改行為）。`logs.state='open'`、`staff.last_seen` 欄位存在。
- ★ `fbtoken` 只看**使用中組別**（與工具頁 `#tokWarn` 相同，用 `quickWarn`），不逐組檢查。
- 未解鎖的系統管理者也看得到敏感項目的**狀態**：使用者明確選擇（方案 A：看狀態不用解鎖）。`/admin/dash` 不走敏感卡片的解鎖檢查，只回狀態等級與短文字。
- 暫存一律存**完整結果**、每次請求再依權限篩選；`fresh=1` 更新該執行個體的共用暫存。10 秒限制＝該執行個體記憶體內、依使用者（系統管理者 admin 憑證以 `sys` 為 key），跨執行個體不保證。`at`＝完整結果的讀取時間。
- ★ 一次性補權限（`perms_v3`）：名稱為「管理」**或**權限組已有 `card:staff` 的組補全部 `dash:*`；其他組不動。都沒有時只有系統管理者看得到首頁，之後在權限組自己勾。
- ★ 舊 hash（含 `#adv`）行為不變；只有沒有 hash 時才預設首頁。

## 留給實作者
- 各項 text 的實際措辭（≤60 字、台灣口吻）。
- 小卡排列順序（預設照上表）。
