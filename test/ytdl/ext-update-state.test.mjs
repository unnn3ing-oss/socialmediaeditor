import test from "node:test";
import assert from "node:assert/strict";
import { autoCheckDue, changedParts, createCheckRunner, failedSummary, partsText, recordCheck, recordFailure, summarizeCheck } from "../../tools/ytdl/ext/lib/update-state.js";

const HOUR = 3_600_000;
const good = { checkedAt: 1000, sha: "a".repeat(40), date: "d", message: "m", hasUpdate: true, hostChangedCount: 2 };

test("a failed check keeps the last good result and does not count as a check", () => {
  assert.deepEqual(failedSummary(good, "斷線", 5000), { ...good, error: "斷線", errorAt: 5000 });
  assert.deepEqual(failedSummary(null, "斷線", 5000), { error: "斷線", errorAt: 5000 });
});

test("autoCheckDue: first run, stale result, pending update, and retry after an error", () => {
  const now = 100 * HOUR;
  assert.equal(autoCheckDue(null, now), true);
  assert.equal(autoCheckDue({ ...good, checkedAt: now - HOUR, hasUpdate: false }, now), false);
  assert.equal(autoCheckDue({ ...good, checkedAt: now - 7 * HOUR, hasUpdate: false }, now), true);
  assert.equal(autoCheckDue({ ...good, checkedAt: now - HOUR }, now), true, "a pending update needs its details again");
  const failed = failedSummary({ ...good, checkedAt: now - HOUR }, "斷線", now - 60_000);
  assert.equal(autoCheckDue(failed, now), false, "one minute after an error: wait");
  assert.equal(autoCheckDue(failed, now + 5 * 60_000), true, "five minutes after an error: retry");
});

// ---- 定時檢查與手動檢查共用同一份摘要：哪部分有差異、連不上下載助手時沒問到的部分 ----
const file = (path) => ({ path, sha: "s", size: 1 });
const found = (over = {}) => ({ sha: "b".repeat(40), date: "d", message: "m", hostChanged: [], hostChecked: true, hasUpdate: false, ...over });

test("the summary says whether the host files differ", () => {
  const s = summarizeCheck(found({ hostChanged: [file("host.py")], hasUpdate: true }), 1);
  assert.deepEqual([s.parts, s.hasUpdate, s.hostChangedCount], ["host", true, 1]);
  assert.equal(summarizeCheck(found(), 1).parts, null);
  assert.equal(partsText(null), "");
  assert.equal(partsText({ hostChangedCount: 2 }), "下載助手有新版本");
  assert.equal(changedParts({}), null);
});

test("a check that could not ask the host keeps what the last check knew; only a real answer clears it", () => {
  const prev = summarizeCheck(found({ hostChanged: [file("host.py")], hasUpdate: true }), 1);
  const unreachable = summarizeCheck(found({ hostChecked: false }), 2, prev);
  assert.deepEqual([unreachable.hasUpdate, unreachable.hostChangedCount, unreachable.checkedAt], [true, 1, 2]);
  assert.equal(summarizeCheck(found(), 3, prev).hasUpdate, false);
});

function memory() {
  let stored = null;
  return { stored: () => stored, deps: { load: async () => stored, save: async (summary) => { stored = summary; } } };
}

test("recording keeps the update that was found through failed and unreachable checks", async () => {
  const m = memory();
  await recordCheck(found({ hostChanged: [file("host.py")], hasUpdate: true }), { ...m.deps, now: 1 });
  await recordCheck(found({ hostChecked: false }), { ...m.deps, now: 2 });
  assert.equal(m.stored().parts, "host");
  await recordFailure("連不上 GitHub", { ...m.deps, now: 3 });
  assert.deepEqual([m.stored().hasUpdate, m.stored().parts, m.stored().error, m.stored().errorAt], [true, "host", "連不上 GitHub", 3]);
  await recordCheck(found({ hostChecked: false }), { ...m.deps, now: 4 });
  assert.deepEqual([m.stored().hasUpdate, m.stored().error], [true, undefined], "a good check replaces the failed one");
  await recordCheck(found(), { ...m.deps, now: 5 });
  assert.equal(m.stored().hasUpdate, false, "the host was asked and matches");
});

test("recording survives a store that refuses", async () => {
  const deps = { load: async () => { throw new Error("no storage"); }, save: async () => { throw new Error("no storage"); } };
  assert.equal((await recordCheck(found({ hostChanged: [file("a.py")], hasUpdate: true }), { ...deps, now: 1 })).hasUpdate, true);
  assert.equal((await recordFailure("x", { ...deps, now: 1 })).error, "x");
});

test("recording never touches the toolbar badge", async () => {
  const calls = [];
  globalThis.chrome = { action: new Proxy({}, { get: (_, k) => (...a) => calls.push([k, a]) }) };
  try { await recordCheck(found({ hostChanged: [file("a.py")], hasUpdate: true }), { ...memory().deps, now: 1 }); }
  finally { delete globalThis.chrome; }
  assert.deepEqual(calls, []);
});

test("checks that are asked for while one runs are folded into one more run, so the local program's files are not missed", async () => {
  const gates = [];
  let runs = 0;
  const runner = createCheckRunner(() => new Promise((resolve) => { runs += 1; gates.push(resolve); }));
  const first = runner.trigger();
  runner.trigger(); // (the local program connected a moment after the check started: that check could not ask it)
  runner.trigger();
  assert.equal(runs, 1, "never two at once");
  gates[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2, "exactly one more run, however many asked");
  gates[1]();
  await first;
  assert.equal(runs, 2);
  const again = runner.trigger();
  assert.equal(runs, 3, "idle again: runs at once");
  gates[2]();
  await again;
});

test("a check that throws does not stop later checks", async () => {
  let runs = 0;
  const runner = createCheckRunner(async () => { runs += 1; if (runs === 1) throw new Error("boom"); });
  await runner.trigger().catch(() => {});
  await runner.trigger();
  assert.equal(runs, 2);
});
