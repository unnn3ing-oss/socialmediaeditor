# v4：排程發布列表骨架屏＋跳動數字等寬
- 狀態：審查通過、待使用者確認　- 分支：`claude/fb-backend`（從 main 3e68c3d 起）　- 最後更新：2026-11-06
- 使用者原話：上傳「前端現代工程架構與 AI 開發工作流規範」「動態數字防抖指南」→「幫我用這兩個規則提出修改計劃」→「先做 A＋B」
- 不做：網格（首頁已是 auto-fill，其他是兩欄版面需斷點）；Logo（計畫 C，之後另開對話）

## 已定案的決定
| 項目 | 決定 |
|---|---|
| A 骨架屏 | 排程發布「已排程」「成效」讀取時放 3 列占位（尺寸同真列、`aria-busy`／`aria-hidden`、減少動態時不動）；「看成效」展開放一條占位；失敗／沒有貼文照舊文字 |
| B 等寬數字 | fbpost 成效數字、排程時間、字數、失敗數、時間輸入；浮水印 output／狀態；拼圖 output；尺寸狀態 → `font-variant-numeric: tabular-nums` |
| 外掛版號 | 不升（沒動 extension） |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/tool.js`、`tool.css` | 骨架屏＋等寬 | ✅ |
| `tools/watermark/*.css`、`tools/collage/*.css`、`tools/resize/*.css` | 等寬 | ✅ |
| `test/e2e/fbpost.e2e.js` | 讀取時有占位、讀完消失 | ✅ |

## 下一步
- [x] 實作 A、B、build、相關測試（unit 299、fbpost 19、collage／watermark／resize／shell 18）、截圖
- [x] 獨立審查有條件通過，已修 aria-busy 值與手機版骨架列（a243f38）
- [ ] 使用者說「推」 併 main（同 commit 更新 CLAUDE.md）

## 注意事項
- 改完 tools/ 任何檔都要重跑 `node build.js`（catalog `?v=` 雜湊）。
- 不改 `server/wrangler.toml`；公司素材不進 repo。
