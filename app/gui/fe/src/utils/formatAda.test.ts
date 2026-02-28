import { describe, it, expect } from 'vitest'
import { formatAda, formatAdaDisplay } from './formatAda'

describe('formatAda', () => {
  it('formats whole ADA amounts with 2 decimal places', () => {
    expect(formatAda(2_000_000)).toBe('2.00')
    expect(formatAda(100_000_000)).toBe('100.00')
  })

  it('formats fractional ADA amounts with at least 2 decimals', () => {
    expect(formatAda(1_500_000)).toBe('1.50')
    expect(formatAda(2_250_000)).toBe('2.25')
  })

  it('formats sub-ADA amounts', () => {
    expect(formatAda(500_000)).toBe('0.50')
    expect(formatAda(1)).toBe('0.000001')
  })

  it('formats zero with 2 decimal places', () => {
    expect(formatAda(0)).toBe('0.00')
  })

  it('preserves up to 6 decimal places', () => {
    expect(formatAda(1_234_567)).toBe('1.234567')
  })
})

describe('formatAdaDisplay', () => {
  it('formats string lovelace with exactly 2 decimal places', () => {
    expect(formatAdaDisplay('2000000')).toBe('2.00')
    expect(formatAdaDisplay('1500000')).toBe('1.50')
  })

  it('returns "..." for undefined', () => {
    expect(formatAdaDisplay(undefined)).toBe('...')
  })

  it('returns "..." for empty string', () => {
    expect(formatAdaDisplay('')).toBe('...')
  })

  it('formats large amounts with locale grouping', () => {
    const result = formatAdaDisplay('1000000000000')
    // 1,000,000 ADA — locale-dependent grouping, but always 2 decimals
    expect(result).toContain('.00')
  })
})
