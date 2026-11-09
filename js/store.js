// Drafting Desk v4 store.
// One key per post (dd2.post.<id>) + a small index, so saving one post never
// rewrites the whole library. Declared schema below — no field exists unless
// it is declared here. Everything lives in this browser; nothing is sent
// anywhere except prompts to the model provider the user configures.

const INDEX_KEY = "dd2.index";        // [id, ...] most-recent-first order is derived from updated
const POST_PREFIX = "dd2.post.";
const SETTINGS_KEY = "dd2.settings";
const SECRET_KEY = "dd2.secrets";
const V3_POSTS_KEY = "dd.posts.v1";   // legacy, migrated once on first run

export const POST_FIELDS = ["id", "title", "body", "notes", "snapshots", "voice",
  "description", "tags", "finishedAt", "created", "updated"];
export const NOTE_FIELDS = ["id", "text", "used", "created"];
export const SNAPSHOT_FIELDS = ["id", "at", "label", "body"];

export const DEFAULT_VOICE = `- First person, plain and direct.
- Short sentences mixed with longer explanatory ones.
- Specific numbers and names over adjectives.
- No hype or marketing words.`;

function read(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.error("Could not save", key, e); return false; }
}

export function newId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function blankNote(text = "") {
  return { id: newId(), text, used: false, created: Date.now() };
}

export function blankPost(title = "") {
  const now = Date.now();
  return {
    id: newId(), title, body: "", notes: [], snapshots: [],
    voice: "", description: "", tags: "", finishedAt: null,
    created: now, updated: now,
  };
}

/** Coerce any object into the declared post schema (import + migration path). */
export function coercePost(src) {
  const post = blankPost(String(src?.title || ""));
  post.id = typeof src?.id === "string" && src.id ? src.id : newId();
  post.body = String(src?.body || "");
  post.voice = String(src?.voice || "");
  post.description = String(src?.description || "");
  post.tags = String(src?.tags || "");
  post.finishedAt = Number(src?.finishedAt) || null;
  post.created = Number(src?.created) || Date.now();
  post.updated = Number(src?.updated) || post.created;
  post.notes = (Array.isArray(src?.notes) ? src.notes : []).map((n) => {
    if (typeof n === "string") return blankNote(n);
    const parts = [n?.title, n?.url, n?.text].map((x) => String(x || "").trim()).filter(Boolean);
    return { ...blankNote(parts.join("\n")), used: !!n?.used, created: Number(n?.created) || Date.now() };
  });
  post.snapshots = (Array.isArray(src?.snapshots) ? src.snapshots : []).slice(-30).map((s) => ({
    id: newId(), at: Number(s?.at) || Date.now(), label: String(s?.label || ""), body: String(s?.body || ""),
  }));
  return post;
}

// ---- posts ----
function index() { return read(localStorage, INDEX_KEY, []); }
function saveIndex(ids) { write(localStorage, INDEX_KEY, ids); }

export function listPosts() {
  return index().map((id) => read(localStorage, POST_PREFIX + id, null))
    .filter(Boolean).sort((a, b) => b.updated - a.updated);
}
export function getPost(id) { return read(localStorage, POST_PREFIX + id, null); }

/** Returns true on success; callers MUST surface false (quota / private mode). */
export function savePost(post) {
  post.updated = Date.now();
  const ok = write(localStorage, POST_PREFIX + post.id, post);
  if (ok) {
    const ids = index();
    if (!ids.includes(post.id)) { ids.push(post.id); saveIndex(ids); }
  }
  return ok;
}
export function deletePost(id) {
  try { localStorage.removeItem(POST_PREFIX + id); } catch {}
  saveIndex(index().filter((x) => x !== id));
}
export function importPost(obj) {
  if (!obj || typeof obj !== "object" || typeof obj.body !== "string") {
    throw new Error("That file doesn't look like a Drafting Desk post.");
  }
  const post = coercePost(obj);
  post.id = newId(); // imports never overwrite an existing post
  savePost(post);
  return post;
}
export function exportAll() {
  return { app: "drafting-desk", version: 4, exported: new Date().toISOString(), posts: listPosts() };
}

// ---- v3 migration: dd.posts.v1 -> per-post keys, once ----
export function migrateV3() {
  if (localStorage.getItem("dd2.migrated-v3")) return 0;
  const old = read(localStorage, V3_POSTS_KEY, null);
  let n = 0;
  if (old && typeof old === "object") {
    for (const src of Object.values(old)) {
      if (!src || typeof src !== "object") continue;
      // v3 posts are already v2-shaped (body + notes); snapshots move with them.
      const post = coercePost({ ...src, finishedAt: src.status === "Published" || src.status === "Ready" ? (src.updated || null) : null });
      if (savePost(post)) n++;
    }
  }
  try { localStorage.setItem("dd2.migrated-v3", "1"); } catch {}
  return n;
}

// ---- settings ----
export const DEFAULT_SETTINGS = {
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
  rememberKeys: false, // v4 fix: session-only by default
  defaultVoice: "",
  extraFrontMatter: "",
  notesOpen: true,
  suggestionsOn: true,
};
let settingsCache = null;
export function getSettings() {
  if (settingsCache) return settingsCache;
  const s = read(localStorage, SETTINGS_KEY, {});
  settingsCache = {
    ...DEFAULT_SETTINGS, ...s,
    models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) },
    baseUrls: { ...DEFAULT_SETTINGS.baseUrls, ...(s.baseUrls || {}) },
  };
  return settingsCache;
}
export function saveSettings(s) {
  settingsCache = s;
  return write(localStorage, SETTINGS_KEY, s);
}

// ---- secrets ----
function secretStore() { return getSettings().rememberKeys ? localStorage : sessionStorage; }
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
