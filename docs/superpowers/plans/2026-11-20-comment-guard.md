# 留言守門 Implementation Plan

> **For agentic workers:** 主對話 Native 執行（任務互相依賴介面、檔案重疊，不分派子代理）；完成後派一個獨立審查。

**Goal:** Webhook 收到新增／編輯留言 → 預篩 → 讀標註 → 依規則記錄或隱藏；管理頁「留言守門」卡片。
**Architecture:** 新檔 `server/fb/guard.js`（規則純函式、設定、紀錄表、事件處理、管理路由），`webhook.js` 只加掛點，`fb/index.js` 掛管理路由，`adminperm`／`levels` 加卡片 `guard`。前端只改 `admin/`。
**Tech Stack:** Cloudflare Worker、D1、Graph v27.0、`node --test`、Playwright。
**Spec:** `docs/superpowers/specs/2026-11-20-comment-guard-design.md`

## Global Constraints
- 設定 D1 `fb_settings` k=`guard`（JSON）；統計 k=`guard_stats`；紀錄表 `fb_guard_log`（自動建立），保存 30 天。
- 清單每類 ≤50 筆、每筆 ≤20 字；留言內容存 ≤500 字。
- 模式 `off`／`observe`／`hide`；規則各自自動隱藏開關，預設 r1 開、r2 關。
- 預設名稱關鍵字：寶爸、寳爸；引導詞：老師、進群、交流群、選股、飆股、獲利、追蹤、帶單、理財群。
- Webhook 一律先回 200，守門處理在 `ctx.waitUntil`；錯誤吞掉。
- 速率：使用中 App 或該粉專用量 ≥90%、或 10 分鐘內有限流紀錄 → 不讀留言，只記統計 `skipped`。
- 卡片 `guard` 非敏感、預設給管理者。

## Review Focus
1. 同一則留言 add 後馬上 edited（兩個事件併發）→ 紀錄只有一列（`INSERT … ON CONFLICT(comment_id) DO UPDATE`）。
2. 粉專自己的留言（`from.id == page`）→ 不處理、不打 API。
3. 手動取消隱藏＝豁免 → 之後 edited 不再隱藏。
4. 模式 `observe` 時絕不呼叫 `POST /{comment}`（is_hidden）。
5. 守門組別換不到該粉專權杖 → 不打 API、不丟例外。

### Task 1: 規則與事件處理（`server/fb/guard.js`）
- 純函式：`normText(s)`（NFKC＋小寫）、`prefilter(msg, rules)`、`judge(comment, rules, pageId)` → `{ hit, rule:'r1'|'r2'|'', tags:[] }`、`cleanRules(raw)`。
- `readGuard(env)`／`saveGuard(env, cfg)`；`guardEvent(env, body)`：逐 change 處理；`cleanupGuard(env, now)`。
- 測試 `test/server/fb-guard.test.js`：預篩、r1／r2、白名單、豁免、observe 不隱藏、hide 隱藏、粉專自己、限流略過、無文字計數、併發一列、30 天清除。
### Task 2: Webhook 掛點＋cron
- `handleFbHook(request, env, path, ctx)`；`server/index.js` 傳 ctx、cron 加 `cleanupGuard`。
### Task 3: 管理路由
- `GET/POST /admin/fb/guard`（設定＋組別＋統計）、`GET /admin/fb/guard/pages`（粉專＋訂閱狀態）、`POST /admin/fb/guard/pages/:id`（{on}）、`GET /admin/fb/guard/log`（?action&page&before）、`POST /admin/fb/guard/log/:cid/(hide|unhide)`；操作紀錄 `guard_mode`／`guard_hide`／`guard_unhide`。ROUTES、CARDS、DEFAULT_LEVELS.mgr。
### Task 4: 管理頁卡片＋e2e＋隱私權政策
- `admin/index.html` 臉書發文分類加 `#gdCard`（data-card="guard"）；`admin.js` 載入／儲存／列表；SF_ACT 補三個動作。`test/e2e/admin.e2e.js` 加一項。`privacy/` 中英各一列。
