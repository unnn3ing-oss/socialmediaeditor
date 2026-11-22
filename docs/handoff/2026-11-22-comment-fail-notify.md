# 留言失敗紅字＋重新留言＋錯誤紀錄＋登入通知＋已排程 30 分鐘自動刷新
- 狀態：已完成（併入 main）　- 分支：claude/modest-bohr-dxn17c　- 最後更新：2026-11-22
- 使用者原始需求：「第二次自動嘗試時就讓列表亮紅字，並出現『重新留言』按鈕。將該留言失敗也歸納為錯誤寫入紀錄、跳提醒在登入通知（先預設權限組可開關）。然後已排程列表改為半小時自動刷新一次。」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 紅字條件 | 同一則留言失敗累計 ≥2 次，或已判定 failed | 使用者要第 2 次就亮 |
| 重新留言 | 歸零 attempts、立即重試（先查是否已留過），需 `post`（影片 `vpost`） | 不重複留 |
| A 影片發布 | A1 一起做 | 使用者選 |
| B 錯誤紀錄 | B2 記粉專 ID（`logs` 加欄位），在最後判定失敗時寫一次 | 使用者選 |
| C 通知權限 | 新權限 `notify`，預設只有系統管理者（預設權限組都不勾，可在權限組開） | 使用者選 |
| 通知資料 | D1 `fb_notices`，紅字時寫、重新留言成功刪，7 天清；`GET /staff/me/notices` 只查 D1 | 不打臉書 |
| 自動刷新 | 只刷「已排程」、每 30 分鐘、分頁隱藏時延後到回來 | 使用者要 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/timer.js` | `alertOf`（失敗累計 ≥2 或 failed；整則取消不提醒）、`note()`（簽章變了才寫 D1 通知、最先失敗那則只記一次錯誤日誌，`ecode`＝臉書錯誤碼）、`retry` action（從失敗那則起歸零，試過的設 posting 先查再留）、status 多回 `alert`、`kind` | ✅ |
| `server/fb/notices.js`（新） | D1 `fb_notices`（post_id 主鍵）、`setNotice`、`logCommentFail`、`listNotices`（帶粉專簡稱）、7 天清除 | ✅ |
| `server/core/logs.js` | `logs.page` 欄（自動 ALTER）、`logEvent`；管理頁錯誤日誌加「粉專」欄 | ✅ |
| `server/fb/manage.js` | 列表留言狀態有 alert 時回物件 `{status,alert,seq,error,failed}` | ✅ |
| `server/fb/index.js` | `POST /fb/comment/retry {postId,page}`（貼文要 post、影片要 vpost；操作紀錄 `comment_retry`） | ✅ |
| `server/core/staff.js`、`auth.js` | 權限 `notify`（共用區；預設權限組都不含）、`GET /staff/me/notices`（回 enabled、items、canRetry） | ✅ |
| `tools/fbpost/manage.js`、`util.js`、`fbpost.css` | 已排程／已發佈紅字（自己一行）＋「重新留言」；已排程每 30 分鐘自動刷新（背景延後、改時間中延後） | ✅ |
| `shell/company.js`、`company.css` | 帳號彈窗通知卡片（重新留言、開排程發布／開影片發布）、右上紅點；登入後、開彈窗、每 30 分鐘讀 | ✅ |
| `admin/`、`privacy/` | 操作紀錄「重新留言」、錯誤日誌粉專欄；隱私權政策補兩列 | ✅ |

## 第二輪（2026-11-22 使用者回饋）
| 項目 | 做法 | 狀態 |
|---|---|---|
| 不要紅點 | 帳號框 `.acct-alert` 紅色光暈閃爍（1.2 秒，減少動態時固定亮） | ✅ |
| 回列表切已發佈 | `dialog.js` 加 `onOpen`／`onClose`；關閉新增發文時讀通知，有排程發布的失敗就 `showTab('pub')`＋`manage.showPub(粉專)` 讀出紅字 | ✅ |
| 側邊欄即時狀態 | 新檔 `tools/fbpost/live.js`＋`#liveState`（新增發文標題列 × 左邊）：綠燈正常、紅燈＋紅暈閃爍＝留言失敗，點了回已發佈；只在 is-side 顯示、每 2 分鐘讀（背景不讀）；權限組沒開通知就隱藏 | ✅ |
| 窄版列表 | 時間接在粉專後、留言狀態最後；按鈕不斷字 | ✅ |

## 第三輪（2026-11-22）：通知只給發文者＋系統管理者
- 決定：**C**，`notify` 權限改義為「接收所有人的留言失敗通知」；發文者一律收自己的；系統管理者收全部。
- 做法：armTimer 帶 `by`（員工編號，`me.who.uid`；影片用 job 的 `who`）→ timer rec 存 `by` → `fb_notices.by` 欄（自動補）→ `/staff/me/notices`：sys 或 notify＝全部，否則 `by = 自己`。舊紀錄沒有 by＝只有全部權限的人看得到。
- 列表紅字與重新留言按鈕不變（依 view／post 權限）。
- 狀態：✅ 完成（npm test 775、e2e company／fbpost／admin／fbvideo 110 過），待使用者確認

## 下一步
- [x] 後端、前端、單元測試、e2e（fbpost 3、company 2）
- [x] 獨立審查通過；Minor 已修 3 項（後端分貼文／影片權限、取消後收通知、ALTER 暫時錯誤可重試、提示文字）
- [ ] 使用者確認截圖 → 說「推」才併入 main（同時更新 CLAUDE.md 目前進度）

## 已知未處理（審查 Minor）
- 重新留言剛好碰上鬧鐘正在打臉書：鬧鐘結束會蓋掉重試設定，最壞是那次重試沒生效（不會重複留言）。
- 影片發布工具本身沒有留言狀態列表（送出後只追蹤 15 分鐘），影片留言失敗靠首頁通知處理。

## 部署
後端需重新部署（正式＋測試），新表與欄位自動建立，不用手動 SQL；外掛不升版號。想讓其他權限組收通知，到管理頁「權限組」勾「接收留言失敗通知」。
