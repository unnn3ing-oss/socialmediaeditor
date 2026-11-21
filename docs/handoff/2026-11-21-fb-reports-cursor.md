# 數據報表：續頁 Invalid cursor 修正
- 狀態：已完成（已併入 main）　- 分支：claude/sleepy-albattani-xtbkpg　- 最後更新：2026-11-21
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
| `server/fb/reports.js` | readBatch／游標（`pagingFrom`／`readPaging`）／probe（6 篇＋翻第 2 頁）／KV key 翻頁參數改雜湊 | ✅ |
| `test/server/fb-reports.test.js` | 替身：since/until＋after → 100（舊版重現失敗）；續頁照 next 參數；白名單；缺 insights 提示 | ✅ |

## 下一步
- [x] 改程式＋測試（npm test 742、fbreports e2e 6、build --check）、獨立審查通過、推開發分支
- [ ] 使用者：說「推」→ 部署後端（正式＋測試）→ 重查＋欄位檢查「翻第 2 頁」
