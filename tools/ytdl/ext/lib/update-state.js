import { shouldCheck } from "./updater.js";

export const SUMMARY_KEY = "ytdl-update-info";

// 哪部分有差異："host"（下載助手檔案）或 null。
export function changedParts({ hostChangedCount = 0 }) {
  return hostChangedCount > 0 ? "host" : null;
}

const PARTS_TEXT = { host: "下載助手有新版本" };
export const partsText = (summary) => PARTS_TEXT[changedParts(summary ?? {})] ?? "";

// `info`：collectUpdateInfo 的回覆。`previous`：上次存的摘要。
// 下載助手要連線才能比對：這次沒問到就沿用上次的差異數（只有真的問過的檢查才能清掉差異）。
export function summarizeCheck(info, now = Date.now(), previous = null) {
  const hostChecked = Boolean(info.hostChecked);
  const hostChangedCount = hostChecked ? (info.hostChanged?.length ?? 0) : (previous?.hostChangedCount ?? 0);
  return {
    checkedAt: now,
    sha: info.sha,
    date: info.date,
    message: info.message,
    hasUpdate: hostChangedCount > 0,
    hostChangedCount,
    hostChecked,
    parts: changedParts({ hostChangedCount }),
  };
}

// 檢查失敗不能洗掉上次的好結果。
export function failedSummary(previous, message, now = Date.now()) {
  return { ...(previous ?? {}), error: message, errorAt: now };
}

const ERROR_RETRY_MS = 5 * 60 * 1000;

// 網頁該不該自己再檢查：沒存過、結果過期、有待更新、或失敗已隔夠久。
export function autoCheckDue(summary, now = Date.now()) {
  if (!summary) return true;
  if (summary.error) return now - (summary.errorAt ?? 0) >= ERROR_RETRY_MS;
  return Boolean(summary.hasUpdate) || shouldCheck(summary.checkedAt, now);
}

export async function saveSummary(summary) {
  await chrome.storage.local.set({ [SUMMARY_KEY]: summary });
}

export async function loadSummary() {
  const stored = await chrome.storage.local.get(SUMMARY_KEY);
  return stored[SUMMARY_KEY] ?? null;
}

// 記下一次完成的檢查。不動圖示 badge（那是工具箱核心在用）。
export async function recordCheck(info, { load = loadSummary, save = saveSummary, now = Date.now() } = {}) {
  const summary = summarizeCheck(info, now, await load().catch(() => null));
  await save(summary).catch(() => {});
  return summary;
}

// 失敗的檢查：上次的結果保持不變。
export async function recordFailure(message, { load = loadSummary, save = saveSummary, now = Date.now() } = {}) {
  const summary = failedSummary(await load().catch(() => null), message, now);
  await save(summary).catch(() => {});
  return summary;
}

// 一次只跑一個 `run`。執行中又被要求，不會同時開第二個，而是在結束後再多跑一次
// （例如檢查進行中下載助手剛好連上，前一次比對不到它的檔案）。
export function createCheckRunner(run) {
  let running = null;
  let again = false;
  return {
    trigger() {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        try {
          do {
            again = false;
            await run();
          } while (again);
        } finally {
          running = null;
        }
      })();
      return running;
    },
  };
}
