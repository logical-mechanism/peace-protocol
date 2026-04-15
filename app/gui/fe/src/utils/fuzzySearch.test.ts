import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyHighlightRanges } from './fuzzySearch';

describe('fuzzyMatch', () => {
  it('returns match with score 0 for empty query', () => {
    const result = fuzzyMatch('', 'hello');
    expect(result.match).toBe(true);
    expect(result.score).toBe(0);
  });

  it('returns no match for empty text', () => {
    const result = fuzzyMatch('hello', '');
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
  });

  it('scores exact match highest (1.0)', () => {
    const result = fuzzyMatch('hello', 'hello');
    expect(result.match).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('is case insensitive for exact match', () => {
    const result = fuzzyMatch('Hello', 'hello');
    expect(result.match).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('scores prefix match at 0.9', () => {
    const result = fuzzyMatch('hel', 'hello world');
    expect(result.match).toBe(true);
    expect(result.score).toBe(0.9);
  });

  it('scores word-boundary substring match at 0.8', () => {
    const result = fuzzyMatch('world', 'hello world');
    expect(result.match).toBe(true);
    expect(result.score).toBe(0.8);
  });

  it('scores mid-string substring match at 0.7', () => {
    const result = fuzzyMatch('ello', 'hello world');
    expect(result.match).toBe(true);
    expect(result.score).toBe(0.7);
  });

  it('scores subsequence match at 0.4', () => {
    const result = fuzzyMatch('hlo', 'hello');
    expect(result.match).toBe(true);
    expect(result.score).toBe(0.4);
  });

  it('returns no match when characters are not a subsequence', () => {
    const result = fuzzyMatch('xyz', 'hello');
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
  });

  it('handles scoring order: exact > prefix > word-boundary > substring > subsequence', () => {
    const exact = fuzzyMatch('audio', 'audio');
    const prefix = fuzzyMatch('aud', 'audio files');
    const wordBound = fuzzyMatch('files', 'audio files');
    const substring = fuzzyMatch('udio', 'audio');
    const subseq = fuzzyMatch('adf', 'audio files');

    expect(exact.score).toBeGreaterThan(prefix.score);
    expect(prefix.score).toBeGreaterThan(wordBound.score);
    expect(wordBound.score).toBeGreaterThan(substring.score);
    expect(substring.score).toBeGreaterThan(subseq.score);
  });

  it('handles special regex characters in query', () => {
    const result = fuzzyMatch('file.txt', 'my file.txt backup');
    expect(result.match).toBe(true);
  });

  it('matches word-boundary subsequence', () => {
    const result = fuzzyMatch('af', 'audio files');
    expect(result.match).toBe(true);
    expect(result.score).toBe(0.5);
  });
});

describe('fuzzyHighlightRanges', () => {
  it('returns empty array for empty query', () => {
    expect(fuzzyHighlightRanges('', 'hello')).toEqual([]);
  });

  it('returns empty array for empty text', () => {
    expect(fuzzyHighlightRanges('hello', '')).toEqual([]);
  });

  it('returns single range for contiguous substring', () => {
    const ranges = fuzzyHighlightRanges('ell', 'hello');
    expect(ranges).toEqual([[1, 4]]);
  });

  it('returns range for prefix match', () => {
    const ranges = fuzzyHighlightRanges('hel', 'hello');
    expect(ranges).toEqual([[0, 3]]);
  });

  it('returns multiple ranges for subsequence match', () => {
    const ranges = fuzzyHighlightRanges('hlo', 'hello');
    // h at 0, l at 2-3 (greedy left-to-right), o at 4-5
    expect(ranges).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('returns empty array when query does not match', () => {
    const ranges = fuzzyHighlightRanges('xyz', 'hello');
    expect(ranges).toEqual([]);
  });

  it('is case insensitive', () => {
    const ranges = fuzzyHighlightRanges('HEL', 'hello');
    expect(ranges).toEqual([[0, 3]]);
  });
});
