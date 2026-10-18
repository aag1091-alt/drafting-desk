# Drafting Desk

Write a blog post the way you'd say it. Answer a few questions in rough notes on the left; get each section phrased in your own voice on the right. Edit both, then export Markdown for your blog.

It's a static web app. There's no server and no account. Your posts live only in your browser, and the only thing that leaves it is the prompt, sent straight from your browser to the model provider you choose.

## How it works

1. **New post.** Give it a working title and, optionally, a sentence about what it's about. The model can suggest sections with interview questions for each, or you can start blank.
2. **Answer in your words.** Click a question to drop it into your notes and answer roughly: fragments, bullets, half-sentences. "Ask me more" generates follow-up questions that pull out your own experience and opinions.
3. **Phrase it.** The model rewrites your notes into a section, keeping your own words and phrasings and adding no facts you didn't give it. Edit the result freely. "Restore previous version" swaps back if you liked the last one better.
4. **Voice.** Each post carries a voice guide that's sent with every request. Paste a few things you've written into "Learn my voice" and the model drafts the guide for you.
5. **Export.** Preview the whole post, copy it, or download a `.md` file with optional Jekyll front matter.

## Bring your own model

| Provider | How you connect | Notes |
| --- | --- | --- |
| OpenRouter | **Sign in with OpenRouter** (OAuth PKCE), or paste a key | One sign-in gives you Claude, GPT, Gemini, Llama, Qwen and more. Usage is billed to your OpenRouter account. |
| Anthropic | API key | Calls `api.anthropic.com` directly with the `anthropic-dangerous-direct-browser-access` header. |
| OpenAI | API key | Calls `api.openai.com` directly. |
| Google Gemini | API key from AI Studio | Uses Gemini's OpenAI-compatible endpoint. |
| Ollama | Server address | Start Ollama with `OLLAMA_ORIGINS=https://<your-pages-host> ollama serve`. Browsers allow `http://localhost` from an https page; a server on another machine needs an https address (for example `tailscale serve`). |
| Other OpenAI-compatible | Base URL, optional key | LM Studio, vLLM, llama.cpp server, anything with `/v1/chat/completions`. |

"List models" in Settings pulls the provider's current model list, so you aren't stuck with the defaults.

## Privacy and keys

Posts are stored in `localStorage` under random 12-character ids. Keys are stored in `localStorage` if you tick "Remember keys on this device", otherwise in `sessionStorage` (gone when the tab closes). "Forget all keys" wipes them. The page loads no third-party scripts, fonts or analytics, and a Content-Security-Policy restricts scripts to this site's own files.

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
js/app.js             UI and routing (#/ and #/p/<id>/<section>)
js/store.js           localStorage persistence for posts, settings and keys
js/providers.js       provider calls, streaming, OpenRouter OAuth
js/prompts.js         the prompts sent to the model
js/markdown.js        Markdown export and a small safe preview renderer
samples/              the example post
```

## License

MIT
