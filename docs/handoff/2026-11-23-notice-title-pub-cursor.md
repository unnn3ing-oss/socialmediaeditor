# 通知顯示哪篇文章＋開啟貼文；已發佈「載入更多」請求內容不正確
- 狀態：待使用者確認（通知按鈕縮成一列，「開排程發布」改「到排程發布」）　- 分支：claude/modest-bohr-dxn17c　- 最後更新：2026-11-23
- 使用者原始需求：「通知留言失敗沒有顯示是哪篇文章、沒有按鈕可以開啟對應貼文」「我按已發布時，載入更多會寫請求內容不正確」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 摘要來源 | 送出時存標題摘要 ≤40 字（排程發布：標題，沒有用貼文內容第一行；影片：影片標題），計時器 rec.title → fb_notices.title | 不打臉書 |
| 開啟貼文 | `https://www.facebook.com/<postId>`（同操作紀錄） | |
| 舊通知 | 沒摘要只顯示開啟貼文 | |
| 載入更多 | 推論：游標 >500 字被 `server/fb/index.js` 擋；放寬到 4000 字＋只收 `[A-Za-z0-9_\-=%]` | 未線上確認 |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/index.js` | after 上限 4000＋字元白名單 | ✅ |
| `server/fb/post.js`、`video.js` | armTimer 帶 title | ✅ |
| `server/fb/timer.js`、`notices.js` | rec.title、fb_notices.title（自動補欄） | ✅ |
| `shell/company.js`／`.css` | 卡片摘要行＋開啟貼文 | ✅ |
| `privacy/index.html` | 補摘要 | ✅ |
| 測試 | 單元＋company e2e | ✅ |

後端需重新部署，外掛不升版號。
