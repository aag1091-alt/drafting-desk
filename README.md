# Drafting Desk (v4 rebuild)

A desk for writing blog posts yourself. Paste rough notes, write in your own voice, and get quiet help — grammar fixes, clearer wording, questions that get you unstuck, and "what next" directions — from the model you choose. It doesn't write the post for you.

Static web app, no server, no account, no build step, zero dependencies. Your posts live only in your browser (localStorage, one key per post). The assistant is optional; when you use it, only the text you ask about goes straight from your browser to the provider you pick.

**Design rule: the concept budget is 7** — Post, Note, Suggestion, What Next, History, Settings, Finish. Any new concept must delete an old one. (v3 had ~35 concepts; this rebuild came out of a full code + UX audit of v3.)

## The screen

- **Home:** one box — paste rough notes or just start typing — and your posts. Nothing else.
- **Editor:** header (← Posts · title · History · **Finish →**), a plain Notes column on the left (one list; Insert at cursor; a note containing a link is a source), and the draft in the centre (serif, 68ch, a plain textarea — native undo, no tricks). Pasting several paragraphs to start offers one choice, once: keep as draft, or split into notes.
- **Suggestions** appear as labelled blocks in one stable stream under the draft — never in a moving margin. One is expanded at a time. Your partner checks the paragraph you just left when you pause (toggle: **Suggestions** in the footer), at most two at a time, and stays quiet on failure or when there's nothing useful.
- **Select text** and a strip appears above the footer: **Fix · Clearer · I'm stuck · Note**. Note always works, with or without a model.
- **✦ What next?** (footer) gives up to 3 directions — or, with no model connected, the notes you haven't used yet. *Write this* puts the direction in a cue banner above the draft; the cue is not part of the post and disappears as you write.
- **Finish →** is one dialog: blockers-only checks (with jump-to), title / description / tags (with model suggestions if connected), a reading preview, and **Download .md** with Jekyll front matter. Downloading marks the post finished.
- **History** is a drawer of snapshots (auto-saved when you open a post, plus manual ones). Restoring saves your current draft first.

## Bring your own model

OpenRouter (sign-in or key), Anthropic, OpenAI, Google Gemini, Ollama (local), or another OpenAI-compatible endpoint — in Settings. Keys are kept in the tab's session by default; tick "Remember keys" only if you want them to persist on the device. Note: the Content-Security-Policy only allows connections to the listed provider hosts and localhost, so a custom endpoint on another public host needs its host added to the CSP in `index.html`.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(ES modules don't load from `file://`.)

## Tests

```sh
node tests/run.mjs
```

Covers the pure modules (diff, markdown round-trip, prompt contracts). UI behaviour is verified by hand in a browser.

## Data & migration

v4 stores posts under `dd2.post.<id>` with a `dd2.index`. On first run it migrates v3 posts (`dd.posts.v1`) automatically — body, notes (flattened to text), and snapshots carry over; v3 statuses become a finished stamp for Ready/Published posts. Back up any time from the home page or Settings → Your data.

## Deploy to GitHub Pages

Same shape as v3: publish the repo root via the included Pages workflow (Settings → Pages → Source: GitHub Actions). The v4 files replace `index.html`, `assets/`, and `js/`; asset URLs are no longer stamped — bump the stylesheet/script names if you ever need cache-busting.

## License

MIT
