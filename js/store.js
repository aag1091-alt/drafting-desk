// Everything lives in this browser's localStorage. Nothing is sent anywhere
// except the prompts you choose to send to the model provider you configure.

const POSTS_KEY = "dd.posts.v1";       // { [id]: Post }
const SETTINGS_KEY = "dd.settings.v1"; // provider choice, model, non-secret prefs
const SECRET_KEY = "dd.secrets.v1";    // API keys (localStorage or sessionStorage)

export const STATUSES = ["Idea", "Drafting", "Editing", "Ready", "Published"];

export const DEFAULT_VOICE = `- First person, plain and direct.
- Short sentences mixed with longer explanatory ones.
- Specific numbers and names over adjectives.
- No hype or marketing words.`;

function read(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("Could not save", key, e);
    return false;
  }
}

/** Random, URL-safe id: 12 hex chars from crypto. */
export function newId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function blankNote(kind = "note", fields = {}) {
  return { id: newId(), kind, text: "", url: "", title: "", created: Date.now(), ...fields };
}

export function blankPost(title = "Untitled post") {
  const now = Date.now();
  return {
    id: newId(),
    v: 2,
    title,
    status: "Idea",
    voice: getSettings().defaultVoice || DEFAULT_VOICE,
    body: "",
    notes: [],
    snapshots: [],
    aiChars: 0, // characters inserted by accepting AI suggestions (approximate)
    description: "",
    tags: "",
    created: now,
    updated: now,
  };
}

/** Bring a v1 post (sections with notes/facts/prose) into the v2 shape. */
function migrate(p) {
  if (!p || p.v === 2) return p;
  const post = { ...blankPost(p.title || "Untitled post"), id: p.id || newId(), created: p.created || Date.now(), updated: p.updated || Date.now() };
  post.voice = p.voice || post.voice;
  const parts = [];
  for (const s of p.sections || []) {
    const text = (s.prose || "").trim();
    parts.push(`## ${s.name || "Section"}\n\n${text}`);
    if ((s.notes || "").trim()) post.notes.push(blankNote("note", { text: `${s.name}: ${s.notes.trim()}` }));
    if ((s.facts || "").trim()) post.notes.push(blankNote("source", { title: `${s.name}: reference facts`, text: s.facts.trim() }));
    for (const q of s.questions || []) post.notes.push(blankNote("question", { text: q, title: s.name }));
  }
  post.body = parts.join("\n\n").trim() + (parts.length ? "\n" : "");
  post.status = post.body.replace(/^##.*$/gm, "").trim() ? "Drafting" : "Idea";
  post.aiChars = (p.sections || []).reduce((n, s) => n + (s.prose || "").length, 0); // v1 prose was AI-written
  return post;
}

// ---- posts ----
function allPosts() {
  const all = read(localStorage, POSTS_KEY, {});
  let changed = false;
  for (const id of Object.keys(all)) {
    if (all[id]?.v !== 2) { all[id] = migrate(all[id]); changed = true; }
  }
  if (changed) write(localStorage, POSTS_KEY, all);
  return all;
}
export function listPosts() {
  return Object.values(allPosts()).sort((a, b) => b.updated - a.updated);
}
export function getPost(id) {
  return allPosts()[id] || null;
}
export function savePost(post) {
  const all = read(localStorage, POSTS_KEY, {});
  post.updated = Date.now();
  all[post.id] = post;
  return write(localStorage, POSTS_KEY, all);
}
export function deletePost(id) {
  const all = read(localStorage, POSTS_KEY, {});
  delete all[id];
  write(localStorage, POSTS_KEY, all);
}
/** Import a post object (from a backup or the sample). Always gets a fresh id. */
export function importPost(obj) {
  if (!obj || typeof obj !== "object" || (typeof obj.body !== "string" && !Array.isArray(obj.sections))) {
    throw new Error("That file doesn't look like a Drafting Desk post.");
  }
  const src = obj.v === 2 ? obj : migrate(obj);
  const post = {
    ...blankPost(String(src.title || "Imported post")),
    status: STATUSES.includes(src.status) ? src.status : "Idea",
    voice: typeof src.voice === "string" ? src.voice : DEFAULT_VOICE,
    body: String(src.body || ""),
    aiChars: Number(src.aiChars) || 0,
    description: String(src.description || ""),
    tags: String(src.tags || ""),
    notes: (Array.isArray(src.notes) ? src.notes : []).map((n) => ({
      ...blankNote(["note", "source", "question"].includes(n.kind) ? n.kind : "note"),
      text: String(n.text || ""), url: String(n.url || ""), title: String(n.title || ""),
      ...(n.anchor ? { anchor: String(n.anchor).slice(0, 600) } : {}),
    })),
    snapshots: (Array.isArray(src.snapshots) ? src.snapshots : []).slice(-30).map((s) => ({
      id: newId(), at: Number(s.at) || Date.now(), label: String(s.label || ""), body: String(s.body || ""),
    })),
  };
  savePost(post);
  return post;
}
export function exportAll() {
  return { app: "drafting-desk", version: 2, exported: new Date().toISOString(), posts: listPosts() };
}

// ---- settings (non-secret) ----
const DEFAULT_SETTINGS = {
  provider: "openrouter",
  models: {
    openrouter: "anthropic/claude-sonnet-4.5",
    anthropic: "claude-sonnet-5-5",
    openai: "gpt-4.1-mini",
    gemini: "gemini-2.5-flash",
    ollama: "qwen2.5:14b",
    custom: "",
  },
  baseUrls: { ollama: "http://localhost:11434", custom: "" },
  rememberKeys: true,
  defaultVoice: "",
  notesOpen: true,
};
export function getSettings() {
  const s = read(localStorage, SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) },
    baseUrls: { ...DEFAULT_SETTINGS.baseUrls, ...(s.baseUrls || {}) },
  };
}
export function saveSettings(s) {
  write(localStorage, SETTINGS_KEY, s);
}

// ---- secrets ----
// Remembered keys go to localStorage; otherwise sessionStorage (gone when the tab closes).
function secretStore() {
  return getSettings().rememberKeys ? localStorage : sessionStorage;
}
export function getSecret(provider) {
  return read(localStorage, SECRET_KEY, {})[provider] || read(sessionStorage, SECRET_KEY, {})[provider] || "";
}
export function setSecret(provider, value) {
  for (const st of [localStorage, sessionStorage]) {
    const all = read(st, SECRET_KEY, {});
    delete all[provider];
    write(st, SECRET_KEY, all);
  }
  if (value) {
    const st = secretStore();
    const all = read(st, SECRET_KEY, {});
    all[provider] = value;
    write(st, SECRET_KEY, all);
  }
}
export function forgetAllSecrets() {
  try { localStorage.removeItem(SECRET_KEY); } catch {}
  try { sessionStorage.removeItem(SECRET_KEY); } catch {}
}
