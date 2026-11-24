# Rundown Apps Script 補丁：影片「草稿」「多文」「放待排 2359」填預留格

影片發布工具（`tools/fbvideo`）在這兩種情況寫 RD 時，**不照時間插入**，改填今天欄右邊的綠色預留格：

| 情況 | entry 多帶 | 填哪裡 |
|---|---|---|
| 存草稿（橫式） | `slot: 'draft'`、`kind: 'video'` | 標記「純影已上傳」下第一格 `純影/`；或標記「草稿內」下第一格 `純影/`／`網新/` |
| 存草稿（Reels） | `slot: 'draft'`、`kind: 'reel'` | 標記含「2359」（例：2359、排2359）下第一格 `reels/`（不分大小寫） |
| 被多文的粉專 | `slot: 'cross'`、`kind: 'video'` | 標記「多文」或「多文內」下，最後一格有內容的下面第一格 `純影/` |
| 放待排 2359（直式） | `slot: 'q2359'`、`kind: 'reel'` | 今天欄右邊**第 3～10 欄**，**文字色 #3c78d8＋粗體**、含「2359」的標記（2359、排2359）下第一格 `reels/`；寫 `Reels/SLUG`（檔名 `Shorts_` 開頭寫 `Shorts/SLUG`） |

- 草稿／多文：只看**今天那欄右邊第 1～8 欄**，從「現在」所在的時段區塊開始找，再往前後相近的區塊找（先後、再前，交替）。
- 放待排 2359：只找按送出當下**前後 2 小時內**的時段區塊，由近到遠（一樣近先找較晚的）；不是藍色粗體的「2359」不算（**整格**要設成 #3c78d8＋粗體，只有部分文字上色的格子讀不到顏色）；找不到不退回別欄，直接失敗（工具提示＋複製）。臉書排到當天 23:59，值班再從臉書後台重排。
- 優先的標記欄都沒空位時，草稿會退回同區塊其他欄的第一格 `純影/`（Reels：`reels/`），**不會動「多文」欄**；多文沒有空位就直接失敗。
- 標記＝不含「/」的格子（所以「4042359/文字/…」不會被當成 2359）；比對時忽略空白（`純影 /` 也算）。
- 填入時**只換文字**，保留預留格原本的綠色格式；**不插新列**。
- 找不到就回報失敗，工具會跳出提示並附「複製」鈕，讓你手動貼。

Apps Script 本身在 `-schedulenewnet` 的 `gas/rundown.gs`，本 repo 不能改，所以要**你自己貼上並重新部署**。

## 沒貼之前會怎樣
Apps Script 不認得 `slot`（或還是舊版補丁、不認得 `q2359`），會把草稿／多文／放待排 2359 當成一般稿子，**照時間插進今天那欄**（不是預留格）。所以要用草稿或多文寫 RD，請先貼好補丁。

## 怎麼貼
1. 打開 FB RUNDOWN 試算表 →「擴充功能」→「Apps Script」→ 打開 `rundown.gs`。
2. 把本 repo 的 `docs/rundown-gs/rdslot.js` **整份**複製，貼在 `rundown.gs` 最後面（`if (typeof module !== 'undefined') …` 那行的**上面**或下面都可以；補丁自己最後也有一行同樣的判斷，在 Apps Script 不會執行）。
3. 找到 `function rdAddOne(ss, names, en) {`，在大括號後面第一行加上：

```js
  if (en.slot) return rdSlotAdd(ss, names, en);   // 影片草稿／多文：填預留格（docs/rundown-gs-draft-slot.md）
```

4. 存檔 →「部署」→「管理部署作業」→ 編輯目前的部署 → 版本選「新版本」→「部署」（網址不變，不用改後端 Secrets）。

> 補丁用到 `rundown.gs` 原本就有的 `rdStr`、`rdFindSection`、`rdBlocks`、`rdFindSheetName`、`rdFindDateCol`、`rdPad`、`rdA1`、`RD_SECTIONS`，不用另外改。

## 確認
- 影片發布選一個粉專「草稿」、勾「排入 RD」送出 → 試算表今天欄右邊「純影已上傳／草稿內」下的 `純影/` 變成 `純影/SLUG`。
- Reels 草稿 → 「2359」欄下的 `reels/` 變成 `Reels/SLUG`。
- 直式影片選「放待排 2359」送出 → 送出當下最接近時段的藍色粗體「2359」欄下 `reels/` 變成 `Reels/SLUG`（Shorts_ 檔名：`Shorts/SLUG`）。
- 一個粉專選「多文發佈」並勾目標粉專 → 目標粉專區段的「多文／多文內」欄下的 `純影/` 變成 `純影/SLUG`；原粉專照一般方式照時間排入。

## 測試
規則在 `docs/rundown-gs/rdslot.js`，`test/rdslot.test.js` 用 `test/fixtures/rundown-gs-base.js`（從 `rundown.gs` 複製的 helper）在 Node 跑。`rundown.gs` 那幾個 helper 改了要同步這個 fixture。
