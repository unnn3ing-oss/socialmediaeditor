# 留言失敗標出步驟＋開啟貼文連結
- 狀態：進行中　- 分支：claude/serene-edison-ws6ma1　- 最後更新：2026-11-23
- 使用者原始需求：「後台跳出留言失敗，但實際臉書有留言，但點通知的『看貼文』顯示無法查看」；定案「B+C」。

## 已知事實
- 錯誤紀錄英文原文：`(#10) Object does not exist, cannot be loaded due to missing permission or reviewable feature ... requires the 'pages_read_engagement' permission or the 'Page Public Content Access' feature` → 是計時器「讀」的步驟被擋（`timer.js` 確認發布 `GET /{post}?fields=is_published` 或確認是否已留 `GET /{post}/comments`），不是留言被擋。
- 使用者用 Graph API Explorer 可正常讀取。權杖有多組可切換（`tokenstore.js` profiles、`pages.js` `pageTokens` 使用中優先＋其他組）。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| A1／A2（略過確認、讀不到改待確認） | 不做（使用者只選 B+C） |
| B | 錯誤說明前面加步驟名稱（取得粉專權杖／確認發布／確認是否已留／留言） |
| C | 開啟貼文連結：`<粉專>_<貼文>` 改 `facebook.com/<粉專>/posts/<貼文>` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/timer.js` | `retry(rec,it,e,step)` 錯誤前加步驟 | ⬜ |
| `shell/notices.js`、`admin/admin.js`（兩處） | 共用連結格式 | ⬜ |
| 測試 | timer 單元測試、admin／company e2e | ⬜ |

## 下一步
- [ ] B、C 實作＋測試＋審查
- [ ] 使用者確認後推 main、更新 CLAUDE.md 目前進度

## 注意
- 後端需重新部署（正式＋測試），外掛不升版。
