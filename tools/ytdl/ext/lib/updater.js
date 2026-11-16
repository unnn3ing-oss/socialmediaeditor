import { UPDATE_REPO } from "./update-config.js";
import { gitBlobSha } from "./gitsha.js";
import { MAX_FILE_BYTES, isSafeRelativePath, mapTree } from "./update-rules.js";
import { toBase64 } from "./base64.js";

export { toBase64 };

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SHA_RE = /^[0-9a-f]{40}$/;

export class UpdateError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "UpdateError";
    this.code = code;
  }
}

export function shouldCheck(checkedAt, now = Date.now(), intervalMs = CHECK_INTERVAL_MS) {
  return !Number.isFinite(checkedAt) || now - checkedAt >= intervalMs;
}

async function githubJson(fetchFn, url, repo) {
  let response;
  try {
    response = await fetchFn(url, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  } catch {
    throw new UpdateError("連不上 GitHub，請確認網路連線");
  }
  const rateLimited = response.status === 429
    || (response.status === 403 && response.headers?.get?.("x-ratelimit-remaining") === "0");
  if (rateLimited) throw new UpdateError("GitHub 暫時限制查詢次數，請稍後再試");
  // 分支不存在時 GitHub 回 404 或 422。
  if ((response.status === 404 || response.status === 422) && url.includes("/commits/")) {
    throw new UpdateError(`尚未發佈：找不到 ${repo.branch} 分支`);
  }
  if (response.status === 403) {
    throw new UpdateError("GitHub 拒絕了查詢（HTTP 403），可能被公司網路的代理或防火牆擋下");
  }
  if (!response.ok) throw new UpdateError(`連不上 GitHub（HTTP ${response.status}）`);
  return response.json();
}

// 查 GitHub 上最新 commit，以及 `repo.path` 這一層的 *.py（下載助手的檔案）。
export async function checkLatest({ fetchFn = fetch, repo = UPDATE_REPO } = {}) {
  const base = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const commit = await githubJson(fetchFn, `${base}/commits/${repo.branch}`, repo);
  if (!SHA_RE.test(commit?.sha ?? "")) throw new UpdateError("GitHub 回傳的資料格式不正確");
  const encodedPath = repo.path.split("/").map(encodeURIComponent).join("/");
  const listing = await githubJson(fetchFn, `${base}/contents/${encodedPath}?ref=${commit.sha}`, repo);
  let mapped;
  try {
    mapped = mapTree(Array.isArray(listing) ? listing : [], repo.path);
  } catch (error) {
    throw new UpdateError(error.message);
  }
  return {
    sha: commit.sha,
    date: commit.commit?.committer?.date ?? "",
    message: String(commit.commit?.message ?? "").split("\n")[0],
    hostFiles: mapped.host,
  };
}

// 從指定 commit 下載每個檔案，並用 git blob SHA 逐一驗證；全部相符才回傳。
export async function downloadAll(entries, { sha, repo = UPDATE_REPO, fetchFn = fetch, onProgress = () => {} }) {
  if (!SHA_RE.test(sha ?? "")) throw new UpdateError("無效的 commit，已取消更新");
  const results = [];
  for (const [index, entry] of entries.entries()) {
    if (!isSafeRelativePath(entry.path)) throw new UpdateError(`不安全的檔案路徑：${entry.path}`);
    const encoded = entry.path.split("/").map(encodeURIComponent).join("/");
    const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${sha}/${repo.path}/${encoded}`;
    let bytes;
    try {
      const response = await fetchFn(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      throw new UpdateError(`下載 ${entry.path} 失敗：${error.message}`);
    }
    if (bytes.length > MAX_FILE_BYTES || (await gitBlobSha(bytes)) !== entry.sha) {
      throw new UpdateError(`${entry.path} 下載內容和 GitHub 上的不一致，已取消更新`);
    }
    results.push({ path: entry.path, bytes });
    onProgress({ step: "download", done: index + 1, total: entries.length });
  }
  return results;
}
