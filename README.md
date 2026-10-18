# Drafting Desk

A desk for writing blog posts yourself. Keep notes and research beside your draft. When you want help, an assistant fixes grammar, shows where a sentence is unclear, and asks the questions that get you unstuck. It doesn't write the post for you.

It's a static web app with no server and no account. Your posts live only in your browser. The assistant is optional; when you use it, only the text you ask about goes, straight from your browser, to the model provider you choose.

## How it works

The page is mostly writing space. On the right sits your **partner**, which reads along like a pairing partner and leaves short notes in the margin beside the paragraph they're about:

- **Reads better as**: a wording close to yours, with only the changed words shown. Click Use, or Not now.
- **Typo**: a one-line fix with the word underlined in your text.
- **You could add / A reader might ask**: ideas and questions; click one to start a paragraph on it, or save it to notes.
- **What next**: when you pause at the end, two or three directions you could take, drawn from your notes.

It only chimes in when you pause, only about paragraphs you've just written or changed, and stays quiet if it has nothing useful. Turn off **Chime in** and it waits until you ask. Nothing changes in your draft until you accept, and accepted changes go through the browser's own Undo (Cmd/Ctrl+Z).

Select any words in your draft and a toolbar appears:

| Tool | What it does | Shortcut |
| --- | --- | --- |
| Fix grammar | Spelling, grammar and punctuation only. You see every change before accepting. | Cmd/Ctrl+Alt+1 |
| Make it clearer | What a reader might trip on, with wordings close to yours to pick from. | Cmd/Ctrl+Alt+2 |
| I'm stuck | Questions that get you thinking. You answer them in your own words. | Cmd/Ctrl+Alt+3 |
| Review draft | An editor's notes on the whole draft, highlighted in your text. | Cmd/Ctrl+Alt+4 |
| Ask | Ask your partner anything about the passage. It answers like an editor and won't write paragraphs for you. | |
| Note | Attach a note to those words. | |

Under the partner:

- **Notes & research**: notes, sources with links (paste an excerpt and summarize it), saved questions, search, and "Suggest outline" built only from your notes. Notes can be **linked to text**: attach one from the selection toolbar, or select words and click "Link to text" on an existing note. Linked passages get a dotted underline; hovering the note lights up the passage, clicking its quote jumps there, and putting your cursor in the passage highlights the note.
- **Versions**: saved when you open a post, before any big deletion, every 20 minutes of writing, and on demand. Compare any version with now, paragraph by paragraph, and copy back a single paragraph.
- **Finishing**: Title ideas built from phrases you already wrote, a description helper, tags, a "Before you publish" checklist, Preview, and Export to Markdown with Jekyll front matter (plus your own front-matter template with `{{slug}}`, `{{date}}`, `{{title}}`). In Chrome and Edge you can save straight into your blog's `_posts` or `_drafts` folder.
- **Focus** hides everything but the draft (Esc to leave). On phones the partner sits below your text, and a small badge tells you when it has something.

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
js/markdown.js        Markdown export/import and a small safe preview renderer
js/folder.js          save into a folder on your computer (File System Access API)
samples/              the example post
```

## License

MIT
