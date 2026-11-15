# 前端輸入管理密碼不受停用限制
- 狀態：進行中　- 分支：claude/tender-carson-pl5eze　- 最後更新：2026-11-15
- 使用者原始需求：「如果在前端輸入登入處輸入管理密碼，則所有功能不受停用限制仍可用。」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 做法 | `POST /auth` 先比公司密碼、再比 `ADMIN_PASSWORD`；管理密碼發 `kind:'company'` ＋ `adm:1` 的憑證 | 公司功能照常、權限分開 |
| 有效期 | 管理員憑證 12 小時（`ADMIN_TTL`），`/auth/status` 不續期（續了會變普通憑證） | 使用者選 A |
| 停用中提示 | 不加 | 使用者選「不用」 |
| `/admin/*` | 不受影響，前端管理員憑證不能進管理頁 | 權限分開 |
| 停用檢查 | 憑證有 `adm` 就跳過（`/fb/*`、`/rundown`） | 需求 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/token.js` | payload 可帶 `adm:1`，readToken 回傳 `adm` | ✅ |
| `server/core/auth.js` | `/auth` 雙密碼、`/auth/status` 回 admin、不續期 | ✅ |
| `server/core/fb.js`、`rundown.js` | 有 `adm` 跳過停用 | ✅ |
| `shell/company.js` | 存 `admin`，膠囊顯示「（管理員）剩 X 小時」 | ✅ |
| 測試、規格 §5.3 | | ✅ |

## 下一步
- [x] 後端＋單元測試（auth.test.js 3 項、fbqueue.test.js 1 項）
- [x] 前端膠囊＋e2e（company.e2e.js 1 項）
- [x] npm test 379、全部 e2e 128、build check 通過
- [ ] 獨立審查
- [ ] 使用者說「推」才併 main，同 commit 更新 CLAUDE.md「目前進度」

## 注意事項
- 後端需重新部署；不升外掛版號。
