// 網頁到小編工具箱外掛的連線（用工具箱 SDK 的 tb.ext）。介面和舊版 createBridgeClient 相同，app.js 不必知道差別：
//   request({ type, ...payload }, timeoutMs) -> { ok:true, ...data } 或 { ok:false, error, code }
//   onChange(偵測到／失去外掛)、onState(清單)、onStatus(連線狀態)、onProgress(更新進度)、onVersion(外掛版本)
// 外掛可能還沒裝、晚點才裝、或隨時重新載入，所以每 2 秒 ping 一次；6 秒都沒回應就當作沒有外掛。
// `ext` 是 SDK 的 tb.ext（{ call, on }），測試時傳假的。

// 各 op 建議的等待時間（毫秒，見 tools/ytdl/PROTOCOL.md）；沒列的用 DEFAULT。
export const TIMEOUTS = {
  get_status: 5000, start: 5000, set_output_dir: 30000, doctor: 130000, diagnostics: 70000, update_engine: 300000,
  update_info: 60000, update_apply: 600000, queue_get: 5000, queue_add: 60000, queue_remove: 5000, queue_retry: 5000,
  queue_clear: 10000, queue_start: 10000, queue_stop: 10000, queue_copy_text: 30000, queue_download_cover: 30000, settings_set: 5000,
};
const DEFAULT_TIMEOUT = 20000;

export function createBridgeClient({ ext, pingEveryMs = 2000, lostAfterMs = 6000, now = Date.now } = {}) {
  let detected = false;
  let version = null; // 外掛的版本，來自 ping 的回覆
  let lastSeen = 0;
  let pinging = false;
  const unsubscribe = ext.on("ytdl", onPush); // 推播（SDK 在外掛重新載入後會自動再訂閱）
  const listeners = { change: [], state: [], status: [], version: [], progress: [] };
  const emit = (kind, value) => listeners[kind].forEach((callback) => callback(value));

  function setDetected(value) {
    if (detected === value) return;
    detected = value;
    if (!value) version = null;
    emit("change", value);
  }

  function onPush(data) {
    if (!data || typeof data !== "object") return;
    lastSeen = now();
    if (data.type === "queue_state") emit("state", data.state);
    else if (data.type === "status") emit("status", data);
    else if (data.type === "update_progress") emit("progress", data);
  }

  async function ping() {
    if (pinging) return;
    pinging = true;
    try {
      const reply = await ext.call("ping", undefined, { timeout: Math.min(3000, lostAfterMs) });
      lastSeen = now();
      const next = reply?.version ?? null;
      if (next !== version) {
        version = next;
        emit("version", next);
      }
      setDetected(true);
    } catch {
      if (detected && now() - lastSeen > lostAfterMs) setDetected(false);
    } finally {
      pinging = false;
    }
  }
  const timer = setInterval(ping, pingEveryMs);
  ping();

  return {
    detected: () => detected,
    version: () => version,
    onVersion: (callback) => listeners.version.push(callback),
    onChange: (callback) => listeners.change.push(callback),
    onState: (callback) => listeners.state.push(callback),
    onStatus: (callback) => listeners.status.push(callback),
    onProgress: (callback) => listeners.progress.push(callback),
    stop() { clearInterval(timer); unsubscribe?.(); },
    // message.type 是 op 名稱（去掉 "ytdl." 前綴），其餘欄位就是 payload。
    // 成功回 { ok:true, ...data }；外掛回報失敗（SDK reject）轉成 { ok:false, error, code }；沒偵測到外掛或逾時則 reject。
    async request(message, timeoutMs) {
      if (!detected) throw new Error("尚未偵測到小編工具箱外掛");
      const { type, ...payload } = message;
      const timeout = timeoutMs ?? TIMEOUTS[type] ?? DEFAULT_TIMEOUT;
      try {
        const data = await ext.call(`ytdl.${type}`, Object.keys(payload).length ? payload : undefined, { timeout });
        return { ok: true, ...(data && typeof data === "object" ? data : {}) };
      } catch (error) {
        // SDK 逾時一律回 no_extension：當作這次沒有收到回應（外掛真的不在，ping 會讓 detected 轉成 false）
        if (error?.code === "no_extension") throw new Error("逾時，沒有收到小編工具箱外掛的回應");
        return { ok: false, error: error?.message ?? "失敗", code: error?.code };
      }
    },
  };
}
