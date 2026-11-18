# 排程發布：粉專立即／排程改小選單
- 狀態：進行中　- 分支：claude/vigilant-fermi-oqzctf　- 最後更新：2026-11-18
- 使用者原始需求：「排程發布粉專立即與排程的要用這樣」（附圖：選單「立即發布／排程發布…」＋排程時間視窗）；選 1B（膠囊維持圓角 12）、2A（已排程也先跳選單），「立即/排程的選擇按鈕不用那麼寬」。

## 已定案的決定
| 項目 | 決定 |
|---|---|
| 點膠囊右半 | 一律先跳小選單（立即發布／排程發布…），目前那項淺藍 `#eaf1ff` 藍字；寬度貼合文字、每項 40px（≤820px 44px） |
| 立即發布 | sched=false、關選單 |
| 排程發布… | sched=true（時間不合法就帶現在＋30 分進位 10 分）→ 開排程時間視窗 |
| 排程時間視窗 | 拿掉「立即｜排程」切換；快捷鈕全圓；時間欄聚焦藍框 2px、白底 |
| 膠囊 | 維持圓角 12 |

## 做法
| 檔案 | 內容 | 狀態 |
|---|---|---|
| tools/fbpost/index.html | 加 `#tpMenu`，移除 `.tp-mode` | ✅ |
| tools/fbpost/timepop.js | 選單＋視窗、鍵盤、外點關閉 | ✅ |
| tools/fbpost/fbpost.css | `.tp-menu`、快捷鈕、時間欄 | ✅ |
| test/e2e/fbpost.e2e.js | `#timePop [data-tp=sched]` 改 `#tpMenu [data-tp=sched]`，加選單測試 | ✅ |

## 測試
npm test、fbpost e2e、全部 e2e、build --check；截圖給使用者。

## 進度
- ✅ 實作 b65fc57；npm test 619、e2e 169、build --check、獨立審查通過（未改檔）
- 已知小事（未改）：選單開著按 Tab 離開不會自動關（點外面／Esc 會關）
- [ ] 使用者看截圖確認 → 說「推」才併 main（更新 CLAUDE.md 目前進度；純網站，不部署後端、外掛不升版）
