import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import HighlightText from '../HighlightText';

describe('HighlightText', () => {
  it('renders plain text when query is empty', () => {
    const { container } = render(<HighlightText text="Hello world" query="" />);
    expect(container.textContent).toBe('Hello world');
    expect(container.querySelectorAll('.bg-\\[var\\(--accent-muted\\)\\]').length).toBe(0);
  });

  it('renders plain text when query is whitespace', () => {
    const { container } = render(<HighlightText text="Hello world" query="   " />);
    expect(container.textContent).toBe('Hello world');
  });

  it('highlights a single match', () => {
    const { container } = render(<HighlightText text="Hello world" query="world" />);
    expect(container.textContent).toBe('Hello world');
    const highlights = container.querySelectorAll('span > span');
    // "Hello " (non-match) + "world" (match) = at least 2 spans inside wrapper
    const matchSpan = Array.from(highlights).find(s => s.textContent === 'world');
    expect(matchSpan).toBeTruthy();
  });

  it('highlights multiple matches', () => {
    const { container } = render(<HighlightText text="ab ab ab" query="ab" />);
    expect(container.textContent).toBe('ab ab ab');
    // split("(ab)") on "ab ab ab" = ["", "ab", " ", "ab", " ", "ab", ""]
    // 3 matches at odd indices
    const spans = container.querySelectorAll('span > span');
    const matchSpans = Array.from(spans).filter(s => s.textContent === 'ab');
    expect(matchSpans.length).toBe(3);
  });

  it('highlights case-insensitively', () => {
    const { container } = render(<HighlightText text="Hello HELLO hello" query="hello" />);
    expect(container.textContent).toBe('Hello HELLO hello');
    const spans = container.querySelectorAll('span > span');
    const matchSpans = Array.from(spans).filter(s =>
      s.textContent?.toLowerCase() === 'hello'
    );
    expect(matchSpans.length).toBe(3);
  });

  it('escapes regex special characters in query', () => {
    const { container } = render(<HighlightText text="Price is $10.00" query="$10" />);
    expect(container.textContent).toBe('Price is $10.00');
    const spans = container.querySelectorAll('span > span');
    const matchSpan = Array.from(spans).find(s => s.textContent === '$10');
    expect(matchSpan).toBeTruthy();
  });

  it('renders plain text when no match found', () => {
    const { container } = render(<HighlightText text="Hello world" query="xyz" />);
    expect(container.textContent).toBe('Hello world');
  });

  it('passes className to the wrapper span', () => {
    const { container } = render(
      <HighlightText text="test" query="" className="custom-class" />
    );
    expect(container.querySelector('.custom-class')).toBeTruthy();
  });
});
