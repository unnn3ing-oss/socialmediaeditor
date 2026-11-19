# 首頁「管理員測試」標籤跟著開放／關閉變（方案 B）
- 狀態：已完成（已併入 main）　- 分支：claude/dazzling-tesla-2kscqv　- 最後更新：2026-11-20
- 使用者原始需求：「我在管理頁開放排程功能，前端沒有把『管理員測試』拿掉並開放功能」→ 選 B（首頁動態）。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 開放狀態來源 | 後端新增不需登入的 `GET /fb/open` → `{ open }`（只回布林，不含原因） | 首頁沒登入也要知道 |
| tool.json | 拿掉靜態 `badges`；新增 `gate: { check:'/fb/open', badge:'管理員測試', desc:'測試中，僅管理員可用' }`；`desc` 改成開放時的說明 | 積木式，外殼不寫死工具 id |
| 首頁 | 先照「關閉」顯示（標籤＋測試說明），查到開放才拿掉；查不到維持關閉樣子；每頁只查一次 | 不閃錯誤資訊 |
| 停用頁文字 | 影片發布「只開放給管理員測試」改成「目前沒有開放」 | 開放後被擋的人（公司密碼）不該看到測試字樣 |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/index.js` | `handleFb` 開頭 `GET /fb/open` 不驗證 | ✅ |
| `build.js` | catalog 帶 `gate` | ✅ |
| `shell/showcase.js` | gate 標籤／說明、查一次後更新卡片 | ✅ |
| `tools/fbpost/tool.json`、`tools/fbvideo/tool.json`、`tools/fbvideo/index.html` | 同上 | ✅ |
| 測試 | 單元（後端路由、build）、e2e（首頁開放／關閉／查不到） | ✅ |

## 結果
- npm test 683、全部 e2e 225（新 `gate.e2e.js` 3 項；`fbpost.e2e.js` 的 fbCalls 排除 `/fb/open`）、build --check、獨立審查通過。
- 排程發布停用頁「正在重新撰寫」也改成「這個工具目前沒有開放。」
- 審查 nit 未改：`/fb/open` 每次讀 D1、沒限流；查詢失敗整頁視為關閉、不重試。
- [x] 使用者說「推」，併入 main

## 注意事項
- 後端需重新部署（正式＋測試）才有 `/fb/open`；沒部署前首頁維持顯示「管理員測試」。外掛不改。
