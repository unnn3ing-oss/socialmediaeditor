// 網頁會用到的固定值。數值範圍要和下載助手／外掛的 queue.js 一致。
// 「間隔」（每支影片之間隔幾秒）與「最多展開」（頻道或播放清單最多取幾支）輸入框接受的範圍。
export const SETTING_RANGES = { cooldownSec: { min: 3, max: 60 }, limit: { min: 1, max: 1000 } };

// 下載助手安裝檔（見 tools/ytdl/PROTOCOL.md）。Windows 從網站下載，Mac 貼一行指令。
export const WIN_INSTALLER_PATH = "installers/ytdl-install-windows.cmd"; // 相對於 tools/ytdl/index.html
export const MAC_ZIP_PATH = "installers/ytdl-install-mac.zip";
export const MAC_INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/unnn3ing-oss/socialmediaeditor/main/tools/ytdl/installers/ytdl-install-mac.sh | bash";
