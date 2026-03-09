import { memo, useMemo } from 'react';

interface HighlightTextProps {
  text: string;
  query: string;
  className?: string;
}

function HighlightText({ text, query, className }: HighlightTextProps) {
  const segments = useMemo(() => {
    if (!query.trim()) return null;

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = text.split(regex);

    // No match — split returns single-element array
    if (parts.length === 1) return null;

    return parts;
  }, [text, query]);

  if (!segments) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {segments.map((part, i) =>
        // Odd indices are captured matches from the split regex
        i % 2 === 1 ? (
          <span
            key={i}
            className="bg-[var(--accent-muted)] text-[var(--accent)] rounded-[2px] px-[1px]"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

export default memo(HighlightText);
