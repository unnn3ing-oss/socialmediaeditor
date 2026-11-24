# 影片上傳串流轉送（實驗功能）
- 狀態：進行中　- 分支：claude/adoring-newton-hl37xe　- 最後更新：2026-11-24
- 使用者原始需求：「影片上傳改串流轉送（方案 A）」；之後改為「現行方式保留，新方案放入實驗功能，只對特定人開放，有開啟才切換」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 預設 | 現行 `receiveChunk`（整段讀完再轉）不動、預設使用 | 使用者要求保留 |
| 開關 | 管理頁「進階設定 → 實驗功能」第二張卡片「影片串流上傳」：開關＋全部人／指定員工；D1 `fb_settings` k=`video_opts` `{stream,who,staff}`，預設關 | 同「第一則留言再編輯」 |
| 判斷 | `/fb/video/chunk` 依登入者 `me.who.uid` 每段判斷；前端不改 | 兩種做法都只認 offset，可中途切換 |
| 串流範圍 | Reels：raw body 直接轉；橫式：multipart 串流；多粉專同長度 `tee`；長度不同 → 交回現行做法 | 正確性優先 |
| 重試 | 串流版沒有後端重試（body 已用掉），靠前端每段重試 2 次 | 無法重放串流 |
| 權限 | 管理 API 掛 `labs` 敏感卡片（只有已解鎖系統管理者） | 同現有實驗功能 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/videostream.js`（新） | 設定讀寫（`videoOpts`／`saveVideoOpts`／`streamApplies`）＋`receiveChunkStream` | ✅ |
| `server/fb/video.js` | 匯出共用的 rows/update/updateIf/finishReady/result 等給串流版 | ✅ |
| `server/fb/index.js` | chunk 路由判斷；`GET`／`POST /admin/fb/video-opts` | ✅ |
| `server/core/adminperm.js` | 新路由對應 `labs` 卡片 | ✅ |
| `admin/index.html`、`admin.js` | 第二張實驗卡片 | ✅ |
| 測試 | 單元（位元組比對、fallback、設定）、admin e2e | ✅ |

## 下一步
- [x] 實作後端與管理頁、測試（commit `37eddbe`）
- [x] 獨立審查：無 Critical／Important；Minor 已修（實驗功能依序讀取、員工編號規則共用、移除無效的 branch.cancel）
- [ ] 使用者確認後說「推」併入 main（同 commit 更新 CLAUDE.md 目前進度）
- [ ] 使用者部署後端（正式＋測試）→ 管理頁「進階設定 → 實驗功能」只開給自己 → 上傳大檔比較速度、失敗時回報左側紅字

## 結果
npm test 821（新 `test/server/fb-video-stream.test.js` 6 項）、admin e2e 44、fbvideo e2e 15、build --check 通過（main 上 `shell/catalog.json` 本來就過期，這次一起重產）。
備註：`fb_retry`（503）新錯誤碼；`graph.js` 抽出 `graphFetch`；`video.js` 匯出 rows／update／updateIf／finishReady／result／errText，`ruploadPart` 可收串流；管理頁 `#labEdit` 改名 `#labOn`，兩項共用 `makeLab`。

## 測試
`npm test`、`npx playwright test test/e2e/admin*.e2e.js test/e2e/fbvideo*.e2e.js`、`node build.js --check`

## 注意事項
- 只改後端與管理頁；後端需重新部署（正式＋測試），外掛不升版號。
- 沙盒連不到臉書，速度與「上傳一半失敗」是否改善要使用者實測。

## 上線實測要確認（審查提出，沙盒驗不到）
- 臉書 transfer 是否接受手組、固定 Content-Length 的 multipart。
- rupload 對串流本文的行為。
- 多粉專 tee 時一路較慢會緩衝，記憶體峰值可能接近現行做法。
- 建議第一次只開給自己、單一粉專的 Reels 測。
