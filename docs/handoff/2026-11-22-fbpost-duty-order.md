# 交接：排程發布值班粉專排前面（2026-11-22）

- 分支：`claude/sharp-einstein-n8ng5f`
- 需求：新增發文底列粉專膠囊，有選值班的粉專排在前面。
- 做法：`tools/fbpost/targets.js` `render()` 依 `defaults()`（值班 id）把值班粉專排前、其餘照原順序；`applyDefaults()`（值班改了）先關時間選單再重排，沒勾任何粉專時才套勾選（行為同前）。送出順序（`collect`）不變。
- 測試：`test/e2e/fbpost.e2e.js` 新增「膠囊列值班排前面…」；fbpost e2e 44、fbpost-compose＋sidepanel 28 通過；`node build.js` 更新 catalog 版本參數。
- 另：安裝檔合併 YT＋圖形化的決定記在 CLAUDE.md 待辦（暫緩）。
- 狀態：已改好、等使用者確認；未併入 main。
