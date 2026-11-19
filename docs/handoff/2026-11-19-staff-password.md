# 員工密碼登入＋帳號彈窗（拿掉公司密碼）
- 狀態：已完成（已併入 main）　- 分支：claude/gifted-archimedes-asueph　- 最後更新：2026-11-19
- 使用者原始需求：「將原有的『公司密碼』功能關閉，只留下員工編號，且將系統管理員預設為我本人員工編號為 13082605。」＋「所有使用者都有獨立可自行設定的密碼，管理頁增加使用者後首次登入時自行設定密碼，管理頁可替使用者重置密碼」＋「主頁右上登入區變為『公司模式 名字』，點擊後 popup 有名字、員工編號、分機、解鎖有效時間、預留通知、登出」＋「只要一個登入區，自動判讀初次登入或已設密碼」＋「管理頁收進有權限者的彈窗」＋「用瀏覽器記住員工編號」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 公司密碼 | 首頁與後端都拿掉（`COMPANY_PASSWORD` 不再使用）；首頁管理員密碼入口一起拿掉（①A） | 使用者選 |
| 系統管理者 | 後端設定 `SYS_STAFF_ID`（②A，不寫進 repo）；名單沒有就自動建立；不能停用／刪除／降級；權限等同舊 `adm:1`（未解鎖），敏感卡片仍要管理頁輸入管理員密碼 | 使用者選 |
| 密碼 | 每人自己的密碼，PBKDF2-SHA256 加鹽，至少 8 字；連錯 5 次鎖 15 分鐘；改／重置密碼後舊憑證失效 | ②照預設 |
| 第一次設定 | 一次性 6 碼設定碼（新增或重置時管理頁顯示一次，24 小時有效）（①B）；系統管理者本人可用管理員密碼代替設定碼 | 防搶設 |
| 登入 | 單一登入區：員工編號 → 下一步 → 後端回已設密碼（輸入密碼）或需設定（設定碼＋新密碼×2）；localStorage 記住上次員工編號，有記住就直接到密碼步驟 | 使用者選 |
| 帳號彈窗 | 右上「● 公司模式 名字」，彈窗：姓名＋層級、員工編號、分機、解鎖有效、通知（預留空白）、管理頁（有卡片才顯示）、變更密碼、登出、切到測試後端（只有系統管理者） | 使用者確認草稿 |
| 外掛 | 側邊欄提示文字改字，升 3.12 | 版號規則 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/password.js`（新） | PBKDF2 雜湊、6 碼設定碼 HMAC、常數（8 字、5 次、15 分、24 小時） | ✅ |
| `server/core/staff.js` | 補欄位 pw_hash／pw_salt／pw_ver（預設 1）／setup_hash／setup_exp／fails／lock_until；`sysId`、`ensureSys`；`authRow`、`recordFail`、`storePassword`、`resetPassword`；名單回 pw／setupExp／locked；`POST /admin/staff/:id/reset`；新增回 `setup`；系統管理者列不能停用／刪除／改層級 | ✅ |
| `server/core/auth.js` | `/auth` 三種本文（查下一步／密碼／設定碼）、`/staff/me/password`；`bearer` 比對 pv、沒有 uid 也不是 adm 的公司憑證無效 | ✅ |
| `server/core/token.js` | 憑證帶 pv | ✅ |
| `levels.js`、`adminperm.js`、`fb/access.js`、`http.js` | sys 層級、reset 路由對應卡片、錯誤碼 locked／need_setup／setup_expired | ✅ |
| `shell/company.js`、`shell/company.css`（新）、`status.js`、`panel.*`、`panes.js` | 單一登入區、帳號按鈕＋彈窗、變更密碼；拿掉管理頁膠囊 | ✅ |
| `admin/` | 密碼欄、重置密碼、設定碼視窗、系統管理者列 | ✅ |
| 外掛 3.12 | 側邊欄提示文字、changelog | ✅ |
| 文件 | deploy（SYS_STAFF_ID、刪 COMPANY_PASSWORD、部署後第一步）、README、規格 §5.1、隱私權政策 | ✅ |

## 下一步
- [x] 後端＋單元測試
- [x] 首頁＋e2e company
- [x] 管理頁＋e2e admin
- [x] 全部 e2e（232）、npm test（698）、獨立審查（修正：fails 原子遞增、設定碼連錯作廢、常數時間比較、條件式消耗、重置／停用／刪除檢查權限組、新增不能用系統管理者編號、新增／重置寫操作紀錄、舊 adm 憑證立即失效）、截圖給使用者
- [x] 使用者說「推」，併入 main（同時更新 CLAUDE.md 目前進度）

## 測試
`npm test`（694 過）、`node build.js --check`、`npm run e2e`。

## 注意事項
- 13082605 不寫進 repo（Secret `SYS_STAFF_ID`）。
- 部署後：所有現有員工的舊憑證失效，需管理頁「重置密碼」拿設定碼；系統管理者本人用 ADMIN_PASSWORD 當設定碼。
- 舊版 adm:1 憑證部署後立即失效（審查後改）。
- 已知取捨（未改）：任何人可對某員工編號故意連錯讓對方被鎖 15 分鐘；「下一步」查詢會透露員工編號是否在名單。
