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

/** Corrections, counting a deletion followed by its replacement as one. */
export function changeCount(parts) {
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === "same" || !p.text.trim()) continue;
    n++;
    if (p.type === "del" && parts[i + 1]?.type === "add") i++;
  }
  return n;
}

/** Paragraph-level diff, with word diffs inside paragraphs that changed. */
export function paraDiff(a, b) {
  const A = String(a).split(/\n{2,}/), B = String(b).split(/\n{2,}/);
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
  // pair a deletion followed by an addition into an edited paragraph
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k], nx = raw[k + 1];
    if (r.type === "del" && nx?.type === "add") { out.push({ type: "edit", parts: wordDiff(r.text, nx.text) }); k++; }
    else out.push(r);
  }
  return out;
}
