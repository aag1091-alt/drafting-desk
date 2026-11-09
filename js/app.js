// Drafting Desk v4 — UI.
// One state object, regions rendered explicitly (home / editor), one kind of
// suggestion block, no mirror divs, no absolute-positioned cards, no globals
// beyond `state`. The engine modules (prompts, providers, diff, markdown)
// are ported from v3 unchanged in behaviour; prompts.js is verbatim.

import * as store from "./store.js";
import { PROVIDERS, isReady, notReadyReason, complete, completeJSON, listModels, startOpenRouterLogin, finishOpenRouterLogin } from "./providers.js";
import * as P from "./prompts.js";
import { wordDiff } from "./diff.js";
import { renderMarkdown, postToMarkdown, wordCount, slugify, parseMarkdownPost } from "./markdown.js";

const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
let toastTimer = null;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), ms);
}

const state = {
  post: null,            // current post (editor)
  suggestions: [],       // unified suggestion blocks for this session
  activeSugg: null,      // id of the one expanded suggestion
  sel: { start: 0, end: 0, text: "" },
  busy: false,
  cue: null,             // "Write this" direction banner {text, typedAtStart}
  pendingSplit: false,   // freshly pasted multi-paragraph start
  checkedParas: new Set(), // partner: paragraph texts already checked this session
  titleIdeas: [], titleIdeaIdx: 0,
};

const settings = () => store.getSettings();
const effectivePost = () => state.post && { ...state.post, voice: state.post.voice || settings().defaultVoice || store.DEFAULT_VOICE };
const modelReady = () => { try { return isReady(); } catch { return false; } };

// ---------- routing ----------
function route() {
  const m = location.hash.match(/^#\/p\/([a-z0-9]+)/i);
  if (m) {
    const post = store.getPost(m[1]);
    if (post) { openEditor(post); return; }
  }
  renderHome();
}
window.addEventListener("hashchange", route);

// ---------- shared top bar ----------
function topbar(rightKids = []) {
  return h("header", { class: "topbar" },
    h("a", { class: "brand", href: "#/" }, "Drafting Desk"),
    h("span", { class: "spacer" }),
    ...rightKids,
    h("button", { class: "ghost", onclick: openSettings }, "Settings"),
  );
}

// ---------- home ----------
function renderHome() {
  state.post = null;
  const posts = store.listPosts();
  const app = $("#app");
  app.replaceChildren(topbar());

  const startText = h("textarea", { rows: 5, placeholder: "Paste rough notes or just start typing…", "aria-label": "Start a post" });
  const startBtn = h("button", { class: "primary", onclick: () => startPost(startText.value) }, "Start →");
  startText.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") startPost(startText.value); });

  const home = h("main", { class: "home" },
    h("h1", {}, "Your words. Your post."),
    h("p", { class: "hint" }, "Everything stays in this browser. The assistant is optional and never writes the post for you."),
    h("div", { class: "startbox" },
      startText,
      h("div", { class: "row" },
        modelReady() ? h("span", { class: "hint" }, "Suggestions are available once you're writing.") : h("span", { class: "hint" }, "No model connected — writing, notes and Finish work anyway. Connect one in Settings whenever you like."),
        startBtn)),
  );

  if (!posts.length) {
    home.append(h("p", { style: "margin-top:22px" },
      "New here? ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); loadExample(); } }, "Open the worked example →"),
      h("span", { class: "hint" }, " — the prework post, with its real notes.")));
  } else {
    home.append(h("h2", { style: "margin:28px 0 4px;font-size:15px" }, "Your posts"));
    const ul = h("ul", { class: "postlist" });
    for (const p of posts) {
      ul.append(h("li", {},
        h("a", { href: `#/p/${p.id}` }, p.title || "Untitled post"),
        p.finishedAt ? h("span", { class: "finished-stamp" }, "Finished ✓") : null,
        h("span", { class: "meta" }, `${wordCount(p.body)} words · ${new Date(p.updated).toLocaleDateString()}`),
        h("button", { class: "linkish", onclick: () => { if (confirm(`Delete “${p.title || "Untitled post"}”? This can't be undone.`)) { store.deletePost(p.id); renderHome(); } } }, "Delete"),
      ));
    }
    home.append(ul);
    home.append(h("p", { style: "margin-top:16px" },
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); loadExample(); } }, "Open the worked example"),
      h("span", { class: "hint" }, " · "),
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); $("#importFile").click(); } }, "Import"),
      h("span", { class: "hint" }, " · "),
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); downloadJSON(); } }, "Back up all"),
    ));
  }
  app.append(home);
  startText.focus();
}

function startPost(text) {
  const post = store.blankPost("");
  post.voice = settings().defaultVoice || store.DEFAULT_VOICE;
  post.body = String(text || "");
  state.pendingSplit = post.body.split(/\n\s*\n/).filter((x) => x.trim()).length >= 2;
  if (!store.savePost(post)) { toast("Couldn't save — browser storage may be full."); return; }
  location.hash = `#/p/${post.id}`;
}

async function loadExample() {
  try {
    const res = await fetch("samples/example.json");
    if (!res.ok) throw new Error("fetch failed");
    const post = store.importPost(await res.json());
    location.hash = `#/p/${post.id}`;
  } catch { toast("Couldn't load the example here. It lives in samples/example.json."); }
}

function downloadJSON() {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `drafting-desk-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- editor ----------
function paragraphs(body) {
  const out = [];
  const re = /[^\n](?:[^\n]|\n(?!\n))*/g;
  let m;
  while ((m = re.exec(body))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}
function paraAt(body, offset) {
  const ps = paragraphs(body);
  return ps.find((p) => offset >= p.start && offset <= p.end) || ps[ps.length - 1] || null;
}

function openEditor(post) {
  state.post = post;
  state.suggestions = [];
  state.activeSugg = null;
  state.cue = null;
  // History as invisible infrastructure: snapshot on open when there's text.
  if (post.body.trim()) {
    const last = post.snapshots[post.snapshots.length - 1];
    if (!last || last.body !== post.body) {
      post.snapshots.push({ id: store.newId(), at: Date.now(), label: "Opened", body: post.body });
      post.snapshots = post.snapshots.slice(-30);
      store.savePost(post);
    }
  }
  renderEditor();
}

function renderEditor() {
  const post = state.post;
  const app = $("#app");
  const s = settings();

  const title = h("input", { class: "title-input", placeholder: "Give it a title later if you like", value: post.title, "aria-label": "Post title" });
  title.addEventListener("input", () => { post.title = title.value; queueSave(); document.title = `${post.title || "Untitled"} — Drafting Desk`; });

  const head = h("header", { class: "topbar editor-head" },
    h("a", { href: "#/", class: "brand" }, "← Posts"),
    title,
    h("button", { class: "ghost", onclick: openHistory }, "History"),
    h("button", { class: "primary", onclick: openFinish }, "Finish →"),
    h("button", { class: "ghost", onclick: openSettings }, "Settings"),
  );

  // Notes column — deliberately dumb: one list, Insert / ×, an add box.
  const notesCol = h("aside", { class: "notes-col", id: "notesCol", "aria-label": "Notes" });
  if (s.notesOpen) {
    notesCol.append(h("h2", {}, "Notes", h("button", { class: "linkish", onclick: () => { const st = settings(); st.notesOpen = false; store.saveSettings(st); renderEditor(); } }, "Hide »")));
    const list = h("div", { id: "notesList" });
    renderNotes(list);
    notesCol.append(list);
    const addTa = h("textarea", { rows: 3, placeholder: "Jot a note… a pasted link becomes a source, in the same list.", "aria-label": "Add a note" });
    notesCol.append(h("div", { class: "notes-add" }, addTa,
      h("button", { class: "small", onclick: () => { const t = addTa.value.trim(); if (!t) return; post.notes.unshift(store.blankNote(t)); persistOrWarn(); renderEditor(); } }, "Add note")));
  }
  const strip = s.notesOpen ? null : h("div", { class: "notes-strip", role: "button", tabindex: "0", onclick: () => { const st = settings(); st.notesOpen = true; store.saveSettings(st); renderEditor(); } }, `« Notes (${post.notes.length})`);

  const draft = h("textarea", { id: "draft", placeholder: "Start writing. Headings start with ##. Your rough notes can go straight in — sorting them out is the job.", "aria-label": "Draft" });
  draft.value = post.body;

  const selStrip = h("div", { class: "sel-strip", id: "selStrip", role: "toolbar", "aria-label": "Selection tools" });
  const suggBox = h("div", { class: "suggestions", id: "suggestions", "aria-live": "polite" });
  const askRow = h("div", { class: "ask-row", id: "askRow" },
    h("input", { id: "askInput", placeholder: "Ask about this draft…", class: "grow" }),
    h("button", { id: "askGo", class: "primary" }, "Ask"));

  const main = h("main", { class: "main-col", id: "mainCol" });
  if (state.pendingSplit) {
    main.append(h("div", { class: "split-choice" },
      h("span", {}, "You pasted notes to start."),
      h("button", { class: "small primary", onclick: () => { state.pendingSplit = false; renderEditor(); } }, "Keep as my draft"),
      h("button", { class: "small", onclick: splitIntoNotes }, "Split into Notes instead"),
    ));
  }
  if (state.cue) {
    main.append(h("div", { class: "cue", id: "cueBox" },
      h("span", {}, "✦ ", h("strong", {}, "Write this: "), state.cue.text),
      h("button", { class: "linkish x", onclick: () => { state.cue = null; renderEditor(); $("#draft")?.focus(); } }, "×")));
  }
  main.append(draft, selStrip, askRow, suggBox);

  const paneSwitch = h("div", { class: "pane-switch", role: "group", "aria-label": "Pane" },
    h("button", { id: "paneWrite", "aria-pressed": "true" }, "Write"),
    h("button", { id: "paneNotes", "aria-pressed": "false" }, `Notes (${post.notes.length})`));
  paneSwitch.addEventListener("click", (e) => {
    const notes = e.target.id === "paneNotes";
    $("#paneWrite").setAttribute("aria-pressed", String(!notes));
    $("#paneNotes").setAttribute("aria-pressed", String(notes));
    if (notes && !s.notesOpen) { const st = settings(); st.notesOpen = true; store.saveSettings(st); renderEditor(); return; }
    notesCol.classList.toggle("mobile-hidden", !notes);
    main.classList.toggle("mobile-hidden", notes);
  });
  notesCol.classList.add("mobile-hidden"); // on mobile, Write shows first; the class is only honoured under the 860px breakpoint

  const desk = s.notesOpen
    ? h("div", { class: "desk" }, notesCol, main)
    : h("div", { class: "desk notes-closed" }, strip, main);

  const foot = renderFooter();
  app.replaceChildren(head, paneSwitch, desk, foot);

  wireDraft(draft, selStrip);
  renderSuggestions();
  autogrow(draft);
}

function splitIntoNotes() {
  const post = state.post;
  const parts = post.body.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  post.notes = [...parts.map((t) => store.blankNote(t)), ...post.notes];
  post.body = "";
  state.pendingSplit = false;
  persistOrWarn();
  renderEditor();
  toast("Notes are in the left column. Insert them as you write.");
}

function renderNotes(container) {
  const post = state.post;
  container.replaceChildren();
  if (!post.notes.length) {
    container.append(h("p", { class: "hint" }, "Nothing yet. Rough notes, links, numbers, half-sentences — all welcome here."));
    return;
  }
  for (const note of post.notes) {
    const body = h("div", {});
    // A URL in a note renders as a link — a note with a link IS a source.
    const url = note.text.match(/https?:\/\/[^\s)]+/);
    body.append(document.createTextNode(note.text));
    if (url) body.append(h("div", {}, h("a", { href: url[0], target: "_blank", rel: "noopener noreferrer" }, "Open link ↗")));
    container.append(h("div", { class: `note${note.used ? " used" : ""}` }, body,
      h("div", { class: "note-acts" },
        h("button", { onclick: () => insertAtCursor(note.text, () => { note.used = true; }) }, "Insert at cursor"),
        h("button", { onclick: () => { post.notes = post.notes.filter((n) => n.id !== note.id); persistOrWarn(); renderEditor(); } }, "×"))));
  }
}

function renderFooter() {
  const post = state.post;
  const suggToggle = h("input", { type: "checkbox", id: "suggToggle" });
  suggToggle.checked = settings().suggestionsOn;
  suggToggle.addEventListener("change", () => { const st = settings(); st.suggestionsOn = suggToggle.checked; store.saveSettings(st); toast(suggToggle.checked ? "Suggestions on — your partner will read along when you pause." : "Suggestions off. The tools below still work when you ask."); });
  return h("footer", { class: "editor-foot" },
    h("div", { class: "left" },
      h("span", { id: "wordCount" }, `${wordCount(post.body)} words`),
      h("span", { id: "saveState" }, "Saved ✓"),
      h("span", { id: "busyState", class: "busy", role: "status" }, "")),
    h("div", { class: "right" },
      h("label", { class: "switch" }, suggToggle, "Suggestions"),
      h("button", { class: "linkish", onclick: runReview }, "Review draft"),
      h("button", { class: "linkish", onclick: () => { $("#askRow")?.classList.toggle("on"); $("#askInput")?.focus(); } }, "Ask about this draft…"),
      h("button", { class: "primary", onclick: runWhatNext }, "✦ What next?"),
    ));
}

let saveTimer = null;
function queueSave() {
  const post = state.post;
  if (!post) return;
  const ss = $("#saveState"); if (ss) ss.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistOrWarn(), 400);
}
function persistOrWarn() {
  if (!state.post) return true;
  const ok = store.savePost(state.post);
  const ss = $("#saveState"); if (ss) ss.textContent = ok ? "Saved ✓" : "Couldn't save!";
  if (!ok) toast("Couldn't save — browser storage may be full. Back up your posts from Settings, then delete old ones.", 6000);
  return ok;
}
function autogrow(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.max(320, ta.scrollHeight) + "px";
}

function insertAtCursor(text, after) {
  const ta = $("#draft");
  if (!ta) return;
  const post = state.post;
  const { selectionStart: a, selectionEnd: b } = ta;
  ta.focus();
  // execCommand keeps the insert inside the browser's own undo stack.
  if (!document.execCommand("insertText", false, text)) {
    post.body = post.body.slice(0, a) + text + post.body.slice(b);
    ta.value = post.body;
  } else post.body = ta.value;
  after?.();
  persistOrWarn();
  autogrow(ta);
  updateStats();
}
function replaceRange(start, end, text) {
  const ta = $("#draft");
  const post = state.post;
  ta.focus();
  ta.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) {
    post.body = post.body.slice(0, start) + text + post.body.slice(end);
    ta.value = post.body;
  } else post.body = ta.value;
  persistOrWarn();
  autogrow(ta);
  updateStats();
}
function updateStats() {
  const wc = $("#wordCount");
  if (wc && state.post) wc.textContent = `${wordCount(state.post.body)} words`;
}

let partnerTimer = null;
function wireDraft(ta, selStrip) {
  const post = state.post;
  ta.addEventListener("input", () => {
    post.body = ta.value;
    queueSave();
    autogrow(ta);
    updateStats();
    if (state.cue) {
      const typed = wordCount(post.body) - (state.cue.wordsAtStart || 0);
      if (typed >= 60) { state.cue = null; $("#cueBox")?.remove(); }
    }
    clearTimeout(partnerTimer);
    partnerTimer = setTimeout(partnerCheck, 3000);
  });
  const onSel = () => {
    state.sel = { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
    renderSelStrip(selStrip);
  };
  ta.addEventListener("select", onSel);
  ta.addEventListener("keyup", onSel);
  ta.addEventListener("mouseup", onSel);
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault();
      if (!state.sel.text) { // no selection: act on the paragraph at the cursor
        const p = paraAt(post.body, ta.selectionStart);
        if (p) state.sel = { start: p.start, end: p.end, text: p.text };
      }
      ({ 1: runFix, 2: runClearer, 3: runStuck })[e.key]?.();
    }
  });
  $("#askGo")?.addEventListener("click", runAsk);
  $("#askInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") runAsk(); });
}

function renderSelStrip(strip) {
  const { text } = state.sel;
  strip.replaceChildren();
  if (!text.trim()) { strip.classList.remove("on"); return; }
  strip.classList.add("on");
  strip.append(h("span", { class: "sel-label" }, `${wordCount(text)} words selected`));
  if (modelReady()) {
    strip.append(
      h("button", { class: "small", onclick: runFix, title: "Ctrl/Cmd+Alt+1" }, "Fix"),
      h("button", { class: "small", onclick: runClearer, title: "Ctrl/Cmd+Alt+2" }, "Clearer"),
      h("button", { class: "small", onclick: runStuck, title: "Ctrl/Cmd+Alt+3" }, "I'm stuck"),
    );
  } else {
    strip.append(h("span", { class: "hint" }, "Connect a model in Settings for Fix & Clearer — Note still works:"));
  }
  strip.append(h("button", { class: "small", onclick: () => {
    state.post.notes.unshift(store.blankNote(text));
    persistOrWarn();
    renderEditor();
    toast("Saved as a note.");
  } }, "Note"));
}

// ---------- suggestions: one block type, one presentation ----------
const KIND_LABEL = { fix: "Fix", better: "Reads better as", clearer: "Clearer", idea: "You could add", question: "A reader might ask", stuck: "Questions to get you unstuck", next: "What next", ask: "Answer", review: "Review note", outline: "Outline" };

function addSuggestion(sugg) {
  sugg.id = store.newId();
  sugg.at = Date.now();
  state.suggestions.unshift(sugg);
  state.suggestions = state.suggestions.slice(0, 12);
  state.activeSugg = sugg.id;
  renderSuggestions();
}
function dismissSuggestion(id) {
  state.suggestions = state.suggestions.filter((s) => s.id !== id);
  if (state.activeSugg === id) state.activeSugg = state.suggestions[0]?.id || null;
  renderSuggestions();
}
function diffNodes(before, after) {
  const frag = document.createDocumentFragment();
  for (const part of wordDiff(before, after)) {
    if (part.type === "same") frag.append(document.createTextNode(part.text));
    else if (part.type === "del") frag.append(h("del", {}, part.text));
    else frag.append(h("ins", {}, part.text));
  }
  return frag;
}
function renderSuggestions() {
  const box = $("#suggestions");
  if (!box) return;
  box.replaceChildren();
  for (const s of state.suggestions) {
    if (s.id !== state.activeSugg) {
      const one = s.kind === "fix" || s.kind === "better" ? `${s.original || ""} → ${s.suggestion || ""}`
        : (s.items?.[0] ? String(s.items[0].text || s.items[0]) : s.text || "");
      box.append(h("div", { class: "sugg collapsed", onclick: () => { state.activeSugg = s.id; renderSuggestions(); } },
        h("span", { class: "kind" }, KIND_LABEL[s.kind] || s.kind, " · "),
        h("span", { class: "one-line" }, one)));
      continue;
    }
    const el = h("div", { class: "sugg" });
    el.append(h("div", { class: "kind" }, KIND_LABEL[s.kind] || s.kind));
    if (s.quote) el.append(h("div", { class: "anchor" }, `“${s.quote}”`));
    if (s.why) el.append(h("div", { class: "hint" }, s.why));
    if (s.original && s.suggestion) el.append(h("div", { class: "body-text" }, diffNodes(s.original, s.suggestion)));
    else if (s.text) el.append(h("div", { class: "body-text" }, s.text));
    const acts = h("div", { class: "acts" });
    if (s.original && s.suggestion) {
      acts.append(h("button", { class: "primary small", onclick: () => useSuggestion(s) }, "Use"));
    }
    if (Array.isArray(s.options)) {
      for (const opt of s.options) {
        const o = h("div", { class: "option" },
          h("div", { class: "body-text" }, opt.text),
          opt.why ? h("div", { class: "hint" }, opt.why) : null,
          h("div", { class: "acts" }, h("button", { class: "small primary", onclick: () => {
            replaceRange(s.start, s.end, opt.text);
            dismissSuggestion(s.id);
          } }, "Use this wording")));
        el.append(o);
      }
    }
    if (Array.isArray(s.items)) {
      for (const item of s.items) {
        const text = typeof item === "string" ? item : item.text || item.note || "";
        const row = h("div", { class: "option" },
          h("div", { class: "body-text" }, typeof item === "object" && item.quote ? h("span", {}, h("em", {}, `“${item.quote}” `), text) : text),
          h("div", { class: "acts" },
            h("button", { class: "small", onclick: () => writeThis(text) }, "Write this →"),
            h("button", { class: "small", onclick: () => { state.post.notes.unshift(store.blankNote(text)); persistOrWarn(); toast("Saved to notes."); } }, "Save to notes")));
        el.append(row);
      }
    }
    acts.append(h("button", { class: "small", onclick: () => dismissSuggestion(s.id) }, "Dismiss"));
    el.append(acts);
    box.append(el);
  }
}
function useSuggestion(s) {
  const post = state.post;
  const idx = post.body.indexOf(s.original);
  if (idx < 0) { toast("That passage has changed since the suggestion — can't apply it safely."); dismissSuggestion(s.id); return; }
  replaceRange(idx, idx + s.original.length, s.suggestion);
  dismissSuggestion(s.id);
}
function writeThis(text) {
  const ta = $("#draft");
  if (!ta) return;
  state.cue = { text, wordsAtStart: wordCount(state.post.body) };
  const end = state.post.body.length;
  ta.focus();
  ta.setSelectionRange(end, end);
  if (!state.post.body.endsWith("\n\n") && state.post.body.trim()) insertAtCursor("\n\n");
  renderEditor();
  $("#draft")?.focus();
  toast("Cue is above your draft. It disappears as you write — it's not part of the post.");
}
function setBusy(msg) {
  state.busy = !!msg;
  const b = $("#busyState");
  if (b) b.textContent = msg || "";
}
async function runModel(label, fn) {
  if (!modelReady()) { toast(`Connect a model first (Settings). ${notReadyReason()}`); openSettings(); return; }
  if (state.busy) return;
  setBusy(`${label}…`);
  try { await fn(); }
  catch (e) { toast(e.message || "Something went wrong.", 5000); }
  finally { setBusy(""); }
}

// ---------- tools ----------
function parseCorrected(text) {
  const m = String(text).match(/<corrected>([\s\S]*?)<\/corrected>/);
  return (m ? m[1] : String(text)).trim();
}
function runFix() {
  const sel = { ...state.sel };
  if (!sel.text.trim()) { toast("Select some words first — or put your cursor in a paragraph and press Fix."); return; }
  runModel("Fixing", async () => {
    const out = await complete(P.grammarPrompt(effectivePost(), sel.text));
    const corrected = parseCorrected(out);
    if (corrected === sel.text.trim()) { toast("No fixes needed there."); return; }
    addSuggestion({ kind: "fix", quote: sel.text.slice(0, 90), original: sel.text, suggestion: corrected, start: sel.start, end: sel.end });
  });
}
function runClearer() {
  const sel = { ...state.sel };
  if (!sel.text.trim()) { toast("Select the passage you want clearer first."); return; }
  runModel("Thinking about clarity", async () => {
    const r = await completeJSON(P.clarifyPrompt(effectivePost(), sel.text));
    addSuggestion({ kind: "clearer", quote: sel.text.slice(0, 90), why: r.issue || "", text: r.question ? `Question first: ${r.question}` : "", options: Array.isArray(r.options) ? r.options : [], start: sel.start, end: sel.end });
  });
}
function runStuck() {
  const post = effectivePost();
  const before = state.post.body.slice(0, state.sel.end || state.sel.start).slice(-600);
  runModel("Finding questions", async () => {
    const r = await completeJSON(P.promptMePrompt(post, before));
    addSuggestion({ kind: "stuck", items: (Array.isArray(r) ? r : []).map((q) => ({ text: q })) });
  });
}
function runAsk() {
  const q = $("#askInput")?.value.trim();
  if (!q) return;
  runModel("Thinking", async () => {
    const out = await complete(P.askPrompt(effectivePost(), q));
    addSuggestion({ kind: "ask", quote: q, text: out.trim() });
    const inp = $("#askInput"); if (inp) inp.value = "";
  });
}
function runReview() {
  if (!state.post.body.trim()) { toast("Write a little first — there's nothing to review yet."); return; }
  runModel("Reviewing", async () => {
    const r = await completeJSON(P.reviewPrompt(effectivePost()));
    if (!Array.isArray(r) || !r.length) { toast("Review came back clean."); return; }
    addSuggestion({ kind: "review", items: r.map((n) => ({ text: n.note, quote: n.quote })) });
  });
}
function runWhatNext() {
  const post = state.post;
  if (!post.body.trim() && !post.notes.length) { toast("Jot a note or a first sentence, then ask What's next."); return; }
  if (!modelReady()) {
    const unused = post.notes.filter((n) => !n.used);
    if (!unused.length) { toast("No model connected, and all your notes are used. Connect a model in Settings for fresh directions."); return; }
    addSuggestion({ kind: "next", why: "From your notes — not used yet (works offline):", items: unused.slice(0, 3).map((n) => ({ text: n.text.split("\n")[0].slice(0, 140) })) });
    return;
  }
  runModel("Thinking what's next", async () => {
    const r = await completeJSON(P.nextPrompt(effectivePost()));
    addSuggestion({ kind: "next", items: (Array.isArray(r) ? r : []).slice(0, 3).map((t) => ({ text: t })) });
  });
}

// ---------- the partner: checks the paragraph you just left, then stays quiet ----------
async function partnerCheck() {
  const post = state.post;
  if (!post || state.busy || !settings().suggestionsOn || !modelReady()) return;
  const ta = $("#draft");
  if (!ta) return;
  const para = paraAt(post.body, ta.selectionStart);
  if (!para || wordCount(para.text) < 12) return;
  const key = para.text;
  if (state.checkedParas.has(key)) return;
  state.checkedParas.add(key);
  setBusy("Partner is reading along…");
  try {
    const paras = paragraphs(post.body);
    const i = paras.indexOf(para);
    const around = paras.slice(Math.max(0, i - 1), i + 2).map((p) => p.text).join("\n\n");
    const r = await completeJSON(P.partnerPrompt(effectivePost(), para.text, around));
    if (!Array.isArray(r)) return;
    for (const s of r.slice(0, 2)) {
      if ((s.type === "better" || s.type === "fix") && s.quote && s.suggestion) {
        addSuggestion({ kind: s.type === "fix" ? "fix" : "better", quote: s.quote.slice(0, 90), original: s.quote, suggestion: s.suggestion, why: s.why || "" });
      } else if ((s.type === "idea" || s.type === "question") && s.text) {
        addSuggestion({ kind: s.type, quote: para.text.slice(0, 90), text: s.text, items: s.type === "idea" ? [{ text: s.text }] : undefined });
      }
    }
  } catch { /* the partner stays quiet on failure — by design */ }
  finally { setBusy(""); }
}

// ---------- history ----------
function openHistory() {
  const dlg = $("#historyDlg");
  renderVersions();
  dlg.showModal();
}
function renderVersions() {
  const post = state.post;
  const ul = $("#versionList");
  ul.replaceChildren();
  const snaps = [...post.snapshots].reverse();
  if (!snaps.length) ul.append(h("li", {}, h("span", { class: "hint" }, "No snapshots yet.")));
  for (const s of snaps) {
    ul.append(h("li", {},
      h("strong", {}, s.label || "Snapshot"),
      h("span", { class: "meta" }, `${new Date(s.at).toLocaleString()} · ${wordCount(s.body)} words`),
      h("button", { class: "small", onclick: () => {
        post.snapshots.push({ id: store.newId(), at: Date.now(), label: "Before restore", body: post.body });
        post.body = s.body;
        persistOrWarn();
        $("#historyDlg").close();
        state.suggestions = [];
        renderEditor();
        toast("Restored. Your previous draft was saved as a snapshot first.");
      } }, "Restore")));
  }
}

// ---------- finish ----------
function finishChecks(post) {
  const out = [];
  const body = post.body;
  if (wordCount(body) < 30) out.push({ msg: "The draft is very short — under 30 words.", at: 0 });
  const todo = body.search(/\b(TODO|TK|FIXME)\b/);
  if (todo >= 0) out.push({ msg: "The draft still has a TODO/TK marker.", at: todo });
  const emptyHead = body.search(/^#{1,4}\s*$/m);
  if (emptyHead >= 0) out.push({ msg: "There's an empty heading.", at: emptyHead });
  if (!post.title.trim()) out.push({ msg: "No title yet — add one below (readers and search results need it).", at: -1 });
  return out;
}
function openFinish() {
  const post = state.post;
  persistOrWarn();
  $("#finTitle").value = post.title;
  $("#finDesc").value = post.description;
  $("#finTags").value = post.tags;
  updateDescCount();
  renderFinishChecks();
  $("#finishPreview").innerHTML = renderMarkdown(post.body) || "<p><em>Nothing to preview yet.</em></p>";
  $("#finishStatus").textContent = post.finishedAt ? `Finished ✓ ${new Date(post.finishedAt).toLocaleDateString()} — download again to update.` : "";
  $("#finishDlg").showModal();
}
function renderFinishChecks() {
  const box = $("#finishChecks");
  box.replaceChildren();
  const checks = finishChecks(state.post);
  if (!checks.length) { box.append(h("p", { class: "ok" }, "Nothing blocking. Nice post.")); return; }
  for (const c of checks) {
    box.append(h("p", { class: "blocker" }, "• ", c.msg, c.at >= 0 ? " " : "", c.at >= 0 ? h("button", { class: "linkish", onclick: () => {
      $("#finishDlg").close();
      const ta = $("#draft");
      ta.focus(); ta.setSelectionRange(c.at, c.at);
    } }, "Jump to it →") : ""));
  }
}
function updateDescCount() {
  const d = $("#finDesc").value;
  $("#finDescCount").textContent = d ? `${d.length} characters (120–160 reads well)` : "";
}
function syncFinishFields() {
  const post = state.post;
  post.title = $("#finTitle").value;
  post.description = $("#finDesc").value.trim();
  post.tags = $("#finTags").value;
  persistOrWarn();
}

// ---------- settings ----------
function openSettings() { buildProviderConfig(); syncSettingsFields(); $("#settingsDlg").showModal(); }
function syncSettingsFields() {
  const s = settings();
  $("#rememberKeys").checked = !!s.rememberKeys;
  $("#voiceText").value = state.post ? (state.post.voice || s.defaultVoice || store.DEFAULT_VOICE) : (s.defaultVoice || store.DEFAULT_VOICE);
  $("#extraFm").value = s.extraFrontMatter || "";
}
function buildProviderConfig() {
  const s = settings();
  const wrap = $("#providerConfig");
  wrap.replaceChildren();
  const radios = h("div", { class: "providers", role: "radiogroup", "aria-label": "Provider" });
  for (const [key, p] of Object.entries(PROVIDERS)) {
    const radio = h("input", { type: "radio", name: "provider", value: key });
    if (s.provider === key) radio.checked = true;
    radio.addEventListener("change", () => { const st = settings(); st.provider = key; store.saveSettings(st); buildProviderConfig(); });
    radios.append(h("label", {}, radio, h("span", {}, h("strong", {}, p.label), p.tag ? ` — ${p.tag}` : "", h("br"), h("span", { class: "hint" }, p.blurb))));
  }
  wrap.append(radios);

  const p = PROVIDERS[s.provider];
  const cfg = h("div", { class: "stack" });
  if (p.auth === "oauth") {
    cfg.append(h("div", { class: "row" },
      h("button", { type: "button", class: "primary", onclick: () => startOpenRouterLogin().catch((e) => toast(e.message)) }, "Sign in with OpenRouter"),
      store.getSecret("openrouter") ? h("span", { class: "status" }, "Signed in / key saved ✓") : h("span", { class: "hint" }, "…or paste a key below.")));
  }
  if (p.auth !== "url") {
    const keyIn = h("input", { type: "password", placeholder: `${p.label} API key`, autocomplete: "off", value: store.getSecret(s.provider) });
    keyIn.addEventListener("change", () => { store.setSecret(s.provider, keyIn.value.trim()); toast(keyIn.value.trim() ? "Key saved in this browser." : "Key removed."); });
    cfg.append(h("label", { class: "field" }, h("span", {}, "API key ", p.keyHelp ? h("a", { href: p.keyHelp, target: "_blank", rel: "noopener" }, "(get one)") : ""), keyIn));
  }
  if (p.auth === "url" || p.auth === "url+key") {
    const urlIn = h("input", { placeholder: s.provider === "ollama" ? "http://localhost:11434" : "https://…/v1", value: s.baseUrls[s.provider] || "", spellcheck: "false" });
    urlIn.addEventListener("change", () => { const st = settings(); st.baseUrls[s.provider] = urlIn.value.trim(); store.saveSettings(st); });
    cfg.append(h("label", { class: "field" }, h("span", {}, "Server address"), urlIn));
  }
  const modelIn = h("input", { placeholder: "Model name", value: s.models[s.provider] || "", list: "modelList", spellcheck: "false" });
  modelIn.addEventListener("change", () => { const st = settings(); st.models[s.provider] = modelIn.value.trim(); store.saveSettings(st); });
  const dl = h("datalist", { id: "modelList" });
  const listBtn = h("button", { type: "button", class: "ghost small", onclick: async () => {
    try { const models = await listModels(); dl.replaceChildren(...models.map((m) => h("option", { value: m }))); toast(`${models.length} models listed — start typing the model box.`); }
    catch (e) { toast(e.message, 5000); }
  } }, "List models");
  cfg.append(h("label", { class: "field" }, h("span", {}, "Model"), h("span", { class: "row nowrap" }, modelIn, listBtn)), dl);
  wrap.append(cfg);
}

// ---------- import ----------
async function handleImportFiles(files) {
  for (const f of files) {
    try {
      const text = await f.text();
      if (/\.json$/i.test(f.name)) {
        const obj = JSON.parse(text);
        if (obj && Array.isArray(obj.posts)) { for (const p of obj.posts) store.importPost(p); toast(`Imported ${obj.posts.length} posts.`); }
        else { store.importPost(obj); toast("Imported one post."); }
      } else {
        const parsed = parseMarkdownPost(text, f.name);
        const post = store.blankPost(parsed.title);
        Object.assign(post, { body: parsed.body, description: parsed.description, tags: parsed.tags, voice: settings().defaultVoice || store.DEFAULT_VOICE });
        store.savePost(post);
        toast(`Imported “${parsed.title}”.`);
      }
    } catch (e) { toast(`Couldn't import ${f.name}: ${e.message}`, 5000); }
  }
  if (!state.post) renderHome(); else renderEditor();
}

// ---------- boot / dialog wiring ----------
function wireStatic() {
  for (const dlg of document.querySelectorAll("dialog")) {
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  }
  $("#rememberKeys").addEventListener("change", (e) => { const st = settings(); st.rememberKeys = e.target.checked; store.saveSettings(st); });
  $("#voiceText").addEventListener("change", (e) => {
    const st = settings(); st.defaultVoice = e.target.value; store.saveSettings(st);
    if (state.post) { state.post.voice = e.target.value; persistOrWarn(); }
  });
  $("#extraFm").addEventListener("change", (e) => { const st = settings(); st.extraFrontMatter = e.target.value; store.saveSettings(st); });
  $("#forgetKeys").addEventListener("click", () => { store.forgetAllSecrets(); buildProviderConfig(); toast("All keys forgotten."); });
  $("#testBtn").addEventListener("click", async () => {
    const el = $("#testStatus");
    if (!modelReady()) { el.textContent = notReadyReason(); return; }
    el.textContent = "Testing…";
    try { await complete({ system: "", prompt: "Reply with the single word: ready", maxTokens: 20 }); el.textContent = "Connected ✓"; }
    catch (e) { el.textContent = e.message; }
  });
  $("#backupBtn").addEventListener("click", downloadJSON);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => { handleImportFiles([...e.target.files]); e.target.value = ""; });
  $("#saveSnapshot").addEventListener("click", () => {
    const post = state.post; if (!post) return;
    post.snapshots.push({ id: store.newId(), at: Date.now(), label: $("#snapshotLabel").value.trim(), body: post.body });
    post.snapshots = post.snapshots.slice(-30);
    persistOrWarn(); renderVersions(); $("#snapshotLabel").value = "";
  });
  $("#finDesc").addEventListener("input", updateDescCount);
  $("#finTitleSuggest").addEventListener("click", async () => {
    syncFinishFields();
    if (!state.titleIdeas.length) {
      if (!modelReady()) { toast("Connect a model for title ideas — or just type one."); return; }
      try { const r = await completeJSON(P.titlePrompt(effectivePost())); state.titleIdeas = (Array.isArray(r) ? r : []).map((t) => t.title).filter(Boolean); state.titleIdeaIdx = 0; }
      catch (e) { toast(e.message, 5000); return; }
    }
    if (state.titleIdeas.length) { $("#finTitle").value = state.titleIdeas[state.titleIdeaIdx++ % state.titleIdeas.length]; syncFinishFields(); }
  });
  $("#finDescSuggest").addEventListener("click", async () => {
    syncFinishFields();
    if (!modelReady()) { toast("Connect a model for a suggested description."); return; }
    try { const out = await complete(P.descriptionPrompt(effectivePost())); $("#finDesc").value = out.trim(); updateDescCount(); syncFinishFields(); }
    catch (e) { toast(e.message, 5000); }
  });
  $("#copyMd").addEventListener("click", async () => {
    syncFinishFields();
    try { await navigator.clipboard.writeText(postToMarkdown(state.post, { extra: settings().extraFrontMatter })); $("#finishStatus").textContent = "Markdown copied."; }
    catch { toast("Copy failed — your browser blocked it."); }
  });
  $("#downloadMd").addEventListener("click", () => {
    syncFinishFields();
    const post = state.post;
    const md = postToMarkdown(post, { extra: settings().extraFrontMatter });
    const name = `${new Date().toISOString().slice(0, 10)}-${slugify(post.title)}.md`;
    const blob = new Blob([md], { type: "text/markdown" });
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    post.finishedAt = Date.now();
    persistOrWarn();
    $("#finishStatus").textContent = `Saved as ${name} ✓ — post marked finished.`;
    renderFinishChecks();
  });
}

(async function boot() {
  wireStatic();
  const migrated = store.migrateV3();
  try {
    const back = await finishOpenRouterLogin();
    if (back != null) { toast("Signed in with OpenRouter ✓"); if (back && back !== location.hash) { history.replaceState(null, "", location.pathname + back); } }
  } catch (e) { toast(e.message, 5000); }
  route();
  if (migrated) toast(`Brought over ${migrated} post${migrated === 1 ? "" : "s"} from the old version.`);
  if (!location.hash) route();
})();
