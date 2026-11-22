# 操作紀錄改版＋文字背景到期＋隨機納入純色圖樣
- 狀態：進行中　- 分支：claude/wonderful-babbage-f1owta　- 最後更新：2026-11-22
- 使用者原始需求：「操作紀錄幫我變成可點開貼文的按鈕／操作也多分後台或工具，且發文也寫套版/字圖/文字出來／文字背景隨機選圖在可讀到圖樣時，納入讀取更多圖樣的純色圖／後台的文字背景增加圖樣預計過期期限／操作紀錄增加可用人名查詢」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| ① 貼文按鈕 | 「開啟貼文 ↗」→ `https://www.facebook.com/<id>`；只有 publish／schedule／reschedule／video_* 有，其餘灰字 ID | 刪除與非貼文 ID 開不了 |
| ② 來源 | 前端依動作判斷（工具／後台），加篩選下拉，不改 DB | 舊紀錄也適用 |
| ③ 類型 | 前端送 `kind`（template／textimg／text），後端白名單、寫進 detail（`kind=…`，與 `at=…` 空格分隔） | 不加欄位 |
| ④ 隨機 | 方案 A：圖樣讀完後在瀏覽器取樣，顏色差很小＝純色，加入隨機池 | 使用者選 A |
| ⑤ 到期 | 從 fbcdn 網址 `oe=`（16 進位秒）解析，列表回 `exp`（不回網址），四種狀態＋摘要＋dry 預覽顯示最早到期 | `oe` 為推論，非官方 |
| ⑥ 姓名查詢 | `/admin/audit?q=`：編號格式＝完全比對；其他＝紀錄姓名 LIKE 或 目前名單姓名 LIKE 換 uid，跳脫 % _ | 改名後也查得到 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| admin/admin.js、admin/index.html | ①②⑤⑥ | ⬜ |
| tools/fbpost/send.js | ③ 送 kind | ⬜ |
| server/fb/post.js、server/fb/index.js | ③ | ⬜ |
| tools/fbpost/compose.js | ④ | ⬜ |
| server/fb/bgstore.js | ⑤ urlExpiry、列表 exp | ⬜ |
| server/core/staff.js | ⑥ | ⬜ |

## 測試
npm test、admin／fbpost e2e、node build.js --check、獨立審查。

## 注意事項
後端需重新部署（正式＋測試），不用手動 SQL，外掛不升版號。
