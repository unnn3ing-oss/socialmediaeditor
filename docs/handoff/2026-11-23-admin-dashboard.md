# 管理頁首頁儀表板
- 狀態：進行中　- 分支：claude/hopeful-mendel-ua729r　- 最後更新：2026-11-23
- 使用者原始需求：「後台部分增加一個後台首頁，作為即時儀表板查看系統狀況。」要看「有沒有東西壞了、過期要處理」；進頁查一次＋手動刷新；進階設定項目只顯示狀態，可在進階設定選哪些顯示、權限組可調整誰看得到什麼。
- 設計：`docs/superpowers/specs/2026-11-23-admin-dashboard-design.md`（已經使用者確認，含審查後補充）

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 做法 | 新 API `GET /admin/dash`，後端讀全部、記憶體暫存 **5 分鐘**共用、依權限篩選才回傳 | 使用者選 A＋暫存，改 5 分鐘 |
| 誰看得到 | 系統管理者（不用解鎖）＝全站開關開的全部；員工＝全站開關 ∩ 權限組 `dash:<key>` | 使用者選 A |
| 全站開關 | 進階設定卡片 `dashcfg`（敏感），D1 `fb_settings` k=`dash` | 使用者要求 |
| 不呼叫臉書 | 只讀 D1／記憶體已存資料 | 省限流 |
| 重新整理 | `?fresh=1` 重讀；同一人 10 秒內回上一份 | 防連按 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/dash.js`（新） | `DASH_ITEMS`、`collect(env)`、各項等級規則、暫存、`readDashCfg`／`saveDashCfg`、`adminDash` 路由 | ✅ |
| `server/core/staff.js` | `dash:*` 權限、`PERM_SECTIONS` 新區、`dashOf()`、`perms_v3` 補權限（名稱「管理」或有 `card:staff`） | ✅ |
| `server/core/levels.js` | 卡片 `dashcfg`（sensitive） | ✅ |
| `server/core/adminperm.js` | `adminWho` 加 `dash`、`meInfo` 回 `dash`、ROUTES `/admin/dash/config`→`dashcfg`；`/admin/dash` 由 handler 自己判斷 | ✅ |
| `server/core/admin.js` | `/admin/me` 允許只有 dash 的人；`/admin/dash` 在 gate 前處理 | ✅ |
| `server/core/auth.js` | `manage` 也算 dash 權限 | ✅ |
| `admin/index.html`、`admin.js`、`admin.css` | 分類「首頁」（panel-home，預設）、進階設定「儀表板顯示項目」卡片 | ✅ |
| 測試 | `test/server/dash.test.js`（新）、`test/e2e/admin.e2e.js` 加首頁 | ✅ |

## 下一步
- [x] 後端（dash.js＋權限）＋單元測試
- [x] 前端首頁＋設定卡片＋e2e
- [x] 全部測試、截圖給使用者、獨立審查（npm test 791、admin e2e 38、build --check、審查通過）
- [ ] 使用者說「推」→ 併入 main，更新 CLAUDE.md 目前進度

## 測試
`npm test`；`npx playwright test test/e2e/admin.e2e.js`（沙盒 chromium `/opt/pw-browsers/chromium`）；`node build.js --check`。

## 注意事項
- 回傳每項只有 `{key,name,level,text,tab}`，不可帶權杖、ID、姓名。
- 後端需重新部署（正式＋測試），不用手動 SQL，外掛不改。
