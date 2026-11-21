# 數據報表：續頁 Invalid cursor 修正
- 狀態：進行中　- 分支：claude/sleepy-albattani-xtbkpg　- 最後更新：2026-11-21
- 使用者原始需求：「讀取失敗：臉書：(#100) Invalid cursor … 會出現這個無法順利讀取數據」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 翻頁 | 續頁改照 `paging.next` 的翻頁參數（after／until／since／__paging_token 白名單）原樣送回；不再自己帶 since/until＋after | 推論：帶 since/until 時臉書用時間翻頁，混用 after 被判無效 |
| 版本 | 游標 v2、`DATA_VERSION` r2，舊游標回「請重新查詢」 | |
| 順便 | 沒回 insights 欄位也提示可能缺 read_insights；欄位檢查 6 篇＋翻第 2 頁測試 | 使用者上輪已同意方向 |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/reports.js` | readBatch／游標／probe | 🚧 |
| `test/server/fb-reports.test.js` | 替身：since/until＋after → 100；續頁照 next 參數 | 🚧 |

## 下一步
- [ ] 改程式＋測試、npm test、審查、推開發分支
- [ ] 使用者：說「推」→ 部署後端（正式＋測試）→ 重查＋欄位檢查「翻第 2 頁」
