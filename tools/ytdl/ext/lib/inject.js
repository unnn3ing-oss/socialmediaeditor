// 外掛安裝、更新、重新載入、重新啟用或瀏覽器啟動後，已經開著的工具箱分頁沒有可用的 bridge
// （Chrome 只會對之後載入的頁面注入內容腳本）。這裡幫它們重新注入核心的 core/bridge.js。
import { WEB_ORIGIN, WEB_PATH } from "./constants.js";

// 在頁面的內容腳本世界執行：bridge 還活著嗎？（核心 bridge 會留下標記；孤兒副本回 false。）
// 核心 bridge 重複注入時自己會處理，這裡只是盡量少打擾正常的分頁。
const bridgeAlive = () => Boolean(window.__tbxBridge?.alive?.());

// deps: { tabs, scripting }。可重複執行。回傳補注入的分頁數。
export async function injectBridge({ tabs, scripting }) {
  let injected = 0;
  try {
    for (const tab of await tabs.query({ url: `${WEB_ORIGIN}${WEB_PATH}*` })) {
      try {
        const probes = (await scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: bridgeAlive })) ?? [];
        if (probes.length > 0 && probes.every((probe) => probe?.result === true)) continue;
        await scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["core/bridge.js"] });
        injected += 1;
      } catch { /* 這個分頁不讓注入（已丟棄或關閉）：其他分頁照做 */ }
    }
  } catch { /* 沒有分頁權限：之後開的頁面本來就會拿到內容腳本 */ }
  return injected;
}
