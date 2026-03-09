/** Returns the CSS class for a log line based on its severity level. */
export function getLogLineClass(line: string): string {
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) {
    return 'text-[var(--error)]'
  }
  if (lower.includes('[stderr]') || lower.includes('warn')) {
    return 'text-[var(--warning)]'
  }
  return 'text-[var(--text-secondary)]'
}
