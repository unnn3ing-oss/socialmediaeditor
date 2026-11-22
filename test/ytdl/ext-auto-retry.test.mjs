// 失敗後自動重試一次：等「每支間隔」秒數，之後才算真的失敗
import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "../../tools/ytdl/ext/lib/queue-controller.js";
import { applyAutoRetry, cancelAutoRetries, createState, describeItem, retryItem, scheduleAutoRetry } from "../../tools/ytdl/ext/lib/queue.js";

const url = (id) => `https://www.youtube.com/watch?v=${id}`;
const idOf = (u) => new URL(u).searchParams.get("v");
const ABORTED = { code: "too_many_failures", message: "連續失敗，已停止下載" };

function fakeHost() {
  const h = { requests: [], replies: {} };
  h.connected = () => true;
  h.version = () => "0.2.0";
  h.send = () => {};
  h.request = async (message) => {
    h.requests.push(message);
    const reply = h.replies[message.type];
    return (typeof reply === "function" ? await reply(message) : reply) ?? { type: "error", code: "unhandled", message: "x" };
  };
  h.of = (type) => h.requests.filter((m) => m.type === type);
  h.replies.resolve = (m) => ({ type: "resolved", items: m.urls.map((u) => ({ id: idOf(u), title: `影片 ${idOf(u)}`, url: u, duration: 100 })) });
  h.replies.download = { type: "started", jobId: "j" };
  h.replies.enqueue = (m) => ({ type: "enqueued", count: m.items.length });
  return h;
}

async function setup(ids) {
  const host = fakeHost();
  const waits = [];
  const clock = { t: 0 };
  const ctl = createController({
    host, save: () => {}, notify: () => {}, now: () => clock.t, retryDelayMs: 0,
    downloads: { download: async () => 1 },
    retryPause: (ms) => new Promise((resolve) => waits.push({ ms, fire: resolve })),
  });
  for (const id of ids) await ctl.add(url(id));
  await ctl.idle();
  return { host, ctl, waits, clock, byId: (id) => ctl.getState().items.find((i) => i.id === id) };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const fail = (ctl, id) => ctl.onHostEvent({ type: "item_failed", itemId: id, reason: "網路連線失敗", code: "network" });

test("a failed video is retried once by itself after the cooldown, then stays failed", async () => {
  const { host, ctl, waits, clock, byId } = await setup(["a", "b"]);
  await ctl.start();
  fail(ctl, "a");
  assert.equal(waits.length, 1);
  assert.equal(waits[0].ms, 10000, "the 每支間隔 setting");
  const info = describeItem(ctl.getState(), byId("a"), clock.t + 3000);
  assert.equal(info.kind, "cooling");
  assert.match(info.label, /失敗，7 秒後自動重試/);
  assert.equal(info.sub, "網路連線失敗", "the reason stays visible");
  waits[0].fire();
  await flush();
  assert.equal(byId("a").status, "waiting");
  assert.equal(byId("a").autoRetried, true);
  assert.deepEqual(host.of("enqueue").at(-1).items.map((i) => i.id), ["a"], "it joins the running job, behind the others");
  fail(ctl, "a");
  assert.equal(waits.length, 1, "only one automatic retry per video");
  assert.equal(describeItem(ctl.getState(), byId("a"), clock.t).kind, "failed");
});

test("the automatic retry starts a new job when the old one is already over", async () => {
  const { host, ctl, waits, byId } = await setup(["a"]);
  await ctl.start();
  fail(ctl, "a");
  ctl.onHostEvent({ type: "done", jobId: "j", summary: { ok: 0, failed: 1 } });
  assert.notEqual(byId("a").retryAt, null, "a normal end keeps the wait");
  waits[0].fire();
  await flush();
  await ctl.idle();
  assert.equal(host.of("download").length, 2);
  assert.deepEqual(host.of("download")[1].items.map((i) => i.id), ["a"]);
});

test("no automatic retry after stop or for a row removed meanwhile", async () => {
  const { host, ctl, waits, byId } = await setup(["a", "b", "c"]);
  await ctl.start();
  fail(ctl, "a");
  fail(ctl, "b");
  assert.equal(waits.length, 2);
  ctl.remove(byId("b").uid);
  ctl.stop(); // cancels the waiting retry of a
  assert.equal(byId("a").retryAt, null);
  waits.forEach((w) => w.fire());
  await flush();
  assert.equal(byId("a").status, "failed");
  assert.equal(host.of("enqueue").length, 0);
  fail(ctl, "c");
  assert.equal(waits.length, 2, "after the stop a failure is not retried");
});

test("a job the host stopped on purpose does not retry by itself", async () => {
  const { ctl, waits, byId } = await setup(["a"]);
  await ctl.start();
  fail(ctl, "a");
  ctl.onHostEvent({ type: "done", jobId: "j", summary: { aborted: ABORTED } });
  assert.equal(byId("a").retryAt, null);
  waits[0].fire();
  await flush();
  assert.equal(byId("a").status, "failed");
});

test("pressing 重試 during the wait works and the old wait does nothing", async () => {
  const { host, ctl, waits, byId } = await setup(["a"]);
  await ctl.start();
  fail(ctl, "a");
  ctl.retry(byId("a").uid);
  assert.equal(byId("a").status, "waiting");
  const sent = host.of("enqueue").length;
  waits[0].fire();
  await flush();
  assert.equal(host.of("enqueue").length, sent);
});

test("queue.js: only a failed row with an id that was not retried yet is scheduled", () => {
  const item = (fields) => ({ uid: 1, id: "a", url: url("a"), title: "t", status: "failed", dupOf: null, autoRetried: false, retryAt: null, ...fields });
  const state = (items) => ({ ...createState(), items });
  assert.equal(scheduleAutoRetry(state([item({})]), 1, 500).items[0].retryAt, 500);
  assert.equal(scheduleAutoRetry(state([item({ id: null })]), 1, 500).items[0].retryAt, null, "no video id");
  assert.equal(scheduleAutoRetry(state([item({ autoRetried: true })]), 1, 500).items[0].retryAt, null, "already tried");
  assert.equal(scheduleAutoRetry(state([item({ status: "done" })]), 1, 500).items[0].retryAt, null);
  const waiting = applyAutoRetry(scheduleAutoRetry(state([item({})]), 1, 500), 1);
  assert.deepEqual([waiting.items[0].status, waiting.items[0].autoRetried, waiting.items[0].retryAt], ["waiting", true, null]);
  assert.equal(cancelAutoRetries(scheduleAutoRetry(state([item({})]), 1, 500)).items[0].retryAt, null);
  assert.equal(retryItem(scheduleAutoRetry(state([item({})]), 1, 500), 1).items[0].retryAt, null);
  // after the wait the row looks failed again (with its retry button), not cooling
  const waited = scheduleAutoRetry(state([item({})]), 1, 500);
  assert.equal(describeItem(waited, waited.items[0], 100).kind, "cooling");
  assert.equal(describeItem(waited, waited.items[0], 600).kind, "failed");
});
