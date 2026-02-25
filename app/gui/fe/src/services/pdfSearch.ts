import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface SearchMatch {
  pageNumber: number;
  itemIndex: number;
  startOffset: number;
  length: number;
}

/** Escape HTML special chars for safe use in customTextRenderer HTML output. */
export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Find all case-insensitive matches of `query` across all pages of a PDF document. */
export async function findMatchesInPdf(
  pdfDoc: PDFDocumentProxy,
  query: string,
): Promise<SearchMatch[]> {
  const q = query.toLowerCase();
  const matches: SearchMatch[] = [];

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    textContent.items.forEach((item, itemIndex) => {
      if (!('str' in item)) return;
      const strLower = item.str.toLowerCase();
      let pos = 0;
      while ((pos = strLower.indexOf(q, pos)) !== -1) {
        matches.push({ pageNumber: pageNum, itemIndex, startOffset: pos, length: q.length });
        pos += q.length;
      }
    });
  }

  return matches;
}

/** Build an HTML string that wraps matched ranges in <mark> tags. */
export function highlightText(
  str: string,
  itemMatches: SearchMatch[],
  currentGlobalIndex: number,
  allResults: SearchMatch[],
): string {
  if (itemMatches.length === 0) return escapeHtml(str);

  let result = '';
  let lastEnd = 0;

  for (const match of itemMatches) {
    result += escapeHtml(str.slice(lastEnd, match.startOffset));
    const globalIndex = allResults.indexOf(match);
    const cls = globalIndex === currentGlobalIndex ? 'pdf-search-highlight current' : 'pdf-search-highlight';
    result += `<mark class="${cls}">${escapeHtml(str.slice(match.startOffset, match.startOffset + match.length))}</mark>`;
    lastEnd = match.startOffset + match.length;
  }

  result += escapeHtml(str.slice(lastEnd));
  return result;
}
