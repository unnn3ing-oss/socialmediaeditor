# YT 卡片固定高度＋失敗自動重試／姓名可改／權限組重新設計／選套版沒照片不能送出
- 狀態：進行中　- 分支：claude/eloquent-thompson-4zwayi　- 最後更新：2026-11-21
- 前一段（選色列左右滑等，`3c7db71`、`4bad7e2`）已在本分支，尚未併入 main（等使用者「推」）。
- 使用者原始需求：「列表中的卡片，顯示狀態或按下按鈕都不要改變卡片高度」「影片下載失敗自動在間隔時間後重試一次」「管理頁的姓名可由系統管理者更改」「權限組的權限要以主要功能來顯示選項，層級權限跟隨權限組，人員與權限中不需獨立選擇」「選套版但沒放照片直接改成不可送出」
- 使用者選：內文框 A（一開始就放好框）、Q1 A（影片發布、數據報表與排程發布分開勾）、Q2 B（本對話一起做）

## 已定案的決定

### 1. YT 下載卡片固定高度（`tools/ytdl/web/queue-view.css`、`queue-view.js`；網頁＋側邊欄共用）
| 情況 | 做法 |
|---|---|
| 標題 1／2 行 | 標題區固定 2 行高 |
| 進度條隱藏 | 保留位置（visibility hidden） |
| 狀態文字 | 單行省略號，title 顯示全文（失敗原因也是） |
| qflash（已複製、擷取中…）、qhint（同標題提醒） | 不另起一行：flash 暫時取代狀態文字約 3 秒；hint 改為狀態列小黃標（title 全文） |
| 重試鈕 | 搬到狀態列小按鈕；右側固定複製、移除 2 顆 |
| 移除確認 | 疊在同一列（absolute），1 行問句＋取消／移除，列高不變，封面可見 |
| 網頁內文框（qtext） | 有影片就先顯示（讀取中 placeholder），高度不變（方案 A） |

### 2. 下載失敗自動重試一次（`tools/ytdl/ext/lib/queue.js`、`queue-controller.js`；外掛 3.12→3.20＋changelog）
- 失敗（有影片 ID）→ 等「每支間隔」秒數 → 自動重試 1 次（同一支只自動一次）；等待時用冷卻樣式顯示「失敗，X 秒後自動重試」；再失敗才顯示失敗＋重試鈕。
- 不重試：沒有 ID、使用者停止、移除。

### 3. 系統管理者可改姓名
- 授權名單姓名欄：系統管理者（sys，未解鎖即可）看到輸入框（Enter／離開欄位存）；其他人唯讀。
- `POST /admin/staff/:id` 接受 `name`（1～20 字，trim），只有 sys；寫操作紀錄（action `staff_rename`）。

### 4. 權限組重新設計（Q1 A）
- 權限組選項依主要功能分區；**層級（mgr／user）拿掉**，管理頁卡片改由權限組決定。
- 權限 key：
  - 排程發布：`view` 檢視、`post` 新增發文（含 RD）、`edit` 改時間、`delete` 刪除
  - 影片發布：`vview` 檢視、`vpost` 上傳發布（含改時間刪除）
  - 數據報表：`report` 檢視
  - 共用：`bypass` 排程發布／影片發布關閉時仍可使用
  - 管理頁卡片：`card:<key>`，可選＝levels.js 的 GRANTABLE 去掉敏感卡片：pages、presets、video、bg（發文設定）／guard（留言管理）／staff（人員與權限）／fbstate、rundown、usage（連接狀態）／assets（素材設定）／audit、logs（使用紀錄）
- 進階設定卡片（access、profiles、fbconn、webhook、groups、levels）只有系統管理者。
- 授權名單拿掉「層級」欄；「層級權限」卡片與 `/admin/levels` 刪除。
- 誰能管誰：有 `card:staff` 的人只能管理「權限組權限是自己子集且不完全相同」的人（不能管自己）；指派權限組只能指派自己權限子集（沿用現有 subsetOf）；新增人員同規則。sys 不受限。
- 舊資料搬移（第一次讀取自動、只做一次）：每個權限組，若有 `post`→補 `vpost`、有 `view`→補 `vview`、`report`；若組內有任一成員 `level='mgr'`→補 `card:` ＋ 舊 `admin_levels.mgr`（讀不到用 DEFAULT_LEVELS.mgr）；否則補舊 `admin_levels.user`。搬移標記存 fb_settings k=`perms_v2`。
- 後端路由：fbpost 路由維持 view/post/edit/delete；`/fb/video*` 改 `vview`／`vpost`；`/fb/reports/*` 改 `report`；`/rundown` 需要 `post` 或 `vpost`（route need 支援陣列＝任一即可）。
- 首頁「管理頁」入口（auth.js `manage`）＝權限組有任何 `card:`。
- 前端：fbvideo 用 `vview`／`vpost`；fbreports 依 `report`（沒有就顯示沒有權限）；管理頁權限組卡片依分區顯示勾選。

### 5. 選套版沒有照片不能送出（`tools/fbpost/send.js`）
- 選套版且沒有照片：送出鈕停用，提示泡泡「選套版需要照片，請貼上或選一張照片，或改用純文字」。

## 做法
| 部分 | 誰做 | 狀態 |
|---|---|---|
| 1＋2 YT | 子代理 A（Sonnet） | ⬜ |
| 3＋4 姓名＋權限 | 子代理 B（Sonnet） | ⬜ |
| 5 fbpost | 主對話 | ⬜ |

## 測試
npm test；各自相關 e2e；整合時主對話跑全部 e2e；build --check。

## 注意事項
- 後端需重新部署（正式＋測試），不用手動 SQL；外掛 3.20。
- 已存過「層級權限」的環境由搬移自動轉換。
