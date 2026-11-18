# 排程發布防重複貼文（送出 ID＋待確認）
- 狀態：進行中　- 分支：claude/sleepy-mendel-au8kxg　- 最後更新：2026-11-18
- 使用者原始需求：依 Meta 發布流程審查（交接檔 meta-publishing-review-handoff，未進 repo）的偏差 #1～#3，修正「逾時／部分失敗再送會重複發文」。使用者回「開始」。

## 審查結論（背景）
- A 單張圖：立即＝`/photos` caption＋published=true（符合）；排程＝`/photos` temporary → `/feed` attached_media（符合附件流程）。
- B 多圖、C 影片：未實作（產品沒有），本次不做。
- 偏差 #1 網路錯誤一律當失敗；#2 部分失敗後成功的粉專仍勾著，再送會重發；#3 沒有防重送。→ 本次修。
- 偏差 #4 沒查 CREATE_CONTENT、#5 KV 粉專 token 未加密、#6 立即發布未核對 is_published、#7 無員工↔粉專限制 → 本次不做。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 防重送 | 前端每則發文產生 `sendId`（清空／全部成功才換新），後端 D1 `fb_sends(send_id, page)` 記狀態 | 同一則再送時跳過已成功的粉專 |
| 結果不明 | 只有「最後那一次發布請求」連不上臉書或回應讀不到才算 `unknown`（待確認）；暫存照片那步失敗仍算失敗 | 暫存照片沒發布，重送安全 |
| 待確認再送 | 預設不重送；前端跳確認框（請先到已排程／已發佈確認），選「仍要送」才帶 `retry` 名單重送 | 避免重複，又不會卡死 |
| 進行中 | 同 sendId＋粉專還在 `pending`（另一個請求處理中或 Worker 中斷）→ 回 `unknown` | 不並行重發 |
| 先前已成功 | 回 `ok:true, dup:true`，不留言、不寫操作紀錄、不寫 RD | 已處理過 |
| 清理 | 每天 cron 刪 7 天前的 `fb_sends` | 只為短期防重送 |
| 相容 | 沒帶 `sendId` 照舊（不記錄） | 舊頁面快取 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/graph.js` | `GraphError.uncertain`（fetch 例外或 HTTP 成功但讀不到 JSON） | ⬜ |
| `server/fb/sends.js`（新） | 建表、claim／finish／cleanup | ⬜ |
| `server/fb/post.js` | parsePostForm 收 `sendId`、`retry`；createPosts 先 claim、結果寫回；`unknown` 結果 | ⬜ |
| `server/fb/index.js` | dup 不寫操作紀錄 | ⬜ |
| `server/index.js` | cron 加 cleanupSends | ⬜ |
| `tools/fbpost/send.js` | sendId、待確認確認框、結果文字（待確認／先前已送出） | ⬜ |
| `tools/fbpost/rd.js` | 跳過 `dup` | ⬜ |
| `test/server/fb-post.test.js` | 新測試：重送跳過、unknown、pending、retry | ⬜ |

## 下一步
- [ ] 後端＋測試 → 前端 → npm test／fbpost e2e → 獨立審查 → 給使用者看

## 測試
`node --test test/server/fb-post.test.js`、`npm test`、`npx playwright test test/e2e/fbpost.e2e.js --trace off`。

## 注意事項
- 不推 main；後端需重新部署（自動建表）；外掛不升版號。
