// Zero-dependency tests for the pure modules: node tests/run.mjs
import assert from "node:assert";
import { wordDiff, changeCount, paraDiff } from "../js/diff.js";
import { renderMarkdown, postToMarkdown, slugify, parseMarkdownPost, wordCount } from "../js/markdown.js";
import * as P from "../js/prompts.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

ok("wordDiff marks only the changed word", () => {
  const parts = wordDiff("its a test", "it's a test");
  assert.equal(changeCount(parts), 1);
  assert.ok(parts.some((p) => p.type === "add" && p.text.includes("it's")));
});
ok("wordDiff guard survives long inputs", () => {
  const a = "word ".repeat(3000), b = "other ".repeat(3000);
  assert.ok(wordDiff(a, b).length >= 2);
});
ok("paraDiff pairs an edit", () => {
  const d = paraDiff("Hello world today", "Hello world tomorrow");
  assert.ok(d.some((x) => x.type === "edit"));
});
ok("renderMarkdown escapes HTML before formatting", () => {
  const html = renderMarkdown("<script>alert(1)</script>\n\n**bold**");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("<strong>bold</strong>"));
});
ok("renderMarkdown only links https", () => {
  assert.ok(!renderMarkdown("[x](javascript:alert(1))").includes("href=\"javascript:"));
  assert.ok(renderMarkdown("[x](https://example.com)").includes("href=\"https://example.com\""));
});
ok("postToMarkdown writes Jekyll front matter", () => {
  const md = postToMarkdown({ title: 'My "Post"', body: "Body text.", description: "Desc", tags: "ai, web" });
  assert.ok(md.startsWith("---\nlayout: post\n"));
  assert.ok(md.includes('title: "My \\"Post\\"'));
  assert.ok(md.includes('tags: ["ai", "web"]'));
  assert.ok(md.endsWith("Body text.\n"));
});
ok("slugify", () => assert.equal(slugify("Hello, World! 2026"), "hello-world-2026"));
ok("parseMarkdownPost round trip", () => {
  const src = postToMarkdown({ title: "Round Trip", body: "Some body.", description: "D", tags: "a, b" });
  const back = parseMarkdownPost(src);
  assert.equal(back.title, "Round Trip");
  assert.equal(back.description, "D");
  assert.ok(back.body.includes("Some body."));
});
ok("wordCount", () => assert.equal(wordCount(" one  two\nthree "), 3));
ok("prompts keep the editorial contract", () => {
  const post = { title: "T", body: "Some draft text here.", voice: "- plain", notes: [] };
  const g = P.grammarPrompt(post, "teh text");
  assert.ok(g.system.includes("smallest possible edits") || g.prompt.includes("smallest possible"));
  const partner = P.partnerPrompt(post, "A paragraph.", "ctx");
  assert.ok(partner.system.includes("Most of the time the right answer is to say nothing"));
  const ask = P.askPrompt(post, "write my intro");
  assert.ok(ask.system.includes("Do not write paragraphs"));
});

console.log(`\n${n} tests passed`);
