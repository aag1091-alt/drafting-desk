# Drafting Desk

A desk for writing blog posts yourself. Keep notes and research beside your draft. When you want help, an assistant fixes grammar, shows where a sentence is unclear, and asks the questions that get you unstuck. It doesn't write the post for you.

It's a static web app with no server and no account. Your posts live only in your browser. The assistant is optional; when you use it, only the text you ask about goes, straight from your browser, to the model provider you choose.

## How it works

You type the draft. The assistant suggests, and nothing changes in your draft until you accept it. Accepted changes go through the browser's own Undo, so Cmd/Ctrl+Z still works.

| Tool | What it does | Shortcut |
| --- | --- | --- |
| Fix grammar | Spelling, grammar and punctuation only, shown as a word-level diff. | Cmd/Ctrl+Alt+1 |
| Clarify | Says what a reader might trip on and offers two or three wordings close to yours. | Cmd/Ctrl+Alt+2 |
| Prompt me | Questions about what to say next, based on your draft and notes. You answer in your own words. | Cmd/Ctrl+Alt+3 |
| Review | An editor's margin notes on the whole draft, each tied to a quote you can jump to. No rewrites. | Cmd/Ctrl+Alt+4 |

Tools act on your selection, or on the paragraph (sentence, for Clarify) your cursor is in.

Beside the draft you get a **Notes & research** panel for notes, sources with links, and saved questions, with search, "Insert" into the draft, and "Outline from notes". **Versions** saves snapshots: automatically the first time you edit each day and before any restore, plus whenever you click Save. A **"% your words"** counter shows roughly how much of the draft came from accepted suggestions rather than your own typing. **Focus** hides everything but the draft. **Export** previews the post and downloads Markdown with optional Jekyll front matter.

## Bring your own model

| Provider | How you connect | Notes |
| --- | --- | --- |
| OpenRouter | **Sign in with OpenRouter** (OAuth PKCE), or paste a key | One sign-in gives you Claude, GPT, Gemini, Llama, Qwen and more. Usage is billed to your OpenRouter account. |
| Anthropic | API key | Calls `api.anthropic.com` directly with the `anthropic-dangerous-direct-browser-access` header. |
| OpenAI | API key | Calls `api.openai.com` directly. |
| Google Gemini | API key from AI Studio | Uses Gemini's OpenAI-compatible endpoint. |
| Ollama | Server address | Set `OLLAMA_ORIGINS=https://<your-pages-host>` and restart Ollama. Browsers allow `http://localhost` from an https page; a server on another machine needs an https address, for example `tailscale serve --bg 11434` (and `OLLAMA_HOST=0.0.0.0`). |
| Other OpenAI-compatible | Base URL, optional key | LM Studio, vLLM, llama.cpp server, anything with `/v1/chat/completions`. |

"List models" in Settings pulls the provider's current model list, so you aren't stuck with the defaults.

## Privacy and keys

Posts (draft, notes, versions) are stored in `localStorage` under random 12-character ids. Keys are stored in `localStorage` if you tick "Remember keys on this device", otherwise in `sessionStorage` (gone when the tab closes). "Forget all keys" wipes them. The page loads no third-party scripts, fonts or analytics, and a Content-Security-Policy restricts scripts to this site's own files.

A key in browser storage is readable by anything that runs on this origin, so use a key with a spending limit, and prefer OpenRouter's sign-in (you can revoke it any time from your OpenRouter account). Use "Back up all" on the home page to export your posts as JSON; "Import" restores them on another browser.

## Run it locally

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

ES modules don't load from `file://`, so opening `index.html` directly won't work.

## Deploy to GitHub Pages

The included workflow (`.github/workflows/pages.yml`) publishes the repo root on every push to `main`. In the repo's Settings → Pages, set **Source** to **GitHub Actions** once.

## Files

```
index.html            page shell and dialogs
assets/app.css        styles (light and dark)
js/app.js             UI and routing (#/ and #/p/<id>)
js/diff.js            word-level diff for suggestions
js/store.js           localStorage persistence for posts, settings and keys
js/providers.js       provider calls, streaming, OpenRouter OAuth
js/prompts.js         the prompts sent to the model
js/markdown.js        Markdown export and a small safe preview renderer
samples/              the example post
```

## License

MIT
