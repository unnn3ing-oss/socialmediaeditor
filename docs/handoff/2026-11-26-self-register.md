# 登入時自行註冊（員工編號＋姓名 → 10 分鐘一次性密碼）
- 狀態：已完成（已併入 main）　- 分支：claude/tender-einstein-shzdha　- 最後更新：2026-11-26
- 使用者原始需求：「登入時如果沒查到已有的員工編號，則多增加『註冊』，並須填寫『員工編號/姓名』，完成後回傳10分鐘的『一次性密碼』。」「按送出時需要再次輸入員工編號確認。」「方案 B，但可解鎖常用功能（進階設定可調整），先撇除排程發布相關的」「馬上設定自己的」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 註冊後狀態 | 方案 B：馬上用一次性密碼設定自己的密碼並登入 | 使用者選 |
| 送出確認 | 按「送出註冊」跳框再輸入一次員工編號，前後端都比對 | 使用者要求 |
| 一次性密碼 | 6 碼、10 分鐘（`REG_MS`）；過期帳號保留，要管理者重置 | 防別人搶先重新註冊 |
| 註冊帳號權限 | `staff.grp=0`（沒有權限組；`findStaff` 回 `self:true`，沒另開欄位）；公司素材只放行進階設定勾選的工具（圖片套版、LINE 推播、設計、浮水印），臉書三工具不列、後端也擋（本來就要權限組權限） | 使用者選 |
| 指派權限組 | 管理者指派權限組後 `self` 清除，變一般員工 | |
| 開放註冊預設 | **開**（使用者後來指定「預設先開啟註冊」）；進階設定「自行註冊」卡片（敏感 `selfreg`） | 使用者選 |
| 防濫用 | 只有不存在的編號能註冊；停用／系統管理者回同樣訊息；IP 每小時 5 次；失敗延遲 | |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/selfreg.js`（新） | 設定 `fb_settings` k=`self_reg` `{on,tools}`（沒存過＝開、全部可選工具；壞掉＝關）、`takeRegSlot`（KV `selfreg:<ip>:<小時>`，每小時 5 次，已存在的嘗試也算）、`assetAllowed`、`/admin/selfreg` | ✅ |
| `server/core/auth.js` | `POST /auth` `{register:true, staffId, staffId2, name}` → `{staffId, code, exp}`；查不到時 `bad_staff` 帶 `detail.register` | ✅ |
| `server/core/staff.js` | `registerStaff`（INSERT OR IGNORE、grp=0、設定碼欄存一次性密碼 `REG_MS`、操作紀錄 `staff_register`）；名單 `self` | ✅ |
| `server/core/assets.js` | `/assets/<key>` 與 manifest 依 `assetAllowed` 擋／過濾（403 forbidden，前端退回通用版） | ✅ |
| `build.js` → `server/assettools.gen.js` | 公司素材代號 → 工具；`toolNames` | ✅ |
| `server/core/http.js` | `reg_closed`／`reg_taken`／`reg_limit` | ✅ |
| `server/core/dash.js`＋`levels.js` | 儀表板項目 `selfreg`（待指派人數，黃）；卡片 `selfreg` 敏感 | ✅ |
| `shell/company.js`／`company.css` | 「註冊」鈕（只在 bad_staff 且 detail.register）、註冊步驟、`#company-reg-confirm` 再輸入編號、`#login-otp` 一次性密碼＋複製＋倒數、自動帶入 | ✅ |
| `admin/` | 進階設定「自行註冊」卡片（`#srCard`）、名單「自行註冊」標籤、權限組下拉「（未指派）」 | ✅ |
| 隱私權政策 | 中英各補一列 | ✅ |
| 測試 | `test/server/selfreg.test.js`（5）、company e2e +2、admin e2e +1 | ✅ |

## 下一步
- [x] 後端＋單元測試
- [x] 前端登入框＋e2e
- [x] 管理頁＋e2e
- [x] 獨立審查（修：`fbAccess` 擋 self 的唯讀臉書路由）、全部 e2e 319
- [x] 待指派上限 50（`reg_full`）、管理頁提醒核對本人
- [x] 使用者說「完成後直接先推」→ 併入 main

## 測試
`npm test`（837 過）、`node build.js --check`、`node --test test/e2e/company.e2e.js test/e2e/admin.e2e.js`

## 注意事項
- 後端需重新部署（正式＋測試），不用手動 SQL。外掛不升版號。
- 註冊帳號 grp=0：權限組刪除、發送通知「權限組」等路徑不受影響（grp 對不到任何組）。

## 追加：註冊帳號的專屬頁面（2026-11-26）
- 使用者：新創帳號不要顯示「功能停用」，改顯示「尚未開通〇〇」（選 B：只改註冊帳號，一般員工沒權限維持原樣；不要複製鈕）。
- 後端 `server/fb/access.js`：`self` 回新代碼 `fb_self_pending`（403，`http.js`）。
- 前端 `tools/fbpost|fbvideo|fbreports/index.html` 的 `#offMain` 內新區塊 `#selfPend`（標題「尚未開通排程發布／影片發布／數據報表」、說明兩行、「重新檢查」＝重新載入）；`app.js` 收到 `fb_self_pending` 隱藏原停用卡片、顯示此區塊。
- 測試：`test/server/selfreg.test.js` 驗代碼；新 `test/e2e/selfpend.e2e.js`（三個工具）。npm test 837、相關 e2e 86 通過。後端需重新部署。
