# 臉書錯誤訊息改中文
- 狀態：進行中　- 分支：claude/modest-bohr-dxn17c　- 最後更新：2026-11-23
- 使用者原始需求：「再幫我把錯誤訊息改為中文顯示」→ 選方案 A

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 顯示 | 中文＋（臉書碼 N）；對照表沒有的＝「臉書回應錯誤（臉書碼 N）：英文原文」 | 方案 A |
| 原文 | `GraphError.raw` 保留英文；錯誤日誌新欄 `detail` 存原文（≤200），管理頁游標移到錯誤碼看 | 方案 A |
| 範圍 | 只改後端（graph.js 統一出口＋video.js 處理失敗原文）；舊資料不回填 | 程式判斷只看錯誤碼 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/errzh.js` | 新檔：`zhError(code, subcode, raw)` 對照表 | ⬜ |
| `server/fb/graph.js` | GraphError 訊息改中文、`raw` 原文 | ⬜ |
| `server/fb/video.js` | 影片處理失敗原文套對照 | ⬜ |
| `server/fb/timer.js`、`notices.js`、`server/core/logs.js` | 留言失敗記 `eraw` → 錯誤日誌 `detail` 欄 | ⬜ |
| `admin/admin.js` | 錯誤日誌錯誤碼游標移上看原文 | ⬜ |
| 測試 | errzh 單元、logs detail、既有測試期望改中文 | ⬜ |

## 下一步
- [ ] 依上表實作 → npm test、admin e2e、build --check → 給使用者看
