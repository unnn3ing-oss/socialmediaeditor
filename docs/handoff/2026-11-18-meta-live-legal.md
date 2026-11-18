# Meta 上線模式：隱私權政策＋資料刪除頁＋留言紀錄兩週清除＋應用程式圖示
- 狀態：進行中　- 分支：claude/zen-wozniak-y8862m　- 最後更新：2026-11-18
- 使用者原始需求：「審查臉書功能是否符合應用程式審查」→ 選方案 A（不送審，應用程式目前是開發模式，要切上線模式），「先列出隱私權政策和資料刪除頁怎麼做」→「開始」。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 送審 | 不送 App Review，只切上線模式 | Meta：只給應用程式角色使用者用免審；開發模式內容只有角色使用者看得到 |
| 營運者名稱 | 只寫「小編工具箱」，不寫公司名 | 使用者選 B |
| 聯絡信箱 | jeanzhuang@tvbs.com.tw（使用者明確提供，公開） | Meta 要求 |
| 資料刪除 | 用「說明網址」，不做回呼 | 沒有臉書登入，沒有一般用戶授權 |
| 留言計時器紀錄 | 全部完成／取消／失敗後 **14 天**自動清除（Durable Object `deleteAll`） | 使用者選 A、改兩週 |
| 語言 | 中英對照 | 審查人員看英文 |
| 圖示 | 從 `favicon.svg` 輸出 1024×1024 PNG | 上線模式要圖示 |
| 管理頁授權名單 | 這次不做，另列做法給使用者確認 | 需要個人帳號機制，屬新版本 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `privacy/index.html` | 隱私權政策（中英） | ✅ |
| `data-deletion/index.html` | 資料刪除說明（中英） | ✅ |
| `legal.css` | 兩頁共用樣式 | ✅ |
| `index.html` | 頁尾加兩個連結 | ✅ |
| `server/fb/timer.js` | 沒有待留言時排 14 天後清除鬧鐘，`alarm()` 到期 `deleteAll` | ✅ |
| `test/server/fb-timer.test.js`、`test/helpers/fake-fb.js` | 清除測試；fakeStorage 加 `deleteAll` | ✅ |
| `test/e2e/legal.e2e.js` | 兩頁可開、互連、320px 不超出 | ✅ |
| `docs/meta/app-icon-1024.png` | 應用程式圖示 | ✅ |
| `README.md` | 兩個網址＋Meta 後台填哪裡 | ✅ |

## 下一步
- [x] 依上表實作（瀏覽器只存 RD 開關與登入憑證，重寫後的排程發布沒有本地送出紀錄，政策已照實寫）
- [x] npm test 622、全部 e2e 190、build --check 通過
- [x] 獨立審查：修正後通過（補 Rundown→Google 試算表一列與第三方服務；舊紀錄查 status 時補排清除）
- [x] npm test 623、legal e2e 6、timer 26
- [ ] 使用者確認後說「推」併入 main、更新 CLAUDE.md 目前進度
- [ ] 使用者：部署 Worker → Meta 後台填網址、圖示 → 切上線模式
- [ ] 下一版（未定案）：管理頁「排程發布授權名單」，做法待使用者確認

## 測試
`npm test`、`npx playwright test test/e2e/legal.e2e.js`、`node build.js --check`

## 注意事項
- 後端改了 timer.js → 使用者要重新部署 Worker。
- 不改外掛、不升版號。
