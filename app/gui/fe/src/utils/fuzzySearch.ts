/**
 * Lightweight fuzzy substring matcher with relevance scoring.
 * No external dependencies.
 */

export interface FuzzyResult {
  match: boolean;
  score: number;
}

/**
 * Fuzzy match a query against text.
 * Scoring: exact match (1.0) > prefix (0.9) > word-boundary (0.7) > subsequence (0.4) > no match (0).
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult {
  if (!query) return { match: true, score: 0 };
  if (!text) return { match: false, score: 0 };

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact match
  if (t === q) return { match: true, score: 1.0 };

  // Contains (exact substring)
  const idx = t.indexOf(q);
  if (idx !== -1) {
    // Prefix match scores higher than mid-string
    if (idx === 0) return { match: true, score: 0.9 };
    // Word boundary match (preceded by space, punctuation, etc.)
    if (/\W/.test(t[idx - 1])) return { match: true, score: 0.8 };
    return { match: true, score: 0.7 };
  }

  // Word-boundary subsequence: each query char matches at a word boundary
  if (wordBoundaryMatch(q, t)) return { match: true, score: 0.5 };

  // General subsequence match
  if (isSubsequence(q, t)) return { match: true, score: 0.4 };

  return { match: false, score: 0 };
}

function isSubsequence(query: string, text: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

function wordBoundaryMatch(query: string, text: string): boolean {
  // Check if each char in query can match at word boundaries in text
  let qi = 0;
  let prevWasBoundary = true; // Start of string is a boundary
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (prevWasBoundary && text[ti] === query[qi]) {
      qi++;
    }
    prevWasBoundary = /\W/.test(text[ti]);
  }
  return qi === query.length;
}

/**
 * Returns character index ranges [start, end) in `text` that match the `query` for highlighting.
 * Uses greedy left-to-right matching of query characters as a subsequence.
 */
export function fuzzyHighlightRanges(query: string, text: string): Array<[number, number]> {
  if (!query || !text) return [];

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Prefer contiguous substring match first
  const idx = t.indexOf(q);
  if (idx !== -1) {
    return [[idx, idx + query.length]];
  }

  // Fall back to subsequence character ranges
  const ranges: Array<[number, number]> = [];
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const start = ti;
      while (ti < t.length && qi < q.length && t[ti] === q[qi]) {
        ti++;
        qi++;
      }
      ranges.push([start, ti]);
      ti--; // outer loop will increment
    }
  }

  // Only return ranges if we matched the full query
  return qi === q.length ? ranges : [];
}
