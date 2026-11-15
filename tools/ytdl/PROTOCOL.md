# YT 下載：網頁 ↔ 外掛 ↔ 下載助手 協定

來源：`unnn3ing-oss/videodownload`（main）。這份是三組（A 外掛背景、B 下載助手、C 網頁）共用的約定，**改動要三方一起改**。

## 固定值
| 項目 | 值 |
|---|---|
| 下載助手代號（Native Messaging host name） | `com.tbx.ytdl` |
| 顯示名稱 | 小編工具箱下載助手 |
| 唯一允許的外掛 | `chrome-extension://odajlpffjjeiliinefhimmbpdeeggckg/`（由 `extension/core/manifest.base.json` 的 `key` 算出；`extension/core/id.js`） |
| 下載助手自動更新來源 | `unnn3ing-oss/socialmediaeditor`、分支 `main`、路徑 `tools/ytdl/host/`（只抓這層的 `*.py`） |
| 安裝檔（網站上的網址） | `https://unnn3ing-oss.github.io/socialmediaeditor/tools/ytdl/installers/ytdl-install-windows.cmd`、`.../ytdl-install-mac.zip` |
| Mac 一行指令 | `curl -fsSL https://raw.githubusercontent.com/unnn3ing-oss/socialmediaeditor/main/tools/ytdl/installers/ytdl-install-mac.sh \| bash` |

## 資料夾分工
| 路徑 | 誰 | 內容 |
|---|---|---|
| `tools/ytdl/ext/` | A | 外掛背景模組（`index.js` 入口，會被 `build.js` 複製到 `extension/tools/ytdl/`）；`ext/lib/` 放背景與網頁共用的純邏輯（queue、format、urls、version、covername、copytext、cover…） |
| `tools/ytdl/host/`、`build_installers.py`、`installer-templates/`、`installers/`、`tests/`、`pytest.ini`、`requirements-dev.txt`、`.github/workflows/ytdl-host.yml` | B | 下載助手（Python）、安裝檔產生器、pytest、CI |
| `tools/ytdl/index.html`、`app.js`、`ytdl.css`、`web/`、`icon.svg`、`thumb.svg`、`TOOL.md`；`shell/install.*` | C | 網頁工具、網頁專用畫面邏輯（queue-view、doctor-view、setup-flow、update-wait、connection、add-flow）；工具箱安裝教學的「也要 YT 下載」勾選 |
| `test/ytdl/*.test.mjs` | A：`ext-*.test.mjs`；C：`web-*.test.mjs` | Node 單元測試（`npm test` 會跑） |

網頁可以直接 `import` `../ext/lib/*.js`（GitHub Pages 會提供 `tools/ytdl/ext/`）。`ext/lib/` 不能用到 DOM；`web/` 不會進外掛。

## 外掛核心提供的掛點（第 0 段已完成）
- `tools/ytdl/ext/index.js` 匯出的**每個函式都是 op**，網頁用 `tb.ext.call('ytdl.<名稱>', payload, { timeout })` 呼叫；`init` 與 `_` 開頭的名稱不是 op。
- op 簽名：`async (payload, sender) => ({ ok: true, data }) | ({ ok: false, error, code? })`。SDK 收到 `ok:true` 時 resolve `data`，否則 reject（`err.message`、`err.code`）。
- `export function init(ctx)`：背景啟動時呼叫一次。`ctx.push(data)` 推給所有訂閱的網頁；`ctx.onSubscribe(fn)`：網頁新訂閱時呼叫 `fn(send)`，用 `send(data)` 先送目前狀態。
- 網頁 `tb.ext.on('ytdl', (data) => …)` 收推播（外掛重新載入後自動再訂閱）。
- 核心只收自己外掛 ID 的訊息；op 不需要再檢查來源（舊版的 panel／web 分流拿掉）。

## op 一覽（`ytdl.<名稱>`；回覆的 `data` 和舊版回覆物件相同，只是去掉 `ok`）
| op | payload | data | 網頁建議 timeout |
|---|---|---|---|
| `get_status` | – | `{ state, ready, detail }`（舊 `status` 快照，不含 `type`） | 5000 |
| `start` | – | `{}`（連線下載助手） | 5000 |
| `set_output_dir` | `{ path }` | `{ outputDir }` | 30000 |
| `doctor` | `{ fix }` | `{ checks, fixed }` | 130000 |
| `diagnostics` | – | `{ text }` | 70000 |
| `update_engine` | – | `{ ytdlpVersion }`（舊版是 host_event 廣播；改成等下載助手回 `engine_updated` 再回覆） | 300000 |
| `update_info` | – | `{ current, hostVersion, latestSha, date, message, hostCount, hostChecked, hasUpdate }`（只比對下載助手檔案；外掛本身的更新由工具箱核心處理） | 60000 |
| `update_apply` | `{ sha }` | `{ count, nothing? }`；完成後背景重新連線下載助手（不 reload 外掛） | 600000 |
| `queue_get` | – | `{ state }` | 5000 |
| `queue_add` | `{ url }` | 舊版 `controller.add` 的回覆 | 60000 |
| `queue_remove` / `queue_retry` | `{ uid }` | `{}` | 5000 |
| `queue_clear` / `queue_start` / `queue_stop` | – | 舊版回覆 | 10000 |
| `queue_copy_text` / `queue_download_cover` | `{ uid }` | 舊版回覆（`{ text }` 等） | 30000 |
| `settings_set` | `{ settings }` | `{}` | 5000 |

拿掉：`ping`（用核心的 `ping`）、`deploy_installer`（網頁直接連到安裝檔）、`update_check/stage/commit/rollback`（只在背景內部用）、外掛資料夾相關（`extupdate`、`deploy`、`folder-store`、`installer`）。

## 推播（`ctx.push(data)` 的 `data`，與舊版 web port 訊息相同）
| `data.type` | 內容 | 何時 |
|---|---|---|
| `status` | `{ type, state, ready, detail }`；`state`：`stopped`／`running`／`not_installed`／`forbidden` | 連線狀態改變、訂閱時 |
| `queue_state` | `{ type, state }` | 清單改變（最多每 200ms 一次）、訂閱時 |
| `update_progress` | `{ type, ...進度 }` | `update_apply` 進行中 |

## 下載助手訊息（外掛 ↔ Python，stdio Native Messaging）
與 videodownload 相同（`host/host.py`），只有這些差異：
- 拿掉 `update_ext_*`（外掛檔案由工具箱更新）。
- `update_check`／`update_stage` 的 `files` 名稱是 `tools/ytdl/host/` 底下的檔名（不含路徑），下載位址 `https://raw.githubusercontent.com/unnn3ing-oss/socialmediaeditor/<commit>/tools/ytdl/host/<name>`。
- `doctor` 的 `extensionId` 用來檢查 `allowed_origins`。
