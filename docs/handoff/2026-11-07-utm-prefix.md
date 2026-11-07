# UTM 支援問號前綴
- 狀態：實作與獨立審查完成，已推開發分支，待使用者確認　- 分支：`codex/utm-question-prefix`　- 最後更新：2026-11-07
- 使用者原始需求：`?&utm_source=facebook&utm_medium=tvbsteatimenewspic` 這樣有 `?` 也允許。

## 已定案的決定
- 後台接受 `?`、`?&` 開頭的 UTM，原樣儲存。
- SDK 組合連結時去掉 UTM 前綴的問號與 &，依文章網址決定分隔符號，保留既有查詢參數與錨點，避免重複附加。

## 做法
- `server/core/fb.js`：放寬開頭問號驗證與提示。
- `sdk/news-rules.js`：整理前綴。
- `test/server/fbqueue.test.js`、`test/sdk-news.test.js`：保存讀回、連結組合與去重回歸測試。

## 下一步
- [x] 將現有 UTM 修改推送 `codex/utm-question-prefix`，保留 main 不變。
- [x] 在目前環境重跑相關測試：58 項全通過。
- [x] 獨立代理審查通過：未發現阻擋問題；前綴保存、連結組合與非法字元驗證符合需求。審查提出的交接狀態更新已補齊。
- [ ] 使用者確認後才進行合併與部署；本次指示僅建立開發分支供交接。

## 測試
- `node --test test/sdk-news.test.js test/server/fbqueue.test.js`：58 項全數通過。
- `git diff --check`：通過。

## 注意事項／不能做的事
- 不修改 `server/wrangler.toml`。先前檢查的 Cloudflare 登入與正式 D1／KV ID 不足，Worker 尚未部署。
- 本次不推 main、不開 PR、不部署網站或 Worker。
- 接手請先 `git fetch origin codex/utm-question-prefix`，切換此分支後讀 `CLAUDE.md` 與本檔；勿重做已完成項目。
- 先前交接檔未在實作前推送，本次補齊現況，不改寫歷史。此對話使用 Codex，沒有 Claude Session 連結，不虛構該連結或 Claude 身分。
