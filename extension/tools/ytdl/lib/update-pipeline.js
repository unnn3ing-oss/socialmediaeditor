// 下載助手更新的完整流程（背景執行）：和 GitHub 比對、下載並驗證、請下載助手暫存→套用，失敗就還原。
// 外掛本身的更新由工具箱核心處理，這裡只管 tools/ytdl/host/ 的 *.py。
import { UpdateError, checkLatest, downloadAll } from "./updater.js";
import { toBase64 } from "./base64.js";

const hostError = (event) => (event?.type === "error" ? new UpdateError(event.message ?? "下載助手回報錯誤") : null);

export async function collectUpdateInfo({ check = checkLatest, hostRequest = null, hostVersion = null }) {
  const latest = await check();
  let hostChanged = [];
  let hostChecked = false;
  if (hostRequest) {
    try {
      const event = await hostRequest({ type: "update_check", files: latest.hostFiles }, 20000);
      if (event.type === "update_status") {
        const changed = new Set(event.changed);
        hostChanged = latest.hostFiles.filter((file) => changed.has(file.path));
        hostChecked = true;
      }
    } catch { /* 下載助手現在連不上：下次再比對 */ }
  }
  return {
    current: hostVersion, hostVersion, sha: latest.sha, date: latest.date, message: latest.message,
    hostChanged, hostChecked, hasUpdate: hostChanged.length > 0,
  };
}

// 順序很重要：全部驗證過才動本機檔案。
export async function applyUpdate({ info, hostRequest, fetchFn = fetch, onProgress = () => {} }) {
  const downloads = await downloadAll(info.hostChanged, { sha: info.sha, fetchFn, onProgress });
  const entries = info.hostChanged.map(({ path, sha, size }) => ({ path, sha, size }));
  onProgress({ step: "host", done: 0, total: entries.length });
  const contents = Object.fromEntries(downloads.map((file) => [file.path, toBase64(file.bytes)]));
  let staged = false;
  try {
    const stageEvent = await hostRequest({ type: "update_stage", commit: info.sha, files: entries, contents }, 90000); // 自我檢查就可能花 30 秒
    if (hostError(stageEvent)) throw hostError(stageEvent);
    staged = true;
    const committed = await hostRequest({ type: "update_commit" }, 60000);
    if (hostError(committed)) throw hostError(committed);
  } catch (error) {
    if (staged) {
      const back = await hostRequest({ type: "update_rollback" }).catch((e) => ({ type: "error", message: e.message }));
      if (back.type === "error") {
        throw new UpdateError(`${error.message}。下載助手更新到一半失敗且無法還原；請重新執行安裝檔。`, error.code);
      }
    }
    throw error;
  }
  return { count: entries.length };
}
