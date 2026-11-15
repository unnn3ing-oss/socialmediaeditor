import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { TIMEOUTS, createBridgeClient } from "../../tools/ytdl/web/bridge-client.js";

// 假的 tb.ext：call 記下呼叫並依 handler 回覆；on 記下訂閱，push() 模擬外掛推播。
function fakeExt(handler) {
  const calls = [];
  const subs = [];
  return {
    calls,
    ext: {
      call: async (op, payload, opts) => { calls.push({ op, payload, opts }); return handler(op, payload, opts); },
      on: (tool, cb) => { subs.push({ tool, cb }); return () => { subs.length = 0; }; },
    },
    subs,
    push: (data) => subs.forEach((s) => s.cb(data)),
  };
}
const noExt = () => Object.assign(new Error("未偵測到外掛"), { code: "no_extension" });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the first ping that is answered detects the extension and reports its version", async () => {
  const f = fakeExt(() => ({ version: "3.00" }));
  const client = createBridgeClient({ ext: f.ext, pingEveryMs: 1e9 });
  const changes = [];
  const versions = [];
  client.onChange((v) => changes.push(v));
  client.onVersion((v) => versions.push(v));
  await tick(); await tick();
  assert.equal(client.detected(), true);
  assert.equal(client.version(), "3.00");
  assert.deepEqual(changes, [true]);
  assert.deepEqual(versions, ["3.00"]);
  assert.equal(f.calls[0].op, "ping");
  client.stop();
});

test("it subscribes to the 'ytdl' pushes and turns them into state, status and progress events", async () => {
  const f = fakeExt(() => ({ version: "3.00" }));
  const client = createBridgeClient({ ext: f.ext, pingEveryMs: 1e9 });
  assert.equal(f.subs.length, 1);
  assert.equal(f.subs[0].tool, "ytdl");
  const seen = { state: [], status: [], progress: [] };
  client.onState((v) => seen.state.push(v));
  client.onStatus((v) => seen.status.push(v));
  client.onProgress((v) => seen.progress.push(v));
  f.push({ type: "queue_state", state: { items: [] } });
  f.push({ type: "status", state: "running", ready: { hostVersion: "0.9.0" }, detail: null });
  f.push({ type: "update_progress", step: "download", done: 1, total: 3 });
  f.push({ type: "unknown" });
  f.push(null);
  assert.deepEqual(seen.state, [{ items: [] }]);
  assert.equal(seen.status[0].state, "running");
  assert.equal(seen.status[0].ready.hostVersion, "0.9.0");
  assert.deepEqual(seen.progress, [{ type: "update_progress", step: "download", done: 1, total: 3 }]);
  client.stop();
});

test("request calls 'ytdl.<type>' with the rest as payload and returns { ok: true, ...data }", async () => {
  const f = fakeExt((op) => (op === "ping" ? { version: "3.00" } : { state: { items: [1] } }));
  const client = createBridgeClient({ ext: f.ext, pingEveryMs: 1e9 });
  await tick(); await tick();
  const reply = await client.request({ type: "queue_get" });
  assert.deepEqual(reply, { ok: true, state: { items: [1] } });
  const call = f.calls.at(-1);
  assert.equal(call.op, "ytdl.queue_get");
  assert.equal(call.payload, undefined);
  assert.equal(call.opts.timeout, TIMEOUTS.queue_get);
  await client.request({ type: "queue_add", url: "https://youtu.be/a" }, 1234);
  const add = f.calls.at(-1);
  assert.deepEqual([add.op, add.payload, add.opts.timeout], ["ytdl.queue_add", { url: "https://youtu.be/a" }, 1234]);
  await client.request({ type: "doctor", fix: true });
  assert.deepEqual([f.calls.at(-1).payload, f.calls.at(-1).opts.timeout], [{ fix: true }, 130000]);
  client.stop();
});

test("the timeouts follow the protocol table", () => {
  assert.deepEqual(
    [TIMEOUTS.get_status, TIMEOUTS.doctor, TIMEOUTS.diagnostics, TIMEOUTS.update_engine, TIMEOUTS.update_info, TIMEOUTS.update_apply, TIMEOUTS.queue_add, TIMEOUTS.set_output_dir],
    [5000, 130000, 70000, 300000, 60000, 600000, 60000, 30000],
  );
});

test("an op that fails (the extension answered ok:false) becomes { ok: false, error, code }, not a rejection", async () => {
  const f = fakeExt((op) => {
    if (op === "ping") return { version: "3.00" };
    throw Object.assign(new Error("不是 YouTube 的網址"), { code: "bad_url" });
  });
  const client = createBridgeClient({ ext: f.ext, pingEveryMs: 1e9 });
  await tick(); await tick();
  assert.deepEqual(await client.request({ type: "queue_add", url: "x" }), { ok: false, error: "不是 YouTube 的網址", code: "bad_url" });
  client.stop();
});

test("a request without the extension, or one that times out, rejects", async () => {
  const f = fakeExt(() => { throw noExt(); });
  const client = createBridgeClient({ ext: f.ext, pingEveryMs: 1e9 });
  await tick(); await tick();
  assert.equal(client.detected(), false);
  await assert.rejects(client.request({ type: "queue_get" }), /尚未偵測到/);
  const g = fakeExt((op) => { if (op === "ping") return { version: "3.00" }; throw noExt(); });
  const second = createBridgeClient({ ext: g.ext, pingEveryMs: 1e9 });
  await tick(); await tick();
  await assert.rejects(second.request({ type: "doctor" }), /逾時/);
  client.stop(); second.stop();
});

test("silence for longer than lostAfterMs turns detection off, and an answer turns it on again", async () => {
  let t = 1_000_000;
  let alive = true;
  const f = fakeExt(() => { if (!alive) throw noExt(); return { version: "3.00" }; });
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const client = createBridgeClient({ ext: f.ext, pingEveryMs: 1000, lostAfterMs: 6000, now: () => t });
    const changes = [];
    client.onChange((v) => changes.push(v));
    await tick(); await tick();
    assert.equal(client.detected(), true);
    alive = false;
    t += 3000; // 還在容忍時間內：不算失去
    mock.timers.tick(1000); await tick(); await tick();
    assert.equal(client.detected(), true);
    t += 4000; // 超過 6 秒沒聽到
    mock.timers.tick(1000); await tick(); await tick();
    assert.equal(client.detected(), false);
    assert.equal(client.version(), null);
    alive = true;
    mock.timers.tick(1000); await tick(); await tick();
    assert.equal(client.detected(), true);
    assert.deepEqual(changes, [true, false, true]);
    client.stop();
  } finally {
    mock.timers.reset();
  }
});

test("pushes are ignored safely before anything is listening, and stop() unsubscribes", async () => {
  const f = fakeExt(() => ({ version: "3.00" }));
  const client = createBridgeClient({ ext: f.ext, pingEveryMs: 1e9 });
  f.push({ type: "queue_state", state: {} }); // 沒有監聽者也不會丟錯
  client.stop();
  assert.equal(f.subs.length, 0);
});
