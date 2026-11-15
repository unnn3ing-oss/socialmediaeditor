// 網頁對「小編工具箱外掛」與「下載助手」連線狀態要說什麼，以及何時該一直請外掛去啟動下載助手。
// 都是純函式：畫面只畫它們回傳的東西。

export const EXTENSION_MISSING_TEXT = "還沒偵測到小編工具箱外掛。請先照設定步驟 1 安裝；完成後這裡會自動解鎖，不用重新整理。這個工具需要電腦版 Chrome。";
export const EXTENSION_LOST_TEXT = "與小編工具箱外掛的連線中斷（它可能被停用、重新載入或移除）。請到 chrome://extensions 確認它已啟用；恢復後這裡會自動解鎖，也可以重新整理本頁。";

// 永遠做得到的一件事：安裝檔會把下載助手更新到最新版。
export const REINSTALL_ACTION = "重新執行 YT 下載助手安裝檔（Mac 貼上那一行指令，Windows 重新下載後雙擊）";

export const FORBIDDEN_TEXT = "下載助手不允許這個外掛連線（外掛識別碼和安裝檔不符）。請重新執行 YT 下載助手安裝檔，再按「啟動」。";

// `updating`：正在更新下載助手，頁面自己會說明，這時不要再提「連線中斷」。
export function extensionNotice({ detected, everDetected, updating = false }) {
  if (detected || updating) return null;
  return everDetected ? EXTENSION_LOST_TEXT : EXTENSION_MISSING_TEXT;
}

// { kind, text }（關於下載助手），沒話說就回 null。`wasRunning`：這次開頁後它連上過；
// `gaveUp`：自動啟動停了（見 createAutoConnect）。
export function hostNotice({ detected, status, wasRunning, gaveUp, updating = false }) {
  if (!detected || updating || status.state === "running") return null;
  if (status.state === "forbidden") return { kind: "error", text: FORBIDDEN_TEXT };
  if (gaveUp) {
    return { kind: "error", text: `下載助手啟動後馬上又關閉了，自動重試幾次都失敗。請${REINSTALL_ACTION}（它會自動檢查並修復），再按設定步驟 3 的「啟動」重試。` };
  }
  if (wasRunning) return { kind: "info", text: "與下載助手的連線中斷，下載已暫停。正在嘗試重新連線…" };
  return null;
}

// 外掛偵測到之後，頁面會一直請它啟動下載助手，直到它回應（使用者可能還在跑安裝檔）。
// 但啟動後馬上關閉的下載助手不會無限重試：每次「我們送出請求後又出現新的 stopped 回報」就算一次失敗，
// 失敗 `maxTries` 次就放棄。啟動很慢的下載助手不會送新回報，所以不會被當成一直失敗。
export function createAutoConnect({ maxTries = 5 } = {}) {
  let asked = 0; // 上次重設後送出的請求數
  let failures = 0; // 結束掉的啟動次數
  let lastReport = null;
  const reset = () => {
    asked = 0;
    failures = 0;
    lastReport = null;
  };
  return {
    next(detected, status) {
      if (!detected || status.state === "forbidden") return { send: false, gaveUp: false };
      if (status.state === "running") {
        reset();
        return { send: false, gaveUp: false };
      }
      if (status.state === "stopped") {
        if (status !== lastReport) {
          lastReport = status;
          if (asked > 0) failures += 1;
        }
        if (failures >= maxTries) return { send: false, gaveUp: true };
        asked += 1;
      }
      return { send: true, gaveUp: false };
    },
    reset,
  };
}
