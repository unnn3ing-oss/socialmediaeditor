import test from "node:test";
import assert from "node:assert/strict";
import { gitBlobSha, sameContent } from "../../tools/ytdl/ext/lib/gitsha.js";
import { isSafeRelativePath, mapTree, MAX_FILES, MAX_FILE_BYTES } from "../../tools/ytdl/ext/lib/update-rules.js";

const enc = (text) => new TextEncoder().encode(text);
const h = (c) => c.repeat(40);
const BASE = "tools/ytdl/host";

test("gitBlobSha matches git hash-object vectors", async () => {
  assert.equal(await gitBlobSha(enc("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.equal(await gitBlobSha(enc("")), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("sameContent ignores CRLF-only differences for text files but not binary", async () => {
  const sha = await gitBlobSha(enc("a\nb\n"));
  assert.equal(await sameContent("x.js", enc("a\nb\n"), sha), true);
  assert.equal(await sameContent("x.js", enc("a\r\nb\r\n"), sha), true);
  assert.equal(await sameContent("x.png", enc("a\r\nb\r\n"), sha), false);
  assert.equal(await sameContent("x.js", enc("other"), sha), false);
  assert.equal(await sameContent("x.js", null, sha), false);
});

test("isSafeRelativePath rejects traversal, absolute, backslash, drive letters and .git", () => {
  for (const ok of ["a.py", "lib/a.js", "a b.js"]) assert.equal(isSafeRelativePath(ok), true, ok);
  for (const bad of ["", "/a", "../a", "a/../b", "a//b", "a\\b", "C:/a", ".git/config", "a/.git/x", "a/", ".", "x".repeat(201)]) {
    assert.equal(isSafeRelativePath(bad), false, bad);
  }
});

const blob = (path, over = {}) => ({ path, type: "blob", sha: h("a"), size: 10, ...over });

test("mapTree keeps only the *.py files directly inside tools/ytdl/host/", () => {
  const out = mapTree([
    { path: BASE, type: "tree", sha: h("b") },
    blob(`${BASE}/host.py`, { sha: h("c"), size: 100 }),
    { path: `${BASE}/version.py`, type: "file", sha: h("d"), size: 5 }, // contents API 的 type 是 file
    blob(`${BASE}/tests/test_x.py`),
    blob(`${BASE}/README.md`),
    blob(`${BASE}/bad-name.py`),
    blob("tools/ytdl/ext/index.js"),
    blob("extension/core/background.js"),
    blob("host/old.py"),
  ]);
  assert.deepEqual(out.host, [
    { path: "host.py", sha: h("c"), size: 100 },
    { path: "version.py", sha: h("d"), size: 5 },
  ]);
  assert.equal(out.extension, undefined);
});

test("mapTree rejects unsafe paths, oversized files and too many files", () => {
  for (const path of [`${BASE}/../x.py`, `${BASE}/a\\b.py`, `${BASE}/.git/config`, `${BASE}/C:/x`]) {
    assert.throws(() => mapTree([blob(path)]), /不安全/, path);
  }
  assert.throws(() => mapTree([blob(`${BASE}/big.py`, { size: MAX_FILE_BYTES + 1 })]), /過大/);
  const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => blob(`${BASE}/f${i}.py`));
  assert.throws(() => mapTree(many), /數量/);
});
