import * as store from "./store.js?v=__V__";
import { PROVIDERS, startOpenRouterLogin, finishOpenRouterLogin, isReady, listModels, complete, completeJSON, health } from "./providers.js?v=__V__";
import * as P from "./prompts.js?v=__V__";
import { renderMarkdown, postToMarkdown, slugify, wordCount, parseMarkdownPost } from "./markdown.js?v=__V__";
import { wordDiff, addedChars, changeCount, paraDiff } from "./diff.js?v=__V__";

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}
let toastTimer;
function toast(msg, { error = false, action = null, ms } = {}) {
  const t = $("#toast"), btn = $("#toastAction");
  $("#toastText").textContent = msg;
  t.className = "show" + (error ? " err" : "");
  btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = () => { action.run(); t.className = ""; }; }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), ms || (action ? 6000 : error ? 6000 : 2500));
}
function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function stamp(ms) {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function confirmAction(text, yes = "Delete") {
  const d = $("#confirmDlg");
  $("#confirmText").textContent = text;
  $("#confirmYes").textContent = yes;
  d.returnValue = "";
  d.showModal();
  return new Promise((res) => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}
function downloadText(filename, text, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyText(text, what = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(what); }
  catch { toast("Couldn't copy. Use Download instead.", { error: true }); }
}
const clip = (s, n = 140) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// ---------- routing: #/ (home) and #/p/<id> ----------
let current = null; // { post }
function flushSave() {
  if (saveTimer && current) { clearTimeout(saveTimer); saveTimer = null; store.savePost(current.post); }
}
function route() {
  flushSave();
  const t = $("#toast"); if (t) t.className = "";
  const m = location.hash.match(/^#\/p\/([0-9a-f]+)/);
  if (m) {
    const post = store.getPost(m[1]);
    if (!post) { location.hash = "#/"; return; }
    if (current?.post.id !== post.id) {
      if (current) liveCards.set(current.post.id, cards);
      cards = liveCards.get(post.id) || (post.cards || []).filter((c) => !c.pending && !c.error);
    }
    renderEditor(post);
  } else {
    current = null;
    renderHome();
  }
}
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", flushSave);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });

// ---------- top bar ----------
function modelButton() {
  const s = store.getSettings();
  const ready = isReady(s);
  const ok = ready && health.ok;
  return h("button", { class: "ghost model-btn" + (ready ? "" : " needs"), onclick: openSettings, title: ok ? "Choose the model the assistant uses" : ready ? `Last request failed: ${health.message}` : "Connect a model" },
    h("span", { class: "dot " + (ok ? "ok" : "warn") }),
    h("span", { class: "model-label" }, ready ? `${PROVIDERS[s.provider].label} · ${s.models[s.provider]}` : "Connect a model"));
}

// ---------- home ----------
let homeQuery = "", homeStatus = "All";
function backupNudge(posts) {
  const words = posts.reduce((n, p) => n + wordCount(p.body), 0);
  const last = store.getSettings().lastBackup || 0;
  if (words < 300 || Date.now() - last < 14 * 864e5) return null;
  return h("div", { class: "backup-nudge", role: "note" },
    h("span", {}, last ? `Last backup ${timeAgo(last)}.` : "Your posts are stored only in this browser.", " Clearing site data or switching computers would lose them."),
    h("button", { class: "ghost small", onclick: exportBackup }, "Back up now"));
}
function snippet(p) {
  const t = p.body.replace(/^#.*$/gm, "").replace(/[*_`>#\[\]]/g, "").replace(/\(https?:[^)]+\)/g, "").replace(/\s+/g, " ").trim();
  return t ? clip(t, 140) : (p.notes[0] ? clip("Note: " + p.notes[0].text, 140) : "");
}
function visiblePosts(posts) {
  const q = homeQuery.trim().toLowerCase();
  return posts.filter((p) => (homeStatus === "All" || p.status === homeStatus) && (!q || `${p.title} ${p.body}`.toLowerCase().includes(q)));
}
function renderHome() {
  document.title = "Drafting Desk";
  const posts = store.listPosts();
  app.replaceChildren(
    h("header", { class: "topbar" },
      h("a", { class: "brand", href: "#/" }, h("span", { class: "brand-mark", "aria-hidden": "true" }), "Drafting Desk"),
      h("div", { class: "topbar-actions" }, modelButton())),
    h("main", { class: "home" + (posts.length ? " returning" : "") },
      h("section", { class: "intro" },
        h("h1", {}, "Your words. Your post."),
        h("p", { class: "lede" }, "A desk for writing blog posts yourself. Keep notes and research beside the draft. When you want help, the assistant fixes grammar, shows you where a sentence is unclear, and asks the questions that get you unstuck. It doesn't write the post for you."),
        h("p", { class: "privacy" }, "Everything stays in this browser. The assistant is optional; when you use it, only the text you ask about goes to the model provider you pick."),
        h("div", { class: "row" },
          h("button", { class: "primary", onclick: openNewPost }, "New post"),
          h("button", { class: "ghost", onclick: loadSample }, "Open the example"))),
      h("form", { class: "capture", onsubmit: (e) => {
          e.preventDefault();
          const box = $("#ideaBox");
          const text = box.value.trim();
          if (!text) return;
          const first = text.split("\n")[0];
          const post = store.blankPost(clip(first.replace(/^#+\s*/, ""), 70));
          post.notes.push(store.blankNote("note", { text }));
          store.savePost(post);
          box.value = "";
          renderHome();
          toast("Idea saved", { action: { label: "Open", run: () => (location.hash = `#/p/${post.id}`) } });
        } },
        h("label", { for: "ideaBox", class: "capture-label" }, "Got an idea? Jot it down. It becomes a post you can come back to."),
        h("div", { class: "row nowrap" },
          h("input", { id: "ideaBox", placeholder: "e.g. Why config is a grammar problem, not a reasoning one", autocomplete: "off" }),
          h("button", { class: "ghost" }, "Save idea"))),
      backupNudge(posts),
      h("section", { class: "posts" },
        h("div", { class: "row between" },
          h("h2", {}, posts.length ? "Your posts" : "No posts yet"),
          h("div", { class: "row" },
            posts.length ? h("button", { class: "primary small", onclick: openNewPost }, "New post") : null,
            h("button", { class: "ghost small", onclick: () => $("#importFile").click() }, "Import"),
            posts.length ? h("button", { class: "ghost small", onclick: exportBackup }, "Back up all") : null)),
        posts.length > 4 ? h("div", { class: "row post-filters" },
          h("input", { type: "search", class: "note-search", placeholder: "Search posts", value: homeQuery, "aria-label": "Search posts",
            oninput: (e) => { homeQuery = e.target.value; renderHome(); setTimeout(() => { const i = document.querySelector(".post-filters input"); if (i) { i.focus(); i.selectionStart = i.selectionEnd = i.value.length; } }); } }),
          ["All", ...store.STATUSES].map((st) => h("button", { class: "filter" + (homeStatus === st ? " on" : ""), onclick: () => { homeStatus = st; renderHome(); } }, st))) : null,
        posts.length && !visiblePosts(posts).length ? h("p", { class: "hint" }, "No posts match.") : null,
        posts.length
          ? h("ul", { class: "post-list" }, visiblePosts(posts).map((p) => h("li", {},
              h("a", { href: `#/p/${p.id}`, class: "post-link" },
                h("span", { class: "post-title" }, p.title || "Untitled post"),
                snippet(p) ? h("span", { class: "post-snippet" }, snippet(p)) : null,
                h("span", { class: "post-meta" },
                  h("span", { class: "chip status-" + p.status.toLowerCase() }, p.status),
                  `${wordCount(p.body).toLocaleString()} words · ${p.notes.length} note${p.notes.length === 1 ? "" : "s"} · ${timeAgo(p.updated)}`)),
              h("button", { class: "icon-btn", "aria-label": `Delete ${p.title}`, title: "Delete",
                onclick: async () => { if (await confirmAction(`Delete "${p.title}" and all its notes and versions? This can't be undone.`)) { store.deletePost(p.id); renderHome(); } } }, "×"))))
          : h("p", { class: "hint" }, "Start a new post, or open the example to see how it works."))));
}
async function loadSample() {
  try {
    const res = await fetch("samples/model-prework.json");
    const post = store.importPost(await res.json());
    location.hash = `#/p/${post.id}`;
  } catch { toast("Couldn't load the example.", { error: true }); }
}
function exportBackup() {
  const st = store.getSettings(); st.lastBackup = Date.now(); store.saveSettings(st);
  document.querySelector(".backup-nudge")?.remove();
  downloadText(`drafting-desk-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll(), null, 2), "application/json");
}
$("#importFile").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  let n = 0;
  for (const f of files) {
    try {
      const text = await f.text();
      if (/\.json$/i.test(f.name) || /^\s*[{[]/.test(text)) {
        const data = JSON.parse(text);
        const posts = Array.isArray(data.posts) ? data.posts : [data];
        posts.forEach((p) => store.importPost(p));
        n += posts.length;
      } else {
        const fields = parseMarkdownPost(text, f.name);
        const post = store.blankPost(fields.title);
        Object.assign(post, { body: fields.body, description: fields.description, tags: fields.tags, status: wordCount(fields.body) > 30 ? "Drafting" : "Idea" });
        store.savePost(post);
        n++;
      }
    } catch (err) { toast(`${f.name}: ${err.message || "couldn't read it"}`, { error: true }); }
  }
  if (n) { toast(`Imported ${n} post${n === 1 ? "" : "s"}`); route(); }
});

// ---------- new post ----------
function openNewPost() {
  $("#newPostTitle").value = "";
  $("#newPostIdea").value = "";
  $("#newDlg").showModal();
}
$("#newClose").addEventListener("click", () => $("#newDlg").close());
$("#newForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = $("#newPostTitle").value.trim();
  if (!title) return;
  const post = store.blankPost(title);
  const idea = $("#newPostIdea").value.trim();
  if (idea) post.notes.push(store.blankNote("note", { text: idea }));
  store.savePost(post);
  $("#newDlg").close();
  location.hash = `#/p/${post.id}`;
});

// =====================================================================
// Editor
// =====================================================================
let saveTimer = null;
let cards = [];          // assistant results for the open post (newest first)
const liveCards = new Map(); // post id -> cards, so results still arriving survive navigation
let noteFilter = "all";
let noteQuery = "";
let lastSel = { start: 0, end: 0 };

const draft = () => $("#draft");

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveState("Saving…");
  saveTimer = setTimeout(() => {
    saveTimer = null;
    setSaveState(store.savePost(current.post) ? "Saved" : "Couldn't save: browser storage is full");
  }, 400);
}
function setSaveState(t) { const s = $("#saveState"); if (s) s.textContent = t; }

function autoVersion() {
  const p = current.post;
  const today = new Date().toDateString();
  const last = p.snapshots[p.snapshots.length - 1];
  if (p.body.trim() && (!last || new Date(last.at).toDateString() !== today)) {
    addSnapshot(`Start of ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
  }
}
function addSnapshot(label, body = current.post.body) {
  const p = current.post;
  const last = p.snapshots[p.snapshots.length - 1];
  if (!body.trim() || (last && last.body === body)) return false; // nothing new to keep
  p.snapshots.push({ id: store.newId(), at: Date.now(), label: label || "", body });
  if (p.snapshots.length > 60) p.snapshots.splice(0, p.snapshots.length - 60);
  return true;
}
let lastTimedVersion = 0;

function notesOpen() {
  const s = store.getSettings();
  if (window.matchMedia("(max-width: 1100px)").matches) return !!sessionNotesOpen;
  return !!s.notesOpen;
}
let sessionNotesOpen = false;
function renderEditor(post) {
  if (current?.post.id !== post.id) {
    const c = Math.min(Number.isFinite(post.cursor) ? post.cursor : post.body.length, post.body.length);
    lastSel = { start: c, end: c };
    // a version each time you open a post, so earlier sittings are always recoverable
    if (post.body.trim()) {
      const last = post.snapshots[post.snapshots.length - 1];
      if (!last || last.body !== post.body) { post.snapshots.push({ id: store.newId(), at: Date.now(), label: "When opened", body: post.body }); store.savePost(post); }
    }
    lastTimedVersion = Date.now();
  }
  current = { post, versionedToday: false };
  document.title = `${post.title} · Drafting Desk`;
  const s = { ...store.getSettings(), notesOpen: notesOpen() };

  const title = h("textarea", { class: "post-title-input", rows: "1", "aria-label": "Post title", placeholder: "Title",
    oninput: (e) => { post.title = e.target.value.replace(/\n/g, " "); document.title = `${post.title} · Drafting Desk`; growTitle(e.target); scheduleSave(); },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); draft().focus(); } } });
  title.value = post.title;

  const status = h("select", { class: "status-select", "aria-label": "Status", title: "Where this post is at", onchange: (e) => { post.status = e.target.value; scheduleSave(); } },
    store.STATUSES.map((st) => h("option", { value: st, selected: post.status === st }, st)));

  const ta = h("textarea", { id: "draft", class: "draft", spellcheck: "true", "aria-label": "Draft",
    placeholder: "Start writing. Use # for headings if you like. Everything you type here is yours; the assistant only suggests.",
    oninput: (e) => { hideSelBar(); onDraftInput(e); }, onkeydown: onDraftKey, onblur: () => setTimeout(hideSelBar, 150), onselect: rememberSel, onkeyup: rememberSel, onmouseup: rememberSel, onfocus: rememberSel });
  ta.value = post.body;

  const ready = isReady();
  const tool = (label, kbd, fn, title) => h("button", { class: "tool" + (ready ? "" : " needs-model"),
    title: ready ? `${title} (${MOD}+Alt+${kbd})` : "Connect a model to use the assistant", onmousedown: (e) => e.preventDefault(), onclick: fn }, label);

  app.replaceChildren(
    h("header", { class: "topbar" },
      h("div", { class: "row nowrap" },
        h("a", { class: "brand", href: "#/", title: "All posts" }, h("span", { class: "brand-mark", "aria-hidden": "true" }), h("span", { class: "brand-text" }, "Drafting Desk")),
        h("a", { class: "back-link", href: "#/" }, "← All posts")),
      h("div", { class: "topbar-actions" },
        h("button", { class: "ghost wide-only", id: "focusBtn", onclick: toggleFocus, title: "Hide side panels" }, "Focus"),
        h("button", { class: "ghost wide-only", onclick: openVersions }, "Versions"),
        h("button", { class: "ghost wide-only", onclick: openVoice, title: "Describe how you write, so suggestions sound like you" }, "Your voice"),
        h("button", { class: "ghost wide-only", onclick: openExport }, "Export"),
        h("details", { class: "more-menu narrow-only" },
          h("summary", { class: "ghost" }, "More"),
          h("div", { class: "more-list" },
            h("button", { onclick: (e) => { e.target.closest("details").open = false; openExport(); } }, "Export"),
            h("button", { onclick: (e) => { e.target.closest("details").open = false; openVersions(); } }, "Versions"),
            h("button", { onclick: (e) => { e.target.closest("details").open = false; openVoice(); } }, "Your voice"),
            h("button", { onclick: (e) => { e.target.closest("details").open = false; location.hash = "#/"; } }, "All posts"))),
        modelButton())),
    h("main", { class: "editor-main" },
    h("div", { class: "editor-head" },
      h("h1", { class: "sr-only" }, "Editing: ", post.title || "Untitled post"),
      title,
      h("div", { class: "meta-row" }, status,
        h("span", { id: "wordCount" }),
        h("label", { class: "goal", title: "Target length in words (optional)" }, "Goal",
          h("input", { type: "number", min: "0", step: "100", inputmode: "numeric", value: post.goal || "", placeholder: "—", "aria-label": "Word goal",
            oninput: (e) => { post.goal = Math.max(0, Number(e.target.value) || 0); updateStats(); scheduleSave(); } })), h("button", { id: "authorship", class: "link-btn plain", onclick: () => toast("Your words: roughly how much of the draft is your own wording. Accepted rewordings and outline headings lower it; grammar fixes don't.", { ms: 7000 }), title: "What does this mean?" }),
        h("button", { class: "ghost small", onclick: runTitles, title: "Title options built from phrases in your draft" }, "Title ideas"),
        h("span", { id: "saveState", class: "save-state" }, "Saved"))),
    h("div", { class: "workspace" + (s.notesOpen ? "" : " notes-closed"), id: "workspace" },
      notesPanel(),
      h("section", { class: "draft-col", "aria-label": "Draft" },
        h("div", { class: "toolbar", role: "toolbar", "aria-label": "Assistant tools" },
          h("button", { class: "ghost small notes-toggle", onclick: toggleNotes, "aria-expanded": String(!!s.notesOpen) }, s.notesOpen ? "Hide notes" : `Notes (${post.notes.length})`),
          h("div", { class: "tools" },
            tool("Fix grammar", "1", (e) => (e.shiftKey ? runGrammarAll() : runGrammar()), "Correct spelling and grammar in the selection or this paragraph. Shift-click for the whole draft"),
            tool("Make it clearer", "2", () => runClarify(), "See what a reader might trip on in this sentence, with clearer wordings to choose from"),
            tool("I'm stuck", "3", () => runPromptMe(), "Questions that help you think of what to say next"),
            tool("Review draft", "4", () => runReview(), "An editor's notes on the whole draft, highlighted in your text")),
          h("select", { id: "contents", class: "contents", "aria-label": "Jump to section", hidden: true, onchange: (e) => {
            const i = Number(e.target.value); e.target.selectedIndex = 0;
            if (i >= 0) { const line = current.post.body.indexOf("\n", i); selectInDraft(i, line < 0 ? current.post.body.length : line); }
          } }),
          h("span", { class: "scope", id: "scope" })),
        guideStrip(),
        h("div", { class: "draft-wrap" }, h("div", { class: "draft backdrop", id: "backdrop", "aria-hidden": "true" }), ta, selectionBar())),
      assistantPanel())));
  autogrow();
  growTitle($(".post-title-input"));
  updateStats();
  updateScope();
  updateContents();
  renderCards();
  if (!post.body) ta.focus();
  else {
    ta.setSelectionRange(lastSel.start, lastSel.end);
    if (!window.matchMedia("(pointer: coarse)").matches) { ta.focus({ preventScroll: true }); requestAnimationFrame(() => keepCaretVisible(true)); }
  }
}

function growTitle(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}
function guideStrip() {
  const s = store.getSettings();
  if (s.guideDone) return null;
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  const el = h("details", { class: "guide", id: "guide", open: !narrow }, h("summary", { class: "guide-summary" }, "How this works"), h("ol", {},
    h("li", {}, h("strong", {}, "Write"), " in your own words. Rough is fine; nothing is sent anywhere while you type."),
    h("li", {}, h("strong", {}, "Stuck?"), " Press ", h("em", {}, "I'm stuck"), " for questions that get you going."),
    h("li", {}, h("strong", {}, "Select a sentence"), " to fix its grammar or make it clearer. You approve every change."),
    h("li", {}, h("strong", {}, "Finished a draft?"), " ", h("em", {}, "Review draft"), " gives you an editor's notes, highlighted in your text.")),
    h("button", { class: "link-btn guide-close", onclick: () => { const st = store.getSettings(); st.guideDone = true; store.saveSettings(st); el.remove(); autogrow(); } }, "Got it"));
  return el;
}

// ---------- floating tools next to a selection ----------
function selectionBar() {
  const stop = (e) => e.preventDefault();
  return h("div", { class: "sel-bar", id: "selBar", hidden: true, role: "toolbar", "aria-label": "Help with the selected text" },
    h("button", { onmousedown: stop, onclick: () => { hideSelBar(); runGrammar(); } }, "Fix grammar"),
    h("button", { onmousedown: stop, onclick: () => { hideSelBar(); runClarify(); } }, "Make it clearer"),
    h("button", { onmousedown: stop, onclick: () => { hideSelBar(); askAboutSelection(); } }, "Ask about this"));
}
let dismissedSel = "";
function hideSelBar() {
  const b = $("#selBar");
  if (b) b.hidden = true;
  dismissedSel = `${lastSel.start}:${lastSel.end}`;
}
function updateSelBar() {
  const bar = $("#selBar"), ta = draft();
  if (!bar || !ta) return;
  const { start, end } = lastSel;
  const text = ta.value.slice(start, end);
  const small = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches;
  if (small || end - start < 3 || !text.trim() || document.activeElement !== ta || !isReady() || dismissedSel === `${start}:${end}`) { bar.hidden = true; return; }
  const pos = caretPoint(ta, start);
  bar.hidden = false;
  const w = bar.offsetWidth;
  const left = Math.max(8, Math.min(pos.left - 12, ta.clientWidth - w - 8));
  const top = pos.top - bar.offsetHeight - 8;
  bar.style.left = left + "px";
  bar.style.top = (top < 4 ? caretPoint(ta, end).top + pos.lh + 6 : top) + "px";
}
function askAboutSelection() {
  const { start, end } = lastSel;
  const quote = current.post.body.slice(start, end).trim();
  const box = $("#askBox");
  box.value = `About "${clip(quote, 300)}": `;
  box.focus();
  box.selectionStart = box.selectionEnd = box.value.length;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function onDraftInput(e) {
  const p = current.post;
  if (!current.versionedToday) { autoVersion(); current.versionedToday = true; }
  // keep what was there before any big deletion, and a version every 20 minutes of writing
  const removed = p.body.length - e.target.value.length;
  if (removed > 200) { addSnapshot("Before deleting " + removed.toLocaleString() + " characters", p.body); toast("The deleted text is kept in Versions", { action: { label: "Versions", run: openVersions } }); }
  else if (Date.now() - lastTimedVersion > 20 * 60e3 && p.body.trim()) { addSnapshot("While writing"); lastTimedVersion = Date.now(); }
  p.body = e.target.value;
  if (p.status === "Idea" && wordCount(p.body) > 30) { p.status = "Drafting"; const sel = $(".status-select"); if (sel) sel.value = "Drafting"; }
  autogrow(false);
  keepCaretVisible();
  updateHighlights();
  clearTimeout(cardsTimer);
  if (cards.some((c) => !c.done && (c.kind === "grammar" || c.kind === "clarify"))) cardsTimer = setTimeout(renderCards, 600);
  clearTimeout(shrinkTimer);
  shrinkTimer = setTimeout(() => autogrow(true), 800);
  updateStats();
  updateContents();
  scheduleSave();
}
function onDraftKey(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.altKey && ["1", "2", "3", "4"].includes(e.code.replace("Digit", ""))) {
    e.preventDefault();
    const k = e.code.replace("Digit", "");
    if (k === "1" && e.shiftKey) runGrammarAll();
    else ({ 1: runGrammar, 2: runClarify, 3: runPromptMe, 4: runReview })[k]();
  }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); flushSave(); setSaveState("Saved"); }
  if (e.altKey && e.key === "Enter") {
    const c = cards.find((x, i) => !x.pending && !x.error && !x.done && !isCollapsed(x, i) && ((x.kind === "grammar" && x.result !== x.original && x.original) || (x.kind === "clarify" && x.result?.options?.length)));
    if (c) { e.preventDefault(); acceptText(c, c.kind === "grammar" ? c.result : c.result.options[0].text); if (c.kind === "clarify") c.chosen = 0; }
  }
  if (mod && !e.altKey && !e.shiftKey && ["b", "i", "k"].includes(e.key.toLowerCase())) {
    e.preventDefault();
    const ta = e.target, s0 = ta.selectionStart, s1 = ta.selectionEnd, sel = ta.value.slice(s0, s1);
    const k = e.key.toLowerCase();
    if (k === "k") {
      const text = sel || "link text";
      replaceRange(s0, s1, `[${text}](https://)`);
      const urlStart = s0 + text.length + 3;
      ta.setSelectionRange(urlStart, urlStart + 8);
    } else {
      const mark = k === "b" ? "**" : "*";
      if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length > mark.length * 2) replaceRange(s0, s1, sel.slice(mark.length, -mark.length));
      else { replaceRange(s0, s1, mark + sel + mark); if (!sel) ta.setSelectionRange(s0 + mark.length, s0 + mark.length); else ta.setSelectionRange(s0, s1 + mark.length * 2); }
    }
    rememberSel();
  }
}
function rememberSel() {
  const ta = draft();
  if (!ta) return;
  lastSel = { start: ta.selectionStart, end: ta.selectionEnd };
  if (current) current.post.cursor = ta.selectionEnd;
  updateScope();
  updateSelBar();
}
function autogrow(full = true) {
  const ta = draft();
  if (!ta) return;
  const min = window.innerHeight * 0.6;
  if (!full) {
    // while typing, only grow: no collapse, so the page never jumps
    if (ta.scrollHeight > ta.clientHeight) { ta.style.height = ta.scrollHeight + 4 + "px"; const bd = $("#backdrop"); if (bd) bd.style.height = ta.style.height; }
    return;
  }
  const y = window.scrollY;
  ta.style.height = "auto";
  ta.style.height = Math.max(ta.scrollHeight + 4, min) + "px";
  const bd = $("#backdrop");
  if (bd) bd.style.height = ta.style.height;
  window.scrollTo(0, y);
}
let shrinkTimer, cardsTimer;
let caretFrame = 0;
/** The draft grows instead of scrolling, so keep the line being typed on screen ourselves. */
function keepCaretVisible(center = false) {
  cancelAnimationFrame(caretFrame);
  caretFrame = requestAnimationFrame(() => {
    const ta = draft();
    if (!ta || document.activeElement !== ta) return;
    const top = caretOffset(ta, ta.selectionEnd);
    const y = ta.getBoundingClientRect().top + top;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 30;
    if (center) { if (y > window.innerHeight * 0.7 || y < 0) window.scrollBy(0, y - window.innerHeight / 2); return; }
    const bottomRoom = window.innerHeight - 48;
    if (y + lh > bottomRoom) window.scrollBy(0, y + lh - bottomRoom);
    else if (y < 64) window.scrollBy(0, y - 64);
  });
}
function caretPoint(ta, index) {
  const cs = getComputedStyle(ta);
  const mirror = h("div", { class: "draft mirror" });
  mirror.style.width = ta.clientWidth + "px";
  mirror.style.font = cs.font;
  mirror.style.padding = cs.padding;
  mirror.style.lineHeight = cs.lineHeight;
  mirror.textContent = ta.value.slice(0, index);
  const mark = h("span", {}, "\u200b");
  mirror.append(mark);
  document.body.append(mirror);
  const p = { top: mark.offsetTop, left: mark.offsetLeft, lh: parseFloat(cs.lineHeight) || 30 };
  mirror.remove();
  return p;
}
function caretOffset(ta, index) {
  const cs = getComputedStyle(ta);
  const mirror = h("div", { class: "draft mirror" });
  mirror.style.width = ta.clientWidth + "px";
  mirror.style.font = cs.font;
  mirror.style.padding = cs.padding;
  mirror.style.lineHeight = cs.lineHeight;
  mirror.style.letterSpacing = cs.letterSpacing;
  mirror.textContent = ta.value.slice(0, index);
  const mark = h("span", {}, "\u200b");
  mirror.append(mark);
  document.body.append(mirror);
  const top = mark.offsetTop;
  mirror.remove();
  return top;
}
window.addEventListener("resize", () => { autogrow(); hideSelBar(); });

/** Find a quoted passage even if the model changed quotes, spacing or case slightly. */
function findQuote(body, quote) {
  if (!quote) return null;
  let i = body.indexOf(quote);
  if (i >= 0) return { start: i, end: i + quote.length };
  const norm = (t) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").toLowerCase();
  // map normalized positions back to the original
  const map = [];
  let nb = "";
  for (let k = 0; k < body.length; k++) {
    const ch = norm(body[k]);
    if (ch === " " && nb.endsWith(" ")) continue;
    nb += ch; map.push(k);
  }
  const nq = norm(quote).trim();
  i = nb.indexOf(nq);
  if (i >= 0) return { start: map[i], end: map[i + nq.length - 1] + 1 };
  // last resort: the first few words
  const head = nq.split(" ").slice(0, 6).join(" ");
  if (head.length >= 20) { i = nb.indexOf(head); if (i >= 0) return { start: map[i], end: map[i + head.length - 1] + 1 }; }
  return null;
}
let hlFrame = 0;
/** Mirror the draft behind the textarea and mark passages the assistant has notes on. */
function updateHighlights() {
  cancelAnimationFrame(hlFrame);
  hlFrame = requestAnimationFrame(() => {
    const bd = $("#backdrop"), ta = draft();
    if (!bd || !ta) return;
    const text = current.post.body;
    const ranges = [];
    for (const c of cards) {
      if (c.pending || c.error) continue;
      if (c.kind === "review") (c.result || []).forEach((r, i) => {
        if (c.checked?.[i]) return;
        const at = findQuote(text, r.quote);
        if (at) ranges.push({ ...at, cls: "hl-review" });
      });
      if ((c.kind === "grammar" || c.kind === "clarify") && !c.done && c.original && c.result !== c.original && !isCollapsed(c, cards.indexOf(c))) {
        const r = locate(c);
        if (r) ranges.push({ ...r, cls: "hl-suggest" });
      }
    }
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // split into segments so overlapping highlights layer instead of hiding each other
    const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort((x, y) => x - y);
    let html = "";
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], z = cuts[i + 1];
      const cls = [...new Set(ranges.filter((r) => r.start <= a && r.end >= z).map((r) => r.cls))].join(" ");
      html += cls ? `<mark class="${cls}">${esc(text.slice(a, z))}</mark>` : esc(text.slice(a, z));
    }
    html += "\n";
    bd.innerHTML = html;
    bd.style.height = ta.style.height;
  });
}
function updateContents() {
  const sel = $("#contents");
  if (!sel) return;
  const heads = [...current.post.body.matchAll(/^(#{1,4})\s+(.+)$/gm)];
  sel.hidden = heads.length < 2;
  const sig = heads.map((m) => m.index + m[0]).join("|");
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  sel.replaceChildren(h("option", { value: "-1" }, "Jump to…"),
    ...heads.map((m) => h("option", { value: String(m.index) }, (m[1].length > 2 ? "  ".repeat(m[1].length - 2) : "") + clip(m[2], 48))));
}
function updateStats() {
  const p = current.post;
  const words = wordCount(p.body);
  const wc = $("#wordCount");
  if (wc) {
    wc.textContent = p.goal ? `${words.toLocaleString()} / ${p.goal.toLocaleString()} words` : `${words.toLocaleString()} words`;
    if (words) wc.textContent += ` · ${Math.max(1, Math.round(words / 230))} min read`;
    wc.classList.toggle("ok-text", !!p.goal && words >= p.goal);
  }
  const chars = p.body.replace(/\s+/g, "").length;
  const mine = chars ? Math.max(0, Math.min(100, Math.round(100 * (1 - p.aiChars / chars)))) : 100;
  const a = $("#authorship");
  if (a) { a.textContent = chars ? `${mine}% your words` : ""; a.className = "link-btn plain" + (mine < 80 ? " warn-text" : ""); }
}

// ---------- scope: what the assistant will act on ----------
function paragraphAt(text, pos) {
  let start = text.lastIndexOf("\n\n", Math.max(0, pos - 1));
  start = start < 0 ? 0 : start + 2;
  let end = text.indexOf("\n\n", pos);
  end = end < 0 ? text.length : end;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}
function sentenceAt(text, pos) {
  const para = paragraphAt(text, pos);
  const chunk = text.slice(para.start, para.end);
  const re = /[^.!?]+(?:[.!?]+["')\]]*\s*|$)/g;
  let m;
  while ((m = re.exec(chunk))) {
    const s = para.start + m.index, e = s + m[0].length;
    if (pos >= s && pos <= e) {
      let st = s, en = e;
      while (st < en && /\s/.test(text[st])) st++;
      while (en > st && /\s/.test(text[en - 1])) en--;
      return { start: st, end: en };
    }
    if (!m[0]) break;
  }
  return para;
}
function getScope(kind) {
  const text = current.post.body;
  let { start, end } = lastSel;
  if (end > start) {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end, label: "selection" };
  }
  const r = kind === "clarify" ? sentenceAt(text, start) : paragraphAt(text, start);
  return { ...r, label: kind === "clarify" ? "sentence" : "paragraph" };
}
function updateScope() {
  const el = $("#scope");
  if (!el || !current) return;
  const { start, end } = lastSel;
  const n = end > start ? wordCount(current.post.body.slice(start, end)) : 0;
  el.textContent = n ? `Acts on your selection (${n} words)` : current.post.body.trim() ? "Acts on the paragraph your cursor is in" : "";
}
function locate(card) {
  const body = current.post.body;
  if (body.slice(card.start, card.end) === card.original) return { start: card.start, end: card.end };
  const i = body.indexOf(card.original);
  if (i >= 0 && body.indexOf(card.original, i + 1) < 0) return { start: i, end: i + card.original.length };
  return null;
}
/** Replace a range in the draft keeping the browser's own Undo working. */
function replaceRange(start, end, text) {
  const ta = draft();
  ta.focus();
  ta.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand("insertText", false, text); } catch {}
  if (!ok || ta.value.slice(start, start + text.length) !== text) ta.setRangeText(text, start, end, "end");
  current.post.body = ta.value;
  lastSel = { start: start + text.length, end: start + text.length };
  autogrow(); updateStats(); updateHighlights(); scheduleSave();
}
function selectInDraft(start, end) {
  const ta = draft();
  ta.focus();
  ta.setSelectionRange(start, end);
  lastSel = { start, end };
  updateScope();
  const top = caretOffset(ta, start);
  const y = ta.getBoundingClientRect().top + window.scrollY + top - window.innerHeight / 3;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

// ---------- notes & research panel ----------
function notesPanel() {
  return h("aside", { class: "notes-col", id: "notesCol", "aria-label": "Notes and research" },
    h("div", { class: "panel-head" }, h("h2", {}, "Notes & research"),
      h("button", { class: "ghost small", onclick: runOutline, title: "Suggest section headings built only from your notes" }, "Suggest outline")),
    h("div", { class: "note-add" },
      h("textarea", { id: "newNote", rows: "3", placeholder: `Jot a thought, a fact, a line you might use… (${MOD}+Enter to add)`,
        onkeydown: (e) => { if ((isMac ? e.metaKey : e.ctrlKey) && e.key === "Enter") { e.preventDefault(); addNoteFromBox(); } } }),
      h("div", { class: "row between" },
        h("button", { class: "ghost small", onclick: () => { const f = $("#sourceForm"); f.hidden = !f.hidden; if (!f.hidden) $("#srcUrl").focus(); } }, "+ Source"),
        h("button", { class: "primary small", onclick: addNoteFromBox }, "Add note")),
      h("div", { id: "sourceForm", class: "source-form", hidden: true },
        h("input", { id: "srcUrl", type: "url", placeholder: "https://… (link to the source)" }),
        h("input", { id: "srcTitle", placeholder: "Title" }),
        h("textarea", { id: "srcText", rows: "4", placeholder: "Key facts in your own words, or paste an excerpt and summarize it" }),
        h("div", { class: "row between" },
          h("button", { class: "ghost small", id: "srcSummarize", onclick: summarizeSource, title: "Turn a pasted excerpt into short factual bullets" }, "Summarize excerpt"),
          h("div", { class: "row" },
            h("button", { class: "ghost small", onclick: () => { $("#sourceForm").hidden = true; } }, "Cancel"),
            h("button", { class: "primary small", onclick: addSource }, "Save source"))))),
    h("div", { class: "note-filters", role: "group", "aria-label": "Filter notes" },
      ["all", "note", "source", "question"].map((k) => h("button", { class: "filter" + (noteFilter === k ? " on" : ""), "aria-pressed": String(noteFilter === k),
        onclick: () => { noteFilter = k; renderNotes(); } }, { all: "All", note: "Notes", source: "Sources", question: "Questions" }[k])),
      h("input", { class: "note-search", type: "search", placeholder: "Search", value: noteQuery, "aria-label": "Search notes", oninput: (e) => { noteQuery = e.target.value; renderNotes(); } })),
    h("ul", { class: "notes", id: "noteList" }, noteItems()));
}
function noteItems() {
  const p = current.post;
  const q = noteQuery.trim().toLowerCase();
  const list = p.notes.filter((n) => (noteFilter === "all" || n.kind === noteFilter) && (!q || `${n.title} ${n.text} ${n.url}`.toLowerCase().includes(q)));
  if (!list.length) return [h("li", { class: "empty" }, p.notes.length ? "Nothing matches." : "Notes, sources and questions you save will collect here.")];
  return list.slice().reverse().map((n) => h("li", { class: "note " + n.kind, "data-id": n.id },
    n.kind !== "note" ? h("span", { class: "chip" }, n.kind === "source" ? "Source" : "Question") : null,
    n.kind === "source" && (n.title || n.url) ? h("div", { class: "note-title" }, n.url ? h("a", { href: n.url, target: "_blank", rel: "noopener noreferrer" }, n.title || n.url) : n.title) : null,
    h("div", { class: "note-text", contenteditable: "true", spellcheck: "true", "aria-label": "Edit note", title: "Click to edit",
      onblur: (e) => { const t = e.target.innerText.trim(); if (t !== n.text) { n.text = t; scheduleSave(); } } }, n.text),
    h("div", { class: "note-actions" },
      n.kind === "note" ? h("button", { class: "link-btn", onmousedown: (e) => e.preventDefault(), onclick: () => insertAtCursor(n.text), title: "Insert this note's text at your cursor in the draft" }, "Insert") : null,
      n.kind === "question" ? h("button", { class: "link-btn", onmousedown: (e) => e.preventDefault(), onclick: () => answerQuestion(n.text), title: "Start a new paragraph in the draft to answer this" }, "Answer in draft") : null,
      n.kind === "source" && n.url ? h("button", { class: "link-btn", onmousedown: (e) => e.preventDefault(), onclick: () => insertLink(n), title: "Link the selected words to this source, or insert the source's title as a link" }, "Insert link") : null,
      h("span", { class: "note-date" }, timeAgo(n.created)),
      h("button", { class: "link-btn danger", onclick: () => { removeNote(n.id); } }, "Delete"))));
}
function renderNotes() {
  const list = $("#noteList");
  if (list) list.replaceChildren(...noteItems());
  document.querySelectorAll(".note-filters .filter").forEach((b, i) => {
    const k = ["all", "note", "source", "question"][i];
    b.classList.toggle("on", k === noteFilter);
    b.setAttribute("aria-pressed", String(k === noteFilter));
  });
}
function addNote(note) {
  current.post.notes.push(note);
  scheduleSave();
  renderNotes();
  const b = $(".notes-toggle");
  if (b && !notesOpen()) b.textContent = `Notes (${current.post.notes.length})`;
}
function removeNote(id) {
  const p = current.post;
  const i = p.notes.findIndex((n) => n.id === id);
  if (i < 0) return;
  const [gone] = p.notes.splice(i, 1);
  scheduleSave();
  renderNotes();
  toast("Note deleted", { action: { label: "Undo", run: () => { p.notes.splice(i, 0, gone); scheduleSave(); renderNotes(); } } });
}
function addNoteFromBox() {
  const box = $("#newNote");
  const text = box.value.trim();
  if (!text) { box.focus(); return; }
  addNote(store.blankNote("note", { text }));
  box.value = "";
  box.focus();
}
function addSource() {
  const url = $("#srcUrl").value.trim(), title = $("#srcTitle").value.trim(), text = $("#srcText").value.trim();
  if (!url && !text) { $("#srcUrl").focus(); return; }
  addNote(store.blankNote("source", { url, title, text }));
  $("#srcUrl").value = $("#srcTitle").value = $("#srcText").value = "";
  $("#sourceForm").hidden = true;
}
async function summarizeSource() {
  const text = $("#srcText").value.trim();
  if (wordCount(text) < 40) { toast("Paste a longer excerpt (40+ words) to summarize."); return; }
  if (!requireModel()) return;
  const btn = $("#srcSummarize");
  btn.disabled = true; btn.textContent = "Summarizing…";
  try {
    const out = await complete({ ...P.summarizeSourcePrompt({ url: $("#srcUrl").value, title: $("#srcTitle").value, text }), maxTokens: 700, onText: (t) => ($("#srcText").value = t) });
    $("#srcText").value = out.trim();
  } catch (e) { $("#srcText").value = text; toast(e.message, { error: true }); }
  finally { btn.disabled = false; btn.textContent = "Summarize excerpt"; }
}
function answerQuestion(q) {
  const ta = draft();
  const text = ta.value;
  // go to the end of the paragraph the cursor is in, then open a fresh one
  let at = text.indexOf("\n\n", lastSel.end);
  at = at < 0 ? text.length : at;
  const before = text.slice(0, at).replace(/\s+$/, "");
  const lead = before ? "\n\n" : "";
  replaceRange(before.length, at, lead);
  const pos = before.length + lead.length;
  ta.setSelectionRange(pos, pos);
  lastSel = { start: pos, end: pos };
  showAnswering(q);
}
function showAnswering(q) {
  $("#answering")?.remove();
  const bar = h("div", { class: "answering", id: "answering", role: "status" },
    h("span", {}, h("strong", {}, "Answering: "), q),
    h("button", { class: "link-btn", onclick: () => bar.remove() }, "Done"));
  $(".draft-wrap").before(bar);
  draft().focus();
}
function insertLink(n) {
  const ta = draft();
  const { start, end } = lastSel;
  const chosen = ta.value.slice(start, end).trim();
  if (chosen) replaceRange(start, end, `[${chosen}](${n.url})`);
  else insertAtCursor(`[${n.title || n.url}](${n.url})`);
}
function insertAtCursor(text) {
  const ta = draft();
  const { start, end } = lastSel;
  const before = ta.value.slice(0, start);
  const pad = before && !/\s$/.test(before) ? " " : "";
  replaceRange(start, end, pad + text);
}
function toggleNotes() {
  const open = !notesOpen();
  if (window.matchMedia("(max-width: 1100px)").matches) sessionNotesOpen = open;
  else { const s = store.getSettings(); s.notesOpen = open; store.saveSettings(s); }
  $("#workspace").classList.toggle("notes-closed", !open);
  const b = $(".notes-toggle");
  b.textContent = open ? "Hide notes" : `Notes (${current.post.notes.length})`;
  b.setAttribute("aria-expanded", String(open));
  autogrow();
}
function toggleFocus() {
  const on = document.body.classList.toggle("focus");
  $("#focusBtn").textContent = on ? "Exit focus" : "Focus";
  autogrow();
  draft().focus();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("focus") && !document.querySelector("dialog[open]")) toggleFocus(); });

// ---------- assistant panel ----------
function assistantPanel() {
  return h("aside", { class: "assist-col", "aria-label": "Assistant" },
    h("div", { class: "panel-head" }, h("h2", {}, "Assistant"),
      h("button", { class: "ghost small", id: "clearCards", onclick: () => { cards = []; renderCards(); persistCards(); } }, "Clear")),
    h("form", { class: "ask-form", onsubmit: (e) => { e.preventDefault(); runAsk(); } },
      h("textarea", { id: "askBox", rows: "2", placeholder: "Ask about your draft… e.g. Does my intro earn the main claim?", "aria-label": "Ask the assistant about your draft",
        onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runAsk(); } } }),
      h("button", { class: "ghost small" }, "Ask")),
    h("div", { id: "cards", class: "cards", "aria-live": "polite" }));
}
function assistIntro() {
  return h("div", { class: "assist-intro" },
    h("p", {}, "You write; I suggest. Nothing changes in your draft unless you accept it."),
    h("dl", {},
      h("dt", {}, "Fix grammar"), h("dd", {}, "Spelling, grammar and punctuation only. You see every change before accepting."),
      h("dt", {}, "Make it clearer"), h("dd", {}, "What a reader might trip on, with wordings close to yours to pick from."),
      h("dt", {}, "I'm stuck"), h("dd", {}, "Questions that get you thinking. You answer them in your own words."),
      h("dt", {}, "Review draft"), h("dd", {}, "An editor's notes on the whole draft, highlighted in your text.")),
    h("p", { class: "hint" }, `Tip: select some text and the tools appear right next to it. Shortcuts: ${MOD}+Alt+1 to 4.`),
    isReady() ? null : h("button", { class: "primary small", onclick: openSettings }, "Connect a model"));
}
function renderCards() {
  updateHighlights();
  const box = $("#cards");
  if (!box) return;
  $("#clearCards").hidden = !cards.length;
  box.replaceChildren(...(cards.length ? cards.map((c, i) => (isCollapsed(c, i) ? cardSummary(c) : cardView(c))) : [assistIntro()]));
}
function persistCards(postId = current?.post.id) {
  if (!postId) return;
  const list = current && postId === current.post.id ? cards : liveCards.get(postId);
  if (!list) return;
  // keep finished results with their post (minus live controllers), newest 20
  const saved = list.filter((c) => !c.pending && !c.error && c.result != null).slice(0, 20)
    .map(({ ctl, progress, retry, ...rest }) => rest);
  if (current && postId === current.post.id) { current.post.cards = saved; scheduleSave(); }
  else { const p = store.getPost(postId); if (p) { p.cards = saved; store.savePost(p); } }
}
function addCard(card) {
  card.id = store.newId();
  card.postId = current.post.id;
  card.at = Date.now();
  cards.unshift(card);
  if (cards.length > 25) cards.length = 25;
  renderCards();
  return card;
}
function updateCard(card, patch) {
  Object.assign(card, patch);
  const here = current && (!card.postId || card.postId === current.post.id);
  if (here) renderCards();
  else if (!card.pending && !card.error) toast(`${KIND_LABEL[card.kind]} is ready in "${clip(store.getPost(card.postId)?.title || "another post", 40)}"`, { action: { label: "Open", run: () => (location.hash = `#/p/${card.postId}`) } });
  if (!card.pending) persistCards(card.postId || current?.post.id);
}
function dropCard(card) {
  cards = cards.filter((c) => c !== card);
  renderCards();
  persistCards();
}
function requireModel() {
  if (isReady()) return true;
  toast("Connect a model to use the assistant.", { action: { label: "Connect", run: openSettings } });
  return false;
}
const KIND_LABEL = { titles: "Title ideas",  grammar: "Grammar", clarify: "Make it clearer", prompt: "I'm stuck", review: "Review", outline: "Outline", ask: "Ask" };

const AUTO_FOLD = new Set(["grammar", "clarify", "titles", "prompt"]);
function isCollapsed(c, i) {
  if (c.pending || c.error) return false;
  if (c.collapsed != null) return c.collapsed;
  if (c.batch) return !!c.done; // whole-draft results stay open until handled
  if (c.kind === "outline") return i > 2;
  return c.done || (i > 0 && AUTO_FOLD.has(c.kind));
}
function cardSummary(c) {
  const status = c.done ? "applied" : c.kind === "grammar" && c.result === c.original ? "no issues" : c.kind === "review" ? `${(c.result || []).length} notes` : "";
  const what = c.question || c.original || c.scopeLabel || "";
  return h("button", { class: "card-summary", "data-card": c.id, title: "Show this result", onclick: () => { c.collapsed = false; renderCards(); persistCards(); } },
    h("span", { class: "card-kind" }, KIND_LABEL[c.kind]),
    h("span", { class: "card-what" }, clip(what.replace(/\s+/g, " "), 60)),
    status ? h("span", { class: "card-status" + (c.done ? " ok-text" : "") }, status) : null);
}
function cardView(c) {
  const head = h("div", { class: "card-head" },
    h("span", { class: "card-kind" }, KIND_LABEL[c.kind]),
    c.scopeLabel ? h("span", { class: "card-scope" }, c.scopeLabel) : null,
    c.at && Date.now() - c.at > 3600e3 ? h("span", { class: "card-scope" }, "· " + timeAgo(c.at)) : null,
    c.pending ? null : h("button", { class: "icon-btn small fold", "aria-label": "Fold", title: "Fold", onclick: () => { c.collapsed = true; renderCards(); persistCards(); } }, "–"),
    h("button", { class: "icon-btn small", "aria-label": "Dismiss", title: "Dismiss", onclick: () => { c.ctl?.abort(); dropCard(c); } }, "×"));
  const el = h("article", { class: "card " + c.kind + (c.done ? " done" : ""), "data-card": c.id }, head);
  if (c.original && c.kind !== "review" && c.kind !== "grammar") {
    el.append(h("button", { class: "quote", title: "Show in draft", onclick: () => { const r = locate(c); if (r) selectInDraft(r.start, r.end); else toast("That text has changed in your draft."); } }, clip(c.original, 160)));
  }
  if (c.pending && c.kind === "ask" && c.partial) {
    el.append(h("p", { class: "asked" }, c.question));
    const ans = h("div", { class: "answer reading-sm" });
    ans.innerHTML = renderMarkdown(c.partial);
    el.append(ans, h("button", { class: "link-btn", onclick: () => c.ctl?.abort() }, "Stop"));
    return el;
  }
  if (c.pending) {
    if (c.question) el.append(h("p", { class: "asked" }, c.question));
    el.append(h("div", { class: "thinking" }, h("span", { class: "spinner", "aria-hidden": "true" }), c.progress || "Thinking…", h("span", { class: "elapsed hint" }),
      h("button", { class: "link-btn", onclick: () => c.ctl?.abort() }, "Stop")));
    return el;
  }
  if (c.error) {
    el.append(h("p", { class: "status err" }, c.error));
    if (c.errorDetail) el.append(h("details", { class: "err-detail" }, h("summary", {}, "Details"), h("code", {}, c.errorDetail)));
    el.append(h("div", { class: "row" },
      c.retry ? h("button", { class: "ghost small", onclick: () => c.retry() }, "Try again") : null,
      h("button", { class: "ghost small", onclick: openSettings }, "Change model")));
    return el;
  }

  if (c.kind === "grammar" && c.scopeLabel === "whole draft") {
    el.append(h("p", { class: c.result ? "" : "ok-text" }, c.result ? `${c.result} paragraph${c.result === 1 ? "" : "s"} with fixes below. Accept the ones you want.` : "No grammar or spelling issues found in the draft."));
    return el;
  }
  if (c.kind === "grammar") {
    if (c.result === c.original) {
      el.append(h("p", { class: "ok-text" }, "No grammar or spelling issues found."));
      if (c.scopeLabel !== "whole draft") el.append(h("button", { class: "link-btn", onclick: () => runGrammarAll() }, "Check the whole draft"));
      return el;
    }
    const parts = wordDiff(c.original, c.result);
    if (!c.done && !locate(c)) el.append(h("p", { class: "hint stale" }, "You've edited this passage since. Accept applies the corrections that still fit."));
    el.append(h("p", { class: "diff" }, parts.map((p) => p.type === "same" ? p.text : h(p.type === "add" ? "ins" : "del", {}, p.text))));
    if (changeRatio(c.original, c.result) > 0.25) el.append(h("p", { class: "status err" }, "This changes more than grammar usually would. Check it's still what you meant before accepting."));
    el.append(h("div", { class: "row between" },
      h("span", { class: "hint" }, `${changeCount(parts)} correction${changeCount(parts) === 1 ? "" : "s"} · `,
        h("button", { class: "link-btn", onclick: () => { const r = locate(c); if (r) selectInDraft(r.start, r.end); else toast("That text has changed in your draft."); } }, "show in draft"),
        c.scopeLabel && !c.scopeLabel.startsWith("paragraph ") ? [" · ", h("button", { class: "link-btn", onclick: () => runGrammarAll() }, "check whole draft")] : null),
      c.done ? h("span", { class: "ok-text" }, "Accepted") : h("div", { class: "row" },
        h("button", { class: "ghost small", onclick: () => dropCard(c) }, "Dismiss"),
        h("button", { class: "primary small", title: "Accept (Alt+Enter from the draft)", onclick: () => acceptText(c, c.result) }, "Accept"))));
  }

  if (c.kind === "clarify") {
    if (!c.done && !locate(c)) {
      el.append(h("p", { class: "hint stale" }, "You've edited this sentence since these options were made."),
        h("button", { class: "ghost small", onclick: () => { dropCard(c); const r = findQuote(current.post.body, c.original.slice(0, 40)); if (r) selectInDraft(r.start, r.end); runClarify(); } }, "Run again on the new wording"));
      return el;
    }
    el.append(h("p", { class: "issue" }, c.result.issue || ""));
    (c.result.options || []).forEach((o, i) => {
      // Light edits read best as a diff; restructured sentences read best as clean text.
      const showDiff = (c.diffOn ||= {})[i] ?? changeRatio(c.original, o.text) <= 0.3;
      const body = showDiff
        ? h("p", { class: "diff" }, wordDiff(c.original, o.text).map((p) => p.type === "same" ? p.text : p.type === "add" ? h("ins", {}, p.text) : h("del", {}, p.text)))
        : h("p", { class: "diff" }, o.text);
      el.append(h("div", { class: "option" + (c.chosen === i ? " chosen" : "") },
        h("span", { class: "option-num" }, `Option ${i + 1}`),
        body,
        o.why ? h("p", { class: "hint" }, o.why) : null,
        h("div", { class: "row" },
          c.done ? null : h("button", { class: "ghost small", onclick: () => { c.chosen = i; acceptText(c, o.text); } }, "Use this"),
          h("button", { class: "link-btn small-text", onclick: () => { c.diffOn[i] = !showDiff; renderCards(); } }, showDiff ? "hide changes" : "show changes"))));
    });
    if (c.result.question) el.append(h("p", { class: "question" }, h("strong", {}, "Question for you: "), c.result.question,
      h("button", { class: "link-btn", onclick: () => { addNote(store.blankNote("question", { text: c.result.question })); toast("Saved to notes"); } }, " Save to notes")));
    if (c.done) el.append(h("p", { class: "ok-text" }, "Applied. Undo with " + MOD + "+Z in the draft."));
  }

  if (c.kind === "prompt") {
    el.append(h("p", { class: "hint" }, "Answer whichever sparks something, in your own words."));
    el.append(h("ul", { class: "qs" }, c.result.map((q, i) => h("li", { class: c.saved?.[i] ? "saved" : "" },
      h("span", {}, q),
      h("span", { class: "row" },
        h("button", { class: "link-btn", onmousedown: (e) => e.preventDefault(), onclick: () => answerQuestion(q) }, "Answer in draft"),
        c.saved?.[i] ? h("span", { class: "ok-text small-text" }, "In notes") : h("button", { class: "link-btn", onclick: () => { addNote(store.blankNote("question", { text: q })); (c.saved ||= {})[i] = true; renderCards(); persistCards(); } }, "Save to notes"))))));
    el.append(h("div", { class: "row end" }, h("button", { class: "ghost small", onclick: () => runPromptMe() }, "Different questions")));
  }

  if (c.kind === "review") {
    if (!c.result.length) el.append(h("p", { class: "ok-text" }, "No notes. It reads clearly."));
    el.append(h("ol", { class: "review" }, c.result.map((r, i) => {
      const found = findQuote(current.post.body, r.quote);
      return h("li", { class: c.checked?.[i] ? "checked" : "" },
        h("div", { class: "row between nowrap" }, h("span", { class: "chip kind-" + slugify(r.kind || "note") }, r.kind || "note"),
          h("label", { class: "check small-text" }, h("input", { type: "checkbox", checked: !!c.checked?.[i], onchange: (e) => { (c.checked ||= {})[i] = e.target.checked; renderCards(); persistCards(); } }), "Done")),
        found
          ? h("button", { class: "quote", title: "Show in draft", onclick: () => { const f = findQuote(current.post.body, r.quote); if (f) selectInDraft(f.start, f.end); } }, clip(r.quote, 120))
          : h("p", { class: "quote missing", title: "This passage isn't in your draft any more, or the assistant misquoted it" }, clip(r.quote, 120), h("span", { class: "hint" }, " (not found in your draft)")),
        h("p", {}, r.note));
    })));
    el.append(h("div", { class: "row end" }, h("button", { class: "ghost small", onclick: () => runReview() }, "Review again")));
  }

  if (c.kind === "titles") {
    el.append(h("ul", { class: "qs" }, c.result.map((t) => h("li", {},
      h("span", {}, t.title),
      t.from ? h("span", { class: "hint" }, `from "${clip(t.from, 80)}"`) : null,
      h("button", { class: "link-btn", onclick: () => {
        const prev = current.post.title;
        current.post.title = t.title;
        const inp = $(".post-title-input"); inp.value = t.title; growTitle(inp);
        document.title = `${t.title} · Drafting Desk`;
        scheduleSave();
        toast("Title updated", { action: { label: "Undo", run: () => { current.post.title = prev; inp.value = prev; growTitle(inp); scheduleSave(); } } });
      } }, "Use this title")))));
    return el;
  }

  if (c.kind === "ask") {
    el.append(h("p", { class: "asked" }, c.question));
    const ans = h("div", { class: "answer reading-sm" });
    ans.innerHTML = renderMarkdown(c.result || c.partial || "");
    el.append(ans);
    return el;
  }

  if (c.kind === "outline") {
    el.append(h("ol", { class: "outline" }, c.result.map((o) => h("li", {}, h("strong", {}, o.heading), o.covers ? h("span", { class: "hint" }, " " + o.covers) : null))));
    el.append(h("div", { class: "row end" }, c.done ? h("span", { class: "ok-text" }, "Inserted") : h("button", { class: "ghost small", onclick: () => {
      const body = current.post.body;
      let at = body.indexOf("\n\n", lastSel.end);
      at = at < 0 ? body.length : at;
      if (!body.trim()) at = 0;
      const before = body.slice(0, at).replace(/\s+$/, "");
      const after = body.slice(at).replace(/^\s+/, "");
      const skel = c.result.map((o) => `## ${o.heading}`).join("\n\n");
      replaceRange(0, body.length, (before ? before + "\n\n" : "") + skel + (after ? "\n\n" + after : "\n"));
      addNote(store.blankNote("note", { text: "Outline:\n" + c.result.map((o) => `- ${o.heading}${o.covers ? ": " + o.covers : ""}`).join("\n") }));
      current.post.aiChars += addedChars("", c.result.map((o) => o.heading).join(" "));
      updateStats();
      updateCard(c, { done: true });
    } }, "Insert headings at cursor")));
  }
  return el;
}

/** Re-apply a suggestion's individual changes by their surrounding words, when the passage was edited since. */
function correctionsThatFit(original, text, body) {
  const parts = wordDiff(original, text);
  const fixes = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].type === "same") continue;
    let del = "", add = "", j = i;
    while (j < parts.length && (parts[j].type !== "same" || (!parts[j].text.trim() && parts[j + 1] && parts[j + 1].type !== "same"))) {
      if (parts[j].type !== "add") del += parts[j].text;
      if (parts[j].type !== "del") add += parts[j].text;
      j++;
    }
    const preAll = parts[i - 1]?.type === "same" ? parts[i - 1].text : "";
    const postAll = parts[j]?.type === "same" ? parts[j].text : "";
    // try wide context first, then narrower, until the spot is unique in the current text
    const tail = (t, n) => (t.match(/(\S+\s*){0,6}$/)?.[0] || "").split(/(?<=\s)(?=\S)/).slice(-n).join("");
    const head = (t, n) => (t.match(/^(\s*\S+){0,6}/)?.[0] || "").split(/(?<=\S)(?=\s)/).slice(0, n).join("");
    let fix = null;
    for (const [a, z] of [[3, 3], [2, 2], [1, 1], [2, 0], [0, 2], [1, 0], [0, 1]]) {
      const pre = a ? tail(preAll, a) : "", post = z ? head(postAll, z) : "";
      const from = pre + del + post;
      if (!from.trim() || (!pre && !post && del.length < 4)) continue;
      const at = body.indexOf(from);
      if (at >= 0 && body.indexOf(from, at + 1) < 0) { fix = { start: at + pre.length, end: at + pre.length + del.length, text: add }; break; }
    }
    fixes.push(fix);
    i = j - 1;
  }
  return fixes;
}
function acceptText(card, text) {
  const r = locate(card);
  if (!r && card.kind === "grammar") {
    const fixes = correctionsThatFit(card.original, text, current.post.body);
    const ok = fixes.filter(Boolean).sort((a, b) => b.start - a.start);
    if (!ok.length) { toast("That passage changed too much since you asked. Run the tool again.", { error: true }); return; }
    for (const f of ok) replaceRange(f.start, f.end, f.text);
    updateCard(card, { done: true });
    toast(ok.length === fixes.length ? "Corrections applied to your edited text" : `Applied ${ok.length} of ${fixes.length} corrections; the rest no longer fit your text`);
    return;
  }
  if (!r) { toast("That passage changed since you asked. Run the tool again.", { error: true }); return; }
  const before = current.post.body;
  // Spelling and grammar fixes are still the writer's words; only rewordings count.
  const added = card.kind === "grammar" ? 0 : addedChars(card.original, text);
  replaceRange(r.start, r.end, text);
  current.post.aiChars += added;
  updateStats();
  updateCard(card, { done: true });
  toast("Change applied", { action: { label: "Undo", run: () => {
    const ta = draft();
    ta.focus();
    let ok = false;
    try { ok = document.execCommand("undo"); } catch {}
    if (!ok || ta.value !== before) { ta.value = before; }
    current.post.body = ta.value;
    current.post.aiChars = Math.max(0, current.post.aiChars - added);
    autogrow(); updateStats(); updateHighlights(); scheduleSave();
    updateCard(card, { done: false, chosen: undefined });
  } } });
}

function announceIfHidden(card) {
  const el = document.querySelector(`[data-card="${card.id}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top > window.innerHeight || r.bottom < 0) {
    toast(`${KIND_LABEL[card.kind]} is ready`, { action: { label: "View", run: () => el.scrollIntoView({ behavior: "smooth", block: "start" }) } });
  }
}
function refreshModelButton() {
  document.querySelectorAll(".model-btn").forEach((b) => b.replaceWith(modelButton()));
}
async function runTool(card, fn) {
  card.ctl = new AbortController();
  card.pending = true;
  card.started = Date.now();
  card.retry = () => { const fresh = { ...card, id: undefined, error: undefined, result: undefined, ctl: undefined, done: false }; dropCard(card); runTool(fresh, fn); };
  if (!card.id) addCard(card);
  const tick = setInterval(() => {
    if (!card.pending) return clearInterval(tick);
    const sec = Math.round((Date.now() - card.started) / 1000);
    const el = document.querySelector(`[data-card="${card.id}"] .elapsed`);
    if (el) el.textContent = sec >= 20 ? `${sec}s · still working (local and larger models can be slow)` : `${sec}s`;
  }, 1000);
  try {
    const result = await fn(card.ctl.signal);
    updateCard(card, { pending: false, result });
    const st = store.getSettings();
    if (!st.guideDone) { st.guideDone = true; store.saveSettings(st); $("#guide")?.remove(); autogrow(); }
    announceIfHidden(card);
  } catch (e) {
    if (e.cancelled) dropCard(card);
    else updateCard(card, { pending: false, error: e.message, errorDetail: e.detail || "" });
  } finally {
    clearInterval(tick);
    refreshModelButton();
  }
}

function runGrammar() {
  if (!requireModel()) return;
  const body = current.post.body;
  if (!body.trim()) { toast("Write something first."); return; }
  const sc = getScope("grammar");
  if (sc.end <= sc.start) { toast("Put your cursor in a paragraph, or select some text."); return; }
  const original = body.slice(sc.start, sc.end);
  runTool({ kind: "grammar", start: sc.start, end: sc.end, original, scopeLabel: sc.label }, async (signal) => {
    const reply = await complete({ ...P.grammarPrompt(current.post, original), signal, temperature: 0, maxTokens: Math.min(8000, 300 + original.length) });
    return parseCorrected(reply, original);
  });
}
/** Pull the corrected text out of a reply; tolerate models that think out loud first. */
function parseCorrected(reply, original) {
  const blocks = [...reply.matchAll(/<corrected>([\s\S]*?)<\/corrected>/g)];
  let out = blocks.length ? blocks[blocks.length - 1][1] : reply.replace(/^\s*<text>\s*|\s*<\/text>\s*$/g, "");
  out = out.replace(/^\n+|\n+$/g, "");
  if (!out.trim()) return original;
  return out.trim() === original.trim() ? original : out.trim();
}
/** Share of the original's words that a suggestion changes. */
function changeRatio(a, b) {
  const parts = wordDiff(a, b);
  const changed = parts.filter((p) => p.type === "del").reduce((n, p) => n + wordCount(p.text), 0);
  return changed / Math.max(1, wordCount(a));
}
function runGrammarAll() {
  if (!requireModel()) return;
  const post = current.post;
  const body = post.body;
  if (!body.trim()) { toast("Write something first."); return; }
  // paragraph ranges
  const paras = [];
  const re = /[^\n](?:[^\n]|\n(?!\n))*/g;
  let m;
  while ((m = re.exec(body))) if (m[0].trim() && !/^#{1,6}\s/.test(m[0]) && !/^```/.test(m[0])) paras.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  const holder = { kind: "grammar", scopeLabel: "whole draft", original: "", progress: `Checking ${paras.length} paragraphs…` };
  runTool(holder, async (signal) => {
    let changed = 0;
    for (let i = 0; i < paras.length; i++) {
      if (signal.aborted) break;
      const p = paras[i];
      updateCard(holder, { progress: `Checking paragraph ${i + 1} of ${paras.length}…` });
      const reply = await complete({ ...P.grammarPrompt(post, p.text), signal, temperature: 0, maxTokens: Math.min(4000, 300 + p.text.length) });
      const out = parseCorrected(reply, p.text);
      if (out !== p.text) {
        changed++;
        const card = { kind: "grammar", start: p.start, end: p.end, original: p.text, scopeLabel: `paragraph ${i + 1}`, result: out, id: store.newId(), at: Date.now(), batch: holder.id, postId: holder.postId };
        const list = current && holder.postId === current.post.id ? cards : liveCards.get(holder.postId);
        if (list) list.splice(list.indexOf(holder) + 1, 0, card);
      }
    }
    return changed;
  });
}
function runClarify() {
  if (!requireModel()) return;
  const body = current.post.body;
  const sc = getScope("clarify");
  if (sc.end <= sc.start) { toast("Put your cursor in a sentence, or select some text."); return; }
  const original = body.slice(sc.start, sc.end);
  if (wordCount(original) < 4) { toast("Select a little more (a full sentence works best)."); return; }
  runTool({ kind: "clarify", start: sc.start, end: sc.end, original, scopeLabel: sc.label }, async (signal) => {
    const r = await completeJSON({ ...P.clarifyPrompt(current.post, original), signal, maxTokens: 1200 });
    if (!r || typeof r !== "object") throw new Error("Unexpected reply. Try again.");
    r.options = (Array.isArray(r.options) ? r.options : []).filter((o) => o && typeof o.text === "string" && o.text.trim()).slice(0, 3);
    return r;
  });
}
function runPromptMe() {
  if (!requireModel()) return;
  const pos = lastSel.start;
  const before = current.post.body.slice(Math.max(0, pos - 1500), pos);
  runTool({ kind: "prompt", scopeLabel: before.trim() ? "where you are" : "the whole post" }, async (signal) => {
    const qs = await completeJSON({ ...P.promptMePrompt(current.post, before.trim()), signal, maxTokens: 600 });
    const list = (Array.isArray(qs) ? qs : []).map(String).filter((q) => q.trim()).slice(0, 6);
    if (!list.length) throw new Error("No questions came back. Try again.");
    return list;
  });
}
function runReview() {
  if (!requireModel()) return;
  if (wordCount(current.post.body) < 60) { toast("Review works best once you have a few paragraphs."); return; }
  runTool({ kind: "review", scopeLabel: `${wordCount(current.post.body)} words` }, async (signal) => {
    const notes = await completeJSON({ ...P.reviewPrompt(current.post), signal, maxTokens: 2000 });
    return (Array.isArray(notes) ? notes : []).filter((n) => n && n.quote && n.note).map((n) => ({ quote: String(n.quote).trim(), kind: String(n.kind || "note"), note: String(n.note) }));
  });
}
function runAsk() {
  const box = $("#askBox");
  const q = box.value.trim();
  if (!q) { box.focus(); return; }
  if (!requireModel()) return;
  box.value = "";
  const history = cards.filter((c) => c.kind === "ask" && c.result).slice(0, 4).reverse().map((c) => ({ q: c.question, a: c.result }));
  const card = { kind: "ask", question: q };
  let last = 0;
  runTool(card, async (signal) => (await complete({ ...P.askPrompt(current.post, q, history), signal, maxTokens: 900,
    onText: (t) => { card.partial = t; if (Date.now() - last > 120) { last = Date.now(); renderCards(); } } })).trim());
}
function runTitles() {
  if (!requireModel()) return;
  if (wordCount(current.post.body) < 80) { toast("Write a bit more first; titles are built from your own phrases."); return; }
  runTool({ kind: "titles", scopeLabel: "from your draft" }, async (signal) => {
    const r = await completeJSON({ ...P.titlePrompt(current.post), signal, maxTokens: 700 });
    const list = (Array.isArray(r) ? r : []).filter((t) => t && t.title).map((t) => ({ title: String(t.title).trim(), from: String(t.from || "") })).slice(0, 6);
    if (!list.length) throw new Error("No titles came back. Try again.");
    return list;
  });
}
function runOutline() {
  if (!requireModel()) return;
  if (!current.post.notes.length && wordCount(current.post.body) < 30) { toast("Add a few notes first; the outline is built from them."); return; }
  runTool({ kind: "outline", scopeLabel: current.post.notes.length ? `from ${current.post.notes.length} note${current.post.notes.length === 1 ? "" : "s"}` : "from your draft" }, async (signal) => {
    const o = await completeJSON({ ...P.outlinePrompt(current.post), signal, maxTokens: 900 });
    const list = (Array.isArray(o) ? o : []).filter((x) => x && x.heading).map((x) => ({ heading: String(x.heading), covers: String(x.covers || "") }));
    if (!list.length) throw new Error("No outline came back. Try again.");
    return list;
  });
}

// ---------- versions ----------
function openVersions() {
  $("#versionLabel").value = "";
  renderVersions();
  $("#versionsDlg").showModal();
}
function renderVersions() {
  const p = current.post;
  const list = $("#versionList");
  if (!p.snapshots.length) { list.replaceChildren(h("li", { class: "hint" }, "No saved versions yet.")); return; }
  list.replaceChildren(...p.snapshots.slice().reverse().map((s) => h("li", {},
    h("div", { class: "version-meta" }, h("strong", {}, s.label || "Saved version"), h("span", { class: "hint" }, `${stamp(s.at)} · ${wordCount(s.body).toLocaleString()} words`)),
    h("p", { class: "version-peek" }, clip(s.body.replace(/\s+/g, " "), 180)),
    h("div", { class: "row" },
      h("button", { class: "ghost small", onclick: (e) => toggleCompare(e.target, s) }, "Compare with now"),
      h("button", { class: "ghost small", onclick: () => copyText(s.body, "Version copied") }, "Copy text"),
      h("button", { class: "ghost small", onclick: async () => {
        if (!(await confirmAction("Replace the current draft with this version? The current draft is saved as a version first.", "Restore"))) { $("#versionsDlg").showModal(); return; }
        addSnapshot("Before restore");
        current.post.body = s.body;
        store.savePost(current.post);
        $("#versionsDlg").close();
        renderEditor(current.post);
        toast("Version restored");
      } }, "Restore"),
      h("button", { class: "link-btn danger", onclick: () => { p.snapshots = p.snapshots.filter((x) => x !== s); scheduleSave(); renderVersions(); } }, "Delete")))));
}
$("#saveVersion").addEventListener("click", () => {
  addSnapshot($("#versionLabel").value.trim() || "Saved version");
  $("#versionLabel").value = "";
  store.savePost(current.post);
  renderVersions();
  toast("Version saved");
});
$("#versionsClose").addEventListener("click", () => $("#versionsDlg").close());

function toggleCompare(btn, snap) {
  const li = btn.closest("li");
  const open = li.querySelector(".compare");
  if (open) { open.remove(); btn.textContent = "Compare with now"; return; }
  btn.textContent = "Hide comparison";
  const parts = paraDiff(snap.body, current.post.body);
  const view = h("div", { class: "compare" });
  if (parts.every((p) => p.type === "same")) view.append(h("p", { class: "ok-text" }, "Identical to your current draft."));
  let run = 0;
  const flush = () => { if (run) { view.append(h("p", { class: "folded" }, `${run} unchanged paragraph${run === 1 ? "" : "s"}`)); run = 0; } };
  const copyBtn = (text, label = "Copy this paragraph") => h("button", { class: "link-btn small-text", onclick: () => copyText(text, "Paragraph copied") }, label);
  for (const p of parts) {
    if (p.type === "same" || p.type === "moved-to") { run++; continue; }
    flush();
    if (p.type === "edit") view.append(h("div", { class: "cmp-block" },
      h("p", { class: "diff" }, p.parts.map((w) => w.type === "same" ? w.text : h(w.type === "add" ? "ins" : "del", {}, w.text))),
      copyBtn(p.before, "Copy the saved version of this paragraph")));
    else if (p.type === "moved-from") view.append(h("p", { class: "folded" }, `Moved: "${clip(p.text, 60)}"`));
    else view.append(h("div", { class: "cmp-block" },
      h("p", { class: "diff whole-" + p.type }, h(p.type === "add" ? "ins" : "del", {}, p.text)),
      p.type === "del" ? copyBtn(p.text) : null));
  }
  flush();
  view.prepend(h("p", { class: "hint" }, h("del", {}, "struck"), " = only in this version, ", h("ins", {}, "highlighted"), " = added since."));
  li.append(view);
}

// ---------- voice ----------
function openVoice() {
  $("#voiceText").value = current.post.voice;
  $("#voiceSamples").value = "";
  $("#learnStatus").textContent = "";
  $("#voiceDlg").showModal();
}
$("#voiceText").addEventListener("input", (e) => { if (current) { current.post.voice = e.target.value; scheduleSave(); } });
$("#voiceDefault").addEventListener("click", () => {
  const s = store.getSettings();
  s.defaultVoice = $("#voiceText").value;
  store.saveSettings(s);
  toast("New posts will start with this voice");
});
$("#learnBtn").addEventListener("click", async () => {
  const samples = $("#voiceSamples").value.trim();
  if (wordCount(samples) < 150) { $("#learnStatus").textContent = "Paste at least a few paragraphs (150+ words)."; return; }
  if (!isReady()) { $("#voiceDlg").close(); openSettings(); return; }
  const btn = $("#learnBtn"), out = $("#voiceText");
  const before = out.value;
  btn.disabled = true;
  $("#learnStatus").textContent = "Reading your writing…";
  try {
    const guide = await complete({ ...P.voicePrompt(samples), maxTokens: 900, onText: (t) => (out.value = t) });
    out.value = guide.trim();
    current.post.voice = out.value;
    store.savePost(current.post);
    $("#learnStatus").textContent = "Drafted. Edit it until it sounds right.";
  } catch (e) { out.value = before; $("#learnStatus").textContent = e.message; }
  finally { btn.disabled = false; }
});

// ---------- export ----------
function exportChecks() {
  const p = current.post, body = p.body;
  const out = [];
  const words = wordCount(body);
  if (words < 50) out.push(["warn", `The draft is short (${words} words).`]);
  if (/Try the assistant on these two practice paragraphs/.test(body)) out.push(["warn", "The practice paragraphs from the example are still in the draft."]);
  const empty = [...body.matchAll(/^(#{1,6})\s+(.+)\n+(?=#{1,6}\s|$(?![\s\S]))/gm)].map((m) => m[2]);
  if (empty.length) out.push(["warn", `Empty section${empty.length > 1 ? "s" : ""}: ${empty.map((t) => `"${clip(t, 40)}"`).join(", ")}.`]);
  const strays = p.notes.filter((n) => n.kind === "question" && n.text.length > 15 && body.includes(n.text));
  if (strays.length) out.push(["warn", `A saved question is pasted into the draft as text: "${clip(strays[0].text, 60)}".`]);
  if (/\b(TODO|TK|FIXME)\b/.test(body)) out.push(["warn", "The draft still has TODO/TK markers."]);
  const openNotes = cards.filter((c) => c.kind === "review" && !c.pending).flatMap((c) => (c.result || []).filter((_, i) => !c.checked?.[i])).length;
  if (openNotes) out.push(["info", `${openNotes} review note${openNotes === 1 ? "" : "s"} not ticked off yet.`]);
  const checked = cards.some((c) => c.kind === "grammar" && c.scopeLabel === "whole draft" && !c.pending && !c.error);
  return { out, checked };
}
function renderExportChecks() {
  const { out, checked } = exportChecks();
  const box = $("#exportChecks");
  box.replaceChildren(
    h("h3", {}, "Before you publish"),
    out.length ? h("ul", {}, out.map(([k, t]) => h("li", { class: k }, t))) : h("p", { class: "ok-text" }, "Nothing obvious left to fix."),
    h("div", { class: "row" },
      checked ? h("span", { class: "ok-text small-text" }, "Whole draft grammar-checked ✓") : null,
      isReady() ? h("button", { class: "ghost small", onclick: () => { $("#exportDlg").close(); runGrammarAll(); } }, checked ? "Check grammar again" : "Check grammar of the whole draft") : null));
}
function openExport() {
  flushSave();
  renderExportChecks();
  $("#markPublished").hidden = true;
  $("#exDesc").value = current.post.description || "";
  descCount();
  $("#exTags").value = current.post.tags || "";
  $("#exportBody").innerHTML = renderMarkdown(`# ${current.post.title}\n\n${current.post.body}`);
  $("#exportDlg").showModal();
}
$("#exportClose").addEventListener("click", () => $("#exportDlg").close());
function descCount() {
  const n = $("#exDesc").value.trim().length;
  const el = $("#exDescCount");
  el.textContent = n ? `${n} characters${n < 70 ? " · a bit short" : n > 170 ? " · may be cut off in previews" : ""}` : "";
}
$("#exDesc").addEventListener("input", (e) => { current.post.description = e.target.value.replace(/\n/g, " "); descCount(); scheduleSave(); });
$("#exTags").addEventListener("input", (e) => { current.post.tags = e.target.value; scheduleSave(); });
$("#exDescSuggest").addEventListener("click", async () => {
  if (!requireModel()) return;
  if (wordCount(current.post.body) < 80) { toast("Write a bit more first."); return; }
  const btn = $("#exDescSuggest"), box = $("#exDesc"), before = box.value;
  btn.disabled = true; btn.textContent = "Thinking…";
  try {
    const d = (await complete({ ...P.descriptionPrompt(current.post), maxTokens: 300, onText: (t) => (box.value = t) })).trim().replace(/^"|"$/g, "");
    box.value = d; current.post.description = d; descCount(); scheduleSave();
    if (before.trim()) toast("Description replaced", { action: { label: "Undo", run: () => { box.value = before; current.post.description = before; descCount(); scheduleSave(); } } });
  } catch (e) { box.value = before; toast(e.message, { error: true }); }
  finally { btn.disabled = false; btn.textContent = "Suggest from my draft"; }
});
$("#copyMd").addEventListener("click", () => { copyText(postToMarkdown(current.post, { frontMatter: $("#frontMatter").checked })); offerPublished(); });
function offerPublished() { if (current.post.status !== "Published") $("#markPublished").hidden = false; }
$("#markPublished").addEventListener("click", () => {
  current.post.status = "Published";
  const sel = $(".status-select"); if (sel) sel.value = "Published";
  scheduleSave();
  $("#markPublished").hidden = true;
  toast("Marked as Published");
});
$("#downloadMd").addEventListener("click", () => {
  const p = current.post;
  downloadText(`${new Date().toISOString().slice(0, 10)}-${slugify(p.title)}.md`, postToMarkdown(p, { frontMatter: $("#frontMatter").checked }));
  offerPublished();
});

// ---------- settings ----------
function openSettings() {
  renderSettings();
  $("#testStatus").textContent = "";
  $("#settingsDlg").showModal();
}
$("#settingsDlg").addEventListener("close", () => {
  // refresh just the model button and assistant intro, keeping the draft and cursor
  document.querySelectorAll(".model-btn").forEach((b) => b.replaceWith(modelButton()));
  if (current) renderCards(); else renderHome();
});

function renderSettings() {
  const s = store.getSettings();
  $("#providerList").replaceChildren(h("legend", { class: "sr-only" }, "Provider"),
    ...Object.entries(PROVIDERS).map(([id, p]) => {
      const connected = id === "ollama" || id === "custom" ? null : !!store.getSecret(id);
      return h("label", { class: "provider" + (s.provider === id ? " on" : "") },
        h("input", { type: "radio", name: "provider", value: id, checked: s.provider === id,
          onchange: () => { const st = store.getSettings(); st.provider = id; store.saveSettings(st); renderSettings(); } }),
        h("span", { class: "provider-name" }, p.label, p.tag ? h("span", { class: "pill tag" }, p.tag) : null, connected ? h("span", { class: "pill" }, "connected") : null),
        h("span", { class: "provider-blurb" }, p.blurb));
    }));
  $("#rememberKeys").checked = s.rememberKeys;
  const note = $("#costNote");
  if (note) note.textContent = s.provider === "ollama" || s.provider === "custom"
    ? "Runs on your own hardware: no per-use cost."
    : "You pay the provider per use. A writing session with these tools typically costs a few cents.";
  renderProviderConfig();
}

function renderProviderConfig() {
  const s = store.getSettings();
  const id = s.provider, p = PROVIDERS[id];
  const kids = [];
  if (p.auth === "oauth") {
    kids.push(store.getSecret(id)
      ? h("div", { class: "row between connected-box" },
          h("span", {}, "Signed in to OpenRouter. Usage is billed to your OpenRouter account."),
          h("button", { type: "button", class: "ghost small", onclick: () => { store.setSecret(id, ""); renderSettings(); } }, "Sign out"))
      : h("div", { class: "stack" },
          h("button", { type: "button", class: "primary", onclick: () => startOpenRouterLogin().catch((e) => toast(e.message, { error: true })) }, "Sign in with OpenRouter"),
          h("details", {}, h("summary", {}, "Or paste an OpenRouter key"), keyField(id, p))));
  }
  if (p.auth === "key") kids.push(keyField(id, p));
  if (p.auth === "url" || p.auth === "url+key") {
    const url = h("input", { type: "url", value: s.baseUrls[id] || "", placeholder: id === "ollama" ? "http://localhost:11434" : "https://host/v1", "aria-label": "Server address",
      oninput: (e) => { const st = store.getSettings(); st.baseUrls[id] = e.target.value.trim().replace(/\/+$/, ""); store.saveSettings(st); } });
    kids.push(h("label", { class: "field" }, h("span", {}, "Server address"), url));
    if (id === "ollama") kids.push(h("p", { class: "hint" },
      "Ollama must allow this site: set ", h("code", {}, `OLLAMA_ORIGINS=${location.origin}`),
      " and restart it. From this https page, browsers only allow http to localhost; for a model on another machine give it an https address (for example ", h("code", {}, "tailscale serve 11434"), ")."));
    if (p.auth === "url+key") kids.push(keyField(id, p, true));
  }
  const model = h("input", { list: "modelOptions", value: s.models[id] || "", "aria-label": "Model", placeholder: "model name",
    oninput: (e) => { const st = store.getSettings(); st.models[id] = e.target.value.trim(); store.saveSettings(st); } });
  const dl = h("datalist", { id: "modelOptions" });
  const loadBtn = h("button", { type: "button", class: "ghost small", onclick: () => loadModels(model, dl, loadBtn) }, "List models");
  kids.push(h("label", { class: "field" }, h("span", {}, "Model"), h("div", { class: "row nowrap" }, model, loadBtn)), dl);
  $("#providerConfig").replaceChildren(...kids);
  if (isReady()) loadModels(model, dl, loadBtn, true);
}
async function loadModels(input, dl, btn, quiet = false) {
  btn.disabled = true; btn.textContent = "Loading…";
  try {
    const ids = await listModels();
    dl.replaceChildren(...ids.map((m) => h("option", { value: m })));
    btn.textContent = `${ids.length} available`;
    // If the saved model isn't offered, pick a sensible one.
    if (ids.length && !ids.includes(input.value)) {
      const pick = ids.find((m) => /sonnet/i.test(m)) || ids.find((m) => /instruct|chat|qwen|llama|gpt|gemini/i.test(m)) || ids[0];
      input.value = pick;
      const st = store.getSettings(); st.models[st.provider] = pick; store.saveSettings(st);
      if (!quiet) toast(`Model set to ${pick}`);
    }
  } catch (e) { btn.textContent = "List models"; if (!quiet) toast(e.message, { error: true }); }
  finally { btn.disabled = false; }
}
function keyField(id, p, optional = false) {
  const inp = h("input", { type: "password", autocomplete: "off", spellcheck: "false", value: store.getSecret(id), "aria-label": `${p.label} API key`,
    placeholder: optional ? "API key (if the server needs one)" : "Paste your API key",
    onchange: (e) => { store.setSecret(id, e.target.value.trim()); renderSettings(); } });
  return h("label", { class: "field" },
    h("span", {}, "API key ", p.keyHelp ? h("a", { href: p.keyHelp, target: "_blank", rel: "noopener noreferrer" }, "get one") : null), inp);
}
$("#rememberKeys").addEventListener("change", (e) => {
  const s = store.getSettings();
  const keys = Object.keys(PROVIDERS).map((id) => [id, store.getSecret(id)]);
  s.rememberKeys = e.target.checked;
  store.saveSettings(s);
  keys.forEach(([id, k]) => store.setSecret(id, k));
});
$("#forgetKeys").addEventListener("click", async () => {
  $("#settingsDlg").close();
  if (await confirmAction("Forget every saved key and sign-in on this device?", "Forget")) { store.forgetAllSecrets(); toast("Keys forgotten"); }
  openSettings();
});
$("#testBtn").addEventListener("click", async () => {
  const st = $("#testStatus");
  st.textContent = "Testing…";
  st.classList.remove("err");
  try {
    const t = await complete({ prompt: "Reply with exactly: ready", maxTokens: 20 });
    st.textContent = t.trim() ? "Works. The assistant is ready." : "Connected, but the reply was empty.";
  } catch (e) { st.textContent = e.message; st.classList.add("err"); }
});

// ---------- boot ----------
(async () => {
  try {
    const back = await finishOpenRouterLogin();
    if (back !== null) { const s = store.getSettings(); s.provider = "openrouter"; store.saveSettings(s); toast("Signed in to OpenRouter"); }
  } catch (e) { toast(e.message, { error: true }); }
  route();
})();
