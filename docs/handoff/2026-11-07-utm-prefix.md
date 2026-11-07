# UTM 支援問號前綴
- 狀態：已實作，待部署；未提交／未推送
- 使用者原始需求：`?&utm_source=facebook&utm_medium=tvbsteatimenewspic` 這樣有 `?` 也允許。

## 已定案的決定
- 後台接受 `?`、`?&` 開頭的 UTM，原樣儲存。
- SDK 組合連結時去掉 UTM 前綴的問號與 &，依文章網址決定分隔符號，保留既有查詢參數與錨點，避免重複附加。

## 做法
- `server/core/fb.js`：放寬開頭問號驗證與提示。
- `sdk/news-rules.js`：整理前綴。
- `test/server/fbqueue.test.js`、`test/sdk-news.test.js`：保存讀回、連結組合與去重回歸測試。

## 測試
- `node --test test/sdk-news.test.js test/server/fbqueue.test.js`：58 項全數通過。
- `git diff --check`：通過。

## 下一步
- 部署網站與 Worker 後才會在線上生效。
- 不修改 `server/wrangler.toml`；不部署、不推 main。
