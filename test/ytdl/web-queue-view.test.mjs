import test from "node:test";
import assert from "node:assert/strict";
import { REINSTALL_ACTION } from "../../tools/ytdl/web/connection.js";
import { HOST_OUTDATED_TEXT, clearConfirmText, coverResultText, REMOVE_CONFIRM_TEXT, syncTextBox, thumbSource, renderAbortNote, renderClearButton, renderFormatPicker, renderHostNote } from "../../tools/ytdl/web/queue-view.js";

// just enough of an element for the note helpers: text and the hidden flag
const note = () => ({ textContent: "", hidden: true });

test("the old-host note names an action that always exists, never a button called 「更新」", () => {
  assert.ok(HOST_OUTDATED_TEXT.includes(REINSTALL_ACTION));
  assert.doesNotMatch(HOST_OUTDATED_TEXT, /按「更新」/);
  assert.doesNotMatch(HOST_OUTDATED_TEXT, /側邊面板|擴充功能資料夾/, "the toolbox page has neither");
});

test("renderHostNote shows the old-host note only while the host is outdated, with the update button as an extra when there is one", () => {
  const node = note();
  renderHostNote(node, { hostOutdated: false });
  assert.deepEqual([node.textContent, node.hidden], ["", true]);
  renderHostNote(node, { hostOutdated: true });
  assert.deepEqual([node.textContent, node.hidden], [HOST_OUTDATED_TEXT, false]);
  renderHostNote(node, { hostOutdated: true }, { updateAvailable: true });
  assert.ok(node.textContent.startsWith(HOST_OUTDATED_TEXT));
  assert.match(node.textContent, /「下載助手更新」.*「更新下載助手」/);
  renderHostNote(node, null);
  assert.deepEqual([node.textContent, node.hidden], ["", true]);
});

test("a note that did not change is not rewritten (it is a live region: rewriting repeats the announcement)", () => {
  let writes = 0;
  const node = { hidden: true, _text: "", get textContent() { return this._text; }, set textContent(value) { writes += 1; this._text = value; } };
  renderHostNote(node, { hostOutdated: true });
  renderHostNote(node, { hostOutdated: true });
  assert.equal(writes, 1);
});

const waitingRow = (uid, extra = {}) => ({ uid, id: `v${uid}`, status: "waiting", dupOf: null, ...extra });

test("renderAbortNote shows the host's reason and how many videos are still waiting", () => {
  const node = note();
  const aborted = { code: "too_many_failures", message: "連續 3 支影片失敗，已停止下載" };
  renderAbortNote(node, { aborted, items: [{ uid: 1, id: "a", status: "failed", dupOf: null }, waitingRow(2), waitingRow(3), waitingRow(4, { dupOf: 2 })] });
  assert.equal(node.hidden, false);
  assert.equal(node.textContent, "連續 3 支影片失敗，已停止下載。還有 2 支沒下載，仍在清單裡；處理好後再按「開始全部下載」。");
});

test("renderAbortNote has nothing to add about the rows when none are waiting, and hides when the job was not stopped", () => {
  const node = note();
  renderAbortNote(node, { aborted: { code: "disk_full", message: "磁碟已滿。" }, items: [] });
  assert.equal(node.textContent, "磁碟已滿。");
  renderAbortNote(node, { aborted: null, items: [waitingRow(1)] });
  assert.deepEqual([node.textContent, node.hidden], ["", true]);
  renderAbortNote(node, null);
  assert.deepEqual([node.textContent, node.hidden], ["", true]);
});

test("renderAbortNote does not repeat a sentence stop that the host already put at the end", () => {
  const node = note();
  renderAbortNote(node, { aborted: { code: "x", message: "已停止下載！" }, items: [waitingRow(1)] });
  assert.equal(node.textContent, "已停止下載！還有 1 支沒下載，仍在清單裡；處理好後再按「開始全部下載」。");
});

test("coverResultText says where the cover went, and why when it is not next to the video", () => {
  assert.equal(coverResultText({ ok: true, where: "folder" }), "已存到影片資料夾");
  assert.match(coverResultText({ ok: true, where: "downloads" }), /已存到下載資料夾（連線下載助手後可存到影片資料夾）/);
  const moved = coverResultText({ ok: true, where: "downloads", folderChanged: true });
  assert.match(moved, /下載資料夾/);
  assert.match(moved, /存放資料夾後來改過/);
  assert.doesNotMatch(moved, /連線下載助手/, "the program is connected: that is not why");
});

const row = (status, extra = {}) => ({ uid: 1, status, dupOf: null, ...extra });

test("the clear button shows only when everything is finished, and says so", () => {
  const button = { hidden: true, disabled: true, textContent: "" };
  renderClearButton(button, { items: [row("waiting")], running: false });
  assert.equal(button.hidden, true, "a waiting video keeps the list");
  renderClearButton(button, { items: [row("done"), row("skipped")], running: false });
  assert.deepEqual([button.hidden, button.disabled, button.textContent], [false, false, "清除全部"]);
  renderClearButton(button, { items: [row("done")], running: true });
  assert.equal(button.hidden, true, "never while a job runs");
  renderClearButton(button, { items: [], running: false });
  assert.equal(button.hidden, true, "nothing to clear");
  renderClearButton(button, null);
  assert.equal(button.hidden, true);
});

test("clearing asks first only when failed videos would lose their retry button", () => {
  assert.equal(clearConfirmText({ items: [row("done"), row("skipped")] }), null);
  assert.match(clearConfirmText({ items: [row("done"), row("failed"), row("failed", { uid: 3 })] }), /2 支失敗.*不能重試/);
});

// ---- the text box under a row ----
const box = () => ({ value: "", hidden: true, placeholder: "" });
const ready = (text) => ({ text, textState: "ready", textError: null });

test("syncTextBox is hidden unless the page wants it and the row has a video", () => {
  const b = box();
  syncTextBox(b, ready("【甲】"), false);
  assert.equal(b.hidden, true, "the side panel does not show it");
  syncTextBox(b, { text: null, textState: "none", textError: null }, true);
  assert.equal(b.hidden, true, "no video yet");
  syncTextBox(b, ready("【甲】\n\n#a #b #c"), true);
  assert.deepEqual([b.hidden, b.value], [false, "【甲】\n\n#a #b #c"]);
});

test("syncTextBox says what it waits for or why it failed instead of an empty box", () => {
  const b = box();
  syncTextBox(b, { text: null, textState: "loading", textError: null }, true);
  assert.deepEqual([b.hidden, b.value, b.placeholder], [false, "", "正在讀取影片說明欄…"]);
  syncTextBox(b, { text: null, textState: "failed", textError: "逾時" }, true);
  assert.match(b.placeholder, /無法取得說明欄：逾時/);
  assert.match(b.placeholder, /複製內文/);
});

test("syncTextBox follows the text, but never overwrites what the person typed into the box", () => {
  const b = box();
  syncTextBox(b, ready("【甲】\n\n#a"), true);
  syncTextBox(b, ready("【甲】\n\n#a #b"), true);
  assert.equal(b.value, "【甲】\n\n#a #b", "an untouched box follows the new text");
  b.value += "\n我加的一行";
  syncTextBox(b, ready("【甲】\n\n#a #b #c"), true);
  assert.equal(b.value, "【甲】\n\n#a #b\n我加的一行", "an edited box is left alone");
});

test("a row's small picture is YouTube's by id; an Instagram post, or a row without a video yet, has none", () => {
  assert.equal(thumbSource({ id: "abc", url: "https://youtu.be/abc" }), "https://i.ytimg.com/vi/abc/mqdefault.jpg");
  assert.equal(thumbSource({ id: "Dd8pP9yS3WB", url: "https://www.instagram.com/reel/Dd8pP9yS3WB/" }), null);
  assert.equal(thumbSource({ id: null, url: "https://youtu.be/abc" }), null);
});

// A group of radio buttons: the values it holds, and what the picker did to them.
const radioGroup = (...values) => ({ hidden: false, inputs: values.map((value) => ({ value, checked: false, disabled: false })),
  querySelectorAll() { return this.inputs; } });
const groupsOf = () => ({ mode: radioGroup("video", "audio"), quality: radioGroup("1080", "720"), audio: radioGroup("mp3", "aac") });
const checkedOf = (group) => group.inputs.filter((i) => i.checked).map((i) => i.value);

test("the format picker shows the options of the chosen kind and checks the saved ones", () => {
  const groups = groupsOf();
  renderFormatPicker(groups, { mode: "video", quality: 720, audioFormat: "aac" });
  assert.deepEqual([checkedOf(groups.mode), checkedOf(groups.quality), checkedOf(groups.audio)], [["video"], ["720"], ["aac"]]);
  assert.deepEqual([groups.mode.hidden, groups.quality.hidden, groups.audio.hidden], [false, false, true]);
  renderFormatPicker(groups, { mode: "audio", quality: 720, audioFormat: "aac" });
  assert.deepEqual([checkedOf(groups.mode), groups.quality.hidden, groups.audio.hidden], [["audio"], true, false]);
});

test("the format picker stays usable while a job runs and is switched off only without a connection", () => {
  const groups = groupsOf();
  const settings = { mode: "video", quality: 1080, audioFormat: "mp3" };
  const disabled = (group) => group.inputs.every((i) => i.disabled);
  renderFormatPicker(groups, settings);
  assert.deepEqual([disabled(groups.mode), disabled(groups.audio), disabled(groups.quality)], [false, false, false]);
  renderFormatPicker(groups, settings, { disabled: true });
  assert.deepEqual([disabled(groups.mode), disabled(groups.audio), disabled(groups.quality)], [true, true, true]);
});

// ---- removing one row asks first (inside the row): the button sits next to 「複製內文」 ----

test("the question on a row's X is the plain one", () => {
  assert.equal(REMOVE_CONFIRM_TEXT, "確認要移除影片嗎？");
});
