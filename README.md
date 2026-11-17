# 小編工具箱

把小編常用的做圖、發文、下載工具整合在一個網站，搭配一個 Chrome 外掛與一個後端。

- 網站：https://unnn3ing-oss.github.io/socialmediaeditor/（併入 main 並開啟 GitHub Pages 後生效）
- 後端：`toolbox-api`（Cloudflare Worker），網址 https://toolbox-api.19jpz-3.workers.dev ，部署方式見 `docs/deploy.md`
- 管理後台：https://unnn3ing-oss.github.io/socialmediaeditor/admin/
- （分類排版；後端版 https://toolbox-api.19jpz-3.workers.dev/admin 也能用，兩個功能相同。輸入管理密碼 `ADMIN_PASSWORD`；上傳公司素材、錯誤紀錄）

## 目錄

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
