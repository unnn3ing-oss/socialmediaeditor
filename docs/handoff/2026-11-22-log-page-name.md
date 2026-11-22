# 錯誤日誌粉專欄顯示粉專名稱
- 狀態：待使用者確認（npm test 776、admin e2e 34）　- 分支：claude/modest-bohr-dxn17c　- 最後更新：2026-11-22
- 使用者原始需求：「錯誤日誌的粉專也可以變成顯示粉專名稱嗎？」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 存法 | D1 `logs.page` 照舊只存 ID，讀取時用 `fb_pages.short` 對照 | 改簡稱舊紀錄跟著變 |
| 對不到 | 顯示 ID；沒有粉專留空 | |
| 管理頁 | 粉專欄顯示簡稱，title 放 ID | |
| 擱置 | 「臉書後台改早排程時留言跟著提早」方案 D＋B（使用者 2026-11-22 說先擱置） | |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/logs.js` `adminLogs` | 回 `pageName` | ✅ |
| `admin/admin.js` | 粉專欄顯示 `pageName`，title＝ID | ✅ |
| `test/server/logs.test.js` | 對到／對不到／空白 | ✅ |

## 第二段：操作紀錄也顯示簡稱（2026-11-22 使用者「開始」）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/pagenames.js`（新） | `withPageNames(env, rows)` 共用 | ⬜ |
| `server/core/logs.js` | 改用共用函式 | ⬜ |
| `server/core/staff.js` `/admin/audit` | 回 `pageName` | ⬜ |
| `admin/admin.js` | 操作紀錄粉專欄顯示簡稱、title＝ID | ⬜ |
| `test/server/staff.test.js` | 補測試 | ⬜ |

## 測試
`node --test test/server/logs.test.js`、`npm test`、admin e2e。後端需重新部署，外掛不升版號。
