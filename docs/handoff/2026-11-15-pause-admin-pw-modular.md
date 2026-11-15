# 暫停排程發布＋管理密碼登入（模組化重做，在 11/07 還原版上）
- 狀態：已併入 main（等使用者部署實測）　- 分支：claude/youthful-dirac-5upj3e　- 最後更新：2026-11-15
- 使用者原始需求：「管理頁『暫停排程發布』開關、前端輸入管理密碼登入，可以不受暫停限制，這兩個我也要」；並要求「之後更新都以模組化，避免錯誤發生無法快速復原」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 暫停功能位置 | 全部集中在新檔 `server/core/pause.js`；fb.js／rundown.js／index.js 只加掛點 | 模組化，拿掉只刪檔＋掛點 |
| 發文核心 | `createPost`、`graph.js` 不動 | 使用者要求凍結 |
| 管理頁 | 維持後端 `/admin`（`server/core/admin-page.js`），加「暫停排程發布」卡片 | 使用者沒要搬到網站 |
| 管理密碼登入 | 照 `fac834d`：`POST /auth` 管理密碼 → company 憑證帶 `adm:1`，12 小時、不續期、不能進 `/admin/*` | 使用者要求 |
| 有圖排程 | 不可用兩步驟 | 使用者否決 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/pause.js` | getPause／setPause（D1 fb_settings key='pause'）、pausedFail、adminFbPause | ✅ |
| `server/core/fb.js`、`rundown.js`、`index.js` | 掛點 | ✅ |
| `server/core/http.js` | fail() detail、fb_paused | ✅ |
| `server/core/token.js`、`auth.js` | adm 旗標、管理密碼登入 | ✅ |
| `server/core/admin-page.js` | 暫停卡片 | ✅ |
| `sdk/api.js`、`shell/company.js` | detail、管理員膠囊 | ✅ |
| `tools/fbpost/` | 停用公告 | ✅ |
| 測試 | pause、auth、fbpost e2e、company e2e、admin 頁 | ✅ |

## 下一步
- [x] 實作、測試（npm test 353、e2e 118、build --check）、獨立審查通過（發文核心未動、adm 不能進 /admin）
- [x] 使用者說「推」，已併入 main

## 參考
原版 commit：`d020fed`（暫停）、`fac834d`（管理密碼）；交接 `2026-11-15-fbpost-pause.md`、`2026-11-15-admin-bypass-pause.md`。
