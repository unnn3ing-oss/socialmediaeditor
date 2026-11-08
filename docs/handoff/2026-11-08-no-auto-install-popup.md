# 網頁版不再自動跳出「安裝外掛」畫面
- 狀態：已完成（已併入 main）　- 分支：claude/dreamy-fermi-7l6uai　- 最後更新：2026-11-08
- 使用者原始需求：「幫我修改網頁版不用預設自動跳出安裝外掛插件畫面。」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 方案 | A：完全不自動跳出 | 最單純，不加設定開關 |
| 手動入口 | 保留頂列「未安裝外掛」膠囊與「安裝外掛」按鈕 | 需要時仍可進教學 |
| 版號／部署 | 只改網頁，不升外掛版號、不部署 Worker | 沒動 `extension/`、`server/` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `shell/main.js` | 移除 `status.runAll().then(...)` 自動開啟段落與 `shouldAutoOpenInstall`／`markInstallShown` 匯入 | ✅ |
| `shell/status.js` | 刪除 `shouldAutoOpenInstall`、`markInstallShown`、`safeSession` | ✅ |
| `test/e2e/status.e2e.js` | `install auto-opens on desktop` 改為不自動跳出，按膠囊才開 | ✅ |
| `docs/superpowers/specs/2026-11-05-toolbox-design.md` §351 | 改為不自動跳出 | ✅ |
| `CLAUDE.md`「目前進度」 | 併入 main 時同 commit 更新 | ✅|

## 下一步
- [x] 依上表依序修改（另移除 company／shell e2e 裡已無用的 `tbx.installShown` 設定）
- [x] 跑 `node --test test/e2e/status.e2e.js`、`node build.js --check`、`npm test`
- [x] 回報結果給使用者；使用者說「推」後併入 main

## 測試
- `status.e2e.js`：1280 寬、未安裝外掛 → `#deployOverlay` 不存在；點 `#status .pill-warn` → 教學打開；手機與假外掛測試維持原樣。

## 注意事項／不能做的事
- 不直接推 main；不開 PR。
- 不動 `extension/`、`server/`。
