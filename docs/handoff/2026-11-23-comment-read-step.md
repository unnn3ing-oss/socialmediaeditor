# 留言失敗標出步驟＋開啟貼文連結
- 狀態：已完成（2026-11-23 併入 main）　- 分支：claude/serene-edison-ws6ma1　- 最後更新：2026-11-23
- 使用者原始需求：「後台跳出留言失敗，但實際臉書有留言，但點通知的『看貼文』顯示無法查看」；定案「B+C」。

## 已知事實
- 錯誤紀錄英文原文：`(#10) Object does not exist, cannot be loaded due to missing permission or reviewable feature ... requires the 'pages_read_engagement' permission or the 'Page Public Content Access' feature` → 是計時器「讀」的步驟被擋（`timer.js` 確認發布 `GET /{post}?fields=is_published` 或確認是否已留 `GET /{post}/comments`），不是留言被擋。
- 使用者用 Graph API Explorer 可正常讀取。權杖有多組可切換（`tokenstore.js` profiles、`pages.js` `pageTokens` 使用中優先＋其他組）。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 第二輪（使用者「開始，加做 5」） | R1 每則記第幾則 `n`；R2 立即發布 arm 帶 `published:true`；R3 確認發布被擋（#10／#200 系列）直接留言；R4 留言臉書明確錯誤＝pending 直接重留、沒收到回應＝posting＋`unsure` 下次先查；R5 `ALERT_AT=3`（約 1.5 分鐘）；R6 提醒出現就寫錯誤日誌，自動成功後通知刪除、日誌系統結案；5 管理頁「臉書連線」列 App／使用者權杖權限／粉專權杖權限 |
| B | 錯誤說明前面加步驟名稱（取得粉專權杖／確認發布／確認是否已留／留言） |
| C | 開啟貼文連結：`<粉專>_<貼文>` 改 `facebook.com/<粉專>/posts/<貼文>` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/timer.js` | `STEP`＋`retry(rec,it,e,step)` 錯誤前加步驟 | ✅ |
| `shell/notices.js` `fbPostUrl`、`admin/admin.js`（錯誤紀錄、操作紀錄） | 共用連結格式 | ✅ |
| 測試 | `fb-timer.test.js` 加 2 項、`test/notices-link.test.js`、admin／company e2e 網址更新 | ✅ npm test 794、admin＋company e2e 52、build --check |

## 下一步
- [x] B、C 實作＋測試
- [x] R1～R6＋5：`timer.js`、`post.js`、`pages.js` `tokenStatus`（granted／pageScopes／appId／needed）、`admin/index.html`＋`admin.js`＋`admin.css` `#fbPerms`；npm test 799、admin／company／fbpost／fbvideo e2e 114
- [x] 獨立審查通過（Minor：部署前已失敗的舊紀錄重新留言改先查再留，已修，rec.v=2）
- [ ] 下一件（使用者新需求，待列做法確認）：系統管理員手動發通知給使用者（黃色閃爍）
- [ ] 使用者確認後推 main、更新 CLAUDE.md 目前進度

## 注意
- 後端需重新部署（正式＋測試），外掛不升版。
