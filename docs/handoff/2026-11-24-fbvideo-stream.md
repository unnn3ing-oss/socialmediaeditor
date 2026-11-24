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
| `server/fb/videostream.js`（新） | 設定讀寫（`videoOpts`／`saveVideoOpts`／`streamApplies`）＋`receiveChunkStream` | ⬜ |
| `server/fb/video.js` | 匯出共用的 rows/update/updateIf/finishReady/result 等給串流版 | ⬜ |
| `server/fb/index.js` | chunk 路由判斷；`GET`／`POST /admin/fb/video-opts` | ⬜ |
| `server/core/adminperm.js` | 新路由對應 `labs` 卡片 | ⬜ |
| `admin/index.html`、`admin.js` | 第二張實驗卡片 | ⬜ |
| 測試 | 單元（位元組比對、fallback、設定）、admin e2e | ⬜ |

## 下一步
- [ ] 實作後端與管理頁、測試、獨立審查、截圖給使用者

## 測試
`npm test`、`npx playwright test test/e2e/admin*.e2e.js test/e2e/fbvideo*.e2e.js`、`node build.js --check`

## 注意事項
- 只改後端與管理頁；後端需重新部署（正式＋測試），外掛不升版號。
- 沙盒連不到臉書，速度與「上傳一半失敗」是否改善要使用者實測。
