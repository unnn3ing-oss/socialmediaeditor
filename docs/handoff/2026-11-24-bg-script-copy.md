# 文字背景：管理頁加「複製擷取腳本」按鈕
- 狀態：進行中　- 分支：claude/jolly-brown-cucnoe　- 最後更新：2026-11-24
- 使用者原始需求：「文字背景的 docs/fb-text-backgrounds/extract-fb-backgrounds.js 可以在文字背景設定裡增加一個可以直接複製的按鈕讓我複製」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 腳本來源 | 按下時 fetch 網站上的 `../docs/fb-text-backgrounds/extract-fb-backgrounds.js` | 不複製一份，腳本更新自動跟著 |
| 位置 | 文字背景卡片說明段落下方 | 使用者確認 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `admin/index.html` | 說明改寫＋`#bgScript` 按鈕 | ✅ |
| `admin/admin.js` | 文字背景區 `#bgScript` onclick：fetch → clipboard → `#bgMsg` | ✅ |
| `test/e2e/admin.e2e.js` | 複製後剪貼簿＝腳本檔 | ✅ |

## 測試
`npx playwright test test/e2e/admin.e2e.js`（或專案 e2e 指令只跑 admin）、`npm test`、`node build.js --check`。

## 注意事項
純網站，不部署後端、不升外掛版號。

## 結果
- admin e2e 41（含新增 1 項）、npm test 806、build --check 通過。
- 已知：`SHOT_DIR` 設定時「截圖：電腦版（系統管理者、管理者）與手機版」失敗，未改程式（stash）同樣失敗，與本次無關；不設 SHOT_DIR 全過。
- 待使用者說「推」併入 main（同 commit 更新 CLAUDE.md 目前進度）。
