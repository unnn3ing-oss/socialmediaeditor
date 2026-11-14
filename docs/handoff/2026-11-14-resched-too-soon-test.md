# 修「排程時間太近」e2e 測試跟時段有關
- 狀態：進行中　- 分支：claude/keen-pascal-lvfwlr　- 最後更新：2026-11-14
- 使用者原始需求：`node --test --test-name-pattern="排程時間太近" test/e2e/fbpost.e2e.js` 失敗（expected 0、actual 1），查根因後修；使用者選方案 A。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 根因 | 測試問題，非產品 BUG | 假資料貼文在「現在＋2 小時」，改時間視窗沿用原日期；本地 22:00～23:59 跨日 → 變成「明天同時刻」合法時間而送出 |
| 修法 | 方案 A：測試同時把 `.tp-date` 填成今天 | 一行、直接測「今天、現在」 |
| 範圍 | 只改 `test/e2e/fbpost.e2e.js` | 不動 `tools/fbpost`、不升外掛版號、不需部署 Worker |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `test/e2e/fbpost.e2e.js`「排程時間太近」 | 在瀏覽器內取今天日期與 HHMM，先填 `.tp-date` 再打時間 | ✅ |

## 下一步
- [x] 改測試
- [x] UTC（23:01）／Asia/Taipei／Pacific/Honolulu／本地 23:58 各跑這支皆通過（23:58 修改前失敗）；整支 fbpost.e2e.js 53/53 通過
- [ ] 給使用者看結果，說「推」才併 main（同 commit 更新 CLAUDE.md 目前進度）

## 測試
`TZ=<時區> node --test --test-name-pattern="排程時間太近" test/e2e/fbpost.e2e.js`；`node --test test/e2e/fbpost.e2e.js`

## 注意事項／不能做的事
- 不要執行 `playwright install`；沙盒瀏覽器 `/opt/pw-browsers/chromium`。
