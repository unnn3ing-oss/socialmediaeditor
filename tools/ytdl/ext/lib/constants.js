// 必須和下載助手的代號一致（tools/ytdl/host 與安裝檔都用這個）。
export const HOST_NAME = "com.tbx.ytdl";

// 網頁版放在 GitHub Pages；只有這個來源能和外掛溝通。
export const WEB_ORIGIN = "https://unnn3ing-oss.github.io";
export const WEB_PATH = "/socialmediaeditor/";
export const EXTENSION_NAME = "小編工具箱";
export const TOOL_NAME = "YT 批量下載";
export const HOST_DISPLAY_NAME = "小編工具箱下載助手";
// 下載助手至少要這個版本，才看得懂 cooldown、enqueue、remove、meta、save_cover。
export const MIN_HOST_VERSION = "0.2.0";
// 下載助手至少要這個版本，才能只下載聲音（否則會悄悄改下載影片）。
export const MIN_AUDIO_HOST_VERSION = "0.7.0";

// 「間隔」（影片之間的秒數）與「最多展開」（從頻道或播放清單取幾支）兩個欄位接受的範圍。
export const SETTING_RANGES = { cooldownSec: { min: 3, max: 60 }, limit: { min: 1, max: 1000 } };
