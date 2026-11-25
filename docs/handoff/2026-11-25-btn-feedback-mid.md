# 按鈕回饋與動畫：中優先批
- 狀態：已完成（已併入 main）　- 分支：claude/brave-goodall-acpuli　- 最後更新：2026-11-25
- 使用者原始需求：「接著做：按鈕回饋中優先批」（前一批見 `2026-11-24-fbvideo-btn-feedback.md`）

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 共用 | 沿用 `ui/fx.js`／`ui/fx.css`（busy／ok／fail），不改輸出、不改下載流程 | 與上一批一致 |
| resize／watermark 全部下載進度 | **B**：按鈕顯示「儲存第 i／N 張」，狀態列照舊逐張顯示 | 狀態列在預覽下方、離按鈕遠；使用者選 B |
| 範圍 | 數據報表、YT 下載、圖片工具下載鈕（pattern、collage、resize、watermark、linepush、design）、快速填入（pattern 帶入、linepush 快速填入） | 中優先清單 |
| 不做 | 直播需求單複製、全站按下縮放、toast 滑入 | 低優先另批 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbreports/` | 查詢、繼續讀取、欄位檢查「開始檢查」 | ✅ |
| `tools/ytdl/` | 增加、開始全部下載、儲存、複製診斷、更新助手／引擎、複製安裝指令 | ✅ |
| `tools/resize/`、`tools/watermark/` | 下載這張／全部下載（按鈕顯示 i／N） | ✅ |
| `tools/collage/` | 下載這張、複製圖片 | ✅ |
| `tools/pattern/` | 下載這張、全部下載、帶入 | ✅ |
| `tools/linepush/` | 下載這張、全部下載／確認下載、快速填入 | ✅ |
| `tools/design/` | 匯出視窗「下載」 | ✅ |

## 下一步
- [x] 逐工具套用 → 相關 e2e（resize／watermark 10、pattern／collage 31、linepush 12、design 10、fbreports 7、ytdl 9、sidepanel 等 11）→ npm test 823、build --check
- [x] 獨立審查通過（修 ytdl 轉圈中 tab-add／save-outdir 被重畫重新啟用，`4b3a4ac`）
- [x] 使用者說「推」，已併入 main（同 commit 更新 CLAUDE.md 目前進度）

## 實作細節
- `ui/fx.js` 新增 `restLabel(btn)`（打勾中再按時拿原本的字）；`busy()` 記 `data-fx-back`。`ui/fx.css` 變數加後備值、一般 `<button>` 轉圈時 inline-flex、停用不半透明。
- 數據報表：讀取中查詢鈕轉圈但**仍可按**（原本可改條件重查，e2e「舊查詢晚回不覆蓋畫面」依此）。
- YT 下載：開始／停止按下後轉圈，等下載助手回報狀態變了（或 10 秒）才換回；失敗抖動。
- LINE 推播快速填入是同步動作（成功後面板收起），只在「找不到★內容」時抖動。
- 設計：「下載這張」保留圖示，自己換轉圈／打勾（`expBtnFx`）。
- `shell/catalog.json` 原本就過期（main 上 build --check 不過），已重產。

## 測試
`npm test`、`node build.js --check`、各工具 e2e（`test/e2e/<tool>*.e2e.js`）。

## 注意事項
- 純網站，不需部署後端、外掛不升版號（ytdl 只改網頁部分，不碰 `tools/ytdl/ext/`）。
- 各工具 base.css 可能沒有 `--surface`／`--accent` 等 token，需確認 fx.css 在工具內顏色正常。
