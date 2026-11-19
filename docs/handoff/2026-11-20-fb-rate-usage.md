# 管理頁「速率限制」卡片
- 狀態：已完成（已併入 main）　- 分支：claude/dazzling-tesla-2kscqv　- 最後更新：2026-11-20
- 使用者原始需求：「https://developers.facebook.com/docs/graph-api/overview/rate-limiting#application-level-rate-limiting 在管理頁添加一個可以查看速率限制的顯示」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 資料來源 | 臉書沒有查用量 API，只有回應標頭：`X-App-Usage`（使用者／App 權杖）、`X-Business-Use-Case-Usage`（粉專權杖，type `pages`，含 `estimated_time_to_regain_access` 分鐘） | Meta 文件 |
| 記錄 | `graph()` 每次回應讀標頭；記到 D1 `fb_settings` k=`rate_usage`（每個執行個體最多每 60 秒寫一次；被限流或 ≥75% 立即寫） | 不增加臉書呼叫、D1 寫入量小 |
| 被限流 | 錯誤碼 4／17／32／613／80001 記最後一次（碼、訊息、時間） | |
| 立即查詢 | 管理頁按鈕：使用中組別每個粉專打一次 `GET /{id}?fields=id`（粉專權杖）＋使用者權杖 `GET /me?fields=id`，強制寫入 | 使用者未回答，預設提供（會用一點額度，按了才打） |
| 顯示 | 管理頁兩份「臉書發文」新卡片「速率限制」：App 一列、每個粉專一列，三個 % 長條（≥75 黃、≥90 紅），被擋時「約 N 分鐘後恢復」，最後更新時間 | |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/usage.js`（新） | 解析標頭、合併、節流寫入、讀取 | ✅ |
| `server/fb/graph.js` | 回應後 `noteUsage`、限流時 `noteThrottle` | ✅ |
| `server/fb/index.js` | `GET /admin/fb/usage`、`POST /admin/fb/usage/refresh` | ✅ |
| 管理頁兩份 | 「速率限制」卡片 | ✅ |
| 測試 | `test/server/fb-usage.test.js`、admin e2e | ✅ |

## 結果
- npm test 686（`fb-usage.test.js` 3 項）、admin e2e 25（速率限制 1 項）、全部 e2e 225／226（`fbpost-compose` 既有字型時間競爭偶發，單獨重跑 3 次全過）、build --check、獨立審查通過。
- 審查修正：高用量時也至少隔 10 秒寫一次（限流紀錄、立即查詢除外）；graph.js 註解位置。未改：跨執行個體先讀再寫可能互蓋（顯示用，可接受）。
- [x] 使用者說「推」，併入 main

## 注意事項
- 後端需重新部署（正式＋測試），外掛不改。
