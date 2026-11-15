export const MAX_FILES = 100;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const HOST_FILE = /^[A-Za-z0-9_]+\.py$/;

export function isSafeRelativePath(path) {
  if (typeof path !== "string" || path === "" || path.length > 200) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes(":")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part !== ".git");
}

// 把 GitHub 的檔案清單（樹狀或 contents 都行）轉成要更新的下載助手檔案：
// 只取 `basePath` 這一層的 *.py（不含子資料夾）。不安全、過大或太多就整個中止。
export function mapTree(tree, basePath = "tools/ytdl/host") {
  const prefix = `${basePath}/`;
  const host = [];
  for (const item of tree) {
    if (item.type !== "blob" && item.type !== "file") continue;
    if (typeof item.path !== "string" || !item.path.startsWith(prefix)) continue;
    const rest = item.path.slice(prefix.length);
    if (!isSafeRelativePath(rest)) throw new Error(`更新清單含不安全的路徑：${item.path}`);
    if (!HOST_FILE.test(rest)) continue;
    const size = Number.isFinite(item.size) ? item.size : 0;
    if (size > MAX_FILE_BYTES) throw new Error(`更新檔案過大：${item.path}`);
    host.push({ path: rest, sha: item.sha, size });
  }
  if (host.length > MAX_FILES) throw new Error(`更新檔案數量超過上限（${MAX_FILES}）`);
  return { host };
}
