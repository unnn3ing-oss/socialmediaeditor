# 工具窗格、送出狀態與 LINE 複製連結
- 狀態：進行中　- 分支：`codex/tool-ui-copy-links`　- 最後更新：2026-11-07
- 使用者已確認「開始」，三項修改一起處理。

## 已定案的決定
- 網頁單工具與左右並排移除整列工具標題框，各窗格保留圓形 ×；關閉仍保留 iframe 內容。
- fbpost 數量改用「個粉專」，逐粉專進度在原送出按鈕顯示「正在排程到 NAME／正在發送到 NAME」。清空與送出維持同列不跳動，長名稱省略，錯誤另放按鈕列下方；保留 RD 寫入與完成階段。
- LINE 步驟2檢查畫面，滑鼠移到格子中央出現「複製推播連結」，觸控點格子。只複製連結不含標題，移除舊參數，新聞 UTM=LineNewsPush/push，娛樂=LineNewsPush/enewsline，沒有連結顯示提示。
- LINE 對照來源：unnn3ing-oss/LinePushPatternTool，4985e527，index.html 的 withUtm、showCellCopy 流程；參考副本 /tmp/linepush-reference。

## 做法
- shell/panes.js、shell.css 與 shell e2e：窗格關閉鈕、鎖定層、並排及內容保留。
- tools/fbpost/tool.js、index.html、tool.css 與 fbpost e2e：按鈕進度與單位排版。
- tools/linepush/tool.js、index.html、tool.css、TOOL.md 與 linepush e2e：浮動複製連結。

## 下一步
- [ ] 實作、測試與各項獨立審查。
- [ ] 更新交接並推開發分支；不推 main、不部署。

## 注意事項
- 不儲存 LINE 草稿、不新增正式推播、不動公司素材；複製失敗需顯示原因。
- 移除標題列時保留 iframe 的無障礙標題與關閉鈕名稱，不重建工具內容。
