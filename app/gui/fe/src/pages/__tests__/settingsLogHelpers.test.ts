import { describe, it, expect } from 'vitest'
import { getLogLineClass } from '../../utils/logClassification'

describe('getLogLineClass', () => {
  it('returns error class for lines containing "error"', () => {
    expect(getLogLineClass('[2024-01-01] ERROR: something failed')).toBe('text-[var(--error)]')
    expect(getLogLineClass('error loading config')).toBe('text-[var(--error)]')
    expect(getLogLineClass('FATAL error occurred')).toBe('text-[var(--error)]')
  })

  it('returns error class for lines containing "fatal"', () => {
    expect(getLogLineClass('FATAL: out of memory')).toBe('text-[var(--error)]')
    expect(getLogLineClass('fatal exception in thread')).toBe('text-[var(--error)]')
  })

  it('returns error class for lines containing "panic"', () => {
    expect(getLogLineClass("thread 'main' panicked at")).toBe('text-[var(--error)]')
    expect(getLogLineClass('panic: runtime error')).toBe('text-[var(--error)]')
  })

  it('returns warning class for lines containing "[stderr]"', () => {
    expect(getLogLineClass('[stderr] some warning output')).toBe('text-[var(--warning)]')
  })

  it('returns warning class for lines containing "warn"', () => {
    expect(getLogLineClass('WARN: deprecated feature used')).toBe('text-[var(--warning)]')
    expect(getLogLineClass('warning: unused variable')).toBe('text-[var(--warning)]')
  })

  it('returns default class for normal log lines', () => {
    expect(getLogLineClass('Server started on port 3001')).toBe('text-[var(--text-secondary)]')
    expect(getLogLineClass('INFO: request completed in 50ms')).toBe('text-[var(--text-secondary)]')
    expect(getLogLineClass('')).toBe('text-[var(--text-secondary)]')
  })

  it('prioritizes error over warning', () => {
    expect(getLogLineClass('WARN: error handler invoked')).toBe('text-[var(--error)]')
  })

  it('is case-insensitive', () => {
    expect(getLogLineClass('Error')).toBe('text-[var(--error)]')
    expect(getLogLineClass('ERROR')).toBe('text-[var(--error)]')
    expect(getLogLineClass('Warn')).toBe('text-[var(--warning)]')
    expect(getLogLineClass('WARNING')).toBe('text-[var(--warning)]')
  })
})
