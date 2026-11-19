# 影片發布：RD 開關、正方形封面、發布方式全套用、草稿、多文發佈
- 狀態：進行中　- 分支：claude/magical-fermat-mt568n　- 最後更新：2026-11-19
- 使用者原始需求：「下方工具列的排入RD沒有正確顯示開關」「封面選擇預覽改為正方形符合位置的等比寬高」「套用到全部影片，改為『發布方式全套用』」「發布形式增加存到『草稿』」「發布方式也可以選擇『多文發佈』，跳出選單可選要多文粉專（限已有顯示的粉專）」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| RD 開關 | 改用 fbpost 的 `rd-switch` 結構（checkbox＋track），id `rdOn` 不變 | `.switch` 是給 button[aria-checked] 用，checkbox 套用會壞 |
| 封面預覽 | 42×42 正方形框、`object-fit: contain`、深色底；沒選＝「自動」 | 使用者要求 |
| 按鈕名稱 | 「發布方式全套用」 | 使用者要求 |
| 發布方式 | 每粉專下拉：立即／排程／草稿／多文發佈 | 使用者選「放在發布方式」 |
| 草稿 | 橫式 `/videos` finish 帶 `published=false`＋`unpublished_content_type=DRAFT`；Reels `video_state=DRAFT`。草稿不排留言；封面照樣嘗試 | 橫式 DRAFT 未實測 |
| 多文發佈 | 只限橫式影片；選了跳選單勾目標粉專（只列網站顯示的粉專、排除本支已上傳的粉專）；原粉專發布後 `POST /{目標}/videos` 帶 `crossposted_video_id`；排程原粉專＝到時間由計時器多文；多文粉專不排留言 | Reels 推論不支援 API 多文；需粉專間先建多文關係 |
| RD 草稿 | 今天欄右邊 1～8 欄、現在時段區塊起往相近區塊找；橫式：標記「純影已上傳」下第一格 `純影/`、或標記「草稿內」下第一格 `純影/`／`網新/`；Reels：標記含「2359」下第一格 `reels/`（不分大小寫）；優先欄位都沒空位再找同區塊其他欄同類預留格（橫式只認 `純影/`）；覆蓋保留格式、不插列；找不到回報失敗＋一鍵複製 | 使用者截圖確認 |
| RD 多文 | 標記「多文」或「多文內」的欄，最後一格有內容的下面第一個 `純影/` → `純影/SLUG` | 使用者要求 |
| Apps Script | 在 `-schedulenewnet`，本 repo 不改；交付補丁文件讓使用者自己貼 | 同前例（綠色字補丁） |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbvideo/index.html`、`fbvideo.css` | RD 開關、正方形封面、按鈕改名、多文選單 dialog | ⬜ |
| `tools/fbvideo/editor.js` | 發布方式加草稿／多文、多文目標、pagesForSend 帶 mode | ⬜ |
| `tools/fbvideo/app.js` | 套用提示、送出帶 draft／cross、RD entry 帶 slot | ⬜ |
| `server/fb/video.js` | 欄位 `mode`（now/sched/draft）、`cross`（JSON 目標粉專）、finish 草稿參數、多文呼叫與狀態 | ⬜ |
| `server/fb/rundown.js` | entry 接受 `slot: 'draft'｜'cross'`、`kind: 'video'｜'reel'` | ⬜ |
| `docs/rundown-gs/rdslot.js`＋`docs/rundown-gs-draft-slot.md` | 補丁函式（可在 Node 測）＋貼法 | ⬜ |
| 測試 | `test/server/fb-video*.test.js`、`test/rdslot.test.js`、`test/e2e/fbvideo*.e2e.js` | ⬜ |

## 下一步
- [ ] 前端小改（1～3）
- [ ] 後端草稿＋多文
- [ ] 前端草稿＋多文
- [ ] RD slot＋Apps Script 補丁
- [ ] 測試、截圖、獨立審查

## 測試
`npm test`、`node --test test/e2e/fbvideo*.e2e.js`、`node build.js --check`

## 注意事項／不能做的事
- 不改 `-schedulenewnet`；不推 main，等使用者說「推」。
- 草稿／多文都**尚未實測臉書**。
