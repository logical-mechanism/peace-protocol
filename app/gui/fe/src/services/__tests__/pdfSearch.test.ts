import { describe, it, expect, vi } from 'vitest';
import { findMatchesInPdf, highlightText } from '../pdfSearch';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// ---------- findMatchesInPdf ----------

function createMockPdfDoc(pages: { str: string }[][]): PDFDocumentProxy {
  return {
    numPages: pages.length,
    getPage: vi.fn().mockImplementation((pageNum: number) =>
      Promise.resolve({
        getTextContent: vi.fn().mockResolvedValue({
          items: pages[pageNum - 1].map((item) => item),
          styles: {},
        }),
      }),
    ),
  } as unknown as PDFDocumentProxy;
}

describe('findMatchesInPdf', () => {
  it('finds a single match on one page', async () => {
    const doc = createMockPdfDoc([[{ str: 'Hello world' }]]);
    const matches = await findMatchesInPdf(doc, 'world');
    expect(matches).toEqual([
      { pageNumber: 1, itemIndex: 0, startOffset: 6, length: 5 },
    ]);
  });

  it('is case-insensitive', async () => {
    const doc = createMockPdfDoc([[{ str: 'Hello World' }]]);
    const matches = await findMatchesInPdf(doc, 'HELLO');
    expect(matches).toEqual([
      { pageNumber: 1, itemIndex: 0, startOffset: 0, length: 5 },
    ]);
  });

  it('finds multiple matches in the same TextItem', async () => {
    const doc = createMockPdfDoc([[{ str: 'abcabcabc' }]]);
    const matches = await findMatchesInPdf(doc, 'abc');
    expect(matches).toHaveLength(3);
    expect(matches[0].startOffset).toBe(0);
    expect(matches[1].startOffset).toBe(3);
    expect(matches[2].startOffset).toBe(6);
  });

  it('finds matches across multiple pages', async () => {
    const doc = createMockPdfDoc([
      [{ str: 'First page content' }],
      [{ str: 'Second page content' }],
    ]);
    const matches = await findMatchesInPdf(doc, 'content');
    expect(matches).toHaveLength(2);
    expect(matches[0].pageNumber).toBe(1);
    expect(matches[1].pageNumber).toBe(2);
  });

  it('finds matches across multiple TextItems on the same page', async () => {
    const doc = createMockPdfDoc([
      [{ str: 'Hello world' }, { str: 'Hello again' }],
    ]);
    const matches = await findMatchesInPdf(doc, 'Hello');
    expect(matches).toHaveLength(2);
    expect(matches[0].itemIndex).toBe(0);
    expect(matches[1].itemIndex).toBe(1);
  });

  it('returns empty for no matches', async () => {
    const doc = createMockPdfDoc([[{ str: 'Hello world' }]]);
    const matches = await findMatchesInPdf(doc, 'xyz');
    expect(matches).toEqual([]);
  });

  it('skips items without str property', async () => {
    const doc = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Hello' },
            { type: 'beginMarkedContent' }, // no str property
          ],
          styles: {},
        }),
      }),
    } as unknown as PDFDocumentProxy;

    const matches = await findMatchesInPdf(doc, 'Hello');
    expect(matches).toHaveLength(1);
  });
});

// ---------- highlightText ----------

describe('highlightText', () => {
  it('returns escaped text when no matches', () => {
    expect(highlightText('Hello <world>', [], 0, [])).toBe('Hello &lt;world&gt;');
  });

  it('wraps a single match in mark tags', () => {
    const match = { pageNumber: 1, itemIndex: 0, startOffset: 6, length: 5 };
    const result = highlightText('Hello world', [match], -1, [match]);
    expect(result).toBe('Hello <mark class="pdf-search-highlight">world</mark>');
  });

  it('marks the current match with "current" class', () => {
    const match = { pageNumber: 1, itemIndex: 0, startOffset: 6, length: 5 };
    const result = highlightText('Hello world', [match], 0, [match]);
    expect(result).toBe('Hello <mark class="pdf-search-highlight current">world</mark>');
  });

  it('handles multiple matches in one string', () => {
    const m1 = { pageNumber: 1, itemIndex: 0, startOffset: 0, length: 2 };
    const m2 = { pageNumber: 1, itemIndex: 0, startOffset: 6, length: 2 };
    const allResults = [m1, m2];
    const result = highlightText('ab cd ab', [m1, m2], 1, allResults);
    expect(result).toBe(
      '<mark class="pdf-search-highlight">ab</mark> cd <mark class="pdf-search-highlight current">ab</mark>',
    );
  });

  it('escapes HTML in matched and unmatched text', () => {
    const match = { pageNumber: 1, itemIndex: 0, startOffset: 0, length: 3 };
    const result = highlightText('<b>x', [match], 0, [match]);
    expect(result).toBe(
      '<mark class="pdf-search-highlight current">&lt;b&gt;</mark>x',
    );
  });

  it('handles match at end of string', () => {
    const match = { pageNumber: 1, itemIndex: 0, startOffset: 4, length: 3 };
    const result = highlightText('foo bar', [match], 0, [match]);
    expect(result).toBe('foo <mark class="pdf-search-highlight current">bar</mark>');
  });

  it('handles match at start of string', () => {
    const match = { pageNumber: 1, itemIndex: 0, startOffset: 0, length: 3 };
    const result = highlightText('foo bar', [match], 0, [match]);
    expect(result).toBe('<mark class="pdf-search-highlight current">foo</mark> bar');
  });

  it('handles match covering entire string', () => {
    const match = { pageNumber: 1, itemIndex: 0, startOffset: 0, length: 5 };
    const result = highlightText('hello', [match], 0, [match]);
    expect(result).toBe('<mark class="pdf-search-highlight current">hello</mark>');
  });
});
