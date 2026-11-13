# 第 N 則留言（發布後延遲）＋ Rundown 搬到底列 ＋ 小編文框縮矮
- 狀態：進行中　- 分支：claude/affectionate-fermat-36bbfp　- 最後更新：2026-11-13
- 使用者原始需求：「使用排程發布貼文功能，能新增可設定時間留第二則留言的功能嗎？」→「先幫我把排入RD移動到下方工具列空白處，並左側為開關、右側為輸入框，設定的按鈕直接改為管理介面可看就好…第二則留言放到目前留言小編文的下方，用『再新增一則留言』按鈕，預設為5分鐘後，用滾輪可選每五分鐘為單位增減。方案選A。第N則不需帶連結，只有文字或其他活動宣傳連結、表情符號。暫時最多三則，並保留未來擴充可能。」＋「小編文的預設輸入框高度縮矮三分之一」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 方案 | A：擴充 D1 `fb_comments`（加 `seq`、`delay`） | 沿用重試、失敗通知、取消／改時間連動 |
| 延遲 | 「發布後 N 分鐘」，`due = 發布時間 + delay`；預設 5、步進 5、下限 5、上限 1440 | 改排程時間時第 N 則跟著移動 |
| 則數 | 含第一則共 3 則（只能再新增 2 則），常數 `MAX_COMMENTS = 3`，前後端共用同一數字 | 使用者確認，保留擴充 |
| 第 N 則內容 | 純文字（可含連結、表情），不自動帶 utm；空白＝不留；各粉專同文同延遲 | 使用者指定 |
| 各則延遲 | 各自從發布時間起算，不強制遞增；第 3 則預設＝第 2 則＋5 | 我的決定（簡單） |
| 滾輪 | 滑鼠在數字框上才調整（preventDefault），也支援 ↑↓ 與直接輸入 | 不影響整頁捲動 |
| Rundown | 開關（左）＋SLUG 輸入（右）搬到底列「清空頁面」左邊空白處；移除 ⚙ 與 `#rdDlg`；說明文字改 hover 提示＋管理頁卡片 | 使用者指定 |
| 管理頁 | 新增「Rundown 連線」卡片：說明＋是否已設定 Secrets＋測試連線；不放可編輯設定 | 使用者確認 |
| 小編文框 | `rows="7"` → `5`（約縮 1/3） | 使用者指定 |
| 版號／部署 | 不升外掛版號；**後端需重新部署** | 沒動 `extension/`，動了 `server/` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/fbqueue.js` | 欄位 `seq`、`delay`（ALTER 補欄位）；`due` 帶 delay（reschedule／retime／syncPage／processPage）；`commentsForPosts` 回全部留言 | ⬜ |
| `server/core/fb.js` | `/fb/post` 收 `extraComments`（JSON `[{message, delay}]`）驗證＋入列；立即發布從現在起算 | ⬜ |
| `server/core/admin-page.js`、`admin.js` | Rundown 連線卡片＋測試連線端點 | ⬜ |
| `tools/fbpost/index.html`、`tool.css`、`tool.js` | 底列 Rundown、留言列（新增／移除／滾輪）、預覽、送出帶入、清空／草稿判斷、小編文 rows=5 | ⬜ |
| `tools/fbpost/records.js` | 紀錄保存各則內容（白名單） | ⬜ |
| 已排程列表 | 每則留言一行：「第 2 則・等待留言（發布後 5 分）」 | ⬜ |
| `tools/fbpost/TOOL.md`、規格 | 補說明 | ⬜ |
| 測試 | 單元（延遲換算、跟隨改時間、取消連動、舊資料、上限）＋ e2e（留言列、滾輪、Rundown 搬位；舊 `#rdSetBtn`／`#rdTest` 測試改成管理頁） | ⬜ |

## 下一步
- [ ] 後端 fbqueue／fb 與單元測試
- [ ] 管理頁 Rundown 卡片
- [ ] 前端（底列、留言列、紀錄、已排程）
- [ ] 跑 `npm test`、`node build.js`、fbpost e2e；拍截圖給使用者（底列＋留言區）
- [ ] 派獨立審查代理（Sonnet）
- [ ] 使用者說「推」才併入 main，同 commit 更新 `CLAUDE.md`「目前進度」

## 測試
- `npm test`、`node build.js --check`、`npx playwright test test/e2e/fbpost.e2e.js`

## 注意事項
- 公司素材不進 repo；第一則留言邏輯（自動連結＋utm）與 3 分鐘上限不變。
- 產生檔（`shell/catalog.json` 等）不手改，跑 `node build.js`。
- 不直接推 main。
