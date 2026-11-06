# 排程發布工具（tools/fbpost，公司專屬）
- 狀態：**進行中**（使用者已確認，2026-11-06 回「B，開始」）　- 分支：`claude/fb-backend`　- 最後更新：2026-11-06
- 使用者原話：「我想參照目前網新排程工具的新增發文方式（介面內容，並且增加目前純文字，純文字希望可以像目前臉書前台手動發布一樣，可以讓純文字選擇預設背景色）」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 工具 | id `fbpost`、名稱「**排程發布**」、`tier: company`、群組「發文與素材」 | 使用者指定 |
| 版面 | **B 彈窗**：主畫面＝分頁「已排程／成效」＋「＋ 新增發文」按鈕；新增發文是彈窗（同網新 `#modal`） | 使用者選 B |
| 彈窗內容保留 | **關閉彈窗不清內容**（工具箱規則），只有「清空」才清；送出成功後也不自動清，結果框提供「清空並新增下一篇」 | CLAUDE.md 內容保留規則 |
| 發文模式 | 「作圖框」／「純文字」兩種（同網新），用隱藏切換 | 照網新 |
| 純文字 | **C**：預設「底圖」（瀏覽器畫 1080×1080、色票選底色、以圖片貼文送出）；另有「臉書原生背景（實驗）」＝`text_format_preset_id`（非官方、約 130 字、ID 不公開→使用者輸入代碼）；另有「無底色」＝一般文字貼文 | 使用者選 C |
| 作圖框 | 照片（點選／拖曳／貼上、縮放平移）＋框（新聞藍／娛樂粉＝公司素材；沒有就通用框 C）＋標題（每行 15 字、最多 3 行，顯示每行字數）＋T 寶貼圖＋馬賽克；**輸出要合成框和標題**（網新 exportBlob 不含，因為網新後端會疊，我們沒有） | 照網新，改為前端合成 |
| 多粉專 | 勾選多個，逐一送出、顯示進度，失敗的可單獨重送 | 使用者同意 |
| 發布時間 | 「立即發布／排程發布」；排程 popover＝日期＋4 碼時間＋「+30 分／+1 小時／明天」；限制 10 分鐘～30 天 | 照網新＋臉書限制 |
| 文章網址帶入 | 後端 `/fetch` 拿 og 標題／主圖／描述；主圖經新的 `GET /fetch/image` 代理才能畫進 canvas | 跨網域圖片不能 export |
| 已排程分頁 | 讀 `/fb/scheduled`，可「取消排程」（新 `POST /fb/cancel`，**只能刪未發布**） | 使用者同意 |
| 成效分頁 | 讀 `/fb/posts`（讚／留言／分享），點開看 `/fb/insights` | 使用者同意 |
| 不搬 | 守則判讀、AI 產生／校錯字、後端預覽、Rundown、本機送出紀錄 | 網新專屬 |
| 上線 | 使用者測完說「推」時，fb 後端＋工具一起併入 main | 使用者指定 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/graph.js` | 加 `graphDelete(env, token, path)` | ✅ |
| `server/core/fb.js` | `POST /fb/cancel`（body `{post}`；先 GET `is_published`，已發布→拒絕；未發布→DELETE；稽核 `post-canceled`）；`checkPost` 加 `textPreset`（數字 5–20 碼、只能純文字、需有內文）；multipart 收 `textPreset` | ✅ |
| `server/core/fetch.js` | `GET /fetch/image?url=`：白名單同 `/fetch`、手動轉址逐跳檢查、只收 `image/jpeg|png|gif|webp`、≤10 MB、回原始位元組＋CORS | ✅ |
| `test/server/fb.test.js`、`test/server/fetch.test.js` | 上述新路由的單元測試 | ✅ |
| `tools/fbpost/tool.json` | tier company、assets 同 pattern（sticker.*、frame.*.ribbon、frame.logo、font.title） | ✅ |
| `tools/fbpost/index.html`、`tool.css` | 主畫面（粉專狀態、分頁、＋新增發文）＋ `<dialog>` 彈窗 | ✅ |
| `tools/fbpost/editor.js` | ES module：`createPhotoEditor({canvas, assets})` → `loadFile/loadUrl/clear/setFrame/setTitle/exportBlob/hasImage/onChange`；畫法取自 `tools/pattern/app.js`（漸層、緞帶、Logo、通用框 C、標題字型）；貼圖／馬賽克取自網新 `stickers.js` | ✅ |
| `tools/fbpost/textcard.js` | `drawTextCard(canvas, {text, bg})`：1080×1080 底色＋自動換行置中文字；色票清單 | ✅ |
| `tools/fbpost/tool.js` | 主邏輯：粉專清單、分頁、已排程＋取消、成效、彈窗表單、送出流程（逐頁、重送） | ✅ |
| `tools/fbpost/TOOL.md`、`icon.svg`、`thumb.svg` | 說明與圖示 | ✅ |
| `tools/registry.json` → `node build.js` | 加 `fbpost` | ✅ |
| `test/e2e/fbpost.e2e.js` | 假後端：送出（單／多粉專、一個失敗再重送）、取消排程、彈窗關閉再開內容還在、清空、分頁切換保留 | ✅ |
| 規格 §1 表、§6 fb 列 | 加「排程發布」一列、新路由 | ⬜ |

## 下一步
- [x] 後端：graphDelete、/fb/cancel、textPreset、/fetch/image ＋ 單元測試（`npm test` 239 過）
- [x] 前端：editor.js、textcard.js
- [x] 前端：index.html、tool.css、tool.js、tool.json、TOOL.md、registry、build；SDK `tb.api.call` 的 body 可傳 FormData
- [x] e2e（`test/e2e/fbpost.e2e.js` 7 過）＋截圖給使用者
- [ ] 規格 §1、§6 補排程發布與新路由
- [ ] 獨立代理審查（sonnet）
- [ ] 使用者部署（`git pull origin claude/fb-backend` → `cd server && npx wrangler deploy`）＋網站測試；說「推」才併 main，同 commit 更新 CLAUDE.md 目前進度

## 測試
- `npm test`（全部單元，含 fb／fetch）、`node build.js --check`
- `npx playwright test test/e2e/fbpost.e2e.js --trace off`（沙盒 chromium：`/opt/pw-browsers/chromium`）

## 注意事項／不能做的事
- token 絕不能出現在 repo、回應、錯誤訊息、日誌、KV；前端拿不到 token。
- 公司素材（框、Logo、T 寶、WHZ 字型）只用 `tb.assets.get`；**不要**從網新 repo 複製 `frames/*.png`、`stickers/`、`fonts/` 進來。
- 不要改 `server/wrangler.toml`（使用者 Mac 上有未提交的 ID 修改）。
- 原生背景代碼（`text_format_preset_id`）臉書沒有公開清單；超過約 130 字或代碼無效時臉書可能默默改成一般文字貼文，介面要寫清楚「實驗」。
