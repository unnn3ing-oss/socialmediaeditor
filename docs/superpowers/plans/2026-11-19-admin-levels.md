# 管理頁權限分層＋改版 Implementation Plan

> 執行方式：主對話直接做（任務都會改到 `server/core/admin.js`／`staff.js`／`admin/admin.js`，依 CLAUDE.md 不平行派子代理），各段完成後派獨立代理審查。

**Goal**：管理頁三層（系統管理者／管理者／普通），後端每條 `/admin/*` 依卡片擋，首頁直接進入；只留網站版管理頁並改前台外觀。
**Spec**：`docs/superpowers/specs/2026-11-19-admin-levels-design.md`
**Tech**：Cloudflare Worker（ESM）、D1、`node --test`、Playwright e2e、原生 JS 前端。

## Global Constraints
- 敏感卡片 `SENSITIVE = ['profiles','fbconn','webhook','groups','levels']`；只有 `admin` 憑證（unlocked）能用，`adm:1` 不行。員工若被勾到 ⚠ 卡片則可用（`levels` 永遠不行）。
- 沒對應到卡片的 `/admin/*` 路徑只給 unlocked sys。
- 預設：管理者 `access,usage,pages,presets,video,staff,audit,rundown,assets,logs`；普通無。
- 普通 ⊆ 管理者（存與讀都強制）；`levels` 從表中剔除。
- 新錯誤碼 `forbidden`（403）「沒有這個功能的權限。」

## Review Focus
1. 管理者打 `POST /admin/staff/<管理者或自己>`、帶 `level`、指派含 bypass 的組 → 403／400。
2. `adm:1` 打 `/admin/fb/token`、`/admin/levels` → 403；`admin` 憑證 → 200。
3. 公司密碼憑證（無 uid、無 adm）打 `/admin/me` → 401。
4. 層級表 D1 值壞掉／普通多於管理者／含 levels → 讀出時被修正。
5. 員工被停用後立即 `/admin/*` → 401。

---

### Task 1：後端權限核心（`server/core/adminperm.js`＋`admin.js`）
- Create `server/core/adminperm.js`：`CARDS`（key→名稱、⚠）、`ROUTES`（[正則, key]，完整比對）、`DEFAULT_LEVELS`、`readLevels(env)`、`saveLevels(env, v)`、`adminWho(request, env)`→`{role:'sys'|'mgr'|'user', unlocked, cards:Set, staff?, uid?}`|null、`cardFor(path)`、`adminLevels` 路由（`GET/POST /admin/levels`）、`GET /admin/me`。
- Modify `server/core/admin.js`：用 `adminWho`；`GET /admin` 302 到網站版；`adminExtras` 呼叫帶第 4 參數 `who`。
- Modify `server/core/staff.js`：`level` 欄位、`findStaff`／`listStaff`／state 帶 level；名單部分權限（spec §6）。
- Modify `server/core/auth.js`：`/auth/status` 帶 `staff.level`、`manage`。
- Modify `server/core/http.js`：`forbidden`。
- Modify `server/fb/index.js`：非 sys 忽略 `?p=`。
- Delete `server/core/admin-page.js`。
- Test：`test/server/adminperm.test.js`（Review Focus 1～5 全部、路由全對應檢查）；既有 `staff.test.js`、`auth.test.js` 等需通過。
- Run `npm test`。Commit。

### Task 2：前端（首頁按鈕＋管理頁權限）
- `shell/`：`/auth/status` `manage` → 頁首「管理頁」連結（`admin/`）。
- `admin/admin.js`／`index.html`：開頁用 `companyKey` 憑證打 `/admin/me`；依 cards 顯示卡片／分類；⚠ 卡片未解鎖顯示密碼解鎖；層級權限卡片；名單層級欄。
- Test：`test/e2e/admin.e2e.js` 擴充（直接進入、卡片可見性、解鎖、層級權限）、`shell.e2e.js`／`status.e2e.js` 按鈕。Commit。

### Task 3：改版外觀
- 先截圖（電腦＋手機）給使用者確認 → 改 `admin/admin.css` 改用 `ui/tokens.css`。e2e 全跑。Commit。

### Task 4：文件與收尾
- README／`docs/deploy.md` 管理頁網址只寫網站版；交接檔；獨立審查。
