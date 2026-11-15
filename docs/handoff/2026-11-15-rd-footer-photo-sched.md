# Rundown 底列＋測試移到管理頁＋少康 RD（RD 區段 A＋B）＋有圖排程照 Meta 文件改兩步驟
- 狀態：已完成（已併入 main）　- 分支：claude/dreamy-hawking-mme5c2　- 最後更新：2026-11-15
- 使用者原始需求：「需要把排入Rundown開關與輸入框移動到空白處，並且左邊開關右邊輸入框」「將測試功能移動到管理後台，並解決少康無法正確寫入RD的問題」；查證 Meta 文件後「開始，有圖排程用方案 A，RD 用 A＋B」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| RD 位置 | 底列「清空頁面」左側：左開關、右 SLUG；移除 ⚙、粉專說明文字、Rundown 設定視窗 | 使用者指定 |
| 測試連線 | 管理頁新分類「Rundown」→「Rundown 連線」卡片；後端 `GET /admin/rundown`（只回有無設定）、`POST /admin/rundown/ping`，掛在 `adminExtras`；後端 `/admin` 與網站 `admin/` 都加 | 不回傳網址與金鑰 |
| 少康 RD（A） | 粉專對應表加「RD 區段」下拉（自動／新聞／娛樂／少康／擠看看／國際＋／氣象），`POST /admin/fb/pagemap` 收 `code`（沒帶沿用舊值） | 原本 code 改不了 |
| 少康 RD（B） | `code` 空白＝自動：名稱完全比對，再依關鍵字包含比對（少康、擠看看、國際、娛樂、氣象、新聞，依此順序） | 名稱不完全一樣也能對上；D1 存了空白 code 也有效 |
| 有圖排程 | 照 Meta 文件（`/docs/graph-api/reference/page/photos/`「Uploading an unpublished photo」）：`/photos` published=false＋temporary=true → `/feed` attached_media[0]＋published=false＋scheduled_publish_time＋unpublished_content_type=SCHEDULED；立即發圖不變 | 使用者選方案 A；文件唯一寫明的流程 |
| 發文其他部分 | 純文字、立即發圖、graph.js 不動 | 模組化、降低風險 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fb.js` | createPost 排程有圖兩步驟；attachComment 排程有圖不當照片；defaultMap 包含比對；mapFor 空 code 自動；pagemap POST 收 code | ✅ |
| `server/core/rundown.js`、`server/index.js` | `adminRundown`＋掛點 | ✅ |
| `server/core/admin-page.js`、`admin/` | Rundown 連線卡片；粉專對應 RD 區段下拉 | ✅ |
| `tools/fbpost/index.html`、`tool.css`、`tool.js` | RD 搬到底列、移除設定視窗 | ✅ |
| 測試 | fb.test、rundown 測試、fbpost e2e、admin e2e | ✅ |

## 下一步
- [x] 後端三項（27c7183 有圖排程、6c40c75 RD 區段、363bfc4 管理頁 Rundown API）
- [x] 管理頁兩處、fbpost 底列（40bb55b、836d296）
- [x] npm test 361、e2e 126、build --check、截圖、獨立審查（Sonnet）通過
- [x] 使用者說「推」才併入 main，同 commit 更新 CLAUDE.md「目前進度」
- [ ] 部署後端後實測：排一篇有圖排程（Meta 後台「已排定」出現、到點發布、留言）；管理頁「粉專對應」確認少康 RD 區段＝自動（少康），排入 RD；管理頁 Rundown 測試連線

## 測試
`npm test`；`npx playwright test test/e2e/fbpost.e2e.js test/e2e/admin.e2e.js --trace off`；`node build.js --check`。

## 注意事項
- 後端需重新部署；外掛不升版號。
- Meta 文件：排程時間 Pages API 指南寫 10 分～30 天（程式 MAX_SCHEDULE＝30 天，維持）。
