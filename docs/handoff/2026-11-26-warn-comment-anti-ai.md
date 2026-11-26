# 警語留言＋防 AI（noindex／後端擋 AI 爬蟲）
- 狀態：進行中　- 分支：claude/friendly-heisenberg-7ss33y　- 最後更新：2026-11-26
- 使用者原始需求：「警語是要用在留言處，如果有增加則可以不受上限限制」「方案 1 可以同時，防 AI 做①＋3，開始」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 警語放哪 | 獨立一則留言（方案 1），不放貼文內容 | 使用者選 |
| 時間 | 與第 1 則同時（offset 與第 1 則相同，排在第 1 則之後；計時器依序留，第 1 則成功後立刻留） | 使用者選「同時」 |
| 上限 | 不佔「最多 3 則」名額（計時器 MAX_ITEMS 3→4） | 使用者要求 |
| 警語清單 | 工作文件「警語」段 20 條，內建在 `ui/warnings.js`，可多選，多條合成一則（換行分隔） | 先寫死，之後要管理頁再做 |
| 範圍 | 排程發布＋影片發布 | 兩個工具都有留言 |
| 防 AI ① | 所有 HTML 頁加 `<meta name="robots" content="noindex, nofollow, noai, noimageai">` | 使用者選 |
| 防 AI ③ | Worker 依 User-Agent 拒絕 AI 爬蟲（403），`/fbhook` 不受影響 | 使用者選 |
| 不做 | 資安 2／4／5、C 方案、robots.txt | 使用者：「其他都先不用」 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `ui/warnings.js`（新） | 清單＋「警語 ▾」多選元件 | ✅ |
| `tools/fbpost/index.html`、`send.js`、`app.js`／`compose.js` | 留言列加警語、送出帶 `warn`、清空 | ✅ |
| `server/fb/post.js` | `parsePostForm` 收 `warn`（≤2000 字），插在第 1 則後、offset 0 | ✅ |
| `server/fb/timer.js` | `MAX_ITEMS` 4 | ✅ |
| `tools/fbvideo/editor.js`、`server/fb/video.js` | 影片留言加警語、後端收 `warn` | ✅ |
| 全部 `*.html` | robots meta＋測試檢查 | ✅ |
| `server/core/aibots.js`（新）、`server/index.js` | AI 爬蟲 UA 擋 403 | ✅ |

## 下一步
- [x] 後端 warn＋測試 → 前端 fbpost → fbvideo → robots meta → AI UA → 測試、截圖、獨立審查（通過，Minor：沒網址只有警語時編號顯示第 2 則，不修）
- [ ] 使用者看截圖確認 → 說「推」才併入 main（同一 commit 更新 CLAUDE.md 目前進度）→ 使用者部署後端（正式＋測試）

## 測試
`npm test`、`npx playwright test test/e2e/fbpost*.e2e.js test/e2e/fbvideo.e2e.js`、`node build.js --check`

## 注意事項／不能做的事
- 不推 main；後端改動需使用者重新部署（正式＋測試）

## 結果
- npm test 857 全過；fbpost／fbvideo／fbpost-compose／sidepanel e2e 106 項中 105 過，比對圖那項為既知並跑偶發，單獨重跑 26/26 過；build --check 通過（順帶重產過期的 shell/catalog.json）。
- `shell/install.html` 是片段（沒有 head），不加 meta；`extension/` 不改（避免升版）。
