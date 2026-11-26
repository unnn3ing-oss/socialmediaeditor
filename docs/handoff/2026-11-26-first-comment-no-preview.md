# 第一則留言移除連結預覽（實驗，取代「隱藏留言」）
- 狀態：已完成（2026-11-26 併入 main）　- 分支：claude/beautiful-cannon-2vsihi　- 最後更新：2026-11-26
- 使用者原始需求：「第一則留言發出後隱藏 不對，是要『移除連結預覽』」（留言下方臉書的「移除預覽」）

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 取代 | 11/26 併入的「第一則留言隱藏」整個換掉（勾選改名「移除預覽」、拿掉 is_hidden） |
| 方法 | 管理頁實驗功能可選：A＝先留不含連結的文字，再編輯成完整內容；B＝留完整內容後，編輯時帶空的 attachment_share_url |
| 舊實驗 | 「第一則留言發出後再編輯一次」保留不動（使用者：截圖時沒開，尚未證實無效） |
| 設定 | D1 `fb_settings` k=`preview_opts` `{on, who, staff, method:'a'|'b'}`；`/admin/fb/preview-opts`（labs 敏感卡片）；`/fb/me` 回 `noPreview` |
| 表單 | `noPreview=1`（只限這次送出，後端再驗發文者） |
| 結果 | `preview: removed|failed`、`previewError`；A 法編輯失敗＝留言只有文字沒有連結，要明講 |

## 做法
| 檔案 | 狀態 |
|---|---|
| `server/fb/comment.js`（取代 hide 段） | ✅ |
| `server/fb/post.js`、`timer.js`（含 A 法 recheck 比對只有文字的留言）、`manage.js`、`index.js`、`server/core/adminperm.js` | ✅ |
| `tools/fbpost/`（index、app、send、util、css） | ✅ |
| `admin/`（labH → labP＋方法選擇） | ✅ |
| 測試 | ✅ |

## 注意
臉書回成功不代表預覽消失，要使用者目視。後端需重新部署（正式＋測試）。

## 進度
- [x] 實作與測試（npm test 831、全部 e2e 313、build --check）
- [x] 獨立審查（修 2 個 Important：重查時 A 法無可拆文字改用 B；用了移除預覽就不再呼叫舊實驗 editAfterPost，避免重抓預覽）
- [x] 使用者說「推」，併入 main

## 追加：LINE 推播複製鈕按下跑位（2026-11-26）
- 原因：`ui/fx.css` 按下 `transform: scale(.97)` 蓋掉 `.cell-copy` 的 `translate(-50%,-50%)`，按住時往右下跳半個按鈕，放開時游標不在按鈕上 → 沒有 click、沒複製（使用者影片確認）
- 修正：按下改用獨立屬性 `scale: .97`（減少動態時 `scale: none`），transition 加 scale
- 測試：`linepush.e2e.js`「按住時按鈕不跑位」（舊程式重現偏移 65px/22px）；全部 e2e 314、npm test 831
