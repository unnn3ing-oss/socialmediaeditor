// 把 connectNative 的錯誤訊息分類：沒安裝、被拒絕（外掛 ID 不在允許清單）、已結束、其他。
export function classifyConnectError(message) {
  const text = String(message ?? "");
  if (text.includes("not found")) return "not_installed";
  if (text.includes("forbidden")) return "forbidden";
  if (text.includes("has exited")) return "exited";
  return "other";
}
