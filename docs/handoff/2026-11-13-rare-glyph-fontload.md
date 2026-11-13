# 作圖生僻字留白：用實際標題文字載入 Noto Sans TC
- 狀態：進行中　- 分支：claude/affectionate-fermat-36bbfp（與留言版本同分支、獨立 commit）　- 最後更新：2026-11-13
- 使用者原始需求：「這字型可以用什麼方式讓我產圖可以避免有罕見字無法顯示出來且留白嗎」→ 選做法 A，「OK 開始」

## 已知事實（實測，2026-11-13）
- Google 的 Noto Sans TC 切成 108 段（CSS `unicode-range`），瀏覽器只下載頁面用到的字所在的段；canvas 不會觸發下載。
- 目前只呼叫 `document.fonts.load(..., '標題')`／`'字'`，罕見字所在的段沒載入 → 退回系統字型 → 沒有就留白。
- 實測 `fonts.googleapis.com/css2?...&text=` 回傳的 unicode-range 含 𠮷(U+20BB7)、𰻞(U+30EDE，擴充 G)、𧃟、𠀋、鱲、堃、喆、㙓、龘：Google 版本幾乎不缺字，問題在載入。
- 公司字型 WHZ-Heavy 載入時，缺字會退回系統字型（fallback 裡原本沒有 Noto Sans TC）。
- `fonts.google.com/selection` 是 JS 單頁，抓不到內容；Noto 字型頁有讀到（65,535 字形、44,806 字）。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 做法 | A：畫之前用實際文字載入、載完重畫；輸出前等載完 | 使用者選 A |
| 範圍 | 只改排程發布（作圖框＋純文字底圖）；其他工具另議 | 使用者確認 |
| B（缺字偵測警告） | 不做，A 之後仍有留白再補 | 字型實測不缺字 |
| 公司字型 fallback | 加 `"Noto Sans TC"` 在系統字型前 | 缺字改用同系字型，不用系統字 |
| 版號／部署 | 純前端，不升外掛版號、不部署 Worker | 沒動 `extension/`、`server/` |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `tools/fbpost/fontload.js`（新） | `createFontLoader`：只載入沒要求過的非 ASCII 字，`request`（載完呼叫 onLoaded）、`ensure`（等載完，不丟錯）；失敗可重試 | ⬜ |
| `tools/fbpost/editor.js` | `setTitle` 觸發載入、載完 `renderSoon`；`exportBlob` 先 `ensure`；FONT_FALLBACK 加 Noto | ⬜ |
| `tools/fbpost/tool.js`、`textcard.js` | `renderCard` 觸發載入；`buildPayload` 純文字底圖先 `ensure`；FALLBACK 加 Noto | ⬜ |
| 測試 | `test/fbpost-fontload.test.js`（單元）、`test/e2e/fbpost.e2e.js`（輸入罕見字會載入該字、送出前等載完） | ⬜ |
| `tools/fbpost/TOOL.md` | 補說明 | ⬜ |

## 下一步
- [ ] 寫 fontload.js 與單元測試
- [ ] 接到 editor／textcard
- [ ] e2e、`npm test`、`node build.js --check`
- [ ] 獨立審查代理（Sonnet）
- [ ] 使用者說「推」才併入 main，同 commit 更新 `CLAUDE.md`「目前進度」（含留言版本）

## 測試
`npm test`、`node build.js --check`、`node --test test/e2e/fbpost.e2e.js`

## 注意事項
- 繪圖仍是同步；字型載完才重畫，輸出前才等待。
- 不改 `extension/`；不手改產生檔。
