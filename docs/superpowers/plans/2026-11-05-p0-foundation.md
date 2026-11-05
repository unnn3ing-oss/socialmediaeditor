# 小編工具箱 P0 地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建好「積木」地基：外殼（櫥窗、工具列、並排、取代、狀態列、公司模式、安裝教學）、SDK、工具規格卡與組裝腳本、統一外掛核心、後端 `toolbox-api` 核心，並用一個範例工具證明「新增／移除工具不動核心」。

**Architecture:** 靜態網站（GitHub Pages）以同網域 iframe 載入 `tools/<id>/`；工具只透過 `sdk/` 溝通。`build.js` 讀 `tools/registry.json`＋各 `tool.json`，產生外殼目錄、外掛 manifest 與路由表、後端路由表。後端是單一 Cloudflare Worker（D1／R2／KV），外掛是 MV3（module service worker）。

**Tech Stack:** 原生 HTML／CSS／ES modules（不用框架、無執行期相依套件）；Node 22 `node:test`；Playwright（`/opt/pw-browsers/chromium`）；Cloudflare Workers＋D1＋R2＋KV；測試用 `node:sqlite` 假 D1。

**Spec:** `docs/superpowers/specs/2026-11-05-toolbox-design.md`（執行者必讀）

## Global Constraints

- 介面文字一律**繁體中文（台灣用語）**，絕不出現簡體；不用 emoji；按鈕文字不加「→」。
- **無執行期相依套件**；測試只用 Node 22 內建模組與環境內建的 `playwright`（`require('playwright')`，`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })` 若找不到預設瀏覽器）。**不要**執行 `playwright install`。
- 瀏覽器程式為 ES modules，路徑全用相對路徑（網站會掛在 `/socialmediaeditor/` 底下）。
- 色彩、元素數值以 spec 第 3 節為準：主按鈕膠囊 `border-radius:999px`、高 44px、底 `#1d4fb8`、框 `#163d8f`；次要按鈕白底、框 `#c4c7cc`、字 `#3c4046`；效果「內壓」；開關 48×28；焦點 2px `#1d4fb8` 外框、偏移 2px；停用底 `#eceef0` 字 `#6b7077`。
- 所有按鈕有框；觸控目標 ≥ 44px；文字對比 ≥ 4.5:1。
- 載入中一律**骨架屏**（`.sk`），不用轉圈；`aria-busy="true"`；`prefers-reduced-motion: reduce` 時停止動畫。
- 動態數字（天數、百分比、時間）加 `font-variant-numeric: tabular-nums`。
- 不做深色模式。
- **公司素材（TVBS Logo、粉框藍框、T 寶等）絕不能進 repo。**
- 只在分支 `claude/charming-hamilton-6rk4l5` 提交與推送；**不推 main、不開 PR**。commit 訊息結尾加：
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 與 `Claude-Session: https://claude.ai/code/session_01T1bNuq8dz4FLv9iEqNrPoP`。
- 暫存腳本、截圖放 scratchpad，不放進 repo。
- 常數：網站 `https://unnn3ing-oss.github.io/socialmediaeditor/`；後端 `https://toolbox-api.19jpz-3.workers.dev`；外掛名稱「小編工具箱」、版本 `1.00`；安裝資料夾 `toolbox-ext`。

## Review Focus

1. **重新整理前 0.5 秒內剛打的字**：debounce 還沒存就重新整理 → 字不能丟。`pagehide`／`visibilitychange` 時要立刻存（Task 7 測試 `flushes on pagehide`）。
2. **IndexedDB 不能用**（無痕視窗、空間滿）：工具仍可操作，保存失敗只跳一次通知，不丟例外（Task 7 測試 `persist degrades without indexedDB`）。
3. **公司憑證在使用中過期**：已開著的公司工具不能被關掉或清掉內容；只隱藏工具列入口並顯示「公司密碼已過期」（Task 10 測試 `expiry keeps open company pane`）。
4. **拖曳到工作區外放開，或拖曳中按 Esc**：版面完全不變（Task 6 測試 `drop outside keeps layout`）。
5. **沒裝外掛**：狀態不能永遠停在骨架；3 秒內變成「未安裝外掛」（Task 8 測試 `ext.call rejects with no_extension`、Task 9 e2e `extension pill settles`）。

---

## 檔案結構

```
socialmediaeditor/
├─ index.html                     外殼頁
├─ CLAUDE.md  README.md  package.json  .gitignore
├─ build.js                       組裝腳本（可 import 的 build(root, opts)）
├─ ui/tokens.css                  token＋按鈕、開關、狀態、骨架、對話框
├─ shell/
│  ├─ config.js                   常數（API_BASE、SITE、EXT_NAME…）
│  ├─ contract.js                 validateTool / validateRegistry（Node 與瀏覽器共用）
│  ├─ layout.js                   版面狀態機（純函式）
│  ├─ main.js                     外殼進入點
│  ├─ showcase.js toolbar.js panes.js drag.js status.js company.js
│  ├─ install.js install.css installer.js   安裝教學（自 -schedulenewnet 複製改名）
│  └─ catalog.json                build.js 產生
├─ sdk/
│  ├─ toolbox.js                  匯出 tb（聚合下列模組）
│  ├─ persist.js files.js download.js bridge.js api.js assets.js log.js status.js
│  └─ README.md
├─ tools/
│  ├─ registry.json               ["sample"]
│  ├─ _template/  tool.json index.html tool.js thumb.svg icon.svg TOOL.md
│  └─ sample/                     由 _template 複製
├─ assets-public/                 通用素材（P0 空，放 .gitkeep）
├─ extension/
│  ├─ core/ manifest.base.json background.js bridge.js sidepanel.html sidepanel.js sidepanel.css updater.js id.js
│  ├─ icons/ icon-16.png icon-32.png icon-48.png icon-128.png
│  ├─ tools/                      build.js 從 tools/<id>/ext.js 複製
│  ├─ routes.gen.js  manifest.json   build.js 產生
│  └─ changelog.json
├─ server/
│  ├─ index.js                    fetch／scheduled 進入點與路由
│  ├─ core/ http.js token.js auth.js assets.js admin.js admin.html logs.js fetch.js db.js
│  ├─ routes.gen.js               build.js 產生
│  ├─ schema.sql  wrangler.toml
├─ docs/ deploy.md  extension-id.md  design/（S5、S6 設計稿副本）
└─ test/
   ├─ helpers/ fake-env.js  serve.js  browser.js
   ├─ *.test.js  server/*.test.js
   └─ e2e/*.e2e.js  fixtures/
```

---

## Part A：網站地基

### Task 1: Repo 骨架、測試框架、協作文件

**Files:**
- Create: `package.json`, `.gitignore`, `CLAUDE.md`, `README.md`, `test/helpers/serve.js`, `test/helpers/browser.js`, `test/smoke.test.js`, `assets-public/.gitkeep`
- Create: `docs/design/`（從 `/tmp/claude-0/-home-user/5c8d627d-becd-5aad-beeb-0a8f46182866/scratchpad/ia/project/` 複製 `S5-Logo.dc.html`, `S5-Showcase.dc.html`, `S5-YT.dc.html`, `S5-Sched.dc.html`, `S6-Buttons.dc.html`）

**Interfaces:**
- Produces:
  - `serve(root: string, port?: number) -> Promise<{ url: string, close(): Promise<void> }>`：靜態伺服器，正確的 MIME（`.js` → `text/javascript`、`.json`、`.svg`、`.css`、`.html`、`.png`）。
  - `launch() -> Promise<Browser>`：先試預設，失敗改用 `executablePath: '/opt/pw-browsers/chromium'`。

- [ ] **Step 1: 寫 `test/smoke.test.js`**：`serve(repoRoot)` 後 `fetch(url + 'package.json')` 回 200 且 `content-type` 含 `json`；`fetch(url + 'nope')` 回 404。
- [ ] **Step 2:** `node --test test/smoke.test.js` → FAIL（`serve` 不存在）。
- [ ] **Step 3:** 實作 `serve`、`launch`。`package.json`：
  - 無 `type` 欄位，無 dependencies；
  - scripts：`"test": "node --test test/*.test.js test/server/*.test.js"`、`"e2e": "node --test test/e2e/*.e2e.js"`、`"build": "node build.js"`、`"check": "node build.js --check"`。
- [ ] **Step 4:** 寫 `CLAUDE.md`，內容依 spec 4.7＋本專案流程：
  - 繁體中文；
  - 先改好測好給使用者看，使用者說「推」才併 main；
  - 改工具只讀 `tools/<id>/` 與 `sdk/README.md`；
  - 公司素材不進 repo；
  - 測試指令；
  - Playwright 用 `/opt/pw-browsers/chromium`；
  - 版號規則比照 QuickPatterntool（只改網頁專用檔不升外掛版）。
- [ ] **Step 5:** 寫 `README.md`：用途、網址、目錄說明。
- [ ] **Step 6:** `node --test test/smoke.test.js` → PASS。
- [ ] **Step 7: Commit** `chore: 建立 repo 骨架與測試框架`

### Task 2: 共用樣式 `ui/tokens.css`

**Files:**
- Create: `ui/tokens.css`, `test/fixtures/tokens.html`, `test/e2e/tokens.e2e.js`

**Interfaces:**
- Produces（class 名稱，之後所有頁面共用）：
  - `.btn`（共用）、`.btn-primary`、`.btn-secondary`、`.btn-sm`（高 36）；
  - `.switch`（`role="switch"` 的 button，`aria-checked`）＋ `.switch-wrap`（兩側文字，`.is-on` 標示選中側）；
  - `.pill`＋`.pill-ok`／`.pill-warn`（框線＋圓點，狀態 B）；
  - `.sk`（骨架）；
  - `.dialog`（`<dialog>` 樣式）；
  - `.card`；
  - `.field`＋`label`（標籤在上）；
  - `.num`（tabular-nums）。
- CSS 變數名稱照 spec 3.2（`--surface`、`--stage`、`--line`、`--line-strong`、`--text`、`--muted`、`--btn-text`、`--accent`、`--accent-strong`、`--accent-soft`、`--placeholder`、`--fill`、`--ok-bg/--ok-line/--ok-text`、`--warn-bg/--warn-line/--warn-text`）。

- [ ] **Step 1: 寫 e2e**：載入 fixture 頁（各元件一個），用 `getComputedStyle` 斷言：

```js
assert.equal(s('.btn-primary').borderRadius, '999px');
assert.equal(s('.btn-primary').height, '44px');
assert.equal(s('.btn-primary').backgroundColor, 'rgb(29, 79, 184)');
assert.equal(s('.btn-secondary').borderTopColor, 'rgb(196, 199, 204)');
// 按下：dispatch mousedown 後 transform 為 scale(.97)（matrix(0.97, 0, 0, 0.97, 0, 0)）
// 停用：[disabled] 底 rgb(236, 238, 240)、字 rgb(107, 112, 119)
// focus-visible：按 Tab 後 outline 2px solid rgb(29, 79, 184)
// .switch 寬 48px 高 28px；.num 的 fontVariantNumeric 含 'tabular-nums'
// emulateMedia({ reducedMotion: 'reduce' }) 後 .sk 的 animationName 為 'none'
```
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作 `tokens.css`。
  - 效果「內壓」數值照 spec 3.3。
  - 骨架 shimmer：

    ```css
    @keyframes sk-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
    .sk {
      background: linear-gradient(90deg, #eceef0 25%, #dfe2e6 50%, #eceef0 75%);
      background-size: 200% 100%;
      animation: sk-shimmer 1.5s infinite;
    }
    ```
  - 字型用 Google Fonts Noto Sans TC 400/500/700（`@import` 放最上方）。
  - 參考 `docs/design/S6-Buttons.dc.html`。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat: 共用樣式 tokens.css`

### Task 3: 工具規格卡檢查 `shell/contract.js`＋範本工具

**Files:**
- Create: `shell/contract.js`, `tools/_template/{tool.json,index.html,tool.js,thumb.svg,icon.svg,TOOL.md}`, `tools/registry.json`, `test/contract.test.js`

**Interfaces:**
- Produces:
  - `validateTool(tool: object, ctx: { folderExists(rel): boolean, fileExists(rel): boolean }) -> string[]`：回傳錯誤訊息（繁中），空陣列＝通過。
  - `validateRegistry(ids: string[], ctx) -> string[]`
  - `TOOL_ID_RE = /^[a-z][a-z0-9-]{1,30}$/`、`REQUIRES = ['extension', 'login:tvbs', 'helper']`、`TIERS = ['public', 'company']`、`SDK_MAJOR = 1`
- `tool.json` 欄位與意義照 spec 4.3。
  - `ext`：`null` 或 `{ permissions: string[], hosts: string[], background: 'ext.js' }`
  - `api`：`null` 或 `'api.js'`
  - `assets`：`{ [key]: { company?: string, public: string | 'upload' | null } }`
  - `group`：任意非空字串（新分類不需改核心）

- [ ] **Step 1: 寫測試**（每條一個 test）：
  - 合法的 `_template/tool.json` → `[]`；
  - `id` 不符 `TOOL_ID_RE` → 含「id」；
  - `tier: 'vip'` → 含「tier」；
  - `requires: ['wifi']` → 含「requires」；
  - `entry` 檔案不存在 → 含「entry」；
  - `sdk: 2` → 含「sdk」；
  - `assets.x.company` 不符 `/^[a-z0-9][a-z0-9._-]*$/` → 含「company」；
  - **`assets.x.company` 在 repo 裡找得到同名檔案 → 含「公司素材不能放進 repo」**；
  - `validateRegistry(['sample', 'sample'])` → 含「重複」；
  - `validateRegistry(['ghost'])`（資料夾不存在）→ 含「ghost」；
  - registry 含 `_template` → 含「範本」。
- [ ] **Step 2:** `node --test test/contract.test.js` → FAIL。
- [ ] **Step 3:** 實作 `contract.js`（ES module，不碰 `fs`；檔案檢查一律透過 `ctx`）。
- [ ] **Step 4:** 建 `_template`。
  - `tool.json`：`id: "sample"`、`name: "範例工具"`、`group: "做圖"`、`desc: "示範保存與清空"`、`tier: "public"`、`requires: []`、`assets: {}`、`ext: null`、`api: null`、`sdk: 1`、`entry: "index.html"`、`icon: "icon.svg"`、`thumb: "thumb.svg"`。
  - `index.html`：載入 `../../ui/tokens.css` 與 `tool.js`（module）。
  - `TOOL.md`：照 spec 4.7 的欄位。
  - `tool.js` 在 Task 7 才接 SDK，這裡先放一個 `<textarea>` 和「清空」次要按鈕。
- [ ] **Step 5:** 複製 `_template` 為 `tools/sample/`；`registry.json` = `["sample"]`。
- [ ] **Step 6:** 執行 → PASS。
- [ ] **Step 7: Commit** `feat: 工具規格卡檢查與範本工具`

### Task 4: 組裝腳本 `build.js`

**Files:**
- Create: `build.js`, `test/build.test.js`, `extension/core/manifest.base.json`（先放最小內容，Task 15 補齊）
- Generated（提交進 repo）: `shell/catalog.json`, `extension/manifest.json`, `extension/routes.gen.js`, `server/routes.gen.js`

**Interfaces:**
- Consumes: `validateTool`, `validateRegistry`（Task 3）
- Produces:
  - `build(root: string, { check?: boolean, write?: boolean = true }) -> Promise<{ errors: string[], outputs: Record<string, string> }>`。`outputs` 的 key 是相對路徑。`check: true` 時不寫檔，只回報「哪個產生檔過期」。
  - CLI：
    - `node build.js`：寫檔，有錯就 exit 1；
    - `node build.js --check`：產生檔過期或規格卡有錯就 exit 1。
  - `shell/catalog.json`：

    ```json
    { "tools": [ { "id", "name", "group", "desc", "tier", "requires", "icon": "tools/<id>/icon.svg", "thumb": "tools/<id>/thumb.svg", "entry": "tools/<id>/index.html" } ] }
    ```

    順序同 registry。
  - `extension/manifest.json`：`manifest.base.json` 加上所有工具 `ext.permissions`／`ext.hosts` 的聯集（去重、排序）。
  - `extension/routes.gen.js`：

    ```js
    import * as t_<id> from './tools/<id>.js';
    export const toolOps = { '<id>': t_<id> };
    ```

    沒有工具時為 `export const toolOps = {};`。同時把 `tools/<id>/ext.js` 複製成 `extension/tools/<id>.js`。
  - `server/routes.gen.js`：

    ```js
    import * as t_<id> from '../tools/<id>/api.js';
    export const toolRoutes = { '<id>': t_<id> };
    ```

  - 產生檔開頭加一行註解：`// 由 build.js 產生，請勿手動修改`。JSON 檔不能加註解，改在 README 說明。

- [ ] **Step 1: 寫測試**（每個都在 `fs.mkdtemp` 複製出的暫存 repo 上跑）：
  - 基本：`catalog.json` 只有 `sample`，且 `entry === 'tools/sample/index.html'`；
  - 某工具 `ext.permissions: ['cookies']` → manifest `permissions` 含 `cookies` 且不重複；
  - 有 `ext.js` 時產生 `extension/tools/<id>.js`；
  - 規格卡錯誤時 `errors.length > 0`，且**沒有寫出任何檔案**；
  - `check: true` 在剛 build 完時 `errors` 為空；改動 `tool.json` 後含「過期」；
  - registry 移除 `sample` 後，catalog `tools` 為空陣列。
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作 `build.js`（`node:fs/promises`、`node:path`；`ctx` 以 `fs.existsSync` 實作）。
- [ ] **Step 4:** 執行 → PASS；再在 repo 根目錄跑 `node build.js` 產生檔案。
- [ ] **Step 5: Commit** `feat: build.js 組裝腳本與產生檔`

### Task 5: 版面狀態機 `shell/layout.js`

**Files:**
- Create: `shell/layout.js`, `test/layout.test.js`

**Interfaces:**
- Produces（全部是純函式，回傳新物件，不改輸入）：
  - `initial() -> State`，`State = { view: 'showcase' | 'work', mode: 'single' | 'split', left: string | null, right: string | null, last: 'left' | 'right' }`
  - `openSingle(s, id)`：
    - 從櫥窗或單格開啟 → 單格 `left = id`；
    - 並排中：`id` 已在某側 → 只把 `last` 設為那側；否則把 `s[s.last]` 換成 `id`。
  - `dropOnSide(s, id, side)`：
    - 櫥窗中 → 等同 `openSingle`；
    - 單格且 `id` 就是目前工具 → 不變；
    - 單格、不同工具 → 並排，`side` 放 `id`、另一側放原本的工具，`last = side`；
    - 並排且 `id` 在另一側 → 兩側互換，`last = side`；
    - 並排且 `id` 已在 `side` → 只設 `last`；
    - 其他 → `s[side] = id`，`last = side`。
  - `focus(s, side)` → 設 `last`。
  - `closePane(s, side)`：並排 → 剩下的工具變單格（放 left，`last = 'left'`）；單格 → `view = 'showcase'`。
  - `home(s)` → `view = 'showcase'`，其他欄位保留。
  - `visible(s) -> string[]`：目前看得到的工具 id（0～2 個）。

- [ ] **Step 1: 寫測試**（至少下列）：

```js
// 'third tool replaces last-operated side'
let s = dropOnSide(openSingle(initial(), 'a'), 'b', 'right');   // a | b, last=right
s = focus(s, 'left');
s = openSingle(s, 'c');
assert.deepEqual([s.left, s.right, s.last], ['c', 'b', 'left']);
// 'dragging the other side's tool swaps sides'
s = dropOnSide(dropOnSide(openSingle(initial(), 'a'), 'b', 'right'), 'a', 'right');
assert.deepEqual([s.left, s.right], ['b', 'a']);
// 'never more than two visible'；'home then openSingle starts single'；
// 'close in split leaves single on left'；'inputs are not mutated'（Object.freeze 輸入）
```
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat: 版面狀態機`

### Task 6: 外殼畫面（櫥窗、工具列、iframe 窗格、拖曳並排）

**Files:**
- Create: `index.html`, `shell/main.js`, `shell/showcase.js`, `shell/toolbar.js`, `shell/panes.js`, `shell/drag.js`, `shell/config.js`, `test/fixtures/tools/{alpha,beta,gamma}/index.html`, `test/e2e/shell.e2e.js`
- Create: `favicon.svg`：Logo A（viewBox `0 0 24 24`），`currentColor` 改成 `#1d4fb8`：

```html
<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
<rect x="6.5" y="6.5" width="11" height="5" rx="1" fill="currentColor"/>
<rect x="6.5" y="13.5" width="11" height="1.8" rx="0.9" fill="currentColor"/>
<rect x="6.5" y="16.3" width="7" height="1.8" rx="0.9" fill="currentColor"/>
```

**Interfaces:**
- Consumes: `layout.js` 全部；`shell/catalog.json`
- Produces:
  - `window.tbxShell = { getStatus(id): StatusValue, onStatus(fn): unsubscribe, setStatus(id, value), company(): { unlocked: boolean, exp: number | null }, onCompany(fn), focusTool(id) }`，給 SDK 讀（同網域 iframe 用 `window.parent.tbxShell`）。`StatusValue = { state: 'checking' | 'ok' | 'warn', text: string }`。
  - 外殼 DOM 約定（e2e 依此選元素）：
    - `#brand`（回櫥窗）；
    - `#toolbar button[data-tool=<id>]`（`draggable="true"`，`aria-pressed` 表示可見）；
    - `#showcase .card[data-tool=<id>]`；
    - `#work .pane[data-side=left|right]`；
    - `.pane.is-last`（藍框）；
    - `.pane .pane-close`；
    - `#dropzones .dz[data-side]`；
    - `#status`（狀態列）。

設計依 `docs/design/S5-Showcase.dc.html`：
- 頂列：Logo A（`favicon.svg` 內容）＋「小編工具箱」、工具列（圖示＋文字）、狀態列。
- 櫥窗：「今天要做什麼？」，依 `group` 分區，網格 `repeat(auto-fit, minmax(240px, 1fr))`、gap 24px，卡片 A（112px 縮圖在上）。
- 並排：中間 1px 分隔；`.is-last` 用 2px `--accent` 框。
- **iframe 保活**：每個開過的工具建立一次 `<iframe src=entry>`，不可見時加 `hidden`，**永不移除**。
- **拖曳**：`dragstart` 時顯示 `#dropzones`（蓋在 iframe 上方的左右兩半透明層，滑過時 `--accent-soft` 底＋虛線框）；`drop` 呼叫 `dropOnSide`；`dragend`、Esc 或在放置區外放開都只隱藏放置區。
- 點窗格（iframe 取得焦點時 `window.blur` 事件＋`document.activeElement === iframe`）→ `focus(side)`。
- `catalog.json` 只顯示 `tier === 'public'` 或公司模式已解鎖的工具（解鎖在 Task 10 接上，這裡先讀 `tbxShell.company().unlocked`，預設 `false`）。

- [ ] **Step 1: 寫 e2e**：用 `page.route('**/shell/catalog.json')` 換成 alpha/beta/gamma 三個 fixture 工具（public）。測試：
  - `opens on showcase`：開站看得到 `#showcase`，3 張卡片；
  - `card opens single full page`：點 alpha 卡片 → 只有 left 窗格，`#showcase` 隱藏；
  - `drag to right splits`：用 `page.dispatchEvent` 送 `dragstart`／`dragover`／`drop`（DataTransfer 帶 `text/plain` = id）到 `.dz[data-side=right]` → 兩個窗格；
  - `third tool replaces last-operated`：並排 alpha | beta，點 left 窗格，再點工具列 gamma → left 變 gamma；
  - `iframe kept alive`：在 alpha 的 iframe 輸入框打「測試」→ 被取代後回到 alpha，值仍是「測試」，且 iframe 元素是同一個（比對 `data-created` 時間戳）；
  - **`drop outside keeps layout`**：`dragstart` 後在 `#toolbar` 上 `drop`、以及 `dragstart` 後按 Esc → 窗格數與 id 不變、`#dropzones` 隱藏；
  - `brand returns to showcase`。
- [ ] **Step 2:** `node --test test/e2e/shell.e2e.js` → FAIL。
- [ ] **Step 3:** 實作上列檔案。`shell/config.js` 匯出：

  ```js
  SITE = 'https://unnn3ing-oss.github.io/socialmediaeditor/'
  API_BASE = 'https://toolbox-api.19jpz-3.workers.dev'
  EXT_NAME = '小編工具箱'
  EXT_FOLDER = 'toolbox-ext'
  REPO = { owner: 'unnn3ing-oss', repo: 'socialmediaeditor', branch: 'main' }
  ```
- [ ] **Step 4:** 執行 → PASS；用 Playwright 截圖 1280×820 存 scratchpad，和 `docs/design/S5-Showcase.dc.html` 對照，差異記在任務回報。
- [ ] **Step 5: Commit** `feat: 外殼櫥窗、工具列、窗格與拖曳並排`

### Task 7: SDK 基礎（保存、檔案、下載、日誌）

**Files:**
- Create: `sdk/toolbox.js`, `sdk/persist.js`, `sdk/files.js`, `sdk/download.js`, `sdk/log.js`, `sdk/README.md`, `test/sdk.test.js`, `test/e2e/persist.e2e.js`
- Modify: `tools/_template/tool.js`, `tools/sample/tool.js`（改用 SDK）

**Interfaces:**
- Produces:
  - `tb.init(toolId: string) -> tb`（之後所有呼叫都以這個 id 分開存）。
  - `tb.persist.save(state: any)`：debounce 500ms。
  - `tb.persist.saveNow() -> Promise<void>`。
  - `tb.persist.load() -> Promise<any | undefined>`。
  - `tb.persist.clear() -> Promise<void>`。
  - IndexedDB 資料庫 `toolbox`、版本 1、object store `state`、key = toolId；可存 Blob（structured clone）。
  - `pagehide` 與 `visibilitychange`（`hidden`）時自動 `saveNow()`。
  - `tb.persist.onError(fn)`：保存失敗時呼叫一次（同一次失敗不重複）。
  - `tb.init` 時呼叫一次 `navigator.storage.persist?.()`（申請不被瀏覽器自動清除；失敗忽略）。
  - `tb.files.bind(el: Element, { accept?: string, multiple?: boolean, max?: number, onFiles(files: File[]) })`：點擊開檔案選擇、拖曳放入、在工具頁內 Ctrl+V 貼上；超過 `max` 只取前 `max` 個並回傳 `{ truncated: true }` 給 `onFiles` 的第二個參數。
  - `stampName(date: Date, n: number) -> string`：`'YYMMDDHHMM_n'`（例 `2610122312_1`）。
  - `tb.download(blob, name)`；`tb.download.batch(items: {blob, name}[], { rng = Math.random })`：每張間隔 `500 + rng() * 500` ms。
  - `buildLogPayload(toolId, code, ver, ua) -> { tool, code, ver, ua }`：`code` 截到 60 字、只允許 `[a-z0-9_.-]`，其他欄位一律丟掉。
  - `tb.log.error(code)`：送 `POST API_BASE + '/logs'`，失敗靜默；不丟例外。

- [ ] **Step 1: 寫 Node 單元測試**：
  - `stampName(new Date(2026, 9, 12, 23, 12), 1) === '2610122312_1'`；
  - `batch` 間隔：注入 `rng = () => 0` 與 `() => 0.999`，用假計時器確認間隔 500 與 999；
  - `buildLogPayload('sample', 'Save Failed!', '1.0', 'UA')` → `code === 'savefailed'`，且沒有其他鍵；
  - 傳入額外的 `{ title: 'x' }` 不會出現在結果裡。
- [ ] **Step 2: 寫 e2e `persist.e2e.js`**（開 `tools/sample/index.html`）：
  - `restores after reload`：輸入「颱風假」，等 600ms，重新整理 → 還在；
  - **`flushes on pagehide`**：輸入後**立刻**（<100ms）`page.reload()` → 還在；
  - `clear removes`：按「清空」後重新整理 → 空白；
  - **`persist degrades without indexedDB`**：`addInitScript` 讓 `indexedDB.open` 丟錯 → 頁面可輸入、出現一次 `role="status"` 文字「這台瀏覽器不能自動保存」、主控台沒有未處理的例外。
- [ ] **Step 3:** 兩個都執行 → FAIL。
- [ ] **Step 4:** 實作。`sdk/toolbox.js` 匯出 `tb`，並設 `globalThis.tb = tb`（讓舊的非 module 程式也能用）。
- [ ] **Step 5:** 寫 `sdk/README.md`：每個公開函式一行說明＋一行範例；開頭寫「工具只能用這裡列出的功能」。
- [ ] **Step 6:** 執行 → PASS。
- [ ] **Step 7: Commit** `feat: SDK 保存、檔案、下載、日誌`

### Task 8: SDK 連線（外掛橋接、後端、素材、狀態）

**Files:**
- Create: `sdk/bridge.js`, `sdk/api.js`, `sdk/assets.js`, `sdk/status.js`, `test/sdk-net.test.js`
- Modify: `sdk/toolbox.js`, `sdk/README.md`

**Interfaces:**
- Consumes: `window.parent.tbxShell`（Task 6）；`API_BASE`（`shell/config.js`）
- Produces:
  - `makeRequest(op, payload, nonce) -> { source: 'tbx-web', nonce, op, payload }`；回覆格式 `{ source: 'tbx-ext', nonce, ok: boolean, data?, code?, error? }`。
  - `tb.ext.call(op, payload, { timeout = 3000 }) -> Promise<data>`：
    - 逾時 reject `Object.assign(new Error('未偵測到外掛'), { code: 'no_extension' })`；
    - 回覆 `ok: false` 則 reject，帶 `code` 與 `error`。
  - `tb.api.call(path, { method = 'GET', body, raw })`：自動帶 `Authorization: Bearer <token>`（從 `localStorage['tbx.company']` 讀 `{ token, exp }`，過期不帶）；回覆 JSON `{ ok, data }`，`ok: false` 則 reject 帶 `code`；回應含 `data.renew` 時更新 localStorage。
  - `resolveAsset(spec, { company: boolean }) -> { source: 'company', key } | { source: 'public', path } | { source: 'upload' } | null`
  - `tb.assets.get(key) -> Promise<{ url: string } | { upload: true } | null>`：
    - company → `API_BASE + '/assets/' + key`，用 Bearer 抓成 Blob 再 `URL.createObjectURL`；
    - public → 相對於工具頁的 URL；
    - 抓公司版失敗時退回 public 版。
  - `tb.status.get(id)`、`tb.status.on(fn)`：轉接 `tbxShell`；工具頁單獨開啟（沒有 parent 外殼）時，`get` 一律回 `{ state: 'warn', text: '請從小編工具箱開啟' }`。

- [ ] **Step 1: 寫測試**：
  - `resolveAsset({ company: 'tvbs-logo', public: 'upload' }, { company: true })` → `{ source: 'company', key: 'tvbs-logo' }`；
  - `company: false` → `{ source: 'upload' }`；
  - `{ public: 'frame.svg' }` 在 company 模式 → `{ source: 'public', path: 'frame.svg' }`；
  - **`ext.call rejects with no_extension`**：用假的 `window`（EventTarget＋`postMessage` 什麼都不做）與假計時器，`timeout: 3000` → reject `code === 'no_extension'`；
  - `ext.call resolves matching nonce only`：先送一個 nonce 不符的回覆、再送相符的 → 只解析相符的；
  - `api.call` 帶 Bearer、過期 token 不帶、`data.renew` 會寫回（用假 `fetch` 與假 `localStorage`）。
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作（依賴 `window`／`fetch`／`localStorage` 的函式都接受注入參數，方便 Node 測試）。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat: SDK 外掛橋接、後端、素材、狀態`

### Task 9: 狀態列＋安裝教學

**Files:**
- Create: `shell/status.js`, `shell/install.js`, `shell/install.css`, `shell/installer.js`, `test/installer.test.js`, `test/e2e/status.e2e.js`
- 來源（複製後改常數與樣式）：`/home/user/-schedulenewnet/web/deploy.js`、`deploy.css`、`installer.js`，以及 `/home/user/-schedulenewnet/test/installer.test.js`

**Interfaces:**
- Consumes: `tb.ext.call('ping')`（Task 8）、`tbxShell.setStatus`（Task 6）、`shell/config.js`
- Produces:
  - 狀態 `extension`：一開始 `checking`（骨架膠囊 132×29、`aria-busy`）；`ping` 成功 → `ok`「外掛已連線」；`no_extension` → `warn`「未安裝外掛」（按下開安裝教學）。
  - P0 只做 `extension` 一個狀態；`login:tvbs`、`helper` 留到 P2，但 `status.js` 用「檢查項目清單」設計，P2 只需加項目。
  - `openInstall()`：全螢幕 5 步驟教學。
  - 電腦版（`matchMedia('(pointer: fine)')` 且寬 > 820px）偵測不到外掛時自動開啟；同一個分頁只自動開一次（`sessionStorage['tbx.installShown']`）。

改名對照：

| 原值 | 新值 |
|---|---|
| `EXT_NAME = '網新快速排程 連線驗證'` | `'小編工具箱'` |
| `schedulenewnet-ext` | `toolbox-ext` |
| `schedulenewnet-install.cmd`／`-mac.sh` | `toolbox-install.cmd`／`toolbox-install-mac.sh` |
| `REPO.repo` | `'socialmediaeditor'` |
| `PREFIX` | 不變（`extension/`） |

樣式改用 `ui/tokens.css`（主按鈕膠囊、次要白底、無 emoji）。

- [ ] **Step 1:** 複製 `installer.test.js` 並改名對照，確認：
  - 產生的 Windows 檔含 `toolbox-ext` 與 `小編工具箱`；
  - Mac 檔含 `bash ~/Downloads/toolbox-install-mac.sh` 的說明字串；
  - 非 base64 內容會丟錯。
- [ ] **Step 2: 寫 e2e `status.e2e.js`**：
  - **`extension pill settles`**：沒有外掛時，3.5 秒內 `#status` 出現「未安裝外掛」，且沒有 `.sk` 殘留；
  - `install auto-opens on desktop`：1280 寬時自動開教學；
  - `no auto-open on phone`：390 寬、`hasTouch` 時不開；
  - `pill ok with fake extension`：`addInitScript` 注入回應 `tbx-web` ping 的假外掛 → 顯示「外掛已連線」。
- [ ] **Step 3:** 執行 → FAIL。
- [ ] **Step 4:** 實作。
- [ ] **Step 5:** 執行 → PASS。
- [ ] **Step 6: Commit** `feat: 狀態列與外掛安裝教學`

### Task 10: 公司模式

**Files:**
- Create: `shell/company.js`, `test/e2e/company.e2e.js`
- Modify: `shell/main.js`, `shell/showcase.js`, `shell/toolbar.js`

**Interfaces:**
- Consumes: `tb.api.call('/auth')`、`/auth/status`（Task 12 的路由；e2e 用 `page.route` 模擬）
- Produces:
  - 頂列次要按鈕「公司素材」→ `<dialog>`：「公司密碼」欄位（標籤在上）、主按鈕「解鎖」、次要按鈕「取消」。
    - 錯誤訊息：「密碼不對，請再試一次」；連不上時：「連不上伺服器，請稍後再試」。
  - 成功：`localStorage['tbx.company'] = { token, exp }`，狀態膠囊「公司素材已解鎖，剩 N 天」（`.num`），點它可「登出公司模式」。
  - 開站時若有 token → 打 `/auth/status` 確認（期間膠囊為骨架）。
  - `tbxShell.company()` 與 `onCompany` 生效；櫥窗、工具列依 `tier` 重新產生。
  - `tbxShell.__checkCompany() -> Promise<void>`：立即執行一次憑證檢查（定時檢查也呼叫它；e2e 直接呼叫）。
  - 憑證過期（開站確認失敗，或每 10 分鐘檢查一次發現 `exp < now`）時：
    - 清 token，工具列與櫥窗隱藏 company 工具；
    - **已開著的 company 窗格保留**（iframe 不移除），窗格上方顯示提示列「公司密碼已過期，重新輸入後即可繼續」＋按鈕「重新輸入」。

- [ ] **Step 1: 寫 e2e**：catalog 換成 alpha(public)＋secret(company)，`/auth` 與 `/auth/status` 用 `page.route` 模擬。
  - `company tool hidden by default`；
  - `unlock shows company tool`：輸入正確密碼 → 出現 secret，膠囊含「剩 30 天」；
  - `wrong password message`；
  - **`expiry keeps open company pane`**：解鎖、開 secret、在 iframe 輸入文字 → 讓 `/auth/status` 回 401，並觸發檢查（呼叫 `window.tbxShell.__checkCompany()`）→ 工具列沒有 secret，但窗格還在、文字還在、看得到「公司密碼已過期」；
  - `logout hides company tool`。
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat: 公司模式解鎖與過期處理`

### Task 11: 積木測試（新增／移除工具不動核心）

**Files:**
- Create: `test/blocks.test.js`

**Interfaces:**
- Consumes: `build(root, opts)`（Task 4）

- [ ] **Step 1: 寫測試 `adding and removing a tool touches no core file`**：
  1. 複製整個 repo（排除 `.git`、`node_modules`）到暫存資料夾；
  2. 對 `shell/`（排除 `catalog.json`）、`sdk/`、`ui/`、`server/core/`、`extension/core/`、`index.html` 算 SHA-256 快照；
  3. 複製 `tools/_template` 為 `tools/zz-demo`、改 `id`，registry 加 `zz-demo` → `build`；
  4. 斷言 catalog 含 `zz-demo`、快照不變；
  5. 移除 registry 中的 `zz-demo` → `build` → catalog 不含、快照仍不變。
- [ ] **Step 2:** 執行 → 應直接 PASS（前面任務正確的話）；若 FAIL，修正造成核心被改動的任務，而不是改這個測試。
- [ ] **Step 3: Commit** `test: 積木測試`

---

## Part B：後端 toolbox-api

### Task 12: Worker 骨架、憑證、`/auth`

**Files:**
- Create: `server/index.js`, `server/core/http.js`, `server/core/token.js`, `server/core/auth.js`, `server/core/db.js`, `server/schema.sql`, `server/wrangler.toml`, `test/helpers/fake-env.js`, `test/server/auth.test.js`
- 參考：`/home/user/-schedulenewnet/worker/index.js` 的 `b64urlEncode`、`hmacKey`、`signSession`、`sessionExp`、`passwordMatches`（複製改寫）

**Interfaces:**
- Produces:
  - `signToken(secret, kind: 'company' | 'admin', exp: number) -> Promise<string>`；`readToken(secret, token, nowSec) -> Promise<{ kind, exp } | null>`
  - `json(request, env, body, status = 200)`：加 CORS。只允許 `env.ALLOWED_ORIGIN`（預設 `https://unnn3ing-oss.github.io`）；`env.ALLOW_LOCALHOST === '1'` 時另允許 `http://localhost:*`、`http://127.0.0.1:*`。`OPTIONS` 預檢回 204。
  - `bearer(request, env, kind) -> Promise<{ kind, exp } | null>`
  - 回覆格式：`{ ok: true, data }`／`{ ok: false, code, error }`。錯誤代碼：
    - `bad_password`（200）
    - `unauthorized`（401）
    - `not_found`（404）
    - `too_large`（413）
    - `bad_request`（400）
    - `misconfigured`（500）
  - `POST /auth { password }`：符合 `COMPANY_PASSWORD` → `{ token, exp }`，有效 `SESSION_DAYS`（預設 30）天；失敗前延遲 `FAIL_DELAY_MS`（預設 1000）。
  - `GET /auth/status`（Bearer company）→ `{ company: true, exp }`；剩不到一半效期時多回 `renew: { token, exp }`。
  - `SESSION_SECRET` 少於 32 字、或 `COMPANY_PASSWORD` 沒設 → `misconfigured`。
  - `server/routes.gen.js` 的工具路由掛在 `/t/<id>/`：把 `request`、`env`、`ctx` 與去掉前綴的 `path` 交給模組的 `handle(request, env, ctx, path)`。
  - `fake-env.js`：`fakeR2()`（put／get／head／delete／list）、`fakeKV()`（get／put，可設 ttl）、`fakeD1()`（用 `node:sqlite` 的 `DatabaseSync(':memory:')` 實作 `prepare(sql).bind(...).run()/all()/first()`，`all` 回 `{ results }`，建立時執行 `server/schema.sql`）。
  - `schema.sql`：

    ```sql
    CREATE TABLE IF NOT EXISTS assets (key TEXT PRIMARY KEY, tier TEXT NOT NULL CHECK (tier IN ('public','company')), type TEXT NOT NULL, size INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, tool TEXT NOT NULL, code TEXT NOT NULL, ver TEXT, ua TEXT);
    CREATE INDEX IF NOT EXISTS logs_at ON logs(at);
    ```
  - `wrangler.toml`：
    - `name = "toolbox-api"`、`main = "index.js"`、`compatibility_date = "2026-10-01"`；
    - D1 binding `DB`、R2 binding `FILES`、KV binding `CACHE`（id 欄位留 `"填入你的 ID"`）；
    - `[triggers] crons = ["17 19 * * *"]`（台灣時間 03:17）；
    - vars `ALLOWED_ORIGIN`。

- [ ] **Step 1: 寫測試**：
  - 正確密碼回 token，且 `readToken` 得到 `kind: 'company'`；
  - 錯誤密碼 `bad_password`；
  - 用 admin token 打 `/auth/status` → 401；
  - 過期 token → 401；
  - 剩 10 天時有 `renew`；
  - CORS：其他 origin 的回應不含 `Access-Control-Allow-Origin`；
  - secret 太短 → `misconfigured`；
  - `fakeD1` 可以 insert 與 select。
- [ ] **Step 2:** `node --test test/server/auth.test.js` → FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat(server): Worker 骨架與公司密碼憑證`

### Task 13: 素材與管理頁

**Files:**
- Create: `server/core/assets.js`, `server/core/admin.js`, `server/core/admin.html`, `test/server/assets.test.js`

**Interfaces:**
- Consumes: `bearer`、`json`、`fakeD1`、`fakeR2`
- Produces:
  - `GET /assets/manifest`：
    - 沒有 company token → 只列 `tier = 'public'`；
    - 有 company token → 全部。
    - 每筆 `{ key, tier, type, size, updated }`。
  - `GET /assets/<key>`：
    - public 不需登入，`Cache-Control: public, max-age=300`；
    - company 需 company token，否則 401，`Cache-Control: private, max-age=300`；
    - R2 物件鍵 `assets/<key>`。
  - `POST /admin/login { password }`：比對 `ADMIN_PASSWORD` → admin token，12 小時有效。
  - `GET /admin/assets`（admin）列全部；`PUT /admin/assets/<key>`（admin，header `X-Tier: public|company`，body 原始位元組，≤ 10 MB）。
    - key 需符合 `/^[a-z0-9][a-z0-9._-]{0,63}$/`；
    - 型別由檔頭判斷（PNG、JPEG、WebP、WOFF2，以及開頭是 `<svg` 或 `<?xml` 的 SVG），其他 → `bad_request`。
  - `DELETE /admin/assets/<key>`（admin）。
  - `GET /admin` 回 `admin.html`：
    - 單頁介面：管理密碼登入 → 素材清單（key、等級、大小、更新時間），可上傳、替換、刪除；
    - 樣式內嵌，數值同 `ui/tokens.css`（Worker 不讀 repo 的 css）；
    - 刪除前要確認，按鈕文字為「刪除這個素材」。

- [ ] **Step 1: 寫測試**：
  - 上傳 company PNG → 未登入時 manifest 沒有它、取檔 401；company token 時 manifest 有它、取檔 200 且 `content-type: image/png`；
  - 上傳 `.exe` 位元組 → `bad_request`；
  - 11 MB → `too_large`；
  - 非 admin 呼叫 PUT → 401；
  - DELETE 後 manifest 與 R2 都沒有；
  - `GET /admin` 回 HTML。
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat(server): 素材與管理頁`

### Task 14: 日誌、抓網頁、定時清理、部署說明

**Files:**
- Create: `server/core/logs.js`, `server/core/fetch.js`, `test/server/logs.test.js`, `test/server/fetch.test.js`, `docs/deploy.md`
- Modify: `server/index.js`（`scheduled` handler）

**Interfaces:**
- Produces:
  - `POST /logs`：
    - body ≤ 2048 bytes，只取 `tool`（`TOOL_ID_RE`）、`code`（`[a-z0-9_.-]{1,60}`）、`ver`（≤ 20）、`ua`（≤ 200），其他欄位丟掉；
    - 不需登入（CORS 已限制來源）。
  - `GET /admin/logs?days=7`（admin）→ 最新的在前，最多 500 筆。
  - `cleanup(env, nowMs)`：刪除 30 天前的 logs；`scheduled` 呼叫它。
  - `GET /fetch?url=`：
    - 只允許 https，且 hostname 等於或以 `.` 結尾符合 `env.FETCH_HOSTS`（逗號分隔，預設 `tvbs.com.tw`）中的某一項，其他 → `bad_request`；
    - 最多讀 2 MB；
    - 從 HTML 取 `og:title`（沒有就 `<title>`）、`og:image`、`og:description`，回 `{ url, title, image, description }`；
    - KV `fetch:<url>` 快取 3600 秒。
- `docs/deploy.md`：給使用者照做的逐步說明。
  1. Cloudflare 建 D1 `toolbox`、R2 `toolbox-files`、KV `toolbox-cache`，把 ID 填進 `wrangler.toml`；
  2. 執行 `npx wrangler d1 execute toolbox --remote --file server/schema.sql`；
  3. 設定 Secrets：`COMPANY_PASSWORD`、`ADMIN_PASSWORD`、`SESSION_SECRET`（`openssl rand -hex 32`）；
  4. 在 `server/` 執行 `npx wrangler deploy`；
  5. 自我檢查：`GET /assets/manifest` 應回 `{ ok: true }`；
  6. 打開 `/admin` 上傳公司素材；
  7. GitHub repo Settings → Pages 從 `main` 部署（併入 main 後才做）。

  每一步都寫「看到什麼代表成功」。

- [ ] **Step 1: 寫測試**：
  - `logs strips content fields`：送 `{ tool: 'sample', code: 'save_failed', title: '颱風', url: 'https://…' }` → D1 那一列沒有 title、url，也沒有任何地方存了它們；
  - 3 KB body → `too_large`；
  - `cleanup` 刪除 31 天前的、保留 29 天前的；
  - fetch：`https://news.tvbs.com.tw/x` 可抓（stub 全域 `fetch` 回含 og 標籤的 HTML）；`https://evil.com` → `bad_request`；`https://tvbs.com.tw.evil.com` → `bad_request`；`http://` → `bad_request`；第二次請求不打上游（KV 命中）。
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat(server): 日誌、抓網頁、定時清理與部署說明`

---

## Part C：統一外掛核心

### Task 15: 外掛 manifest、固定 ID、橋接、背景路由、圖示

**Files:**
- Modify: `extension/core/manifest.base.json`
- Create: `extension/core/background.js`, `extension/core/bridge.js`, `extension/core/id.js`, `extension/icons/icon-{16,32,48,128}.png`, `docs/extension-id.md`, `test/extension.test.js`

**Interfaces:**
- Produces:
  - `manifest.base.json`：

    ```json
    {
      "manifest_version": 3, "name": "小編工具箱", "version": "1.00", "key": "<公鑰 base64>",
      "permissions": ["storage", "alarms", "sidePanel"],
      "host_permissions": ["https://api.github.com/*", "https://raw.githubusercontent.com/*"],
      "background": { "service_worker": "core/background.js", "type": "module" },
      "content_scripts": [{ "matches": ["https://unnn3ing-oss.github.io/socialmediaeditor/*", "http://localhost/*", "http://127.0.0.1/*"],
        "js": ["core/bridge.js"], "all_frames": true, "run_at": "document_start" }],
      "side_panel": { "default_path": "core/sidepanel.html" },
      "action": { "default_title": "小編工具箱" },
      "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }
    }
    ```

  - 公鑰產生：

    ```bash
    openssl genrsa 2048 | openssl rsa -pubout -outform DER | base64 -w0
    ```

    私鑰**不保存**（載入未封裝項目不需要）。
  - `extensionIdFromKey(b64: string) -> string`（在 `extension/core/id.js`）：SHA-256(DER) 前 32 個 hex 字元，`0-f` 對應 `a-p`。
  - `EXT_ID` 常數寫在 `id.js` 與 `docs/extension-id.md`。後者並說明 P2 要把這個 ID 加進 videodownload 的 `allowed_origins`。
  - `bridge.js`：只接受 `event.source === window` 且 `data.source === 'tbx-web'`；轉成 `chrome.runtime.sendMessage({ op, payload })`；回覆貼回 `window.postMessage({ source: 'tbx-ext', nonce, ...result }, location.origin)`。
  - `background.js`：
    - `ops = { ping: () => ({ ok: true, data: { version } }) }`，再合併 `routes.gen.js` 的 `toolOps`，以 `'<id>.<op>'` 為鍵；
    - 未知 op → `{ ok: false, code: 'unknown_op', error: '外掛不支援這個動作' }`；
    - 點工具列圖示時開側邊欄（`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`）。
  - 圖示：用 Playwright 把 Logo A SVG（`favicon.svg`，底色 `#1d4fb8` 圓角方塊＋白色線條版）輸出成 4 種尺寸 PNG。

- [ ] **Step 1: 寫測試**（stub `chrome`）：
  - `extensionIdFromKey(manifest.key) === EXT_ID`，且 `EXT_ID` 為 32 個 `a-p` 字元；
  - bridge 忽略 `source !== 'tbx-web'` 與來自其他 window 的訊息；
  - bridge 把回覆帶原 nonce 貼回；
  - background `ping` 回版本 `1.00`；
  - 未知 op 回 `unknown_op`；
  - `build()` 後 `extension/manifest.json` 的 `key` 與 base 相同。
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作，產生 key 與圖示，跑 `node build.js`。
- [ ] **Step 4:** 執行 → PASS。
- [ ] **Step 5: Commit** `feat(extension): 外掛核心、固定 ID 與橋接`

### Task 16: 側邊欄與自動更新

**Files:**
- Create: `extension/core/sidepanel.html`, `extension/core/sidepanel.js`, `extension/core/sidepanel.css`, `extension/core/updater.js`, `extension/changelog.json`, `test/updater.test.js`
- 來源（複製改寫）：`/home/user/-schedulenewnet/extension/updater.js`、`sidepanel.*`（只取「狀態與更新」相關部分）以及對應測試
- Modify: `extension/core/background.js`（每小時 alarm、啟動時檢查、有新版時 badge 文字「新」）

**Interfaces:**
- Produces:
  - `updater.js`：`REPO = { owner: 'unnn3ing-oss', repo: 'socialmediaeditor', branch: 'main' }`、`PREFIX = 'extension/'`；其餘行為照原檔：
    - 比對 blob SHA；
    - 第一次選資料夾後記住；
    - 只寫有變動的檔案；
    - `chrome.runtime.reload()`。
  - 側邊欄只有三塊：
    - 主按鈕「開啟小編工具箱」→ `chrome.tabs.create({ url: SITE })`；
    - 目前版本（`.num`）；
    - 「檢查更新」次要按鈕＋更新彈窗（「立即更新」主按鈕、「稍後」次要按鈕）。
  - `changelog.json`：`{ "1.00": { "summary": "小編工具箱外掛第一版", "items": ["網站橋接", "側邊欄與自動更新"] } }`

- [ ] **Step 1:** 複製原 updater 測試並改 `REPO` 對照；新增：
  - `sidepanel opens site`：stub `chrome.tabs.create`，斷言 url 為 `https://unnn3ing-oss.github.io/socialmediaeditor/`；
  - `badge shows 新 when update available`：stub GitHub 回應不同的 SHA。
- [ ] **Step 2:** 執行 → FAIL。
- [ ] **Step 3:** 實作。
- [ ] **Step 4:** 執行 → PASS；`node build.js --check` 通過。
- [ ] **Step 5: Commit** `feat(extension): 側邊欄與自動更新`

---

## Task 17: 收尾驗證與回報

**Files:**
- Modify: `README.md`（補上 P0 完成的功能、截圖說明不放進 repo）

- [ ] **Step 1:** 全部執行，每一項都要全過：
  - `npm test`
  - `npm run e2e`
  - `node build.js --check`
- [ ] **Step 2:** 檢查沒有公司素材進 repo：

  ```bash
  git ls-files | grep -iE 'tvbs|ribbon|frames/|sticker|wordmark'
  ```

  → 無輸出。
- [ ] **Step 3:** Playwright 截圖存 scratchpad，供主對話彙整給使用者：
  - 櫥窗；
  - 單一工具全頁；
  - 左右並排（含最後操作藍框）；
  - 公司密碼對話框；
  - 安裝教學第一步；
  - 未安裝外掛的狀態列；
  - 以上都在 1280×820，另加櫥窗的 390 寬手機版。
- [ ] **Step 4:** `git push -u origin claude/charming-hamilton-6rk4l5`（只推開發分支）。
- [ ] **Step 5:** 回報給主對話：
  - 改了什麼（依 Part 分組）；
  - 測試結果數字；
  - 截圖路徑；
  - 使用者需要自己做的事：照 `docs/deploy.md` 部署 Worker；併入 main 後開 GitHub Pages；
  - 尚未驗證的部分：真的部署到 Cloudflare、真的在 Chrome 載入外掛，這兩項沙盒做不到。
