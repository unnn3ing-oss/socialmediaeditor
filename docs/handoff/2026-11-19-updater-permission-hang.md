# 外掛更新卡住（等資料夾權限）修正：外掛 3.11
- 狀態：進行中　- 分支：claude/ecstatic-goodall-mz65ql　- 最後更新：2026-11-19
- 使用者原始需求：3.00 側邊欄按「更新到最新版」後卡住（兩鈕變灰、沒有彈窗）；選「開始」做 3.11 修正。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 推論原因 | 記住的資料夾權限在 Chrome 重開後失效，`requestPermission` 的詢問沒顯示，promise 一直不回 | 未在真 Chrome 驗證 |
| 修法 | 等權限前先跳「等待 Chrome 允許存取資料夾…」彈窗；10 秒沒結果改成請使用者重選資料夾 | 使用者同意 |
| 版號 | 3.10 → 3.11 | 小 BUG |
| 暫時繞過 | 使用者先用「更換資料夾」重選再更新到 3.10 | 3.11 修正要從 3.10 起才生效 |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `extension/core/updater.js` | 新增 `ensurePermission(dir,{timeoutMs,onPrompt})`；`getFolder(opts)` 用它 | ✅ |
| `extension/core/sidepanel.js` | `apply()` 傳 onPrompt 顯示等待彈窗；逾時走 `chooseFolder(true)` | ✅ |
| `test/updater.test.js` | 逾時、granted、denied 測試 | ✅ |
| manifest.base.json／changelog.json | 3.11 | ✅ |

## 補充
- 另修：選資料夾按「取消」後兩個按鈕停在灰色（原本只有 catch 會恢復）。
- 測試：`test/updater.test.js` 加 ensurePermission 單元測試＋側邊欄流程（等待彈窗→重選資料夾→取消後按鈕恢復）。npm test、sidepanel／ytdl e2e 通過。

## 測試
`npm test`、`node build.js --check`、`npm run e2e`（sidepanel 相關）。

## 同版加做：YT 側邊欄縮小（使用者選 1B、間隔只留設定）
- `tools/ytdl/`（只在 `is-side`）：切換鈕與增加同列 40px；目前分頁卡「改貼網址」改成「增加」（`#tab-add`），卡片顯示時隱藏網址框與下方「增加」（在 YT／IG 分頁不能改貼網址，使用者決定）；「開始全部下載」由 JS 搬到 `#queue-foot`（清單最下方滿版，只搬一次）；清單標題列、設定步驟、列按鈕縮小 32px。「每支間隔」維持在「設定與工具」。
- npm test 661、全部 e2e 213 通過。
- 再縮：側邊欄清單列「複製內文／移除」24×24（圖示 14px），側邊欄不顯示每支影片下方內文框（`showText: !isSide`），網頁版照常。ytdl e2e 8 項通過。
