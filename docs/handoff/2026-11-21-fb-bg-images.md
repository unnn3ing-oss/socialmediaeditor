# 文字背景第 3 階段：管理頁＋圖樣存 R2
- 狀態：進行中　- 分支：claude/compassionate-babbage-pwd4cb　- 最後更新：2026-11-21
- 使用者原始需求：「接著做文字背景第 3 階段：管理頁＋圖樣存 R2」（前情見 `2026-11-21-fbpost-text-bg.md`）

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 圖樣載入 | 1A：排程發布點「圖樣 ▾」才載入 | 不用圖樣不浪費流量 |
| 資料存放 | 2A：D1 新表 `fb_backgrounds`；沒資料退回 `bgpresets.data.js` 的純色＋漸層 | 排序、顯示好管 |
| 卡片權限 | 3A：新卡片 `bg`「文字背景」，預設管理者（發文設定分類） | 不碰權杖 |
| 圖片 | 擷取腳本輸出 `background_image_url`；後端每次下載 10 張存 R2 `fbbg/<代號>.jpg`；只收 https `*.fbcdn.net`、image/*、≤2MB、不跟轉址 | 臉書網址會過期；免費方案子請求上限 |
| 讀圖 | `GET /fb/bg/<代號>` 需公司憑證、private 快取 | 圖不公開 |
| 圖樣開放條件 | R2 有圖且顯示中才列給排程發布 | |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `docs/fb-text-backgrounds/extract-fb-backgrounds.js` | 輸出 `background_image_url` | ✅ |
| `server/fb/bgstore.js`（新） | 建表、匯入比對、清單、改顯示／名稱／刪除、分批下載 | ✅ |
| `server/fb/bgpresets.js` | `listBackgrounds` 讀 D1、圖樣要有圖 | ✅ |
| `server/fb/index.js` | `/fb/bg/<id>`、`/admin/fb/backgrounds`（GET／POST 匯入，dry＝預覽）、`/fetch`（body `since`）、`/<id>`（POST 名稱／顯示、DELETE）、`/<id>/img`（管理頁看圖） | ✅ |
| `server/core/adminperm.js`／`levels.js` | 卡片 `bg` | ✅ |
| `admin/` | 「文字背景」卡片 | ✅ |
| `tools/fbpost/compose.js`／`fbpost.css`／`index.html` | 圖樣分組、展開才載入 | ✅ |
| `privacy/` | 補一句 | ✅ |
| 測試 | 單元＋e2e | ✅ |

## 下一步
- [x] 後端＋單元測試（`test/server/fb-bg.test.js` 5 項）
- [x] 管理頁＋e2e（admin e2e 33）
- [x] 排程發布＋e2e、截圖（fbpost-compose 24、fbpost＋legal＋company 54；npm test 752、build --check）
- [x] 獨立審查（通過，無修改；Minor：無 content-length 時先讀完才判斷大小，來源限 fbcdn 風險低）

## 注意事項
- 後端需重新部署（正式＋測試），自動建表；外掛不升版。
- 已存過「層級權限」的環境要手動把「文字背景」勾給管理者。
