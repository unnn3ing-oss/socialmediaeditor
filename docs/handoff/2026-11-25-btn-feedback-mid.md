# 按鈕回饋與動畫：中優先批
- 狀態：進行中　- 分支：claude/brave-goodall-acpuli　- 最後更新：2026-11-25
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
| `tools/fbreports/` | 查詢、繼續讀取、欄位檢查「開始檢查」 | ⬜ |
| `tools/ytdl/` | 增加、開始全部下載、儲存、複製診斷、更新助手／引擎、複製安裝指令 | ⬜ |
| `tools/resize/`、`tools/watermark/` | 下載這張／全部下載（按鈕顯示 i／N） | ⬜ |
| `tools/collage/` | 下載這張、複製圖片 | ⬜ |
| `tools/pattern/` | 下載這張、全部下載、帶入 | ⬜ |
| `tools/linepush/` | 下載這張、全部下載／確認下載、快速填入 | ⬜ |
| `tools/design/` | 匯出視窗「下載」 | ⬜ |

## 下一步
- [ ] 逐工具套用 → 相關 e2e → npm test、build --check → 獨立審查 → 截圖給使用者

## 測試
`npm test`、`node build.js --check`、各工具 e2e（`test/e2e/<tool>*.e2e.js`）。

## 注意事項
- 純網站，不需部署後端、外掛不升版號（ytdl 只改網頁部分，不碰 `tools/ytdl/ext/`）。
- 各工具 base.css 可能沒有 `--surface`／`--accent` 等 token，需確認 fx.css 在工具內顏色正常。
