// 「更新下載助手」之後：下載助手會重新啟動，約十到十五秒內連線會斷一下再回來。
// 這裡是等它回來的邏輯，時鐘與頁面狀態都由外面傳入，方便測試。等的時候頁面只顯示一句平靜的話（UPDATING_TEXT），
// 不顯示「連線中斷」。
export const RELOAD_WAIT_MS = 90000; // 最長等這麼久，之後恢復一般訊息
export const NO_RESTART_MS = 8000; // 一直連著、也沒看到重新啟動，這麼久之後就當作沒有重新啟動
export const POLL_MS = 500;
export const UPDATING_TEXT = "更新中，下載助手正在重新啟動，請稍候…";
export const UPDATING_HINT = "通常要 10～15 秒，請不要關閉這個分頁";

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// probe() 回 { detected, running, notRunningAt }：外掛有沒有回應、下載助手有沒有在跑、最後一次看到它沒在跑的時間。
// 回傳 { running(), start() }：start() 會 resolve { back, restarted }；等待進行中再呼叫（連按兩次）回 null。
export function createReloadWait({ probe, now = Date.now, sleep = sleepFor, maxMs = RELOAD_WAIT_MS, noRestartAfterMs = NO_RESTART_MS, pollMs = POLL_MS }) {
  let active = false;
  async function waitUntilBack() {
    const started = now();
    while (now() - started < maxMs) {
      await sleep(pollMs);
      const seen = probe();
      if (!(seen.detected && seen.running)) continue;
      if (seen.notRunningAt >= started) return { back: true, restarted: true };
      if (now() - started >= noRestartAfterMs) return { back: true, restarted: false };
    }
    return { back: false, restarted: false };
  }
  return {
    running: () => active,
    start() {
      if (active) return null;
      active = true;
      return waitUntilBack().finally(() => { active = false; });
    },
  };
}

// 等待結束後要告訴使用者的話：{ kind: "ok" | "error", text }。`version` 是更新後下載助手回報的版本（可省略）。
export function describeOutcome({ back, version = null }) {
  if (!back) {
    return {
      kind: "error",
      text: `更新後一直連不上下載助手（等了 ${RELOAD_WAIT_MS / 1000} 秒）。請按「啟動」再試；還是不行，就重新執行 YT 下載助手安裝檔，它會自動檢查並修復。`,
    };
  }
  return { kind: "ok", text: version ? `下載助手已更新到 v${version}。` : "下載助手已更新。" };
}
