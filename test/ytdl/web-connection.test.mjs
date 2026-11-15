import test from "node:test";
import assert from "node:assert/strict";
import { FORBIDDEN_TEXT, REINSTALL_ACTION, createAutoConnect, extensionNotice, hostNotice } from "../../tools/ytdl/web/connection.js";

const stopped = { state: "stopped", ready: null, detail: "Native host has exited." };
const closed = () => ({ ...stopped }); // every launch that ends makes the extension send a new report

test("auto connect keeps trying to launch the host a few times, then gives up with a note", () => {
  const auto = createAutoConnect({ maxTries: 3 });
  const outcomes = [1, 2, 3, 4, 5].map(() => auto.next(true, closed()));
  assert.deepEqual(outcomes.map((o) => o.send), [true, true, true, false, false]);
  assert.deepEqual(outcomes.map((o) => o.gaveUp), [false, false, false, true, true]);
});

test("a host that is slow to start (no new report yet) is not counted as closing", () => {
  const auto = createAutoConnect({ maxTries: 2 });
  const same = closed();
  for (let i = 0; i < 20; i += 1) assert.equal(auto.next(true, same).gaveUp, false);
  assert.deepEqual(auto.next(true, closed()), { send: true, gaveUp: false }, "its first failure: one more launch");
  assert.deepEqual(auto.next(true, closed()), { send: false, gaveUp: true }, "its second failure: that was the last launch");
});

test("a host that is simply not installed yet is waited for without limit", () => {
  const auto = createAutoConnect({ maxTries: 2 });
  auto.next(true, { state: "stopped", ready: null, detail: null }); // the very first try, before anything is known
  for (let i = 0; i < 20; i += 1) assert.deepEqual(auto.next(true, { state: "not_installed", ready: null, detail: "not found" }), { send: true, gaveUp: false });
});

test("nothing is sent while the extension is missing, the host runs, or Chrome forbids the connection", () => {
  const auto = createAutoConnect();
  assert.deepEqual(auto.next(false, stopped), { send: false, gaveUp: false });
  assert.deepEqual(auto.next(true, { state: "running", ready: {}, detail: null }), { send: false, gaveUp: false });
  assert.deepEqual(auto.next(true, { state: "forbidden", ready: null, detail: "Access to the specified native messaging host is forbidden." }), { send: false, gaveUp: false });
});

test("reset (the start button, the host running, the extension coming back) gives the tries back", () => {
  const auto = createAutoConnect({ maxTries: 2 });
  auto.next(true, closed()); auto.next(true, closed());
  assert.equal(auto.next(true, closed()).gaveUp, true);
  auto.reset();
  assert.deepEqual(auto.next(true, closed()), { send: true, gaveUp: false });
  auto.next(true, closed());
  auto.next(true, { state: "running", ready: {}, detail: null }); // connected: the count starts over
  assert.deepEqual(auto.next(true, closed()), { send: true, gaveUp: false });
  assert.deepEqual(auto.next(true, closed()), { send: true, gaveUp: false });
  assert.equal(auto.next(true, closed()).gaveUp, true);
});

test("extensionNotice tells apart 'not found yet' from 'connection lost'", () => {
  assert.equal(extensionNotice({ detected: true, everDetected: true }), null);
  assert.match(extensionNotice({ detected: false, everDetected: false }), /還沒偵測到小編工具箱外掛/);
  const lost = extensionNotice({ detected: false, everDetected: true });
  assert.match(lost, /連線中斷/);
  assert.match(lost, /重新整理/);
});

test("hostNotice explains a lost host, a refused connection and a host that will not start", () => {
  const running = { state: "running", ready: {}, detail: null };
  const stoppedNow = { state: "stopped", ready: null, detail: null };
  assert.equal(hostNotice({ detected: false, status: stoppedNow, wasRunning: true, gaveUp: false }), null);
  assert.equal(hostNotice({ detected: true, status: running, wasRunning: true, gaveUp: false }), null);
  assert.equal(hostNotice({ detected: true, status: stoppedNow, wasRunning: false, gaveUp: false }), null, "not connected yet: the setup steps say what to do");
  const lost = hostNotice({ detected: true, status: stoppedNow, wasRunning: true, gaveUp: false });
  assert.equal(lost.kind, "info");
  assert.match(lost.text, /連線中斷/);
  const forbidden = hostNotice({ detected: true, status: { state: "forbidden", ready: null, detail: "x" }, wasRunning: false, gaveUp: false });
  assert.equal(forbidden.kind, "error");
  assert.equal(forbidden.text, FORBIDDEN_TEXT);
  assert.match(forbidden.text, /重新執行 YT 下載助手安裝檔/);
  const gave = hostNotice({ detected: true, status: stoppedNow, wasRunning: false, gaveUp: true });
  assert.equal(gave.kind, "error");
  assert.ok(gave.text.includes(REINSTALL_ACTION));
  assert.match(gave.text, /「啟動」/);
});

test("the reinstall action says what to do on each system and names the YT helper installer", () => {
  assert.match(REINSTALL_ACTION, /YT 下載助手安裝檔/);
  assert.match(REINSTALL_ACTION, /Mac/);
  assert.match(REINSTALL_ACTION, /Windows/);
});

test("while the helper is being updated, neither the lost extension nor the lost host is announced", () => {
  const stoppedNow = { state: "stopped", ready: null, detail: null };
  assert.equal(extensionNotice({ detected: false, everDetected: true, updating: true }), null);
  assert.equal(extensionNotice({ detected: false, everDetected: false, updating: true }), null);
  assert.equal(hostNotice({ detected: true, status: stoppedNow, wasRunning: true, gaveUp: false, updating: true }), null);
  assert.equal(hostNotice({ detected: true, status: stoppedNow, wasRunning: false, gaveUp: true, updating: true }), null);
  assert.match(extensionNotice({ detected: false, everDetected: true, updating: false }), /連線中斷/, "and they return afterwards");
});
