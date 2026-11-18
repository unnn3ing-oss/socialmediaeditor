# 直播需求單改 C 版（單欄步驟式＋底列狀態鈕）
- 狀態：✅ 完成（待主對話整合）　- 分支：claude/vigilant-fermi-oqzctf　- 最後更新：2026-11-18
- 使用者原始需求：選 C；「項目檢查逐項列出狀態鈕，完成綠色打勾、提醒則是警示圖示黃色、缺少用紅色打叉」「逐項狀態鈕移動到下方工具列的左側，上一張與複製定下一張在右側」

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 版面 | 置中一欄約 1080px：① 貼上需求單（貼上框＋值班姓名＋分機一列；貼上後縮成「已貼上 N 場（點這裡重新貼上）」）② 逐張確認（標題＋時間｜FB 粉專勾選；右上場次圓點＋第 N／總數 場；完整需求單）③ 底列 |
| 底列 | 左：7 個狀態鈕（新聞事件→直播時間→FB 粉專→畫面來源→值班小編→標題→內文）；右：‹ 上一張、複製並下一張 ›（有缺漏停用）；窄時狀態鈕換列；手機上下排 |
| 狀態鈕 | 完成＝綠底綠圓白勾；提醒＝黃底黃三角驚嘆號；缺少＝紅底紅圓白叉；黃／紅點擊跳到對應位置，title 顯示原因；拿掉「還缺／提醒」文字 |
| 不變 | parse.js 規則、18氣象站封面提醒、複製後跳下一張、最後一張「全部完成／還有 N 張沒複製」 |
| 不做 | 不把缺漏提示文字塞進需求單（會被複製出去） |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| tools/livereq/index.html、tool.js、tool.css | 版面、狀態鈕、貼上縮合 | ✅ |
| test/e2e/livereq*.js | 對應測試 | ✅ |

## 測試
livereq e2e、npm test、node build.js --check。

## 結果（2026-11-18）
- 改了 tools/livereq/{index.html,tool.js,tool.css}、test/e2e/livereq.e2e.js（parse.js 未動）。
- 貼上後縮成 `#pasteBtn`（hidden 切換，不重建）；清空會展開。狀態鈕在底列 `#stBar`（`.lr-st.is-ok／is-warn／is-bad`、inline SVG、`data-key`／`data-state`），綠色 `aria-disabled`、黃紅可點跳到欄位；`#copy`＝複製並下一張（缺漏 disabled，title 顯示缺什麼），複製訊息仍在卡片內 `[data-msg]`。
- `#pagesBar`／`#nav`／`#next` 已移除；粉專勾選在卡片標題右側（`.lr-card .lr-pages`）。
- 測試：livereq e2e 13 項、npm test 619 通過；320／390px 無水平溢位。截圖 scratchpad/lr/final_desktop.png、final_mobile.png。
- 手機（≤820px）狀態鈕高 44px 自動換行（7 顆在 390px 約三列），按鈕另起一列。
