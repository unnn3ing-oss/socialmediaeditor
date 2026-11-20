# 小編工具箱

把小編常用的做圖、發文、下載工具整合在一個網站，搭配一個 Chrome 外掛與一個後端。

- 網站：https://unnn3ing-oss.github.io/socialmediaeditor/（併入 main 並開啟 GitHub Pages 後生效）
- 後端：`toolbox-api`（Cloudflare Worker），網址 https://toolbox-api.19jpz-3.workers.dev ，部署方式見 `docs/deploy.md`
- 管理後台：https://unnn3ing-oss.github.io/socialmediaeditor/admin/
- （只有網站版；後端網址 `/admin` 會轉過來。兩種進入方式：首頁用員工編號＋密碼登入後，在右上角帳號選單按「管理頁」（系統管理者＝Secret `SYS_STAFF_ID` 那位，或層級有卡片的人才看得到）；或在管理頁直接輸入 `ADMIN_PASSWORD`。權杖、App 密鑰、Webhook、權限組、層級權限要在管理頁輸入管理員密碼解鎖；管理者能用哪些卡片在「授權名單」→「層級權限」設定）

- 隱私權政策：https://unnn3ing-oss.github.io/socialmediaeditor/privacy/
- 資料刪除說明：https://unnn3ing-oss.github.io/socialmediaeditor/data-deletion/

### 臉書應用程式切「上線模式」（不送審）

排程發布只給應用程式上有角色的人（管理員／開發者）的權杖使用，不需要 App Review；但開發模式發的貼文只有角色使用者看得到，要切上線模式。到 Meta 開發者後台 → 該應用程式：

1. 「應用程式設定 → 基本資料」：
   - 隱私政策網址：填上方「隱私權政策」網址
   - 用戶資料刪除：選「資料刪除說明網址」，填上方「資料刪除說明」網址
   - 應用程式圖示：上傳 `docs/meta/app-icon-1024.png`（1024×1024）
   - 類別：選「商業和網頁」（Business and Pages）或最接近的類別
   - 聯絡電子郵件：與隱私權政策相同
2. 儲存後，頂端「應用程式模式」切到「上線」。
3. 確認權杖持有人在「應用程式角色」裡仍是管理員或開發者。


| 路徑 | 內容 |
|---|---|
| `index.html`、`shell/` | 外殼：櫥窗、上方工具列（一次開一個工具）、狀態列、公司模式 |
| `sdk/` | 工具唯一能用的共用功能（說明見 `sdk/README.md`） |
| `ui/tokens.css` | 共用樣式 |
| `tools/` | 每個工具一個資料夾；`registry.json` 決定啟用哪些 |
| `tools/ytdl/` | YT 批量下載：網頁、外掛模組（`ext/`）、本機下載助手（`host/`，Python）與安裝檔（`installers/`）；說明見 `tools/ytdl/PROTOCOL.md`、`tools/ytdl/HOST.md` |
| `extension/` | 統一外掛「小編工具箱」 |
| `server/` | 後端 `toolbox-api` |
| `build.js` | 讀工具清單，產生外殼目錄、外掛 manifest、路由表 |
| `docs/` | 設計規格、實作計畫、設計稿、部署說明 |

`shell/catalog.json`、`extension/manifest.json`、`extension/routes.gen.js`、`extension/tools/`、`server/routes.gen.js` 是 `node build.js` 產生的，請勿手改。`tools/ytdl/installers/` 由 `python3 tools/ytdl/build_installers.py` 產生（改了 `tools/ytdl/host/` 或安裝檔模板就要重跑，CI 會檢查）。

## 開發

```bash
npm test          # 單元測試
npm run e2e       # 瀏覽器測試
node build.js     # 產生檔案
```
