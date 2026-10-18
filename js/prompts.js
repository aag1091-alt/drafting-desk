import { PHRASING_RULES } from "./store.js";

export function phrasePrompt(post, section) {
  const others = post.sections
    .filter((s) => s.id !== section.id && s.prose.trim())
    .map((s) => `## ${s.name}\n${s.prose.trim()}`)
    .join("\n\n");
  const system = `You help a writer turn rough notes into a section of their own blog post. Follow the voice guide exactly.\n\nVOICE GUIDE\n${post.voice}\n\n${PHRASING_RULES}`;
  const prompt = `POST TITLE: ${post.title}
SECTION: ${section.name}

THE WRITER'S ROUGH NOTES (what they actually want to say; keep their words and phrasings):
${section.notes.trim()}

REFERENCE FACTS (optional; use only what the notes point at; when you use a number, keep its markdown link):
${section.facts.trim() || "(none)"}
${others ? `\nOTHER SECTIONS ALREADY WRITTEN (for continuity only; don't repeat them):\n${others.slice(0, 6000)}\n` : ""}
Write the body of this section only, about ${post.length} words, as Markdown paragraphs. No heading, no preamble, no closing summary. Output nothing but the prose.`;
  return { system, prompt };
}

export function questionsPrompt(post, section) {
  return {
    system: "You are a sharp, friendly editor interviewing a writer to draw out their own experience and opinions.",
    prompt: `The writer is drafting the section "${section.name}" of a post titled "${post.title}".

Questions already asked:
${section.questions.map((q) => "- " + q).join("\n") || "(none)"}

Their notes so far:
${section.notes.trim() || "(none yet)"}

Reference facts they have:
${section.facts.trim() || "(none)"}

Write 3 new, specific follow-up questions that pull out their own experience, opinions, or concrete examples: things only they can answer, not facts they could look up. Don't repeat the questions above. Reply with only a JSON array of 3 strings.`,
  };
}

export function outlinePrompt(title, idea) {
  return {
    system: "You are an editor helping a writer plan a blog post.",
    prompt: `Post title: ${title}
What it's about, in the writer's words: ${idea || "(not given)"}

Propose 4 to 7 sections. For each, write a short section name and 4 interview questions that get the writer to say what they think, in their own words (their experience, opinions, examples). Reply with only JSON: [{"name": string, "questions": [string, ...]}, ...]`,
  };
}

export function voicePrompt(samples) {
  return {
    system: "You are an editor who describes a writer's voice precisely enough that another writer could imitate it.",
    prompt: `Here are writing samples by one author:

${samples.slice(0, 30000)}

Write a voice guide for this author as 6 to 9 short bullet points covering: person and stance, sentence length and rhythm, how they open, how they handle opinions and uncertainty, structure (headings, lists vs paragraphs), word choice and things they avoid, humor. Then add one line starting "Sample of their prose:" with two short sentences quoted from the samples. Reply with only the guide.`,
  };
}
