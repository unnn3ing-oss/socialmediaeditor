# 排程發布：純文字只用標題框＋值班粉專＋再發一次
- 狀態：已完成（2026-11-21 併入 main）　- 分支：claude/compassionate-babbage-pwd4cb　- 最後更新：2026-11-21
- 使用者原始需求：「純文字時只剩標題輸入框（等於貼文內容），不加【】」；「首次開啟或每個班段 0730-1630／1600-0000 詢問值班粉專，發文時主動勾選」；「已排程／已發佈加『再發一次』，帶入網址、圖片、發出時的標題」。網頁與外掛都要（外掛嵌入網站 fbpost，不用改外掛程式）。
- 同分支還有未推的「文字背景第 3 階段」（`2026-11-21-fb-bg-images.md`），使用者要等這批一起推。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 純文字帶入 | 1A：標題框放標題（自動斷行），不加【】 |
| 模式切換 | 2A：共用同一個標題框 |
| 貼文內容框 | 3A：純文字時隱藏、內容保留，但**不送出**；送出只用標題框 |
| 班段 | 07:30–15:59 早班、16:00–23:59 晚班（4A）、00:00–07:29 大夜（5A）；換班段第一次開啟就問 |
| 略過 | 6B：一定要選（至少 1 個） |
| 再發一次資料 | 7B：本機記錄（localStorage 文字＋IndexedDB 原始照片），7 天；只有同一瀏覽器自己發的 |
| 帶回內容 | 8A：網址、照片、發出時的標題、模式、框／底色；不帶貼文內容、小編文、留言 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/compose.js`（`postText`、showMode）／`send.js`（`composer.text()`）／`index.html`（`#titleName`、`#msgLbl`） | 純文字只用標題框 | ✅ |
| `tools/fbpost/duty.js`（新，`shiftOf`／`readDuty`／`createDuty`）＋ app（`canPost` 後 `duty.check()`）／targets（`defaults`、`applyDefaults`）＋ `#dutyDlg`、`#dutyBtn` | 值班粉專 | ✅ |
| `tools/fbpost/history.js`（新，IndexedDB `tbx-fbpost`／`sends`，index `posts`）＋ send（`snapshot` 存成功 postId）／manage（`.act-resend`，`postKey` 比對）／compose（`snapshot`、`restore`）／app（`resend` 先問覆蓋） | 送出記錄、再發一次 | ✅ |
| 測試 | `test/fbpost-duty.test.js`、fbpost e2e（值班 2、再發一次 2） | ✅ |

## 下一步
- [x] 一、純文字只用標題框（fbpost＋compose e2e 61）
- [x] 二、值班粉專（單元 2、e2e 2；測試輔助 `presetDuty` 在 `test/helpers/tool-page.js`）
- [x] 三、再發一次
- [x] npm test 754、build --check、fbpost＋compose＋sidepanel＋admin e2e 全過
- [x] 獨立審查（修正：值班視窗 Esc 連帶關新增發文、restore 底色沒亮、只有照片時沒先問；未修 Minor：純文字整段當 RD title）
