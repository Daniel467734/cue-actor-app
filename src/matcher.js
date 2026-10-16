// Fuzzy line matching: aligns what the actor said against the expected line.

const NUM = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20',
};

export function stripDirections(text) {
  return String(text || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[*_]/g, '');
}

export function tokenize(text) {
  return stripDirections(text)
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/(\w)'(\w)/g, '$1$2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUM[w] || w);
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function wordEq(a, b, level = 2) {
  if (a === b) return true;
  if (level >= 3) return false;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  const max = len >= 7 ? 2 : 1;
  return lev(a, b, max) <= max;
}

export const STRICTNESS = {
  1: { name: 'Relaxed', threshold: 0.6, extraPenalty: 0 },
  2: { name: 'Normal', threshold: 0.8, extraPenalty: 0.2 },
  3: { name: 'Strict', threshold: 0.97, extraPenalty: 0.5 },
};

// Returns how well `spoken` covers `expected`.
export function matchLine(expected, spoken, level = 2) {
  const E = tokenize(expected);
  const H = tokenize(spoken);
  const n = E.length;
  const m = H.length;
  const cfg = STRICTNESS[level] || STRICTNESS[2];
  const matched = new Array(n).fill(false);
  if (n === 0) return { score: 1, matched, missing: [], needed: 0, hits: 0, extras: 0, complete: true, lastHit: -1, tokens: E };
  if (m === 0) return { score: 0, matched, missing: E.slice(), needed: Math.ceil(n * cfg.threshold), hits: 0, extras: 0, complete: false, lastHit: -1, tokens: E };

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = wordEq(E[i - 1], H[j - 1], level)
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (wordEq(E[i - 1], H[j - 1], level) && dp[i][j] === dp[i - 1][j - 1] + 1) {
      matched[i - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  const hits = dp[n][m];
  const extras = Math.max(0, m - hits);
  const score = Math.max(0, hits / (n + extras * cfg.extraPenalty));
  const needed = n <= 3 && level >= 2 ? n : Math.ceil(n * cfg.threshold);
  const lastHit = matched.lastIndexOf(true);
  return {
    score,
    matched,
    missing: E.filter((_, k) => !matched[k]),
    needed,
    hits,
    extras,
    lastHit,
    tokens: E,
    complete: hits >= needed && score >= Math.min(cfg.threshold, needed / n) - 1e-9,
  };
}

// Words of the original (display) text, with the index of the matching token (or -1 for non-words).
export function displayWords(text) {
  const out = [];
  let tokenIdx = 0;
  for (const part of String(text).split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push({ text: part, token: -1 });
      continue;
    }
    const isDir = /^[([].*[)\]]$/.test(part);
    const toks = isDir ? [] : tokenize(part);
    if (toks.length) {
      out.push({ text: part, token: tokenIdx });
      tokenIdx += toks.length;
    } else out.push({ text: part, token: -1 });
  }
  return out;
}

// Words to hand the actor when they stall: the next few words after the last matched one.
export function hintFrom(expected, match, count = 3) {
  const words = stripDirections(expected).split(/\s+/).filter(Boolean);
  const start = Math.min(words.length, Math.max(0, match.lastHit + 1));
  const slice = words.slice(start, start + count);
  return (slice.length ? slice : words.slice(0, count)).join(' ');
}

const PROMPT_RE = /^(?:(?:i )?(?:need|want) (?:a |the )?(?:prompt|line|cue)|(?:prompt|line|cue)(?: please| me)?|give me (?:a |the )?(?:prompt|line|cue)|what(?:s| is) (?:my|the) (?:next )?line|(?:can i (?:have|get) (?:a |the )?(?:prompt|line))|help(?: me)?|i forgot|i dont know|im stuck)$/;
const SKIP_RE = /^(?:skip(?: (?:it|line|that|this))?|next line|move on|pass)$/;
const BACK_RE = /^(?:go back|back|previous(?: line)?|last line)$/;
const REPEAT_RE = /^(?:repeat(?: that| it| the line)?|say that again|again|(?:can you |please )?say (?:it|that) again|what was that|come again|pardon)$/;
const RESTART_RE = /^(?:start (?:over|again)|restart(?: line)?|from the top|take that again)$/;
const PAUSE_RE = /^(?:pause|hold on|hold please|wait|one moment|stop for a (?:sec|second|moment))$/;
const STOP_RE = /^(?:stop|end (?:rehearsal|session|scene)|finish|thats all|cut)$/;
const RESUME_RE = /^(?:resume|continue|go|carry on|ready|im ready|go ahead)$/;

// Recognise a spoken control command. Only short utterances count.
export function detectCommand(spoken) {
  const t = tokenize(spoken).join(' ');
  if (!t || t.split(' ').length > 6) return null;
  const clean = t.replace(/^(?:um |uh |okay |ok |sorry |hey cue |cue )+/, '').replace(/ (?:please|thanks)$/, (m) => (PROMPT_RE.test(t) ? m : ''));
  if (PROMPT_RE.test(clean) || PROMPT_RE.test(t)) return 'prompt';
  if (SKIP_RE.test(clean)) return 'skip';
  if (BACK_RE.test(clean)) return 'back';
  if (RESTART_RE.test(clean)) return 'restart';
  if (REPEAT_RE.test(clean)) return 'repeat';
  if (PAUSE_RE.test(clean)) return 'pause';
  if (STOP_RE.test(clean)) return 'stop';
  if (RESUME_RE.test(clean)) return 'resume';
  return null;
}
