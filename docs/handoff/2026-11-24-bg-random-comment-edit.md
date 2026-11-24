# 文字背景隨機由後台設定＋第一則留言發出後再編輯（測試去連結預覽）
- 狀態：已完成（已併入 main）　- 分支：claude/modest-carson-8lmfi0　- 最後更新：2026-11-24
- 使用者原始需求：「想要文字背景可以在後台調整隨機的預設。」「增加出的第一則留言可以直接關閉連結預覽。」

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 隨機範圍 | 管理頁「文字背景」每列「列入隨機」勾選＋快捷鈕；D1 `fb_backgrounds.rnd`（自動補欄位；預設純色／漸層 1、圖樣 0） | 使用者選 ① |
| 單色圖樣自動判斷 | 拿掉（方案 A），完全由後台勾選 | 使用者選 A |
| 沒匯入過（內建 11 個） | 照舊全部可隨機 | — |
| 連結預覽 | Graph API `/comments` 只有 message／attachment_id／attachment_url／attachment_share_url／source，**沒有關預覽參數**（已讀官方文件 v27.0）。使用者選試方案 B：第一則留言成功後 `POST /{comment-id}` 以相同 message 再編輯一次，看預覽會不會消失 | 未證實，做成管理頁開關（預設關），先在測試後端實測 |
| 編輯失敗 | 不影響留言結果（只記 console），不重試 | 留言本身已成功 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/bgstore.js` | `rnd` 欄位、update 收 `rnd`、adminRow／list 回 `rnd`、批次 `rnd` 設定 | ✅ |
| `server/fb/bgpresets.js`／`server/fb/index.js` | `/fb/backgrounds` 回 `rnd`；admin 路由收 `rnd` | ✅ |
| `tools/fbpost/compose.js` | `randomBg` 只挑 `rnd`；拿掉 `bgSolidImg`／`isSolidImage` | ✅ |
| `admin/admin.js`／`admin/index.html` | 文字背景列加「隨機」勾選＋快捷鈕；活動留言卡片加「第一則留言發出後再編輯一次」開關 | ✅ |
| `server/fb/comment.js` | `editComment`、`commentOpts`（fb_settings k=`comment_opts` `{edit:bool}`，快取 60 秒） | ✅ |
| `server/fb/post.js`、`server/fb/timer.js` | 第 1 則（n=1）留言成功後若開關開→編輯一次 | ✅ |
| 測試 | bgstore／comment／timer 單元、admin＋fbpost e2e | ✅ |

## 下一步
- [x] 實作 → npm test 809、admin＋fbpost＋fbpost-compose e2e 119、build --check 通過 → 獨立審查（無 Critical／Important）→ 截圖給使用者
- [ ] 使用者確認後說「推」才併入 main（同 commit 更新 CLAUDE.md 目前進度）
- [ ] 使用者部署後端（正式＋測試）→ 測試後端管理頁「活動留言」打開「留言成功後再編輯一次」→ 發一則看第一則留言預覽有沒有消失 → 回報；無效就拿掉此開關

## 審查 Minor（未改）
- 編輯結果（edited／failed）只寫 console，管理頁看不到；判斷有效與否靠看臉書。
- 立即發布時編輯緊接在留言後，預覽可能還沒產生，時間點有競爭；無效時可考慮改由計時器延後幾秒再編輯。
- 快捷鈕「全選○○」只加選、不取消其他種類。

## 注意事項
- 沙盒連不到臉書，B 方案效果要使用者在測試後端打開開關實測。

---
## 第二段：實驗功能（使用者 2026-11-24「實驗功能開始」）
- 需求：「2 放進進階設定內的『實驗功能』，並且可開給特定的使用者」。已確認＝只有指定員工發的貼文才再編輯；設定只有已解鎖系統管理者能改。

| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/core/levels.js` | 新卡片 `labs`（實驗功能，sensitive） | ✅ |
| `server/core/adminperm.js` | `/admin/fb/comment-opts` 改掛 `labs` | ✅ |
| `server/fb/comment.js` | 設定 `{edit, who:'all'|'some', staff:[]}`（舊 `{edit:true}`＝all）；`editAfterPost(env, token, id, msg, by)` 判斷發文者 | ✅ |
| `server/fb/post.js`、`timer.js` | 傳 `by`（timer 用 `rec.by`） | ✅ |
| `admin/index.html`、`admin.js` | 活動留言卡片拿掉開關；進階設定新分頁「實驗功能」`labCard`（開關＋全部人／指定員工勾選名單） | ✅ |
| 測試 | comment／timer／post 單元、admin e2e | ✅ |

### 第二段結果
npm test 809、admin＋company e2e 通過（「截圖：電腦版…」在 SHOT_DIR 模式逾時，改動前就會，與本次無關）；獨立審查無 Critical／Important。

## 待確認（下一段）：影片發布「放待排 2359」
使用者答：臉書排程到當天 23:59（C）；RD 找按送出當下最接近的時段（±1～2 小時）；日期欄右邊第 3～10 欄、#3c78d8 粗體「2359」或「排2359」標記下的 `reels/` 預留格；與原 Reels 草稿規則並存。最終做法待列給使用者確認。
