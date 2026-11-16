import test from "node:test";
import assert from "node:assert/strict";
import { STEP_LABELS, connectSummary, detectOs, installerAdvice, installerPath, isDeployed, macInstallCommand, wizardSteps } from "../../tools/ytdl/web/setup-flow.js";

const running = (ready = {}) => ({ state: "running", ready: { ytdlpVersion: "2025.1.1", ffmpegOk: true, jsRuntimeOk: true, ...ready }, detail: null });
const stopped = { state: "stopped", ready: null, detail: null };

test("there are three steps: extension, installer, start", () => {
  assert.equal(STEP_LABELS.length, 3);
  assert.match(STEP_LABELS[0], /外掛/);
  assert.match(STEP_LABELS[1], /下載助手/);
});

test("the Mac command is the one in the protocol and points at the toolbox repository", () => {
  assert.equal(macInstallCommand(), "curl -fsSL https://raw.githubusercontent.com/unnn3ing-oss/socialmediaeditor/main/tools/ytdl/installers/ytdl-install-mac.sh | bash");
  assert.equal(installerPath("win"), "installers/ytdl-install-windows.cmd");
  assert.equal(installerPath("mac"), "installers/ytdl-install-mac.zip");
});

test("detectOs reads the platform, then the user agent", () => {
  assert.equal(detectOs({ platform: "MacIntel" }), "mac");
  assert.equal(detectOs({ userAgentData: { platform: "Windows" } }), "win");
  assert.equal(detectOs({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }), "mac");
  assert.equal(detectOs({ platform: "Linux x86_64", userAgent: "X11; Linux" }), "other");
  assert.equal(detectOs({}), "other");
});

test("nothing is done without the extension, and the first step is the one to do", () => {
  const out = wizardSteps({ detected: false, status: stopped, deployed: false });
  assert.deepEqual(out.states, ["now", "todo", "todo"]);
  assert.equal(out.suggested, 1);
  const pressed = wizardSteps({ detected: false, passedInstaller: true, status: stopped, deployed: false });
  assert.deepEqual(pressed.states, ["now", "todo", "todo"], "without the extension there is nothing to connect to");
});

test("with the extension but no helper yet, the installer is the step to do", () => {
  const out = wizardSteps({ detected: true, status: { state: "not_installed", ready: null, detail: "not found" }, deployed: false });
  assert.deepEqual(out.states, ["done", "now", "todo"]);
  assert.equal(out.suggested, 2);
});

test("a helper that exists (running, forbidden or stopped with a report) counts as installed; the button also counts", () => {
  assert.deepEqual(wizardSteps({ detected: true, status: stopped, deployed: false }).states, ["done", "now", "todo"], "no report at all: not known to be installed");
  assert.deepEqual(wizardSteps({ detected: true, passedInstaller: true, status: stopped, deployed: false }).states, ["done", "done", "now"]);
  assert.deepEqual(wizardSteps({ detected: true, status: { state: "stopped", ready: null, detail: "exited" }, deployed: false }).states, ["done", "done", "now"]);
  assert.deepEqual(wizardSteps({ detected: true, status: { state: "forbidden", ready: null, detail: "x" }, deployed: false }).states, ["done", "done", "now"]);
});

test("everything works: all done and the last step is shown", () => {
  const out = wizardSteps({ detected: true, status: running(), deployed: true });
  assert.deepEqual(out.states, ["done", "done", "done"]);
  assert.equal(out.suggested, 3);
});

test("isDeployed needs the extension, a current running helper and its three parts", () => {
  assert.equal(isDeployed({ detected: true, status: running(), hostOutdated: false }), true);
  assert.equal(isDeployed({ detected: false, status: running(), hostOutdated: false }), false);
  assert.equal(isDeployed({ detected: true, status: stopped, hostOutdated: false }), false);
  assert.equal(isDeployed({ detected: true, status: running(), hostOutdated: true }), false);
  assert.equal(isDeployed({ detected: true, status: running({ ytdlpVersion: null }), hostOutdated: false }), false);
  assert.equal(isDeployed({ detected: true, status: running({ ffmpegOk: false }), hostOutdated: false }), false);
  assert.equal(isDeployed({ detected: true, status: running({ jsRuntimeOk: false }), hostOutdated: false }), false);
});

test("the summary line says where it stands", () => {
  assert.deepEqual(connectSummary({ detected: true, deployed: true, status: running() }), { ok: true, text: "一切正常，已經連線" });
  assert.match(connectSummary({ detected: false, deployed: false, status: stopped }).text, /外掛/);
  assert.match(connectSummary({ detected: true, deployed: false, status: { state: "not_installed" } }).text, /還沒安裝下載助手/);
  assert.match(connectSummary({ detected: true, deployed: false, status: { state: "forbidden" } }).text, /不允許這個外掛/);
  assert.match(connectSummary({ detected: true, deployed: false, status: running({ ffmpegOk: false }) }).text, /檢查環境/);
  assert.match(connectSummary({ detected: true, deployed: false, status: stopped }).text, /「啟動」/);
  assert.equal(connectSummary({ detected: false, deployed: false, status: stopped }).ok, false);
});

test("the installer step explains not_installed and forbidden, and says nothing otherwise", () => {
  assert.match(installerAdvice({ state: "not_installed" }), /安裝檔/);
  const forbidden = installerAdvice({ state: "forbidden" });
  assert.match(forbidden, /不允許這個外掛/);
  assert.match(forbidden, /重新執行 YT 下載助手安裝檔/);
  assert.equal(installerAdvice(running()), null);
  assert.equal(installerAdvice(stopped), null);
});
