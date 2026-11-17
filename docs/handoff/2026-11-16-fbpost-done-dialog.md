# 排程發布：送出成功後跳「再發一則／返回列表」
- 狀態：進行中　- 分支：claude/dreamy-gauss-mzxyof　- 最後更新：2026-11-16
- 使用者原始需求：「把目前的新增發文，改為按送出後，如果成功則彈出『再發一則』並清除頁面、『返回列表』則跳出新增發文彈窗回到『已排程』列表」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 何時跳 | 所有粉專都成功才跳；有任一失敗＝維持現狀（不跳、不清空、結果顯示在頁面） | 使用者選 1A |
| 返回列表 | 清空頁面、關新增發文視窗、切到「已排程」，**不自動查詢** | 使用者選 2B |
| RD 寫入失敗 | 仍算成功、照跳視窗；黃色提醒區，顯示一顆與按鈕同框的「文章ID/圖文/SLUG」按鈕，點一下複製（變「已複製」1.5 秒），下面列各粉專＋時間；同文字只一顆 | 使用者選 3 |
| 沒文章 ID／沒 SLUG | 只顯示原因，不出複製按鈕 | 組不出格式 |
| 沒開 RD／沒 RD 區段 | 不顯示提醒區 | |
| 再發一則 | 清空（不再確認）、視窗留著、焦點到網址欄 | |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/rd.js` | `write()` 回 `{ lines, failed:[{text,label,time}] }` 或改為另附 failed，寫入邏輯不變 | ✅ |
| `tools/fbpost/send.js` | 全部成功開 `doneDlg`；共用 `clearAll()`；按鈕事件 | ✅ |
| `tools/fbpost/index.html`、`fbpost.css` | `<dialog id="doneDlg">`、複製按鈕樣式 | ✅ |
| `tools/fbpost/app.js` | 傳 `dialog.close`、切分頁給 send.js | ✅ |
| `tests/e2e/fbpost.e2e.js` | 再發一則、返回列表、部分失敗不跳、RD 失敗複製按鈕 | ✅ |

## 下一步
- [x] 依上表實作（另加 `util.js` copyText、`dialog.js` Esc 跳過 doneDlg；替身後端改成固定娛樂 222 失敗）；fbpost e2e 31、npm test 609、build --check 通過
- [x] 獨立審查通過、截圖已給使用者（`02bf456`）

## 追加（使用者已說「開始」）
| 項目 | 決定 |
|---|---|
| UTM 兩欄 | D1 `fb_pages.utm_text`（自動 ALTER 補欄位）；沒附圖（純文字）用「文字」UTM，其他用「圖文」（原 `utm`）。**文字空白＝不加 UTM**，前端送出前若勾選的粉專文字 UTM 空白要跳確認提醒（`/fb/pages` 多回 `noTextUtm`） |
| 粉專設定版面 | 表格改每粉專一張小卡（名稱＋上下移／簡稱 RD 顯示／UTM 圖文整行／UTM 文字整行），兩個管理頁都改 |
| 素材上傳 | 順序 等級→名稱→檔案→上傳；選檔自動填名稱（去副檔名、小寫、非法字元→-），只在名稱空白或上次自動填時覆蓋 |
| 開放切換 | 兩段：只開放管理員（預設）／開放給公司帳號；存 `fb_settings` k=`access`；`/admin/fb/access` GET/POST；`GET /fb/access` 回 mode；開放時隱藏「測試模式」標籤；前端不再只看 admin，改看 `/fb/pages` 是否 403 |
| 部署 | **後端需重新部署** |

- [x] 後端：pages.js（`ensureCols` 依 D1 綁定 WeakSet 補欄位）／post.js（`pageUtm(env, id, !form.file)`）／access.js（`accessMode`／`setAccessMode`）／index.js（`/fb/access`、`/admin/fb/access`、`/fb/pages` 加 `noTextUtm`）／schema.sql＋單元測試
- [x] 管理頁：`admin/`、`server/core/admin-page.js`（同一支腳本改兩邊：卡片 `.pg-card`、`#acCard`、素材順序＋`autoKey`）
- [x] fbpost 前端：app.js 改看 `st.company`＋`/fb/pages` 403、`.test-pill` 依 `/fb/access` 隱藏；send.js 純文字送出前 confirmBox
- [x] npm test 613、e2e 116、build --check 通過；截圖已拍
- [x] 獨立審查通過（未改檔）

## 追加 2：開放／關閉＋關閉原因（使用者已說「開始」）
- 卡片標題「排程發布」，按鈕「開放」「關閉」（mode company／admin 不變）；關閉＝只有管理員密碼。
- 關閉原因選填 ≤100 字，存 `fb_settings` k=`access` 的 v 改 JSON `{mode,reason}`（相容舊值純字串）；開放後保留原因。
- 公司帳號被擋：`fb_forbidden` 帶 `detail:{reason}`，fbpost 停用頁顯示「原因：…」（沒填不顯示）。
- [x] 後端 access.js（`accessState`／`setAccessState`）／index.js（POST 沒帶 reason＝保留）＋測試；`fb_forbidden` 文字改「排程發布目前關閉。」
- [x] 兩個管理頁（`#acOpen`／`#acClose`／`#acReason`／`#acReasonSave`）
- [x] fbpost app.js 顯示 `detail.reason`＋e2e；npm test 613、e2e 117、build --check 通過
- [x] 獨立審查通過（未改檔）；等使用者說「推」

## 測試
`npm test`、`npx playwright test tests/e2e/fbpost.e2e.js`、`node build.js --check`

## 注意事項
- 送出完成視窗是純前端；追加部分**後端需重新部署**（自動補 `utm_text` 欄位、`fb_settings` 已存在）。不升外掛版號。
- 工具內切換一律 hidden；不推 main，使用者說「推」才併。
