// Everything lives in this browser's localStorage. Nothing is sent anywhere
// except the prompts you choose to send to the model provider you configure.

const POSTS_KEY = "dd.posts.v1";      // { [id]: Post }
const SETTINGS_KEY = "dd.settings.v1"; // provider choice, model, non-secret prefs
const SECRET_KEY = "dd.secrets.v1";    // API keys (localStorage or sessionStorage)

export const DEFAULT_VOICE = `Write in the author's own voice, as described below. Edit this guide to match how you write, or use "Learn my voice" to draft it from your past posts.

- First person, plain and direct. Short declarative sentences mixed with longer explanatory ones. No hype or marketing words.
- Open with the concrete situation, then the reasoning.
- Opinionated, but show the trade-off. "I think" for judgments; state facts flatly.
- Paragraphs over bullet lists; lists only for truly parallel items.
- Specific numbers and names over adjectives.`;

export const PHRASING_RULES = `Rules for phrasing: keep the writer's own words and phrasings wherever they appear in the notes; only reorder, connect and tidy. Never add a fact, number or claim that is not in the notes or the reference facts. If the notes are thin, write less rather than padding. No intro like "In this post" and no closing summary unless the notes have one.`;

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

export function blankSection(name = "New section") {
  return { id: newId(), name, notes: "", facts: "", prose: "", questions: [] };
}

export function blankPost(title = "Untitled post") {
  const now = Date.now();
  return {
    id: newId(),
    title,
    voice: getSettings().defaultVoice || DEFAULT_VOICE,
    length: 280,
    created: now,
    updated: now,
    sections: [blankSection("Introduction")],
  };
}

// ---- posts ----
export function listPosts() {
  const all = read(localStorage, POSTS_KEY, {});
  return Object.values(all).sort((a, b) => b.updated - a.updated);
}
export function getPost(id) {
  return read(localStorage, POSTS_KEY, {})[id] || null;
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
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.sections)) {
    throw new Error("That file doesn't look like a Drafting Desk post.");
  }
  const post = {
    ...blankPost(String(obj.title || "Imported post")),
    voice: typeof obj.voice === "string" ? obj.voice : DEFAULT_VOICE,
    length: Number(obj.length) || 280,
    sections: obj.sections.map((s) => ({
      id: newId(),
      name: String(s.name || "Section"),
      notes: String(s.notes || ""),
      facts: String(s.facts || ""),
      prose: String(s.prose || ""),
      questions: Array.isArray(s.questions) ? s.questions.map(String) : [],
    })),
  };
  savePost(post);
  return post;
}
export function exportAll() {
  return { app: "drafting-desk", version: 1, exported: new Date().toISOString(), posts: listPosts() };
}

// ---- settings (non-secret) ----
const DEFAULT_SETTINGS = {
  provider: "openrouter",
  models: {
    openrouter: "anthropic/claude-sonnet-4.5",
    anthropic: "claude-sonnet-4-5",
    openai: "gpt-4.1-mini",
    gemini: "gemini-2.5-flash",
    ollama: "qwen2.5:14b",
    custom: "",
  },
  baseUrls: { ollama: "http://localhost:11434", custom: "" },
  rememberKeys: true,
  defaultVoice: "",
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
