# YT 下載助手（host）維護說明

來源：由 `unnn3ing-oss/videodownload` 的本機下載助手搬入。協定與固定值見 `PROTOCOL.md`。

## 檔案
| 路徑 | 內容 |
|---|---|
| `host/*.py` | 下載助手（Python 標準函式庫，Chrome Native Messaging，host 名稱 `com.tbx.ytdl`） |
| `host/tests/` | 下載助手的 pytest |
| `build_installers.py` | 產生安裝檔（內嵌 `host/*.py`；外掛 ID 由 `extension/core/manifest.base.json` 的 `key` 算出） |
| `installer-templates/` | 安裝檔外殼（Windows .cmd、Mac .command） |
| `installers/` | 產生物，要 commit：`ytdl-install-windows.cmd`、`ytdl-install-mac.zip`、`ytdl-install-mac.sh` |
| `tests/` | 產生器與更新來源的 pytest、`win_registry_smoke.py` |

## 和 videodownload 完全分開
| | 本工具 | videodownload |
|---|---|---|
| host 名稱／登錄機碼 | `com.tbx.ytdl` | `com.ytdl.batch_downloader` |
| Windows 資料夾 | `%LOCALAPPDATA%\TbxYtdl` | `YTDownloader` |
| Mac 資料夾 | `~/Library/Application Support/TbxYtdl` | `YTDownloader` |
| 允許的外掛 | 只有 `odajlpffjjeiliinefhimmbpdeeggckg` | 它自己的 |

安裝檔只裝下載助手（引擎 yt-dlp、Deno、ffmpeg、Chrome 登錄、自我測試）；外掛由小編工具箱安裝。

## 改了 `host/*.py` 或模板之後
1. `python3 tools/ytdl/build_installers.py`，把 `tools/ytdl/installers/` 一起 commit（CI 的 build-fresh 會檢查）。
2. 改了 `host/version.py` 的 `VERSION`：x.y.z，安裝檔用它判斷不降版；已安裝的下載助手會從 main 的 `tools/ytdl/host/` 自動更新。
3. 換 Windows 內嵌 Python：同時改 `build_installers.py` 的 `URL_PYTHON_WIN` 與 `SHA256_PYTHON_WIN`；換 Deno／ffmpeg／yt-dlp 版本：改 `host/installer.py`（`URL`、`PINS`）與 `host/winengine.py`、`host/macos_engine.py`。

## 測試
- 沙盒不裝 pytest；`pytest` 只在 CI 跑（`.github/workflows/ytdl-host.yml`：Linux 3.9／3.12、build-fresh、Windows、macOS）。
- 本機有 pytest 時：`cd tools/ytdl && python3 -m pytest -q`。
- CI 證明不了：真正的 Windows／Mac 電腦搭 Chrome、防毒軟體、公司代理、YouTube 實際下載。上線前要在真機各跑一次安裝檔，再到小編工具箱的 YT 批量下載工具按「啟動」。
