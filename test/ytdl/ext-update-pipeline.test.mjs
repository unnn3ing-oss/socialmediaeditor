import test from "node:test";
import assert from "node:assert/strict";
import { gitBlobSha } from "../../tools/ytdl/ext/lib/gitsha.js";
import { UpdateError } from "../../tools/ytdl/ext/lib/updater.js";
import { applyUpdate, collectUpdateInfo } from "../../tools/ytdl/ext/lib/update-pipeline.js";

const enc = (t) => new TextEncoder().encode(t);
const dec = (b) => new TextDecoder().decode(b);
const SHA = "c".repeat(40);

async function entry(path, text) {
  return { path, sha: await gitBlobSha(enc(text)), size: enc(text).length };
}

// 假 GitHub：raw 檔案放在 tools/ytdl/host/<名稱>。
function fakeFetch(files) {
  return async (url) => {
    const m = /\/([0-9a-f]{40})\/tools\/ytdl\/host\/(.+)$/.exec(url);
    const body = m && files[decodeURIComponent(m[2])];
    return body === undefined ? { ok: false, status: 404 } : { ok: true, status: 200, arrayBuffer: async () => enc(body).buffer };
  };
}

const latest = async (over = {}) => ({
  sha: SHA, date: "2026-10-06T00:00:00Z", message: "release",
  hostFiles: [await entry("version.py", 'VERSION = "2.0.0"\n'), await entry("host.py", "# same")],
  ...over,
});
const FILES = { "version.py": 'VERSION = "2.0.0"\n', "host.py": "# same" };

function host({ changed = ["version.py"], fail = {} } = {}) {
  const sent = [];
  const request = async (message) => {
    sent.push(message);
    if (fail[message.type]) return { type: "error", message: fail[message.type] };
    switch (message.type) {
      case "update_check": return { type: "update_status", changed, total: message.files.length };
      case "update_stage": return { type: "update_staged", count: message.files.length };
      case "update_commit": return { type: "update_applied", count: 1 };
      default: return { type: "update_rolled_back" };
    }
  };
  return { request, sent };
}

const collect = (h, over = {}) => collectUpdateInfo({ check: async () => latest(over), hostRequest: h.request, hostVersion: "1.0.0" });

test("the check says which host files differ", async () => {
  const h = host();
  const info = await collect(h);
  assert.equal(info.sha, SHA);
  assert.deepEqual(info.hostChanged.map((f) => f.path), ["version.py"], "only the host files that differ");
  assert.deepEqual(h.sent[0].files.map((f) => f.path), ["version.py", "host.py"]);
  assert.equal(info.hostChecked, true);
  assert.equal(info.hasUpdate, true);
  assert.equal(info.hostVersion, "1.0.0");
});

test("without the host nothing is compared and nothing is claimed", async () => {
  const info = await collectUpdateInfo({ check: async () => latest(), hostRequest: null });
  assert.equal(info.hostChecked, false);
  assert.equal(info.hasUpdate, false);
});

test("nothing differs: no update", async () => {
  const info = await collect(host({ changed: [] }));
  assert.equal(info.hasUpdate, false);
  assert.equal(info.hostChecked, true);
});

test("an unreachable host does not fail the check", async () => {
  const info = await collectUpdateInfo({ check: async () => latest(), hostRequest: async () => { throw new Error("gone"); } });
  assert.equal(info.hostChecked, false);
  assert.equal(info.hasUpdate, false);
});

test("applying: download, stage, commit, in that order", async () => {
  const h = host();
  const info = await collect(h);
  h.sent.length = 0;
  const steps = [];
  const result = await applyUpdate({ info, hostRequest: h.request, fetchFn: fakeFetch(FILES), onProgress: (p) => steps.push(p.step) });
  assert.deepEqual(h.sent.map((m) => m.type), ["update_stage", "update_commit"]);
  assert.equal(h.sent[0].commit, SHA);
  assert.equal(dec(Uint8Array.from(atob(h.sent[0].contents["version.py"]), (c) => c.charCodeAt(0))), 'VERSION = "2.0.0"\n');
  assert.deepEqual(result, { count: 1 });
  assert.ok(steps.includes("download") && steps.includes("host"));
});

test("a file that does not match GitHub's hash stops the update before the host is touched", async () => {
  const h = host();
  const info = await collect(h);
  h.sent.length = 0;
  await assert.rejects(applyUpdate({ info, hostRequest: h.request, fetchFn: fakeFetch({ ...FILES, "version.py": "# tampered" }) }), /不一致/);
  assert.deepEqual(h.sent, []);
});

test("if committing fails, the staged files are rolled back", async () => {
  const h = host({ fail: { update_commit: "磁碟已滿" } });
  const info = await collect(h);
  h.sent.length = 0;
  await assert.rejects(applyUpdate({ info, hostRequest: h.request, fetchFn: fakeFetch(FILES) }), /磁碟已滿/);
  assert.deepEqual(h.sent.map((m) => m.type), ["update_stage", "update_commit", "update_rollback"]);
});

test("if staging fails there is nothing to roll back", async () => {
  const h = host({ fail: { update_stage: "自我檢查失敗" } });
  const info = await collect(h);
  h.sent.length = 0;
  await assert.rejects(applyUpdate({ info, hostRequest: h.request, fetchFn: fakeFetch(FILES) }), /自我檢查失敗/);
  assert.deepEqual(h.sent.map((m) => m.type), ["update_stage"]);
});

test("the host's slow steps are given time to finish", async () => {
  const h = host();
  const timeouts = {};
  const request = async (message, timeout) => { timeouts[message.type] = timeout; return h.request(message); };
  const info = await collect(h);
  await applyUpdate({ info, hostRequest: request, fetchFn: fakeFetch(FILES) });
  assert.ok(timeouts.update_stage >= 90000 && timeouts.update_commit >= 60000, JSON.stringify(timeouts));
});

test("when rolling back fails too, the person is told to run the installer", async () => {
  const h = host({ fail: { update_commit: "磁碟已滿", update_rollback: "沒有可還原的備份" } });
  const info = await collect(h);
  await assert.rejects(applyUpdate({ info, hostRequest: h.request, fetchFn: fakeFetch(FILES) }), (e) => e instanceof UpdateError && /磁碟已滿.*無法還原.*安裝檔/s.test(e.message));
});
