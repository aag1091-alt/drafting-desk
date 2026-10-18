// Word-level diff (LCS) so a suggestion shows exactly what would change.

function tokenize(s) {
  // words, whitespace runs and punctuation as separate tokens
  return String(s).match(/\s+|[\p{L}\p{N}'’_-]+|[^\s\p{L}\p{N}]/gu) || [];
}

/** @returns {{type: "same"|"add"|"del", text: string}[]} */
export function wordDiff(a, b) {
  const A = tokenize(a), B = tokenize(b);
  const n = A.length, m = B.length;
  // Guard: very long inputs fall back to a whole replacement.
  if (n * m > 4_000_000) return [{ type: "del", text: a }, { type: "add", text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", A[i]); i++; }
    else { push("add", B[j]); j++; }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}

/** Characters added by going from a to b (what counts as AI-written). */
export function addedChars(a, b) {
  return wordDiff(a, b).filter((p) => p.type === "add").reduce((n, p) => n + p.text.replace(/\s+/g, "").length, 0);
}

/** Corrections: a run of changes separated only by spaces counts as one. */
export function changeCount(parts) {
  let n = 0, inChange = false;
  for (const p of parts) {
    if (p.type === "same") { if (p.text.trim()) inChange = false; continue; }
    if (!p.text.trim()) continue;
    if (!inChange) { n++; inChange = true; }
  }
  return n;
}

function similarity(a, b) {
  const wa = new Set(a.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []), wb = new Set(b.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);
  if (!wa.size || !wb.size) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / Math.max(wa.size, wb.size);
}

/** Paragraph-level diff: unchanged, moved, edited (with word diff), added, removed. */
export function paraDiff(a, b) {
  const A = String(a).split(/\n{2,}/).filter((x) => x.trim()), B = String(b).split(/\n{2,}/).filter((x) => x.trim());
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const raw = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { raw.push({ type: "same", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ type: "del", text: A[i++] }); }
    else { raw.push({ type: "add", text: B[j++] }); }
  }
  while (i < n) raw.push({ type: "del", text: A[i++] });
  while (j < m) raw.push({ type: "add", text: B[j++] });
  // a paragraph removed in one place and added in another is a move
  const adds = raw.filter((r) => r.type === "add");
  for (const r of raw) {
    if (r.type !== "del") continue;
    const twin = adds.find((x) => !x.matched && x.text === r.text);
    if (twin) { twin.matched = true; r.type = "moved-from"; twin.type = "moved-to"; }
  }
  // pair a removal followed by a similar addition into an edit
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k], nx = raw[k + 1];
    if (r.type === "del" && nx?.type === "add" && similarity(r.text, nx.text) >= 0.3) { out.push({ type: "edit", before: r.text, after: nx.text, parts: wordDiff(r.text, nx.text) }); k++; }
    else out.push(r);
  }
  return out;
}
