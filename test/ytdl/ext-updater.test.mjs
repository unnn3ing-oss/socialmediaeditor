import test from "node:test";
import assert from "node:assert/strict";
import { gitBlobSha } from "../../tools/ytdl/ext/lib/gitsha.js";
import { UpdateError, checkLatest, downloadAll, shouldCheck } from "../../tools/ytdl/ext/lib/updater.js";

const REPO = { owner: "o", repo: "r", branch: "release", path: "tools/ytdl/host" };
const COMMIT = "c".repeat(40);
const TREE = "t".repeat(40);
const COMMIT_URL = "https://api.github.com/repos/o/r/commits/release";
const LIST_URL = `https://api.github.com/repos/o/r/contents/tools/ytdl/host?ref=${COMMIT}`;
const enc = (text) => new TextEncoder().encode(text);
const dec = (bytes) => new TextDecoder().decode(bytes);
const commitJson = (message = "release: v2\n\nbody") => ({
  sha: COMMIT, commit: { tree: { sha: TREE }, committer: { date: "2026-10-05T00:00:00Z" }, message },
});
const blobItem = async (path, content) => ({ path, type: "blob", sha: await gitBlobSha(enc(content)), size: enc(content).length });
const readLocal = (files) => async (path) => (files[path] === undefined ? null : enc(files[path]));

function makeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) return { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } };
    if (route.bytes) {
      const b = route.bytes;
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
    const status = route.status ?? 200;
    const headers = { get: (name) => route.headers?.[name.toLowerCase()] ?? null };
    return { ok: status < 400, status, json: async () => route.json, headers };
  };
}

const fileItem = async (name, content) => ({ path: `tools/ytdl/host/${name}`, type: "file", sha: await gitBlobSha(enc(content)), size: enc(content).length });

test("checkLatest reads the commit, then lists only the host folder's *.py at that commit", async () => {
  const calls = [];
  const listing = [await fileItem("host.py", "print(1)"), await fileItem("README.md", "x"), { path: "tools/ytdl/host/tests", type: "dir", sha: "d".repeat(40) }];
  const info = await checkLatest({
    fetchFn: makeFetch({ [COMMIT_URL]: { json: commitJson() }, [LIST_URL]: { json: listing } }, calls), repo: REPO,
  });
  assert.deepEqual(calls, [COMMIT_URL, LIST_URL]);
  assert.deepEqual(info.hostFiles.map((e) => e.path), ["host.py"]);
  assert.deepEqual([info.sha, info.message, info.date], [COMMIT, "release: v2", "2026-10-05T00:00:00Z"]);
});

test("checkLatest maps GitHub failures to friendly messages", async () => {
  const cases = [
    [{ [COMMIT_URL]: new Error("offline") }, /連不上 GitHub，請確認網路連線/],
    [{ [COMMIT_URL]: { status: 403, headers: { "x-ratelimit-remaining": "0" } } }, /暫時限制查詢次數/],
    [{ [COMMIT_URL]: { status: 429 } }, /暫時限制查詢次數/],
    [{ [COMMIT_URL]: { status: 403 } }, /HTTP 403.*代理|HTTP 403.*防火牆/],
    [{ [COMMIT_URL]: { status: 422 } }, /尚未發佈：找不到 release 分支/],
    [{ [COMMIT_URL]: { status: 404 } }, /尚未發佈：找不到 release 分支/],
    [{ [COMMIT_URL]: { status: 500 } }, /HTTP 500/],
    [{ [COMMIT_URL]: { json: { sha: "bad" } } }, /格式不正確/],
    [{ [COMMIT_URL]: { json: commitJson() }, [LIST_URL]: { json: [{ path: "tools/ytdl/host/../x.py", type: "file", sha: "a".repeat(40), size: 1 }] } }, /不安全/],
  ];
  for (const [routes, pattern] of cases) {
    await assert.rejects(checkLatest({ fetchFn: makeFetch(routes), repo: REPO }),
      (error) => error instanceof UpdateError && pattern.test(error.message), String(pattern));
  }
});

test("shouldCheck honours the 6 hour interval", () => {
  const now = 10_000_000_000;
  const hour = 3_600_000;
  assert.equal(shouldCheck(undefined, now), true);
  assert.equal(shouldCheck(now - hour, now), false);
  assert.equal(shouldCheck(now - 6 * hour, now), true);
  assert.equal(shouldCheck(now - hour, now, hour), true);
});

test("downloadAll fetches from the pinned commit url under the host path", async () => {
  const calls = [];
  const entry = { path: "version.py", sha: await gitBlobSha(enc("v")) };
  const url = `https://raw.githubusercontent.com/o/r/${COMMIT}/tools/ytdl/host/version.py`;
  const got = await downloadAll([entry], { sha: COMMIT, repo: REPO, fetchFn: makeFetch({ [url]: { bytes: enc("v") } }, calls) });
  assert.deepEqual(calls, [url]);
  assert.deepEqual(got.map((f) => [f.path, dec(f.bytes)]), [["version.py", "v"]]);
});

test("downloadAll verifies every file and returns nothing when one is tampered", async () => {
  const entries = [{ path: "a.py", sha: await gitBlobSha(enc("A")) }, { path: "b.py", sha: await gitBlobSha(enc("B")) }];
  const url = (name) => `https://raw.githubusercontent.com/o/r/${COMMIT}/tools/ytdl/host/${name}`;
  const fetchFn = makeFetch({ [url("a.py")]: { bytes: enc("A") }, [url("b.py")]: { bytes: enc("tampered") } });
  await assert.rejects(downloadAll(entries, { sha: COMMIT, repo: REPO, fetchFn }), /b\.py.*不一致/);
  await assert.rejects(downloadAll(entries, { sha: "main", repo: REPO, fetchFn }), /commit/);
  await assert.rejects(downloadAll([{ path: "../x.py", sha: "a".repeat(40) }], { sha: COMMIT, repo: REPO, fetchFn }), /不安全/);
});
