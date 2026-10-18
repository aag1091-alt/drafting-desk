// Model providers, all called straight from the browser. No proxy, no server.
import { getSecret, setSecret, getSettings } from "./store.js?v=__V__";

export const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    tag: "Easiest",
    blurb: "Sign in once and use Claude, GPT, Gemini, Llama, Qwen and more. No key to copy.",
    auth: "oauth",
    keyHelp: "https://openrouter.ai/settings/keys",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    blurb: "Your own Anthropic API key, sent only to api.anthropic.com.",
    auth: "key",
    keyHelp: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    blurb: "Your own OpenAI API key, sent only to api.openai.com.",
    auth: "key",
    keyHelp: "https://platform.openai.com/api-keys",
  },
  gemini: {
    label: "Google Gemini",
    blurb: "Your own Gemini API key from Google AI Studio.",
    auth: "key",
    keyHelp: "https://aistudio.google.com/apikey",
  },
  ollama: {
    label: "Ollama (local)",
    tag: "Free & private",
    blurb: "A model running on your own machine. Nothing leaves your network.",
    auth: "url",
  },
  custom: {
    label: "Other OpenAI-compatible",
    blurb: "LM Studio, vLLM, llama.cpp server, or any /v1/chat/completions endpoint.",
    auth: "url+key",
  },
};

// ---------- OpenRouter OAuth (PKCE) ----------
const PKCE_KEY = "dd.pkce";

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startOpenRouterLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, back: location.hash }));
  const callback = location.origin + location.pathname;
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", callback);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("key_label", "Drafting Desk");
  location.assign(url.toString());
}

/** Call on page load. Returns the hash to return to if a login just completed. */
export async function finishOpenRouterLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return null;
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || "null");
  sessionStorage.removeItem(PKCE_KEY);
  // Strip ?code=… from the address bar right away.
  history.replaceState(null, "", location.pathname + (saved?.back || ""));
  if (!saved) throw new Error("Sign-in expired. Please try again.");
  const st = params.get("state");
  if (st && st !== saved.state) throw new Error("Sign-in check failed. Please try again.");
  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: saved.verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) throw new Error(`OpenRouter sign-in failed (${res.status}). Please try again.`);
  const { key } = await res.json();
  if (!key) throw new Error("OpenRouter didn't return a key.");
  setSecret("openrouter", key);
  return saved.back || "";
}

// ---------- readiness ----------
export function isReady(settings = getSettings()) {
  const p = settings.provider;
  const model = settings.models[p];
  if (!model) return false;
  if (p === "ollama") return !!settings.baseUrls.ollama;
  if (p === "custom") return !!settings.baseUrls.custom;
  return !!getSecret(p);
}

export function notReadyReason(settings = getSettings()) {
  const p = settings.provider;
  if (!settings.models[p]) return "Enter a model name, or use List models.";
  if (p === "ollama" || p === "custom") return "Add the server address first.";
  if (p === "openrouter") return "Sign in with OpenRouter (or paste a key) first.";
  return `Paste your ${PROVIDERS[p].label} API key first.`;
}

// ---------- model lists ----------
export async function listModels(settings = getSettings()) {
  const p = settings.provider;
  const key = getSecret(p);
  const j = async (url, init) => {
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`Couldn't list models (${r.status}).`);
    return r.json();
  };
  if (p === "openrouter") {
    const d = await j("https://openrouter.ai/api/v1/models");
    return d.data.map((m) => m.id).sort();
  }
  if (p === "anthropic") {
    const d = await j("https://api.anthropic.com/v1/models?limit=100", { headers: anthropicHeaders(key) });
    return d.data.map((m) => m.id);
  }
  if (p === "openai") {
    const d = await j("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    return d.data.map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id)).sort();
  }
  if (p === "gemini") {
    const d = await j(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
    return d.models
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  }
  if (p === "ollama") {
    const d = await j(trimSlash(settings.baseUrls.ollama) + "/api/tags");
    // Embedding-only models can't chat; hide them.
    return d.models
      .filter((m) => !Array.isArray(m.capabilities) || m.capabilities.includes("completion"))
      .filter((m) => !/embed|minilm|bge|e5-/i.test(m.name))
      .map((m) => m.name);
  }
  if (p === "custom") {
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const d = await j(trimSlash(settings.baseUrls.custom) + "/models", { headers });
    return d.data.map((m) => m.id);
  }
  return [];
}

// ---------- chat ----------
function trimSlash(u) {
  return String(u || "").replace(/\/+$/, "");
}
function anthropicHeaders(key) {
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    "content-type": "application/json",
  };
}

/** Where an OpenAI-style request goes for each provider. */
function openaiTarget(p, settings, key) {
  switch (p) {
    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/chat/completions",
        headers: {
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": location.origin,
          "X-Title": "Drafting Desk",
        },
      };
    case "openai":
      return { url: "https://api.openai.com/v1/chat/completions", headers: { Authorization: `Bearer ${key}` } };
    case "gemini":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        headers: { Authorization: `Bearer ${key}` },
      };
    case "ollama":
      return { url: trimSlash(settings.baseUrls.ollama) + "/v1/chat/completions", headers: {} };
    case "custom": {
      const base = trimSlash(settings.baseUrls.custom);
      return {
        url: base.endsWith("/chat/completions") ? base : base + "/chat/completions",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      };
    }
  }
  throw new Error("Unknown provider");
}

/** Read a Server-Sent Events body, calling onData with each `data:` payload. */
async function readSSE(res, onData, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") onData(data);
      }
    }
  }
}

async function failure(res, label) {
  let detail = "";
  try {
    const t = await res.text();
    const j = JSON.parse(t);
    detail = j.error?.message || j.message || t.slice(0, 200);
  } catch {}
  const hint =
    res.status === 401 || res.status === 403 ? " Check your key or sign in again in Settings."
    : res.status === 429 ? " You're being rate limited; wait a minute and try again."
    : "";
  return new Error(`${label} returned ${res.status}${detail ? `: ${detail}` : "."}${hint}`);
}

/**
 * Send one prompt, stream the reply.
 * @param {{system?: string, prompt: string, onText?: (full: string) => void, signal?: AbortSignal, maxTokens?: number}} opts
 * @returns {Promise<string>} the full reply
 */
const noTemperature = new Set(); // models that refused a temperature setting this session

export async function complete(opts) {
  const settings = getSettings();
  const modelKey = settings.provider + ":" + settings.models[settings.provider];
  const temp = noTemperature.has(modelKey) ? undefined : opts.temperature;
  try {
    return await completeOnce({ ...opts, temperature: temp });
  } catch (e) {
    // Some newer models reject sampling settings; retry once without.
    if (temp != null && /temperature/i.test(e.message) && !e.cancelled && !(e.partial || "").length) {
      noTemperature.add(modelKey);
      return completeOnce({ ...opts, temperature: undefined });
    }
    throw e;
  }
}

async function completeOnce({ system, prompt, onText, signal, maxTokens = 2000, temperature }) {
  const settings = getSettings();
  const p = settings.provider;
  // Hosted models may think before answering, and thinking counts against the
  // limit; give generous headroom (you only pay for what's used).
  const budget = p === "ollama" || p === "custom" ? maxTokens : maxTokens + 6000;
  let stopReason = "";
  const model = settings.models[p];
  const key = getSecret(p);
  const label = PROVIDERS[p]?.label || p;
  if (!isReady(settings)) throw new Error(notReadyReason(settings));

  let full = "";
  const push = (t) => {
    if (!t) return;
    full += t;
    onText?.(full);
  };

  let res;
  try {
    if (p === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: anthropicHeaders(key),
        body: JSON.stringify({
          model,
          max_tokens: budget,
          stream: true,
          ...(temperature != null ? { temperature } : {}),
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw await failure(res, label);
      await readSSE(res, (d) => {
        const ev = JSON.parse(d);
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") push(ev.delta.text);
        if (ev.type === "message_delta" && ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.type === "error") throw new Error(ev.error?.message || "Anthropic stream error");
      }, signal);
      checkComplete(stopReason === "max_tokens", full);
      return full;
    }

    const t = openaiTarget(p, settings, key);
    const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
    res = await fetch(t.url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", ...t.headers },
      // OpenAI's newer models want max_completion_tokens; everyone else takes max_tokens.
      body: JSON.stringify({
        model, messages, stream: true,
        ...(temperature != null && !(p === "openai" && /^o\d/.test(model)) ? { temperature } : {}),
        ...(p === "openai" ? { max_completion_tokens: budget } : { max_tokens: budget }),
      }),
    });
    if (!res.ok) throw await failure(res, label);
    await readSSE(res, (d) => {
      const ev = JSON.parse(d);
      if (ev.error) throw new Error(ev.error.message || "Stream error");
      push(ev.choices?.[0]?.delta?.content || "");
      if (ev.choices?.[0]?.finish_reason) stopReason = ev.choices[0].finish_reason;
    }, signal);
    checkComplete(stopReason === "length", full);
    return full;
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error("Stopped.");
      err.cancelled = true;
      err.partial = full;
      throw err;
    }
    if (e instanceof TypeError) {
      // fetch() network/CORS failure
      const local = p === "ollama" || p === "custom";
      const err = new Error(
        local
          ? `Couldn't reach ${label} at its address. Is it running, and does it allow this site? For Ollama, start it with OLLAMA_ORIGINS=${location.origin}.`
          : `Couldn't reach ${label}. Check your connection and try again.`
      );
      err.partial = full;
      throw err;
    }
    e.partial = full;
    throw e;
  }
}

/** A reply that hit the length limit is incomplete; never hand it to the UI as if it were whole. */
function checkComplete(truncated, full) {
  if (!truncated) return;
  const err = new Error("The reply was cut short before it finished. Try a shorter selection, or try again.");
  err.partial = full;
  err.truncated = true;
  throw err;
}

/** Ask for JSON; tolerant of code fences or a sentence around it. */
export async function completeJSON(opts) {
  const text = await complete(opts);
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
  if (start < 0 || end < start) throw new Error("The model didn't return a list. Try again.");
  return JSON.parse(body.slice(start, end + 1));
}
