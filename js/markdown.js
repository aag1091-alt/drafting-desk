// A tiny, safe Markdown renderer for the preview: escapes everything first,
// then adds back a small set of formatting. Good enough for blog prose.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

export function renderMarkdown(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const html = [];
  let para = [];
  let list = null; // {tag, items}
  let code = null;

  const flushPara = () => { if (para.length) { html.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };

  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { html.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushPara(); flushList(); const n = Math.min(h[1].length + 1, 4); html.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (/^\s*>\s?/.test(line)) { flushPara(); flushList(); html.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ""))}</blockquote>`); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list) flushList();
    para.push(line.trim());
  }
  if (code !== null) html.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  flushPara(); flushList();
  return html.join("\n");
}

export function postToMarkdown(post, { frontMatter = true, extra = "" } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const q = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const tags = String(post.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  const head = frontMatter
    ? "---\nlayout: post\n" +
      `title: ${q(post.title)}\ndate: ${date}\n` +
      (post.description ? `description: ${q(post.description)}\n` : "") +
      (tags.length ? `tags: [${tags.map(q).join(", ")}]\n` : "") +
      frontMatterExtra(extra, post, date) +
      "---\n\n"
    : `# ${post.title}\n\n${post.description ? `*${post.description}*\n\n` : ""}`;
  const body = post.body.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return (head + body).trimEnd() + "\n";
}

/** Extra front-matter lines from the user's template; {{slug}}, {{date}}, {{title}} are filled in. */
function frontMatterExtra(extra, post, date) {
  const lines = String(extra || "").split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() && !/^(layout|title|date|description|tags):/i.test(l.trim()) && !/^---/.test(l));
  if (!lines.length) return "";
  return lines.map((l) => l.replace(/\{\{\s*slug\s*\}\}/g, slugify(post.title)).replace(/\{\{\s*date\s*\}\}/g, date).replace(/\{\{\s*title\s*\}\}/g, post.title)).join("\n") + "\n";
}

export function wordCount(s) {
  return (String(s).trim().match(/\S+/g) || []).length;
}

export function slugify(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "post";
}

/** Turn a Markdown file (optionally with Jekyll front matter) into post fields. */
export function parseMarkdownPost(text, filename = "") {
  let body = String(text).replace(/\r\n/g, "\n");
  const fields = {};
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = body.slice(fm[0].length);
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean).join(", ");
      else v = v.replace(/^["']|["']$/g, "").replace(/\\"/g, '"');
      fields[m[1].toLowerCase()] = v;
    }
  }
  let title = fields.title || "";
  if (!title) {
    const h1 = body.match(/^#\s+(.+)\n+/);
    if (h1) { title = h1[1].trim(); body = body.slice(h1.index + h1[0].length); }
  }
  if (!title) title = filename.replace(/\.(md|markdown|txt)$/i, "").replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/[-_]+/g, " ").trim().replace(/^./, (c) => c.toUpperCase()) || "Imported post";
  return { title, body: body.replace(/^\s+/, ""), description: fields.description || fields.excerpt || "", tags: fields.tags || fields.categories || "" };
}
