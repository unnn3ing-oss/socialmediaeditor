# 小編工具箱（socialmediaeditor）— 設計規格

- 日期：2026-11-05
- 狀態：**草稿，待使用者審閱**
- 設計稿（Claude Design 畫布）：https://claude.ai/artifact/EM2eVNTjYAV91awcKRAcJ1　定案稿為 S5、S6 兩排

---

## 1. 目標與範圍

**一句話**：把目前分散在四個 repo 的小編工具整合成**一個網站＋一個外掛**，讓自己和同事不用再切網站、裝一堆外掛。

| 要解決的痛點 | 對應做法 |
|---|---|
| 切換網站太麻煩 | 一個網址，上方工具列切換，可左右並排兩個工具 |
| 外掛太多太亂 | 合成一個外掛「小編工具箱」 |
| 要給同事用 | 開站先看到櫥窗、狀態列直接告訴你缺什麼（外掛、登入、下載助手） |

**不做**：深色模式、「最近的作品」、剪輯（已搬到 QuickCut）。

**舊工具不退場**：QuickPatterntool、LinePushPatternTool、-schedulenewnet、videodownload 的網站和外掛**照常運作**；程式**複製**進本 repo，之後新站是主力，舊站只修重大問題。

### 收錄的工具

| 群組 | 工具 | 來源 | 需要外掛？ |
|---|---|---|---|
| 做圖 | 圖片套版（網頁版批次） | QuickPatterntool `app.js` 等 | 否 |
| 做圖 | LINE 推播（六宮格、娛樂四格） | LinePushPatternTool `index.html` | 否（抓 OG 圖走既有 Cloudflare Worker） |
| 做圖 | 拼圖 | QuickPatterntool `collage.*` | 否 |
| 做圖 | 浮水印 | QuickPatterntool `watermark.*` | 否 |
| 做圖 | 尺寸 | QuickPatterntool `resize.*` | 否 |
| 做圖 | 設計 | QuickPatterntool `design-*` | 否 |
| 發文與素材 | 網新排程 | -schedulenewnet `web/` | **是**（帶 cookie 打 digi-social-post.tvbs.ai） |
| 發文與素材 | YT 批量下載 | videodownload `web/` | **是**＋本機下載助手（native messaging） |

---

## 2. 資訊架構與互動（已定案）

| 規則 | 內容 |
|---|---|
| 開站 | **每次**開站先顯示櫥窗，點卡片進入工具；左上角 Logo＋「小編工具箱」回櫥窗 |
| 工具列 | 在上方，圖示＋文字 |
| 單點 | 點上方工具 → 該工具**全頁**顯示 |
| 並排 | 已開一個工具時，把上方工具**拖進工作區左半或右半** → 左右並排，**最多 2 格** |
| 第三個工具 | 並排中再單點第三個工具 → **取代最後操作的那一邊** |
| 最後操作 | 用藍框（元素 A）標示 |
| 同一工具 | 同一工具同時只開一格；拖到另一側＝換邊 |
| **內容保留** | 不論切換、取代、關閉、重新整理，**填入的內容一律保留**；只有按工具內的「清空」才刪除 |

---

## 3. 視覺設計（已定案）

### 3.1 基調
S3「安靜中性」，**所有按鈕都有框**，不做深色模式。字型 Noto Sans TC。

### 3.2 色彩 token

| token | 值 | 用途 |
|---|---|---|
| `--surface` | `#ffffff` | 頂列、卡片、輸入框 |
| `--stage` | `#f6f7f8` | 工作區底 |
| `--line` | `#e3e4e6` | 分隔線 |
| `--line-strong` | `#c4c7cc` | 控制項框線 |
| `--text` | `#202124` | 主要文字 |
| `--muted` | `#55595f` | 說明文字 |
| `--btn-text` | `#3c4046` | 次要按鈕文字 |
| `--accent` | `#1d4fb8` | 主色、選取、焦點 |
| `--accent-strong` | `#163d8f` | 主按鈕框線 |
| `--accent-soft` | `#eef3fc` | 選取底 |
| `--placeholder` | `#d5d8dc` | 縮圖佔位 |
| `--fill` | `#f1f2f4` | 切換開關底 |
| 狀態綠 | 底 `#e8f5ec`／框 `#a8d5b5`／字 `#17682e` | 正常 |
| 狀態橘 | 底 `#fff4e0`／框 `#e8c48a`／字 `#8a4b00` | 需要處理 |

所有文字對比 ≥ 4.5:1。

### 3.3 元素選擇

| 元素 | 選擇 | 規格 |
|---|---|---|
| Logo | **A 套版框** | 圓角外框＋照片＋兩行標題，24 viewBox；16px 可辨識 |
| 主按鈕 | **C 膠囊** | 高 44、`border-radius: 999px`、實心 `--accent`＋`--accent-strong` 框 |
| 次要按鈕 | **A 白底** | 白底、`--line-strong` 框、`--btn-text` 字 |
| 按鈕效果 | **C 內壓** | 滑過：主按鈕 `#1a47a6`，次要框與字變 `--accent`；按下：`scale(.97)`，主按鈕內陰影 `inset 0 2px 4px rgba(0,0,0,.3)`，次要底 `--accent-soft`；鍵盤焦點：2px `--accent` 外框、間距 2px；不能按：底 `#eceef0`、字 `#6b7077` |
| 上方工具 | **C 圖示＋文字** | 16px 線條圖示 |
| 二選一 | **B 相連 → 乙 開關＋兩側文字** | 開關 48×28；選中那側文字變 `--accent` 粗體；`role="switch"`，`aria-label` 寫「改成 ○○」 |
| 櫥窗卡片 | **A 圖在上** | 上方 112px 成品示意圖，下方名稱＋一句說明 |
| 輸入框 | **A 標籤在上** | |
| 狀態 | **B 框線＋圓點** | |
| 最後操作 | **A 藍框** | |

### 3.4 前端規範（依兩份上傳規範）
- **網格**：櫥窗用 `repeat(auto-fit, minmax(240px, 1fr))`，間距 24px，不另寫斷點。
- **骨架屏取代轉圈**：檢查外掛／登入／下載助手、帶入文章、YT 清單載入時，顯示和完成後**同尺寸**的骨架（微光動畫），加 `aria-busy`；系統開「減少動態效果」時停止微光。
- **等寬數字**：百分比、速度、剩餘時間、天數、時間欄位一律 `font-variant-numeric: tabular-nums`。
- **動畫**：只用 `transform`／`opacity`；尊重 `prefers-reduced-motion`。

---

## 4. 技術架構

### 4.1 工具怎麼放進同一頁（需要你選）

| 方案 | 做法 | 優點 | 缺點 |
|---|---|---|---|
| **A 同網域 iframe（建議）** | 外殼頁負責櫥窗、工具列、並排；每個工具是一個獨立頁面，用同網域 iframe 載入 | 各工具原本的全域變數、CSS 互不干擾，搬遷改動最少；切走時 iframe 只隱藏不銷毀，內容自然保留；並排就是放兩個 iframe | 外掛橋接要設 `all_frames`；拖曳並排時需要外殼蓋一層透明放置區（iframe 會吃掉滑鼠事件） |
| B Shadow DOM 元件 | 每個工具改寫成掛在 shadow root 裡的元件 | 單一頁面、狀態好共享 | 現有程式大量用 `document.getElementById`、全域函式，幾萬行都要改，風險高 |
| C 全部重寫 | 用新框架統一重寫 | 程式最乾淨 | 工程量最大，舊功能容易漏 |

> 推論：四個專案合計約 3.5 萬行 JS，多數依賴全域與 `document` 查詢，A 是唯一能分階段、每階段都可用的方案。

### 4.2 Repo 結構（以方案 A 為例）

```
socialmediaeditor/
├─ index.html            外殼：櫥窗、上方工具列、並排、狀態列
├─ shell/                外殼程式（layout、drag-split、persist、status）
├─ ui/tokens.css         第 3 節的 token 與按鈕、開關、骨架共用樣式
├─ tools/
│  ├─ pattern/  linepush/  collage/  watermark/  resize/  design/
│  ├─ sched/             網新排程
│  └─ ytdl/              YT 批量下載
├─ extension/            統一外掛「小編工具箱」（MV3）
├─ test/                 單元測試＋Playwright e2e
└─ docs/
```

每個工具頁都載入 `ui/tokens.css`，並逐步把原本的顏色、按鈕換成共用樣式。

### 4.3 內容保留機制
1. **切換、取代、關閉**：iframe 只隱藏不銷毀；被「取代」的工具移到隱藏區保留。
2. **重新整理、關掉分頁**：每個工具把狀態存進 IndexedDB（照片存 Blob），輸入後 500ms 自動存，開啟時自動還原。
3. **刪除**：只有工具內的「清空」會清掉該工具的存檔。
4. 外殼另存版面狀態（開著哪些工具、左右、最後操作）；但依定案，開站一律先顯示櫥窗，進入工具時才還原內容。
5. 容量：申請 `navigator.storage.persist()`；空間不足時跳通知，並列出最佔空間的工具。

### 4.4 統一外掛「小編工具箱」
- **權限**：把三個外掛的權限合併（`sidePanel`、`storage`、`unlimitedStorage`、`alarms`、`notifications`、`clipboardWrite`、`cookies`、`scripting`、`declarativeNetRequest`、`nativeMessaging`、`downloads`），host 權限取聯集。
- **網站橋接**：content script 只注入 `https://unnn3ing-oss.github.io/socialmediaeditor/*`，`all_frames: true`；沿用 -schedulenewnet 的 `postMessage` 協定（`source`＋`nonce`＋`op`），訊息 source 改用新前綴，避免與舊外掛混淆。
- **和舊外掛同時安裝**（已知事實）：舊外掛的 content script 只注入自己的網址（`/QuickPatterntool/*`、`/-schedulenewnet/*`、`/videodownload/*`），在新站上不會重複回應。
- **重複回應風險**（已知事實）：QuickPatterntool 外掛會注入熱門新聞庫和 facebook.com。新外掛**第一版不注入這兩個網域**；之後要加時，再設計「偵測到舊外掛就讓給舊外掛」的機制。
- **YT 下載助手**（已知事實）：`videodownload/host/installer.py` 的 `allowed_origins` 只寫一個外掛 ID，新外掛的 ID 不同就連不上。需要在 videodownload repo 改成同時允許兩個 ID，並請已安裝的人重跑一次安裝程式。**這會改到另一個 repo，屆時另外請你確認。**
- **側邊欄**：第一版只放「開啟小編工具箱」與三項狀態；舊外掛側邊欄的單張快速產圖等功能，排在後續階段。
- **版本與更新**：沿用 QuickPatterntool 的規則（`manifest.json` 版號、`changelog.json`、側邊欄「檢查更新」），從 `1.00` 開始。

### 4.5 狀態列（頂列右側）
| 狀態 | 正常 | 需要處理 | 檢查中 |
|---|---|---|---|
| 外掛 | 外掛已連線 | 未安裝外掛（附安裝教學） | 骨架 |
| 網新登入 | 網新已登入，剩 N 天 | 需要重新登入 | 骨架 |
| 下載助手 | 下載助手可用 | 未安裝下載助手 | 骨架 |

需要外掛的工具在條件不足時，**卡片仍可點**；進去後顯示原因和下一步，不顯示空白畫面。

---

## 5. 分階段

| 階段 | 內容 | 完成時給你看 |
|---|---|---|
| P0 外殼 | repo 骨架、`tokens.css`、櫥窗、上方工具列、單點全頁、拖曳並排、取代最後操作、保留框架、e2e 測試 | 可操作的外殼（工具位置先放示意頁） |
| P1 做圖工具 | 搬入圖片套版、LINE 推播、拼圖、浮水印、尺寸、設計，套用共用樣式與自動保存 | 六個工具在新站可用，重新整理內容還在 |
| P2 外掛＋發文工具 | 統一外掛、網新排程、YT 批量下載、狀態列；videodownload 安裝程式的 ID 調整（另一個 repo） | 同事安裝一個外掛即可使用全部 |
| P3 補齊 | 側邊欄功能、熱門新聞庫「送到套版」、facebook 相關功能（含與舊外掛的重複回應處理） | 舊外掛功能全部有對應 |

- **開發方式**：主對話負責分派，按工作性質派子代理實作，每階段結束彙整「改了什麼」。
- **合併規則**：只推到開發分支 `claude/charming-hamilton-6rk4l5`；**你確認後才併入 main**。

---

## 6. 測試
- **單元測試**：`node --test test/*.test.js`，搬入工具時一起帶入原 repo 的測試。
- **外殼 e2e**（Playwright，使用 `/opt/pw-browsers/chromium`），至少涵蓋：
  - 開站顯示櫥窗；
  - 單點全頁；
  - 拖曳到左／右並排；
  - 並排時單點第三個工具，取代最後操作的那一邊；
  - 切換、取代、重新整理後內容仍在；
  - 「清空」後內容消失；
  - 鍵盤可操作（Tab 選到工具列、Enter 開啟）。
- **外掛**：沙盒沒有網路，`chrome.*` 以 stub 驗證呼叫參數。
- **視覺**：每階段截圖，和設計稿 S5／S6 對照。

---

## 7. 待確認

| # | 問題 | 預設（沒回就照這個） |
|---|---|---|
| 1 | 工具整合方式 | 方案 A 同網域 iframe |
| 2 | 網址 | GitHub Pages：`https://unnn3ing-oss.github.io/socialmediaeditor/` |
| 3 | 外掛名稱 | 小編工具箱 |
| 4 | 同事怎麼裝外掛 | 比照現有外掛（下載 zip、載入未封裝項目，附全螢幕安裝教學） |
| 5 | P2 修改 videodownload 安裝程式 | 到時再單獨請你確認 |
