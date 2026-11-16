import test from "node:test";
import assert from "node:assert/strict";

// 在還沒有 chrome 的 Node 底下 import：模組最上層不能碰 chrome.*。
assert.equal(typeof globalThis.chrome, "undefined");
const mod = await import("../../tools/ytdl/ext/index.js");

const isOpName = (name) => name !== "init" && !name.startsWith("_");
const ops = () => Object.entries(mod).filter(([name, fn]) => typeof fn === "function" && isOpName(name));
const EXPECTED = [
  "get_status", "start", "set_output_dir", "doctor", "diagnostics", "update_engine", "update_info", "update_apply",
  "queue_get", "queue_add", "queue_remove", "queue_retry", "queue_clear", "queue_start", "queue_stop",
  "queue_copy_text", "queue_download_cover", "settings_set",
].sort();

test("op 在 init 之前被呼叫：回 {ok:false} 而不是拋例外", async () => {
  for (const [name, fn] of ops()) {
    const reply = await fn({});
    assert.equal(reply.ok, false, name);
    assert.equal(typeof reply.error, "string", name);
  }
});

// ---- 假 chrome ----
function fakeChrome({ queue = null } = {}) {
  const store = queue ? { "ytdl-queue": queue } : {};
  const touched = [];
  const nativePorts = [];
  const executed = [];
  const chromeStub = {
    runtime: {
      id: "ext-id",
      lastError: undefined,
      onStartup: { addListener() {} },
      connectNative(name) {
        const listeners = { message: [], disconnect: [] };
        const sent = [];
        const p = {
          name, sent, listeners,
          onMessage: { addListener: (f) => listeners.message.push(f) },
          onDisconnect: { addListener: (f) => listeners.disconnect.push(f) },
          postMessage: (m) => sent.push(m),
          disconnect: () => {},
        };
        nativePorts.push(p);
        return p;
      },
    },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); } } },
    alarms: { get: async () => null, create: async (name) => { touched.push(["alarm", name]); }, onAlarm: { addListener() {} } },
    downloads: {},
    tabs: { query: async () => [{ id: 7 }] },
    scripting: { executeScript: async (opts) => { executed.push(opts); return opts.func ? [{ result: false }] : []; } },
    action: new Proxy({}, { get: (_, k) => () => { touched.push(["action", k]); } }),
  };
  return { chromeStub, store, touched, nativePorts, executed };
}

function fakeCtx() {
  const pushed = [];
  const subscribers = [];
  return { pushed, subscribers, ctx: { id: "ytdl", push: (d) => pushed.push(d), onSubscribe: (fn) => subscribers.push(fn) } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("init 之後 op 名單齊全，init 不是 op", async () => {
  const env = fakeChrome();
  globalThis.chrome = env.chromeStub;
  try {
    mod.init(fakeCtx().ctx);
    await settle();
    assert.deepEqual(ops().map(([n]) => n).sort(), EXPECTED);
    assert.ok(!ops().some(([n]) => n === "init"));
    const status = await mod.get_status();
    assert.deepEqual(status, { ok: true, data: { state: "stopped", ready: null, detail: null } });
  } finally { delete globalThis.chrome; }
});

test("未連線時 queue_add（壞網址）／start／doctor 等回 {ok:false}，不拋例外", async () => {
  const env = fakeChrome();
  globalThis.chrome = env.chromeStub;
  try {
    mod.init(fakeCtx().ctx);
    for (const [name, payload] of [
      ["queue_add", { url: "not a url" }], ["queue_start", {}], ["queue_copy_text", { uid: "x" }],
      ["queue_download_cover", { uid: "x" }], ["set_output_dir", { path: "/tmp" }], ["doctor", {}], ["diagnostics", {}],
      ["update_engine", {}], ["update_apply", {}],
    ]) {
      const reply = await mod[name](payload);
      assert.equal(reply.ok, false, name);
      assert.equal(typeof reply.error, "string", name);
    }
    // 合法網址離線時可先排進清單（開始下載時才檢查下載助手），這是舊版就有的行為
    assert.equal((await mod.queue_add({ url: "https://youtu.be/abcdefghijk" })).ok, true);
    assert.equal((await mod.queue_get()).ok, true);
  } finally { delete globalThis.chrome; }
});

test("onSubscribe 會先送 status 快照與 queue_state", async () => {
  const env = fakeChrome();
  globalThis.chrome = env.chromeStub;
  try {
    const c = fakeCtx();
    mod.init(c.ctx);
    assert.equal(c.subscribers.length, 1);
    const sent = [];
    c.subscribers[0]((d) => sent.push(d));
    await settle();
    assert.equal(sent[0].type, "status");
    assert.equal(sent[0].state, "stopped");
    assert.equal(sent[1].type, "queue_state");
    assert.ok(sent[1].state && typeof sent[1].state === "object");
  } finally { delete globalThis.chrome; }
});

test("init 會對開著的工具箱分頁補注入核心 bridge，並用 ytdl- 前綴的鬧鐘；不動圖示 badge", async () => {
  const env = fakeChrome();
  globalThis.chrome = env.chromeStub;
  try {
    mod.init(fakeCtx().ctx);
    await settle();
    assert.ok(env.executed.some((o) => o.target.tabId === 7 && o.target.allFrames === true && o.files?.[0] === "core/bridge.js"));
    assert.deepEqual(env.touched.filter(([k]) => k === "alarm"), [["alarm", "ytdl-check-update"]]);
    assert.deepEqual(env.touched.filter(([k]) => k === "action"), []);
  } finally { delete globalThis.chrome; }
});

test("start 連 com.tbx.ytdl；連上後推播 status；斷線分類", async () => {
  const env = fakeChrome();
  globalThis.chrome = env.chromeStub;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, headers: { get: () => null } }); // 連線後的背景檢查不要真的上網
  try {
    const c = fakeCtx();
    mod.init(c.ctx);
    assert.deepEqual(await mod.start(), { ok: true, data: {} });
    assert.equal(env.nativePorts[0].name, "com.tbx.ytdl");
    env.nativePorts[0].listeners.message[0]({ type: "ready", hostVersion: "1.0.0", outputDir: "/d" });
    await settle();
    assert.ok(c.pushed.some((m) => m.type === "status" && m.state === "running"));
    assert.equal((await mod.get_status()).data.state, "running");
    env.chromeStub.runtime.lastError = { message: "Specified native messaging host not found." };
    env.nativePorts[0].listeners.disconnect[0]();
    assert.equal((await mod.get_status()).data.state, "not_installed");
  } finally { globalThis.fetch = realFetch; delete globalThis.chrome; }
});

test("update_info 只比對 tools/ytdl/host/ 這層的 *.py", async () => {
  const env = fakeChrome();
  globalThis.chrome = env.chromeStub;
  const realFetch = globalThis.fetch;
  const COMMIT = "c".repeat(40);
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const json = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
    if (String(url).endsWith("/commits/main")) return json({ sha: COMMIT, commit: { message: "m\nbody", committer: { date: "2026-11-15T00:00:00Z" } } });
    if (String(url).includes("/contents/tools/ytdl/host")) {
      return json([
        { path: "tools/ytdl/host/host.py", type: "file", sha: "a".repeat(40), size: 10 },
        { path: "tools/ytdl/host/version.py", type: "file", sha: "b".repeat(40), size: 10 },
        { path: "tools/ytdl/host/README.md", type: "file", sha: "d".repeat(40), size: 10 },
        { path: "tools/ytdl/host/tests", type: "dir", sha: "e".repeat(40), size: 0 },
      ]);
    }
    return { ok: false, status: 404, headers: { get: () => null } };
  };
  try {
    mod.init(fakeCtx().ctx);
    await mod.start();
    const port = env.nativePorts[0];
    port.postMessage = (m) => {
      port.sent.push(m);
      if (m.type === "update_check") setImmediate(() => port.listeners.message[0]({ type: "update_status", reqId: m.reqId, changed: ["version.py"] }));
    };
    port.listeners.message[0]({ type: "ready", hostVersion: "1.2.3", outputDir: "/d" });
    await settle();
    port.sent.length = 0;
    const reply = await mod.update_info();
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.data, {
      current: "1.2.3", hostVersion: "1.2.3", latestSha: COMMIT, date: "2026-11-15T00:00:00Z", message: "m",
      hostCount: 1, hostChecked: true, hasUpdate: true,
    });
    const check = port.sent.find((m) => m.type === "update_check");
    assert.deepEqual(check.files.map((f) => f.path), ["host.py", "version.py"]);
    assert.ok(urls.some((u) => u.includes("/repos/unnn3ing-oss/socialmediaeditor/contents/tools/ytdl/host?ref=" + COMMIT)));
    assert.ok(urls.every((u) => !u.includes("/git/trees/")), "不抓整棵樹");
    assert.equal(env.store["ytdl-update-info"].hostChangedCount, 1, "結果存在 ytdl-update-info");
    assert.deepEqual(env.touched.filter(([k]) => k === "action"), []);
  } finally { globalThis.fetch = realFetch; delete globalThis.chrome; }
});
