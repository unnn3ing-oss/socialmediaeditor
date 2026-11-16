// 網頁設定流程的純函式：哪一步做到哪、安裝是否完成、沒完成要說什麼。畫面只畫它們回傳的東西。
// 三步：1 安裝小編工具箱外掛 → 2 下載並執行「YT 下載助手安裝檔」→ 3 按「啟動」連線。
import { MAC_INSTALL_COMMAND, MAC_ZIP_PATH, WIN_INSTALLER_PATH } from "./constants.js";
import { REINSTALL_ACTION } from "./connection.js";

export const STEP_LABELS = ["安裝小編工具箱外掛", "安裝 YT 下載助手", "啟動連線"];
export const installerPath = (os) => (os === "mac" ? MAC_ZIP_PATH : WIN_INSTALLER_PATH);
// Mac 的人貼進「終端機」的指令：不用下載，macOS 的安全性提示就不會出現。
export const macInstallCommand = () => MAC_INSTALL_COMMAND;

export function detectOs(nav = globalThis.navigator) {
  const platform = String(nav?.userAgentData?.platform ?? nav?.platform ?? "");
  const agent = String(nav?.userAgent ?? "");
  if (/mac/i.test(platform) || /Macintosh/i.test(agent)) return "mac";
  if (/win/i.test(platform) || /Windows/i.test(agent)) return "win";
  return "other";
}

// 下載助手「裝過了」：它在跑、被 Chrome 拒絕（表示檔案在、只是識別碼不符），或停著但有回報細節。
const hostInstalled = (status) => status.state === "running" || status.state === "forbidden" || (status.state === "stopped" && Boolean(status.detail));

// 每一步的狀態 "done" | "now" | "todo"，以及該顯示的步驟編號：第一個還沒完成的。
// 網頁看不到安裝檔有沒有跑過；外掛在了之後可以看到下載助手，另外記得使用者是否按過「我已執行」(`passedInstaller`)。
export function wizardSteps({ detected, passedInstaller = false, status, deployed }) {
  const ranInstaller = (detected && hostInstalled(status)) || (detected && passedInstaller);
  const done = [detected, ranInstaller, Boolean(detected && deployed)];
  const first = done.indexOf(false);
  return {
    states: done.map((isDone, index) => (isDone ? "done" : index === first ? "now" : "todo")),
    suggested: first === -1 ? STEP_LABELS.length : first + 1,
  };
}

// 設定區最上面一行：目前連線到哪、好不好。
export function connectSummary({ detected, deployed, status }) {
  if (deployed) return { ok: true, text: "一切正常，已經連線" };
  if (!detected) return { ok: false, text: "還沒偵測到小編工具箱外掛（步驟 1）" };
  if (status.state === "not_installed") return { ok: false, text: "還沒安裝下載助手（步驟 2）" };
  if (status.state === "forbidden") return { ok: false, text: "下載助手不允許這個外掛，請重新執行 YT 下載助手安裝檔（步驟 2）" };
  if (status.state === "running") return { ok: false, text: "下載助手已連線，但還有地方需要處理：按「檢查環境」看哪一項" };
  return { ok: false, text: "還沒連上下載助手（步驟 3 按「啟動」）" };
}

// 下載需要的都在：外掛在、下載助手新版且在跑、三個元件都找得到。
export function isDeployed({ detected, status, hostOutdated }) {
  if (!detected || status?.state !== "running" || hostOutdated) return false;
  const ready = status.ready ?? {};
  return Boolean(ready.ytdlpVersion) && ready.ffmpegOk === true && ready.jsRuntimeOk === true;
}

// 步驟 2 在 `not_installed` 或 `forbidden` 時要補的說明（沒話說回 null）。
export function installerAdvice(status) {
  if (status?.state === "not_installed") return "還沒偵測到下載助手：請下載並執行 YT 下載助手安裝檔（Mac 貼一行指令），裝完回來按「啟動」。";
  if (status?.state === "forbidden") return `下載助手不允許這個外掛，請${REINSTALL_ACTION}，再按「啟動」。`;
  return null;
}
