# 排程發布整套移除（只留停用殼）
- 狀態：已完成（已併入 main）　- 分支：claude/bold-meitner-6g9v2g　- 最後更新：2026-11-16
- 使用者原始需求：「幫我把整個排程發布全清除掉，避免錯誤還是無法發文，所以需要重新撰寫。保留網頁端功能按鈕以及點入後『功能停用』的功能就好」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 工具卡片 | 保留 `fbpost`（registry、icon、thumb），點進去只顯示「功能停用」 | 使用者要求 |
| 舊程式 | 全刪，參考版本＝main `ebce125` | 重新撰寫 |
| D1 舊表 `fb_page_map`、`fb_comments`、`fb_settings` | 方案 B：部署後手動 DROP（指令寫在 README／deploy.md） | 使用者選 B |
| Secrets `FB_TOKEN`、`FB_APP_ID`、`FB_APP_SECRET`、`RUNDOWN_URL`、`RUNDOWN_TOKEN` | 方案 B：`wrangler secret delete` | 使用者選 B |
| 前端管理密碼登入（`adm:1`） | 方案 B：保留 | 使用者選 B |
| 外掛 | 不改、不升版號（側邊欄嵌入的 panel.html?tool=fbpost 自動顯示停用頁） | |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/` | 只留 tool.json／icon／thumb＋新 index.html 停用公告 | ✅ |
| `server/core/{fb,fbqueue,graph,pause,rundown}.js` | 刪除；`index.js`、`http.js` 拿掉相關路由／錯誤碼／cron | ✅ |
| `admin/`、`server/core/admin-page.js` | 刪臉書發文、Rundown 分類 | ✅ |
| `shell/panel.js` | 一鍵檢測刪臉書粉專項 | ✅ |
| 測試 | 刪 fbpost／fb／fbqueue／rundown 測試，新增停用頁 e2e，修 admin／sidepanel e2e | ✅ |
| 文件 | README、deploy.md、規格、CLAUDE.md | ✅ |

## 下一步
- [x] 依上表逐項做，`node build.js`；npm test 540、e2e 76、build --check 通過
- [x] sidepanel e2e：fbpost 改公開後側邊欄不再出現解鎖卡片，測試改為先寫入憑證再驗證狀態頁；一鍵檢測移除「臉書粉專」
- [x] 獨立審查（補修 schema.sql）→ 截圖 → 使用者說「推」已併入 main

## 部署後使用者要做
- 後端重新部署；D1 DROP 三張表、`wrangler secret delete` 五個（指令見 docs/deploy.md 步驟 6-2）

- [x] 2026-11-16 使用者已部署（加 migration v1→v2 刪 CommentHub）、DROP D1 舊表、刪 Secrets

## 注意事項
- repo `wrangler.toml` 沒綁 Durable Object，移除 `CommentHub` 不需 migration（使用者本機若有綁需加 `deleted_classes`）。
