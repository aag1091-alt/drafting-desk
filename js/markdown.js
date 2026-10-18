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

export function postToMarkdown(post, { frontMatter = true } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  let md = frontMatter ? `---\nlayout: post\ntitle: "${post.title.replace(/"/g, '\\"')}"\ndate: ${date}\n---\n\n` : `# ${post.title}\n\n`;
  for (const s of post.sections) {
    if (!s.prose.trim()) continue;
    md += `## ${s.name}\n\n${s.prose.trim()}\n\n`;
  }
  return md.trimEnd() + "\n";
}

export function slugify(t) {
  return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "post";
}
