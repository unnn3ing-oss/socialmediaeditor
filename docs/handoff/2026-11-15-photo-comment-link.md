# 有圖排程留言跟著改時間／取消＋底圖輸出失敗要報錯
- 狀態：進行中　- 分支：claude/youthful-dirac-5upj3e　- 最後更新：2026-11-15
- 使用者原始需求：「確認新增發文能正常附圖、文字放貼文內容、自動留言正常，檢查有無 BUG」→ 檢查後選方案 A「先修 BUG＋小瑕疵，加回歸測試」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 照片 ID ↔ 貼文 ID 對應 | 不多打臉書：在原本就會打的請求（取消／改時間前的 `is_published` 查詢、已排程列表 `scheduled_posts`）多要 `attachments{target{id}}`，用 target id 比對 D1 只有 `photo_id` 的待留言，補上 `post_id` | 限流是之前的主因，不能增加呼叫次數 |
| attachments 欄位失敗 | 錯誤碼 100 時退回不帶 attachments 再查一次，行為與修改前相同 | 未實測排程中貼文能否讀 attachments，不能讓取消／列表因此壞掉 |
| 底圖 `toBlob` 回 null | 丟錯「輸出圖片失敗」，不送出 | 原本會悄悄發成無圖純文字貼文 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fbqueue.js` | 新增 `linkPhotoComments(env, page, post, photoIds)`、`attachmentTargets(post)` | ✅ |
| `server/core/fb.js` | `cancelPost`／`reschedulePost` 查 `is_published` 時多要 attachments 並先連結；`listScheduled` 同 | ✅ |
| `tools/fbpost/tool.js` | `buildPayload` 底圖 `toBlob` null 丟錯 | ✅ |
| `test/server/fbqueue.test.js`、`test/e2e/fbpost.e2e.js` | 回歸測試（含 toBlob null 不送出）：只有 photo_id 的留言，改早時間後 due 跟著改；取消後留言取消；列表顯示留言狀態；attachments 欄位錯誤時退回 | ✅ |

## 下一步
- [x] 實作上表
- [x] npm test 384 項、fbpost e2e 56 項、build --check 通過（新測試在舊程式碼上確認會失敗）
- [x] 獨立代理審查通過（備註：attachments 不展開子附件，降低列表回應大小）
- [ ] 給使用者看結果，等「推」

## 測試
`npm test`、`node --test test/e2e/fbpost.e2e.js`、`node build.js --check`

## 注意事項／不能做的事
- 「排程中照片貼文能否讀到 attachments.target.id」未實測；讀不到時行為與修改前相同（到原定時間才偵測）。
- 後端需重新部署；外掛不升版號。
