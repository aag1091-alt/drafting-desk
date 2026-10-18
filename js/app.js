import * as store from "./store.js";
import { PROVIDERS, startOpenRouterLogin, finishOpenRouterLogin, isReady, listModels, complete, completeJSON } from "./providers.js";
import { phrasePrompt, questionsPrompt, outlinePrompt, voicePrompt } from "./prompts.js";
import { renderMarkdown, postToMarkdown, slugify } from "./markdown.js";

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

// ---------- small helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}
let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isError ? 6000 : 2500);
}
function timeAgo(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy. Use Download instead.", true);
  }
}
function wordCount(s) {
  return (s.trim().match(/\S+/g) || []).length;
}

// ---------- routing: #/ (home) and #/p/<id>[/<sectionId>] ----------
function flushSave() {
  if (saveTimer && current) { clearTimeout(saveTimer); saveTimer = null; store.savePost(current.post); }
}
function route() {
  flushSave();
  const m = location.hash.match(/^#\/p\/([0-9a-f]+)(?:\/([0-9a-f]+))?/);
  if (m) {
    const post = store.getPost(m[1]);
    if (!post) { location.hash = "#/"; return; }
    renderEditor(post, m[2]);
  } else {
    renderHome();
  }
}
window.addEventListener("hashchange", route);

// ---------- top bar ----------
function topBar(extra = []) {
  const s = store.getSettings();
  const ready = isReady(s);
  return h("header", { class: "topbar" },
    h("a", { class: "brand", href: "#/" }, h("span", { class: "brand-mark", "aria-hidden": "true" }), "Drafting Desk"),
    h("div", { class: "topbar-actions" },
      ...extra,
      h("button", { class: "ghost model-btn" + (ready ? "" : " needs"), onclick: openSettings, title: "Choose the model" },
        h("span", { class: "dot " + (ready ? "ok" : "warn") }),
        ready ? `${PROVIDERS[s.provider].label} · ${s.models[s.provider]}` : "Connect a model"
      )
    )
  );
}

// ---------- home ----------
function renderHome() {
  document.title = "Drafting Desk";
  const posts = store.listPosts();
  app.replaceChildren(
    topBar(),
    h("main", { class: "home" },
      h("section", { class: "intro" },
        h("h1", {}, "Write it the way you'd say it."),
        h("p", { class: "lede" }, "Answer a few questions in rough notes on the left. Get the section phrased in your own voice on the right. Edit both. Export Markdown for your blog."),
        h("p", { class: "privacy" }, "Your posts never leave this browser. The only thing sent anywhere is the prompt, straight to the model provider you pick, with your own key or sign-in."),
        h("div", { class: "row" },
          h("button", { class: "primary", onclick: openNewPost }, "New post"),
          h("button", { class: "ghost", onclick: loadSample }, "Open the example"),
        )
      ),
      h("section", { class: "posts" },
        h("div", { class: "row between" },
          h("h2", {}, posts.length ? "Your posts" : "No posts yet"),
          h("div", { class: "row" },
            h("button", { class: "ghost small", onclick: () => $("#importFile").click() }, "Import"),
            posts.length ? h("button", { class: "ghost small", onclick: exportBackup }, "Back up all") : null,
          )
        ),
        posts.length
          ? h("ul", { class: "post-list" }, posts.map((p) => {
              const done = p.sections.filter((s) => s.prose.trim()).length;
              const words = p.sections.reduce((n, s) => n + wordCount(s.prose), 0);
              return h("li", {},
                h("a", { href: `#/p/${p.id}`, class: "post-link" },
                  h("span", { class: "post-title" }, p.title || "Untitled post"),
                  h("span", { class: "post-meta" }, `${done} of ${p.sections.length} sections phrased · ${words.toLocaleString()} words · ${timeAgo(p.updated)}`)
                ),
                h("button", { class: "icon-btn", "aria-label": `Delete ${p.title}`, title: "Delete",
                  onclick: async () => { if (await confirmAction(`Delete "${p.title}"? This can't be undone.`)) { store.deletePost(p.id); renderHome(); } } }, "×")
              );
            }))
          : h("p", { class: "hint" }, "Start a new post, or open the example to see how it works.")
      )
    )
  );
}

async function loadSample() {
  try {
    const res = await fetch("samples/model-prework.json");
    const post = store.importPost(await res.json());
    location.hash = `#/p/${post.id}`;
  } catch (e) {
    toast("Couldn't load the example.", true);
  }
}
function exportBackup() {
  downloadText(`drafting-desk-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll(), null, 2), "application/json");
}
$("#importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const posts = Array.isArray(data.posts) ? data.posts : [data];
    posts.forEach((p) => store.importPost(p));
    toast(`Imported ${posts.length} post${posts.length === 1 ? "" : "s"}`);
    route();
  } catch (err) {
    toast(err.message || "Couldn't read that file.", true);
  }
});

// ---------- new post ----------
function openNewPost() {
  const d = $("#newDlg");
  $("#newPostTitle").value = "";
  $("#newPostIdea").value = "";
  $("#newStatus").textContent = "";
  d.showModal();
}
$("#newBlank").addEventListener("click", () => {
  const title = $("#newPostTitle").value.trim() || "Untitled post";
  const post = store.blankPost(title);
  post.sections[0].questions = [
    "What's this post about, in one sentence you'd say out loud?",
    "Who is it for, and what should they be able to do after reading?",
    "What happened that made you want to write it?",
  ];
  store.savePost(post);
  $("#newDlg").close();
  location.hash = `#/p/${post.id}`;
});
$("#newSuggest").addEventListener("click", async () => {
  const title = $("#newPostTitle").value.trim();
  if (!title) { $("#newPostTitle").focus(); return; }
  if (!isReady()) { $("#newDlg").close(); openSettings(); toast("Connect a model first."); return; }
  const btn = $("#newSuggest");
  btn.disabled = true;
  $("#newStatus").textContent = "Thinking…";
  try {
    const plan = await completeJSON({ ...outlinePrompt(title, $("#newPostIdea").value.trim()), maxTokens: 1500 });
    const post = store.blankPost(title);
    post.sections = (Array.isArray(plan) ? plan : []).filter((s) => s && s.name).map((s) => ({
      ...store.blankSection(String(s.name)),
      questions: Array.isArray(s.questions) ? s.questions.map(String) : [],
    }));
    if (!post.sections.length) throw new Error("No sections came back. Try again or start blank.");
    store.savePost(post);
    $("#newDlg").close();
    location.hash = `#/p/${post.id}`;
  } catch (e) {
    $("#newStatus").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- editor ----------
let current = null; // { post, sectionId }
let saveTimer = null;
let inflight = null; // AbortController

function scheduleSave() {
  clearTimeout(saveTimer);
  const st = $("#saveState");
  if (st) st.textContent = "Saving…";
  saveTimer = setTimeout(() => {
    const ok = store.savePost(current.post);
    const s = $("#saveState");
    if (s) s.textContent = ok ? "Saved in this browser" : "Couldn't save (browser storage full?)";
  }, 500);
}
function curSection() {
  return current.post.sections.find((s) => s.id === current.sectionId) || current.post.sections[0];
}

function renderEditor(post, sectionId) {
  if (!post.sections.length) post.sections.push(store.blankSection("Introduction"));
  current = { post, sectionId: post.sections.some((s) => s.id === sectionId) ? sectionId : post.sections[0].id };
  document.title = `${post.title} · Drafting Desk`;
  const sec = curSection();

  const tabs = h("nav", { class: "tabs", role: "tablist", "aria-label": "Sections" },
    post.sections.map((s, i) => {
      const state = s.prose.trim() ? "done" : s.notes.trim() ? "notes" : "";
      return h("a", {
        class: "tab", role: "tab", href: `#/p/${post.id}/${s.id}`,
        "aria-selected": String(s.id === sec.id), "aria-current": s.id === sec.id ? "true" : null,
      }, h("span", { class: "dot " + state, title: state === "done" ? "Phrased" : state === "notes" ? "Has notes" : "Empty" }), h("span", { class: "tab-num" }, String(i + 1)), s.name);
    }),
    h("button", { class: "tab add", onclick: addSection, title: "Add a section" }, "+ Section")
  );

  const notes = h("textarea", { id: "notes", class: "notes", "aria-label": "Your notes", placeholder: "Type what you'd actually say. Fragments are fine.", oninput: (e) => { sec.notes = e.target.value; scheduleSave(); updateCounts(); } });
  notes.value = sec.notes;
  const facts = h("textarea", { id: "facts", class: "facts", rows: "6", "aria-label": "Reference facts", placeholder: "Numbers, links, quotes you want available. The model only uses what your notes point at.", oninput: (e) => { sec.facts = e.target.value; scheduleSave(); } });
  facts.value = sec.facts;
  const prose = h("textarea", { id: "prose", class: "prose", "aria-label": "Phrased text", placeholder: "Your notes, phrased the way you'd write them. Edit anything; your edits are kept.", oninput: (e) => { sec.prose = e.target.value; scheduleSave(); updateCounts(); } });
  prose.value = sec.prose;

  const qList = h("ol", { class: "questions" }, sec.questions.map((q) =>
    h("li", {}, h("button", { class: "q", title: "Add to notes", onclick: () => {
      notes.value = (notes.value.trim() ? notes.value.replace(/\s*$/, "\n\n") : "") + `Q: ${q}\nA: `;
      sec.notes = notes.value; scheduleSave(); notes.focus(); notes.selectionStart = notes.selectionEnd = notes.value.length;
    } }, q))
  ));

  const lenSel = h("select", { id: "len", "aria-label": "Target length", onchange: (e) => { post.length = Number(e.target.value); scheduleSave(); } },
    [[150, "Short · ~150 words"], [280, "Medium · ~280 words"], [420, "Long · ~420 words"], [650, "Very long · ~650 words"]].map(([v, l]) => h("option", { value: v, selected: Number(post.length) === v }, l))
  );

  const sectionName = h("input", { class: "section-name", value: sec.name, "aria-label": "Section name",
    oninput: (e) => { sec.name = e.target.value; scheduleSave(); },
    onchange: () => renderEditor(post, sec.id) });
  sectionName.value = sec.name;

  const titleInput = h("input", { class: "post-title-input", "aria-label": "Post title", oninput: (e) => { post.title = e.target.value; document.title = `${post.title} · Drafting Desk`; scheduleSave(); } });
  titleInput.value = post.title;

  app.replaceChildren(
    topBar([
      h("button", { class: "ghost", onclick: openVoice }, "Voice"),
      h("button", { class: "ghost", onclick: openPreview }, "Preview & export"),
    ]),
    h("main", { class: "editor" },
      h("div", { class: "editor-head" }, titleInput),
      tabs,
      h("div", { class: "section-bar" },
        sectionName,
        h("div", { class: "row" },
          h("button", { class: "ghost small", title: "Move left", "aria-label": "Move section left", onclick: () => moveSection(-1) }, "←"),
          h("button", { class: "ghost small", title: "Move right", "aria-label": "Move section right", onclick: () => moveSection(1) }, "→"),
          h("button", { class: "ghost small danger", onclick: deleteSection }, "Delete section"),
        )
      ),
      h("div", { class: "panes" },
        h("section", { class: "pane", "aria-labelledby": "leftH" },
          h("div", { class: "pane-head" }, h("h2", { id: "leftH" }, "In your words"), h("button", { class: "ghost small", id: "askBtn", onclick: askMore }, "Ask me more")),
          sec.questions.length ? h("p", { class: "hint" }, "Click a question to drop it into your notes. Answer roughly.") : h("p", { class: "hint" }, "No questions yet. Click “Ask me more”, or just start typing."),
          qList,
          notes,
          h("div", { class: "counts", id: "notesCount" }),
          h("details", { class: "facts-box" }, h("summary", {}, "Reference facts for this section"), facts),
        ),
        h("section", { class: "pane", "aria-labelledby": "rightH" },
          h("div", { class: "pane-head" }, h("h2", { id: "rightH" }, "Phrased"),
            h("div", { class: "row" }, lenSel,
              h("button", { class: "primary", id: "phraseBtn", onclick: () => phrase() }, "Phrase it"),
              h("button", { class: "ghost", id: "stopBtn", hidden: true, onclick: () => inflight?.abort() }, "Stop"),
            )
          ),
          prose,
          h("div", { class: "row between" },
            h("span", { class: "status", id: "status" }),
            h("div", { class: "row" },
              h("button", { class: "ghost small", id: "restoreBtn", hidden: !sec.previous, onclick: restorePrevious }, "Restore previous version"),
              h("span", { class: "counts", id: "proseCount" }))),
        )
      ),
      h("footer", { class: "editor-foot" }, h("span", { id: "saveState" }, "Saved in this browser"), h("a", { href: "#/", class: "muted-link" }, "All posts"))
    )
  );
  updateCounts();
}
function updateCounts() {
  const s = curSection();
  const n = $("#notesCount"), p = $("#proseCount");
  if (n) n.textContent = `${wordCount(s.notes)} words of notes`;
  if (p) p.textContent = s.prose.trim() ? `${wordCount(s.prose)} words` : "";
}
function setStatus(msg, err = false) {
  const el = $("#status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", err);
}

function addSection() {
  const s = store.blankSection(`Section ${current.post.sections.length + 1}`);
  current.post.sections.push(s);
  store.savePost(current.post);
  location.hash = `#/p/${current.post.id}/${s.id}`;
}
async function deleteSection() {
  const s = curSection();
  if (current.post.sections.length === 1) { toast("A post needs at least one section."); return; }
  if (!(await confirmAction(`Delete the section "${s.name}" and its notes?`))) return;
  const i = current.post.sections.indexOf(s);
  current.post.sections.splice(i, 1);
  store.savePost(current.post);
  location.hash = `#/p/${current.post.id}/${current.post.sections[Math.max(0, i - 1)].id}`;
}
function moveSection(dir) {
  const arr = current.post.sections;
  const i = arr.indexOf(curSection());
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  store.savePost(current.post);
  renderEditor(current.post, current.sectionId);
}

async function phrase() {
  const post = current.post, sec = curSection();
  if (!sec.notes.trim()) { setStatus("Add some notes on the left first.", true); $("#notes").focus(); return; }
  if (!isReady()) { openSettings(); return; }
  const out = $("#prose"), btn = $("#phraseBtn"), stop = $("#stopBtn");
  const before = sec.prose;
  inflight = new AbortController();
  btn.disabled = true; stop.hidden = false;
  setStatus("Thinking…");
  try {
    const text = await complete({ ...phrasePrompt(post, sec), signal: inflight.signal, onText: (t) => { out.value = t; setStatus("Writing…"); } });
    sec.prose = text.trim();
    out.value = sec.prose;
    if (before.trim()) { sec.previous = before; $("#restoreBtn").hidden = false; }
    setStatus("Done. Edit anything above.");
  } catch (e) {
    if (e.cancelled) { setStatus("Stopped."); sec.prose = e.partial || before; }
    else { setStatus(e.message, true); sec.prose = before; }
    out.value = sec.prose;
  } finally {
    btn.disabled = false; stop.hidden = true; inflight = null;
    store.savePost(post); updateCounts();
    renderTabsState();
  }
}
function restorePrevious() {
  const sec = curSection();
  if (!sec.previous) return;
  [sec.prose, sec.previous] = [sec.previous, sec.prose];
  $("#prose").value = sec.prose;
  $("#restoreBtn").textContent = "Swap back";
  store.savePost(current.post);
  updateCounts();
}
function renderTabsState() {
  current.post.sections.forEach((s) => {
    const tab = document.querySelector(`.tab[href$="/${s.id}"] .dot`);
    if (tab) tab.className = "dot " + (s.prose.trim() ? "done" : s.notes.trim() ? "notes" : "");
  });
}

async function askMore() {
  if (!isReady()) { openSettings(); return; }
  const post = current.post, sec = curSection();
  const btn = $("#askBtn");
  btn.disabled = true;
  setStatus("Thinking of questions…");
  try {
    const qs = await completeJSON({ ...questionsPrompt(post, sec), maxTokens: 600 });
    const add = (Array.isArray(qs) ? qs : []).map(String).filter((q) => q.trim());
    if (!add.length) throw new Error("No questions came back. Try again.");
    sec.questions.push(...add);
    store.savePost(post);
    renderEditor(post, sec.id);
    toast(`Added ${add.length} questions`);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    const b = $("#askBtn");
    if (b) b.disabled = false;
  }
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
    const guide = await complete({ ...voicePrompt(samples), maxTokens: 900, onText: (t) => (out.value = t) });
    out.value = guide.trim();
    current.post.voice = out.value;
    store.savePost(current.post);
    $("#learnStatus").textContent = "Drafted. Edit it until it sounds right.";
  } catch (e) {
    out.value = before;
    $("#learnStatus").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- preview & export ----------
function openPreview() {
  const md = postToMarkdown(current.post, { frontMatter: false });
  $("#previewBody").innerHTML = renderMarkdown(md) || "<p class='hint'>Nothing phrased yet.</p>";
  $("#previewDlg").showModal();
}
$("#previewClose").addEventListener("click", () => $("#previewDlg").close());
$("#copyMd").addEventListener("click", () => copyText(postToMarkdown(current.post, { frontMatter: $("#frontMatter").checked })));
$("#downloadMd").addEventListener("click", () => {
  const p = current.post;
  const name = `${new Date().toISOString().slice(0, 10)}-${slugify(p.title)}.md`;
  downloadText(name, postToMarkdown(p, { frontMatter: $("#frontMatter").checked }));
});

// ---------- settings ----------
function openSettings() {
  renderSettings();
  $("#testStatus").textContent = "";
  $("#settingsDlg").showModal();
}
$("#settingsDlg").addEventListener("close", () => route());

function renderSettings() {
  const s = store.getSettings();
  const list = $("#providerList");
  list.replaceChildren(h("legend", { class: "sr-only" }, "Provider"),
    ...Object.entries(PROVIDERS).map(([id, p]) => {
      const connected = id === "ollama" || id === "custom" ? null : !!store.getSecret(id);
      return h("label", { class: "provider" + (s.provider === id ? " on" : "") },
        h("input", { type: "radio", name: "provider", value: id, checked: s.provider === id,
          onchange: () => { const st = store.getSettings(); st.provider = id; store.saveSettings(st); renderSettings(); } }),
        h("span", { class: "provider-name" }, p.label, connected ? h("span", { class: "pill" }, "connected") : null),
        h("span", { class: "provider-blurb" }, p.blurb)
      );
    })
  );
  $("#rememberKeys").checked = s.rememberKeys;
  renderProviderConfig();
}

function renderProviderConfig() {
  const s = store.getSettings();
  const id = s.provider, p = PROVIDERS[id];
  const box = $("#providerConfig");
  const kids = [];

  if (p.auth === "oauth") {
    const key = store.getSecret(id);
    kids.push(key
      ? h("div", { class: "row between connected-box" },
          h("span", {}, "Signed in to OpenRouter. Usage is billed to your OpenRouter account."),
          h("button", { type: "button", class: "ghost small", onclick: () => { store.setSecret(id, ""); renderSettings(); } }, "Sign out"))
      : h("div", { class: "stack" },
          h("button", { type: "button", class: "primary", onclick: () => startOpenRouterLogin().catch((e) => toast(e.message, true)) }, "Sign in with OpenRouter"),
          h("details", {}, h("summary", {}, "Or paste an OpenRouter key"),
            keyField(id, p))));
  }
  if (p.auth === "key") kids.push(keyField(id, p));
  if (p.auth === "url" || p.auth === "url+key") {
    const url = h("input", { type: "url", placeholder: id === "ollama" ? "http://localhost:11434" : "https://host/v1", "aria-label": "Server address",
      oninput: (e) => { const st = store.getSettings(); st.baseUrls[id] = e.target.value.trim(); store.saveSettings(st); } });
    url.value = s.baseUrls[id] || "";
    kids.push(h("label", { class: "field" }, h("span", {}, "Server address"), url));
    if (id === "ollama") kids.push(h("p", { class: "hint" },
      "Ollama must allow this site. Quit Ollama, then start it with ", h("code", {}, `OLLAMA_ORIGINS=${location.origin} ollama serve`),
      ". Browsers only allow http:// to localhost from a secure page, so a model on another machine needs an https address (for example ", h("code", {}, "tailscale serve"), ")."));
    if (p.auth === "url+key") kids.push(keyField(id, p, true));
  }

  const model = h("input", { list: "modelOptions", "aria-label": "Model", placeholder: "model name",
    oninput: (e) => { const st = store.getSettings(); st.models[id] = e.target.value.trim(); store.saveSettings(st); } });
  model.value = s.models[id] || "";
  const dl = h("datalist", { id: "modelOptions" });
  const loadBtn = h("button", { type: "button", class: "ghost small", onclick: async () => {
    loadBtn.disabled = true; loadBtn.textContent = "Loading…";
    try {
      const ids = await listModels();
      dl.replaceChildren(...ids.map((m) => h("option", { value: m })));
      loadBtn.textContent = `${ids.length} models`;
      model.focus();
    } catch (e) { loadBtn.textContent = "List models"; toast(e.message, true); }
    finally { loadBtn.disabled = false; }
  } }, "List models");
  kids.push(h("label", { class: "field" }, h("span", {}, "Model"), h("div", { class: "row nowrap" }, model, loadBtn)), dl);
  box.replaceChildren(...kids);
}

function keyField(id, p, optional = false) {
  const inp = h("input", { type: "password", autocomplete: "off", spellcheck: "false", "aria-label": `${p.label} API key`,
    placeholder: optional ? "API key (if the server needs one)" : "Paste your API key",
    onchange: (e) => { store.setSecret(id, e.target.value.trim()); renderSettings(); } });
  inp.value = store.getSecret(id);
  return h("label", { class: "field" },
    h("span", {}, "API key ", p.keyHelp ? h("a", { href: p.keyHelp, target: "_blank", rel: "noopener noreferrer" }, "get one") : null),
    inp);
}

$("#rememberKeys").addEventListener("change", (e) => {
  const s = store.getSettings();
  const keys = Object.keys(PROVIDERS).map((id) => [id, store.getSecret(id)]);
  s.rememberKeys = e.target.checked;
  store.saveSettings(s);
  keys.forEach(([id, k]) => store.setSecret(id, k)); // move keys to the right storage
});
$("#forgetKeys").addEventListener("click", async () => {
  if (await confirmAction("Forget every saved key and sign-in on this device?", "Forget")) {
    store.forgetAllSecrets();
    renderSettings();
    toast("Keys forgotten");
  }
});
$("#testBtn").addEventListener("click", async () => {
  const st = $("#testStatus");
  st.textContent = "Testing…";
  st.classList.remove("err");
  try {
    const t = await complete({ prompt: "Reply with exactly: ready", maxTokens: 20 });
    st.textContent = t.trim() ? "Works" : "Connected, but the reply was empty";
  } catch (e) {
    st.textContent = e.message;
    st.classList.add("err");
  }
});

// ---------- boot ----------
(async () => {
  try {
    const back = await finishOpenRouterLogin();
    if (back !== null) {
      const s = store.getSettings();
      s.provider = "openrouter";
      store.saveSettings(s);
      toast("Signed in to OpenRouter");
    }
  } catch (e) {
    toast(e.message, true);
  }
  route();
})();
