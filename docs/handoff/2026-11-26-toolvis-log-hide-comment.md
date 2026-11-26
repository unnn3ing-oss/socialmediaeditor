# 未登入隱藏工具＋影片發布送出紀錄收合＋第一則留言隱藏（實驗）
- 狀態：進行中　- 分支：claude/beautiful-cannon-2vsihi　- 最後更新：2026-11-26
- 使用者原始需求：
  1.「如果沒有登入時，無法顯示有登入才能使用的工具，在管理頁可以由系統管理者切換」
  2.「點開該卡片才條列出粉專、發布時間、貼文按鈕」（影片發布送出紀錄）
  3.「發文隱藏留言…『留言內容』標題右側多一個『勾選』啟用區，供給當前單次貼文使用」
  0.（已做完）「影片發布送出紀錄也附上貼文連結」（方案 B，commit ca132f6）
- 順序：1 → 2 → 3，同一分支最後一起推

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 1 設定 | D1 `fb_settings` k=`tool_vis` `{on, hide:[id]}`；沒存過＝on false、hide 預設 fbpost/fbvideo/fbreports；`GET /site/vis` 公開（只回 on 時的 hide，快取 60 秒）；`/admin/site/vis` 敏感卡片 `toolvis`（進階設定，只有已解鎖系統管理者） |
| 1 外殼 | 沒登入（且沒有存憑證等待確認中）時首頁與選單不顯示 hide；讀不到設定＝全部顯示 |
| 1 直接開被隱藏的網址 | 直接開該工具頁面＋跳登入框（使用者選） |
| 2 | 卡片預設收合＋狀態膠囊；點開表格：粉專／狀態／發布時間／開啟貼文；發布時間方案 A：排程＝at、立即與草稿＝送出時間、多文＝「同原粉專」；純前端 |
| 3 | 管理頁實驗功能第三項「第一則留言隱藏」（全部人／指定員工）；符合時排程發布「留言內容」右側出現勾選（預設不勾、只限這次、清空／送出完成恢復）；只隱藏第 1 則（`POST /{comment-id}` is_hidden=true）；失敗不影響留言、顯示隱藏失敗；影片發布不加；能否隱藏自己的留言未證實 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| 0 `server/fb/video.js`、`tools/fbvideo/app.js`、css、測試 | 送出紀錄連結 | ✅ |
| 1 `server/core/sitevis.js`（新）、`server/index.js`、`levels.js`、`adminperm.js` | 設定與路由（卡片 toolvis） | ✅ |
| 1 `shell/main.js` | 過濾＋跳登入框（`/site/vis` 最多等 1.5 秒；有存憑證確認中先全部顯示） | ✅ |
| 1 `admin/index.html`、`admin/admin.js` | 進階設定卡片 `tvCard`（進分類自動讀取，同儀表板卡片） | ✅ |
| 2 `tools/fbvideo/app.js`（`logCard`、`pubTime`、`openLink`）、css | 收合卡片（展開記在 `logOpen`，刷新維持） | ✅ |
| 3 後端計時器、`server/fb/index.js` comment-opts、前端 fbpost、管理頁 labs | 隱藏留言 | ⬜ |

## 下一步
- [x] 1（測試：`test/server/sitevis.test.js`、`test/e2e/toolvis.e2e.js`、admin e2e 一項）
- [x] 2（fbvideo e2e「送出紀錄」）
- [ ] 3，各自測試，最後獨立審查，給使用者看，等「推」

## 測試
`npm test`、相關 e2e（shell／company／admin／fbvideo／fbpost）、`node build.js --check`

## 注意事項
後端需重新部署（正式＋測試）；外掛不升版號。
