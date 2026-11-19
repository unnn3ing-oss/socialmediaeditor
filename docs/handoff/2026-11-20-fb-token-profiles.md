# 臉書權杖多組切換（管理頁命名／切換）
- 狀態：進行中　- 分支：claude/dazzling-tesla-2kscqv　- 最後更新：2026-11-20
- 使用者原始需求：「主管那邊得到的權杖與目前測試用的權杖，能在管理頁輸入管理員密碼時讓我能切換權杖且能對權杖命名嗎？」
- 背景：使用者自己的 App `socialmediaeditor` 已是上線（已發佈），使用者本身有公司粉專管理權限，測試後端用他的權杖發公司粉專顯示正常。

## 已定案的決定
| 項目 | 決定 | 理由 |
|---|---|---|
| 一組＝ | 名稱（1～20 字）＋App 密鑰＋使用者權杖＋換好的粉專權杖 | 不同 App 各自有密鑰 |
| 數量 | 最多 5 組 | 使用者照建議 |
| 誰能切 | 只有管理頁（管理憑證）；工具端不能切 | 同上 |
| 舊資料 | 現有的一組＝`p1`「預設」，沿用原本的 D1 key（不搬資料） | 部署後不用重貼 |
| 切換 | 只能切到「有權杖」的組；使用中那組不能刪 | 避免切到空的 |
| 已排程的留言／封面／改時間／刪除 | **方案 A**：先用使用中那組，沒有該粉專就從其他組找同粉專權杖 | 使用者選 A |
| 粉專清單（工具與管理頁粉專設定） | 只列使用中那組的粉專 | 切換＝換成那組粉專 |
| Webhook 簽章 | 任一組的 App 密鑰驗得過就算 | 不同 App 各自的 webhook |
| 權杖顯示 | 照現狀永不回傳權杖／Secret | 使用者選 |
| Secrets `FB_USER_TOKEN`／`FB_APP_ID`／`FB_APP_SECRET` | 只當 `p1` 的後備 | 相容舊設定 |

## 做法（改哪裡）
| 檔案 | 內容 | 狀態 |
|---|---|---|
| `server/fb/tokenstore.js` | `fb_settings` k=`profiles`（`{active,list:[{id,name,created}]}`）；`kOf(base,pid)`＝p1 用原 key、其他 `base@pid`；`forProfile(env,pid)`（`Object.create(env)`＋`__fbProfile`）；`profileId`；各函式依組別；`otherPageTokens`；`allAppCreds`；markBroken 依權杖所屬組 | ✅ |
| `server/fb/pages.js` | `pageTokens` 合併（使用中優先＋其他組）、`activePageTokens` 給 listPages／tokenStatus；KV 快取 key 依組；connectToken 存 App 名稱 | ✅ |
| `server/fb/graph.js` | `markBroken(env, token)` | ✅ |
| `server/fb/webhook.js` | 用所有組的 App 密鑰驗簽章 | ✅ |
| `server/fb/index.js` | `/admin/fb/profiles` GET／POST，`/admin/fb/profiles/<id>` POST（改名）／DELETE，`/admin/fb/profiles/<id>/activate`；既有 status／token／app／refresh 接 `?p=<id>` | ✅ |
| 管理頁兩份（`admin/`、`server/core/admin-page.js`） | 「權杖組別」卡片（列表、切換、改名、刪除、新增）；臉書連線與 App 密鑰卡片上方「設定中的組別」下拉，API 帶 `?p=` | ✅ |
| 測試 | `test/server/fb-profiles.test.js`；admin e2e | ✅ |

## 下一步
- [x] 後端（tokenstore → pages → graph／webhook → index）＋單元測試（`test/server/fb-profiles.test.js` 5 項）
- [x] 管理頁兩份＋e2e（「權杖組別」卡片：列表／切換為使用中／設定這一組／重新命名（prompt）／刪除（confirm）／新增；臉書連線卡片上方「設定中的組別」下拉）
- [x] npm test 682、build --check、全部 e2e 222、獨立審查通過（Minor 2 已修：刪組別清 KV 快取）
- [ ] 使用者確認截圖 → 說「推」才併入 main（同 commit 更新 CLAUDE.md）
- [ ] 部署正式＋測試後端

## 已知限制（審查 Minor，未改）
- 方案 A 只補其他組「已存好的粉專權杖」：只靠 Secret `FB_USER_TOKEN`（沒按過「驗證並儲存」）的 p1，切走後它的已排程留言會失敗 → 部署後先在管理頁對 p1 按一次「驗證並儲存」即可。
- 新增／改名沒有鎖（只有單一管理員操作）；`pageTokens` 每次多讀其他組（最多 4 次 D1）。

## 注意事項／不能做的事
- 不改發文核心邏輯（post.js、timer.js、video.js 只透過 pageTokens 受影響）。
- 後端需重新部署（正式＋測試），外掛不改。
