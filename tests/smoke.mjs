// jsdom smoke test for Drafting Desk v4 (boot, migration, home, editor, notes, offline What Next, finish, settings)
import { JSDOM } from "jsdom"; // optional: npm i --no-save jsdom (not a runtime dependency)
import fs from "node:fs";
import assert from "node:assert";

const ROOT = new URL("..", import.meta.url).pathname; // repo root (this file lives in tests/)
const html = fs.readFileSync(`${ROOT}/index.html`, "utf8");
const dom = new JSDOM(html, { url: "http://localhost:8931/", pretendToBeVisual: true });
const { window } = dom;

// expose browser globals to the module graph
for (const k of ["document", "localStorage", "sessionStorage", "navigator", "history", "location", "HTMLElement", "HTMLDialogElement", "Node", "CustomEvent", "HashChangeEvent", "Event"]) {
  try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true }); } catch { globalThis[k] = window[k]; }
}
globalThis.window = window;
window.document.execCommand = () => false; // exercise the fallback path
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
window.URL.createObjectURL = () => "blob:fake";
window.URL.revokeObjectURL = () => {};
const sample = JSON.parse(fs.readFileSync(`${ROOT}/samples/example.json`, "utf8"));
globalThis.fetch = async (url) => {
  if (String(url).includes("samples/example.json")) return { ok: true, json: async () => sample };
  throw new Error("network disabled in smoke test: " + url);
};

// seed a v3 library BEFORE boot to test migration
window.localStorage.setItem("dd.posts.v1", JSON.stringify({
  abc123: { v: 2, id: "abc123", title: "Migrated post", body: "Hello from v3.\n\nSecond paragraph here.", status: "Ready",
    notes: [{ kind: "source", title: "Ref", url: "https://example.com", text: "A fact." }], snapshots: [], voice: "", created: 1, updated: 2 },
}));

let step = 0;
const ok = (name, fn) => { fn(); step++; console.log("ok -", name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s, r = window.document) => r.querySelector(s);
const $$ = (s, r = window.document) => [...r.querySelectorAll(s)];

await import(`${ROOT}/js/app.js`);
await wait(150);

ok("boots to home with the start box", () => {
  assert.ok($(".startbox textarea"), "start textarea missing");
  assert.ok(document.body.textContent.includes("Your words. Your post."));
});
ok("v3 post migrated to per-post storage and listed", () => {
  const idx = JSON.parse(window.localStorage.getItem("dd2.index") || "[]");
  assert.equal(idx.length, 1);
  const post = JSON.parse(window.localStorage.getItem("dd2.post." + idx[0]));
  assert.equal(post.title, "Migrated post");
  assert.ok(post.finishedAt, "Ready status should become a finished stamp");
  assert.ok(post.notes[0].text.includes("https://example.com"), "source note flattened with its URL");
  assert.ok(document.body.textContent.includes("Migrated post"));
});

// start a new post from pasted rough notes
const startTa = $(".startbox textarea");
startTa.value = "First rough paragraph about config grammars and why they matter for small models.\n\nSecond rough paragraph with numbers: a 4090 costs 74 cents an hour and training took three hours total.";
$$("button").find((b) => b.textContent.includes("Start")).click();
await wait(50);
if (!$("#draft")) { window.dispatchEvent(new window.HashChangeEvent("hashchange")); await wait(50); }

ok("editor opens with the pasted text as the draft", () => {
  assert.ok($("#draft"), "draft textarea missing");
  assert.ok($("#draft").value.includes("config grammars"));
  assert.ok(document.body.textContent.includes("Split into Notes instead"), "split choice should be offered");
});
ok("notes column and footer tools exist", () => {
  assert.ok($("#notesCol"));
  assert.ok($$("button").some((b) => b.textContent.includes("What next")));
  assert.ok($$("button").some((b) => b.textContent === "Finish →"));
});

// typing updates word count and autosaves (per-post key only)
const draft = $("#draft");
draft.value += "\n\nA third paragraph written by typing in the editor just now.";
draft.dispatchEvent(new window.Event("input", { bubbles: true }));
await wait(650);
ok("autosave persists the edited body", () => {
  const cur = JSON.parse(window.localStorage.getItem("dd2.post." + window.location.hash.split("/").pop()));
  assert.ok(cur.body.includes("third paragraph"));
  assert.ok($("#wordCount").textContent.includes("words"));
});

// selection strip appears WITH NO MODEL, and Note works (the v3 gating bug, fixed)
draft.focus();
draft.setSelectionRange(0, 40);
draft.dispatchEvent(new window.Event("select", { bubbles: true }));
await wait(20);
ok("selection strip appears without a model and offers Note", () => {
  const strip = $("#selStrip");
  assert.ok(strip.classList.contains("on"), "strip not shown");
  assert.ok(strip.textContent.includes("Note"));
  assert.ok(strip.textContent.includes("Connect a model"), "should explain Fix/Clearer need a model");
});
$$("#selStrip button").find((b) => b.textContent === "Note").click();
await wait(30);
ok("Note saves the selection as a note with no model involved", () => {
  const id = window.location.hash.split("/").pop();
  const cur = JSON.parse(window.localStorage.getItem("dd2.post." + id));
  assert.ok(cur.notes.some((n) => n.text.includes("First rough paragraph")));
});

// What Next works offline from unused notes
const before = $$(".sugg").length;
$$("button").find((b) => b.textContent.includes("What next")).click();
await wait(30);
ok("What Next (offline) surfaces unused notes as a suggestion block", () => {
  assert.ok($$(".sugg").length > before, "no suggestion block appeared");
  assert.ok(document.body.textContent.toUpperCase().includes("WHAT NEXT"));
});

// Finish dialog: checks + preview render
$$("button").find((b) => b.textContent === "Finish →").click();
await wait(20);
ok("Finish dialog renders preview and checks", () => {
  assert.ok($("#finishDlg").open);
  assert.ok($("#finishPreview").innerHTML.includes("config grammars"));
  assert.ok($("#finishChecks").textContent.length > 0);
});
$("#finishDlg").close();

// Settings dialog: six providers, remember-keys default off
$$("button").find((b) => b.textContent === "Settings").click();
await wait(20);
ok("Settings lists all six providers, keys session-only by default", () => {
  assert.ok($("#settingsDlg").open);
  assert.equal($$("#providerConfig input[name=provider]").length, 6);
  assert.equal($("#rememberKeys").checked, false);
});

console.log(`\nSMOKE: ${step} checks passed`);
