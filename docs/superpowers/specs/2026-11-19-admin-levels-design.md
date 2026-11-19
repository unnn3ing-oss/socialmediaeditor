# 管理頁權限分層＋管理頁改版 — 設計

## 一、目的
- 讓同事（管理者）處理日常設定（粉專、素材、名單…），**不用把管理員密碼給出去**。
- 權杖、App 密鑰這類敏感設定只留在系統管理者手上。
- 系統管理者／管理者登入首頁後直接進管理頁，不用再輸入密碼。
- 管理頁外觀改成和前台一致（`ui/tokens.css` 與前台元件）。

## 二、目標／非目標／反目標
- 目標：三層（系統管理者、管理者、普通）；**下層看不到也改不了上層的功能**；前端隱藏＋後端每條 `/admin/*` 擋。
- 非目標：員工編號加密碼、`adm:1` 撤銷機制（接受 12 小時；敏感卡片已改要密碼）、管理頁操作紀錄（現有 `fb_audit` 只記排程發布）、外掛改動。
- 反目標：任何讓管理者能把自己或別人升到管理者／擴大自己卡片的路徑；新增 `/admin/*` 路由忘了標權限就被開放。

## 三、已定案（使用者）
| # | 決定 |
|---|---|
| 1 | 系統管理者**只有管理員密碼**（`ADMIN_PASSWORD`）；管理者從授權名單指定員工 |
| 2 | 卡片預設分配如第四節；另有「層級權限」卡片讓系統管理者調整管理者、普通可用的卡片 |
| 3 | 只留網站版 `admin/`；後端 `GET /admin` 改 302 轉 `https://unnn3ing-oss.github.io/socialmediaeditor/admin/`，刪 `server/core/admin-page.js` |
| 4 | 進入方式＝做法 A：`/admin/*` 直接接受首頁的公司憑證（員工每次查名單與層級；`adm:1` 視為系統管理者）；管理頁自己的密碼登入保留為備用入口 |
| 5 | **敏感卡片要再輸入密碼（方案甲）**：`adm:1`（存在 localStorage）只算「系統管理者（未解鎖）」，可用全部日常卡片；⚠ 卡片（權杖組別、臉書連線、Webhook、權限組、層級權限、名單改層級）要在管理頁輸入管理員密碼拿到 `admin` 憑證（只放記憶體）才解鎖 |

### 考慮過的做法
- 進入方式 A（採用）：沿用首頁憑證，停用／降層級立即生效（`bearer()` 每次查名單）；代價是 `adm:1` 原本「不能進 /admin/*」的限制要拿掉。
- 進入方式 B（不採用）：按「管理頁」換短效管理憑證，層級寫在憑證內 → 降層級要等過期，與「下層不能碰上層」有落差。
- 管理頁兩份都保留（不採用）：工作量兩倍、每次改卡片改兩處。

## 四、卡片與預設權限
| 卡片 key | 名稱 | 路由 | 管理者預設 | 普通預設 |
|---|---|---|:-:|:-:|
| `access` | 排程發布 開放／關閉 | `/admin/fb/access` | ✓ | |
| `profiles` | 權杖組別 ⚠ | `/admin/fb/profiles*` | | |
| `fbconn` | 臉書連線（含 App 密鑰、重新讀取粉專）⚠ | `/admin/fb/status`、`/token`、`/app`、`/refresh` | | |
| `webhook` | Webhook ⚠ | `/admin/fb/webhook` | | |
| `usage` | 速率限制 | `/admin/fb/usage`、`/usage/refresh` | ✓ | |
| `pages` | 粉專設定 | `/admin/fb/pages` | ✓ | |
| `presets` | 活動留言 | `/admin/fb/presets` | ✓ | |
| `video` | 影片設定 | `/admin/fb/video-settings` | ✓ | |
| `staff` | 授權名單 | `/admin/staff*` | ✓（部分，見第六節） | |
| `groups` | 權限組 ⚠ | `/admin/staff-groups*` | | |
| `audit` | 操作紀錄 | `/admin/audit` | ✓ | |
| `rundown` | Rundown 連線 | `/admin/rundown`、`/rundown/ping` | ✓ | |
| `assets` | 素材 | `/admin/assets*` | ✓ | |
| `logs` | 錯誤日誌 | `/admin/logs` | ✓ | |
| `levels` | 層級權限（新） | `/admin/levels` | 🔒 永遠只有系統管理者 | 🔒 |

⚠＝勾給管理者／普通時跳紅字確認。

## 五、後端
### 5.1 身分（`server/core/adminperm.js`，新檔）
`adminWho(request, env)` 回 `{ role:'sys'|'mgr'|'user', cards:Set, staff? }` 或 null：
- `admin` 憑證（管理頁密碼登入，只放記憶體）→ `sys`，`unlocked:true`。
- `company` 憑證帶 `adm:1`（首頁管理員密碼登入，localStorage）→ `sys`，`unlocked:false`：cards＝全部**減去敏感卡片**（`profiles`、`fbconn`、`webhook`、`groups`、`levels`），名單改層級也擋。
- `company` 憑證帶 `uid` → `bearer()` 已查名單（停用／移除＝null）；`staff.level` 為 `mgr` 或 `user`，cards 依層級權限表。
- 公司密碼憑證（無 uid、無 adm）→ null（不能進管理頁）。
- 敏感卡片（`SENSITIVE`）只有 `unlocked` 的 sys 能用；就算層級權限表勾給管理者／普通，員工使用時仍可用（勾選時已紅字確認，那是系統管理者的決定）。
- 公司密碼憑證（無 uid、無 adm）明確回 null。

### 5.2 路由檢查（集中一處）
- `ROUTES`：`[正則, 卡片 key]` 陣列，對應第四節。
- `handleAdmin`：`/admin/login` 照舊；其餘先 `adminWho`，null → `unauthorized`；路徑找不到對應卡片 → **只有 sys 可過**（預設拒絕）；有對應但 cards 沒有 → 新錯誤碼 `forbidden`（403，「沒有這個功能的權限」）。
- 比對用完整正則（不做前綴），`staff-groups` 排在 `staff` 前；測試檢查所有已知 `/admin/*` 路由都有對應卡片。
- 非 sys 使用者帶 `?p=<組別>` 一律忽略、只用使用中組別（`pages`、`usage` 等）。
- 通過後照舊交給 `adminList／adminPut／adminDelete` 與 `adminExtras`；`who` 放在 request 旁（例如 `adminExtras` 第 4 參數）給 `staff.js` 做部分權限。
- 新路由：
  - `GET /admin/me` → `{ role, unlocked, cards:[...], name? }`（任何有至少一張卡片的人；沒有卡片的員工回 `forbidden`）。
  - `GET /admin/levels`、`POST /admin/levels` → 讀／存勾選表（只有 sys）。
- `GET /auth/status`：員工多回 `staff.level`，並回 `manage:true`（sys 或至少一張卡片），首頁用來顯示「管理頁」按鈕。

### 5.3 資料
- `staff` 加欄位 `level TEXT NOT NULL DEFAULT 'user'`（`'user'`／`'mgr'`），沿用 `ensureStaff` 的「讀不到就 ALTER、失敗吞掉」做法。`findStaff`、`listStaff`、`getProfile` 帶出 level。
- 既有員工一律 `user`，由系統管理者手動升管理者（不因在「管理」權限組自動升）。
- 勾選表存 D1 `fb_settings` k=`admin_levels`，值 `{ mgr:[keys], user:[keys] }`；讀不到或壞掉＝預設（第四節）。存檔時：只收已知 key、去掉 `levels`、**普通勾的自動併入管理者**（普通 ⊆ 管理者，下層不會比上層多）。讀取時同樣防呆：拿掉 `levels`、普通＝普通 ∩ 管理者。

## 六、授權名單的部分權限（`staff.js`）
規則（對有 `staff` 卡片的非 sys 使用者）：
- 只能新增、修改（姓名、分機、權限組）、停用、移除**層級低於自己**的人（管理者只能動普通；普通拿到 `staff` 卡片也只能看）；員工編號不能改。
- 不能改自己那一列（後端依憑證 uid 比對；自己的分機照舊走 `/staff/me`），也不能動同層級的人。
- 新增時層級一律 `user`；編號已存在就拒絕；請求帶 `level` 一律拒絕（只有已解鎖的 sys 能改層級）。
- 換權限組：新組與原組的權限都必須是自己權限組的子集（不能把人升高，也不能動比自己高的組的人）；自己沒有權限組＝不能指派任何組——**設計者的判斷**。
- 看得到全部名單；高於或等於自己的列唯讀。
- sys 不受以上限制，並可改每個人的層級。

## 七、前端
### 7.1 首頁（外殼）
- `/auth/status` 回 `manage:true` 時，頁首（電腦版使用者狀態旁；≤820px 收進「工具」面板）出現「管理頁」按鈕，連到 `admin/`（新分頁或同頁由實作決定，建議同頁）。
- 測試後端（`tbx.api=dev`）時連到同一個 `admin/`，由管理頁依 `tbx.api` 選後端（現況已有）。

### 7.2 管理頁 `admin/`
- 管理頁不續期憑證（首頁負責），收到 `unauthorized` 就顯示登入框；只照首頁的 `tbx.api` 選後端，不另提供切換。
- 用 `adm:1` 進來時，⚠ 卡片顯示「輸入管理員密碼解鎖」（同一個密碼框），解鎖後憑證只放記憶體，重新整理要再解鎖。
- 開頁：讀 `localStorage` 對應的公司憑證（`sdk/api.js` 的 `companyKey`）→ `GET /admin/me`；成功就直接進、只顯示 cards 有的卡片，分類全空就隱藏該分類；失敗（沒憑證／過期／沒權限）顯示原本的密碼登入框，旁邊提示「或回首頁用員工編號登入」。
- 密碼登入成功＝sys，token 照舊只放記憶體。
- 用首頁憑證時「登出」只離開管理頁（不清首頁登入）。
- 新卡片「層級權限」（分類放「授權名單」）：表格 卡片｜管理者｜普通，⚠ 卡片勾選時確認、`levels` 列鎖定；「還原預設」「儲存」。
- 授權名單表格：sys 多一欄「層級」下拉；非 sys 不顯示層級欄、唯讀列的按鈕停用。
- 任何 API 回 `forbidden` → 該卡片顯示「沒有權限」並重新 `GET /admin/me` 刷新可見卡片。

### 7.3 改版外觀
- 改用 `ui/tokens.css` 與前台元件（按鈕、輸入框、切換鈕、卡片圓角 18、控制項 12、主色 `#155eef`），頁首比照前台 64px。
- 分類結構不變（臉書發文／授權名單／Rundown／素材／錯誤日誌），電腦左側選單、手機上方分頁。
- **動外觀前先截圖給使用者確認**（電腦＋手機各一張）。

## 八、後端 `/admin` 轉址
- `GET /admin` → 302 到網站版；`admin-page.js` 刪除。測試後端同樣轉到網站版（網站版自己切 dev）。
- README、`docs/deploy.md` 的管理頁網址只寫網站版。

## 九、測試
- 單元：`adminWho` 各憑證（`adm:1` 擋敏感卡片、`admin` 憑證全開、公司密碼憑證拒絕）、路由對應（含「未對應路徑只給 sys」）、層級表存讀（普通⊆管理者、拒絕 `levels`）、名單部分權限（管理者動管理者／自己／帶 level／指派超出子集的組皆拒）、`/auth/status` 的 `manage`。
- e2e：首頁按鈕出現條件、管理頁用首頁憑證直接進且只看到應有卡片、密碼登入看到全部、層級權限卡片勾選與確認、`/admin` 轉址。

## 十、留給實作者
- 「管理頁」按鈕的確切位置與樣式（依前台現有頁首元件）。
- `forbidden` 錯誤碼的訊息文字。
- 改版各元件的細節（截圖經使用者確認後）。

## 十一、部署
- **後端需重新部署（正式＋測試）**，不用手動 SQL（自動補欄位）。外掛不改、不升版。
