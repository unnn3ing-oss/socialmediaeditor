# 小編工具箱 UI 更新：設計交接
- 狀態：實作中（使用者 2026-11-18 回「開始」，依序做第 1～3 輪）
- 文件分支：`codex/ui-design-handoff-20261118`
- PR 目標開發分支：`dev/ui-refresh`（由 main `137f961f31c50579ef6f05bf91d045618be4dbd2` 建立）
- 最後更新：2026-11-18（Asia/Taipei）
- 使用者原始需求：「給我整個設計規範、設計配色、形狀，目標要可讓我交接給 claude code……」「幫我 pr 到開發分支，可以讓 claude 接手。」

## 手機需求補充（2026-11-18）

使用者追加：「那也需要有針對手機優化的介面」。手機是同批必要交付，不是把桌面縮小。必讀 [手機介面規範](../design/2026-11-18-ui-refresh-mobile-spec.md)：觸控單列導覽、製圖局部編輯／預覽、底部動作、安全區／鍵盤／iframe 捲動、九工具適配及 M-01～M-12。UI 仍未實作，實機仍待驗證。

## 實作輪次（使用者已確認）
| 輪 | 內容 | 狀態 |
|---|---|---|
| 1 | tokens＋單列導覽（桌面 disclosure 下拉／≤820px 或觸控「工具」面板）＋首頁 3／2／1 欄 | ✅ `4669287`（shell e2e 22、company／status／tokens e2e、npm test 618、build --check 通過） |
| 2 | （子代理進行中）圖片套版桌面＋手機（編輯／預覽切換、底部操作列），只改排版、輸出逐像素比對 | ⬜ |
| 3 | （3 個子代理進行中：linepush／collage／watermark／resize、design／livereq、fbpost／ytdl）其他 8 工具依 mobile spec §6（含 YT 下載、尺寸按鈕對齊） | ⬜ |

### 第 1 輪實作重點
- 導覽同一份 DOM：`#toolbar` 內 `#tools-btn`（≤820px 才顯示）＋`#tools-panel`（工具首頁、各分類 `.nav-group`＞`.nav-trigger`＋`.nav-menu`、手機狀態槽）。工具按鈕 `#toolbar button[data-tool]`，目前工具用 `aria-current="page"`（取代 aria-pressed）。
- hover 只在 `(hover:hover) and (pointer:fine)` 且 >820px；`window blur`（點進 iframe）、外部 pointerdown、focusout 收起；Esc 還焦點；ArrowDown 進第一項；選工具後焦點進 iframe。
- ≤820px 把 `#status` 搬進面板（`.nav-status`），公司狀態 warn 時「工具」鈕加提示點。
- 首頁卡片標籤：`tool.json` 新增選填 `badges`（build.js 傳進 catalog），`requires` 自動加「需要外掛」「需要下載助手」。
- 安裝教學 CSS、`ui/compose/fx.css` 換新色與圓角；`shell/installer.js`（Windows 安裝程式畫面）不動。

## 已定案的決定

| 項目 | 決定 | 理由 |
|---|---|---|
| 首頁 | 前次提案「方案 2」：完整工具入口，做圖 6 項＋發文與素材 3 項 | 九項工具與使用條件清楚可找 |
| 手機 | 單列觸控工具面板、製圖局部編輯／預覽、可避讓鍵盤的底部操作；非製圖採單欄 | 使用者追加要求，與桌面同批交付 |
| 工作頁 | 前次提案「方案 1」：左設定＋右側大預覽＋本次圖片列 | 延續既有習慣，減少框線與無效空間 |
| 導覽 | 只有一列全域 header；分類為做圖／發文與素材 | 使用者明確要求不要兩層工作列 |
| 選單 | 最近選定的「A 精簡直式下拉」 | 游標移到分類才展開，圖示＋名稱，不放雙欄／縮圖 |
| 配色 | 白／淺灰／藍色 #155EEF | 延續偏好的整體 C 風格；不是墨綠 B |
| B 的定位 | 溫潤米白墨綠是備選，這次不實作 | 使用者已選 C 結構及 A 選單 |
| 功能 | 九工具全部保留，非製圖工具保留表單／清單 | 不以「極簡」刪功能 |
| 權限與狀態 | 保留公司模式、管理員測試、外掛／助手判斷、iframe 保留內容 | UI 改版不能改功能合約 |
| 輸出 | canvas 成品框、字型、尺寸、DPI、命名不因 UI tokens 改變 | 示意圖內容不等於新的成品模板 |

注意：先前討論的 A／B／C 曾分別指整體視覺和導覽選單；本次定案是「藍白 C 的整體視覺＋A 的窄版直式選單」，不是深色 A 風格。

## 做法（改哪裡）

| 檔案／範圍 | 內容 | 狀態 |
|---|---|---|
| docs/design/2026-11-18-ui-refresh-spec.md | 完整規範：功能、tokens、字級、形狀、尺寸、RWD、選單狀態、驗收與接手指令 | ✅ 完成 |
| docs/design/2026-11-18-ui-refresh-mobile-spec.md | 手機布局、觸控／安全區／鍵盤、各工具手機限制、12 項手機驗收 | ✅ 規範完成，UI 未開始 |
| 本交接檔 | 已定案、範圍、下一步與測試狀態 | ✅ 文件交付完成；實作時續更新 |
| ui/tokens.css | 映射新 tokens，移除光暈／厚陰影／全面膠囊；保留既有變數名稱 | ⬜ 未開始 |
| shell/toolbar.js、shell/shell.css、shell/main.js | 單列分類 disclosure、hover／click／鍵盤與觸控；接回既有 onOpen | ⬜ 未開始 |
| shell/status.js、shell/company.js | 配合單列及窄屏狀態顯示；保留所有既有登入／到期／安裝流程 | ⬜ 未開始 |
| shell/showcase.js、首頁樣式 | 緊湊工具卡、3／2／1 欄，沿用 catalog 工具資料 | ⬜ 未開始 |
| tools/pattern/ | 先做工作頁視覺試點；不改圖片渲染／輸出 | ⬜ 未開始 |
| tools/ 其他八個工具 | 試點驗證後逐一調整，不強制共用同一畫布布局 | ⬜ 未開始 |
| test/ | 補導覽互動、狀態保留、響應式與必要回歸 | ⬜ 未開始 |

## 下一步

- [x] 取得文件分支：`git fetch origin codex/ui-design-handoff-20261118`，閱讀規範與本交接檔。
- [x] 若 PR 尚未合入目標，直接 checkout 文件分支接手；若已合入，從最新 dev/ui-refresh 建立實作分支。依使用者當次指定分支優先。
- [x] 先讀 CLAUDE.md，確認實作授權；這次使用者授權的是規範交接 PR，不能據此宣稱已要求部署或已完成 UI。
- [x] 重讀當前 ui/tokens.css、shell/toolbar.js、shell/showcase.js、shell/panes.js 與要改的工具，不憑舊圖推論現況。
- [x] 檢查既有 CSS／測試實際依賴，回報檔案與計畫；按倉庫流程取得開始實作的指令。
- [ ] 先完成 tokens＋單列導覽＋工具首頁，再同步做圖片套版桌面／手機試點；依 mobile spec 完成編輯／預覽切換與安全區、鍵盤、iframe 捲動驗證。
- [ ] 實測滑鼠跨過觸發鈕與面板間隙、鍵盤、觸控、點 iframe 外部關閉及焦點回復。
- [ ] 從圖片套版切到其他工具／首頁再返回，確認內容、照片、既有 iframe 保留。
- [ ] 比較改版前後輸出，確認 UI 字型／背景沒有改到 PNG／JPG。
- [ ] 更新本檔完成項、測試、截圖位置及待驗證事項，提交實作 PR；不自行合併 main。

## 測試

本 PR 只變更 Markdown，未修改 UI／後端／外掛，因此未執行網站測試，不宣稱瀏覽器或輸出已驗證。

文件驗證：檢查 Markdown fence 成對、九個工具 ID、必要選單互動／tokens／RWD 章節、AC-01～AC-12 及 M-01～M-12 驗收編號，並核對 PR 差異僅包含設計與交接文件。

實作時按 CLAUDE.md 的測試分層規則，先相關測試，整合時執行：

```sh
npm test
npm run e2e
node build.js --check
```

視覺與人工矩陣：
- 寬度 320、375、390、768、820、821、1024、1280、1440px。
- 首頁、工作頁、做圖下拉、發文與素材下拉；目前工具、hover、focus、未連線／錯誤。
- 公開／公司／過期／管理員測試；200% 文字放大、鍵盤、觸控與橫向。
- 手機必要截圖：首頁、工具面板、pattern 編輯／預覽、鍵盤展開、直播需求單、YT 不支援狀態。
- iPhone／LINE 內建瀏覽器、公司素材與 Windows／Mac 助手：未實機測試必須列明，不能用規範或靜態示意圖當通過證據。

## 注意事項／不能做的事

- 此 PR 是文件交接，不是已完成改版。不要回報 UI 已更新。
- 不重建／移除既有 iframe，不重設 src；工具內分頁使用 hidden，內容保留。
- 不新增自動儲存。多數製圖資料只在記憶體；設計可存 JSON；直播值班與下載佇列維持各自既有保存規則。
- 不把 LINE 製圖寫成直接發送；不要繞過排程發布管理員限制。
- 不把公司素材、密碼、token、使用者資料或假公司圖例上傳到公開 repo。
- 不修改後端、外掛／助手與下載引擎；純網站更新不升外掛版號。
- 不手改 catalog／manifest／routes 等產生檔；需要時改來源並跑 build。
- 不採雙欄選單、圖像 mega menu、常駐第二排工具列、永久左側全域工具列。
- 操作區 tokens 不得改變輸出圖的設計。保留既有 iPhone 防撐寬與無障礙修正。
- 生成示意圖未作為公司資產或 runtime 新增；精確尺寸、狀態、功能與驗收以 spec 為準，圖例不是新功能要求。
