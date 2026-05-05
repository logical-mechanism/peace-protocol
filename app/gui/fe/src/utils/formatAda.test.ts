import { describe, it, expect } from 'vitest'
import { formatAda, formatAdaDisplay, formatWithCommas, stripCommas } from './formatAda'

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

describe('formatWithCommas', () => {
  it('returns empty string unchanged', () => {
    expect(formatWithCommas('')).toBe('')
  })

  it('formats small whole numbers without commas', () => {
    expect(formatWithCommas('0')).toBe('0')
    expect(formatWithCommas('999')).toBe('999')
  })

  it('inserts commas on the integer part', () => {
    expect(formatWithCommas('1234')).toBe('1,234')
    expect(formatWithCommas('1000000')).toBe('1,000,000')
    expect(formatWithCommas('45000000000')).toBe('45,000,000,000')
  })

  it('preserves the decimal portion verbatim', () => {
    expect(formatWithCommas('1234567.89')).toBe('1,234,567.89')
    expect(formatWithCommas('0.001')).toBe('0.001')
    expect(formatWithCommas('1.10')).toBe('1.10')
    expect(formatWithCommas('1234.000001')).toBe('1,234.000001')
  })

  it('preserves a trailing dot during typing', () => {
    expect(formatWithCommas('1234.')).toBe('1,234.')
  })

  it('strips leading zeros via parseInt', () => {
    expect(formatWithCommas('00100')).toBe('100')
  })

  it('returns input unchanged when integer part is non-numeric', () => {
    expect(formatWithCommas('.5')).toBe('.5')
    expect(formatWithCommas('abc')).toBe('abc')
  })
})

describe('stripCommas', () => {
  it('removes all commas from a formatted string', () => {
    expect(stripCommas('1,234')).toBe('1234')
    expect(stripCommas('1,234,567.89')).toBe('1234567.89')
  })

  it('returns input unchanged when no commas present', () => {
    expect(stripCommas('1234')).toBe('1234')
    expect(stripCommas('')).toBe('')
  })
})

describe('formatWithCommas / stripCommas round-trip', () => {
  it('round-trips ordinary values back to the original raw string', () => {
    const cases = ['', '0', '1234', '1000000', '1234567.89', '0.001', '45000000000']
    for (const raw of cases) {
      expect(stripCommas(formatWithCommas(raw))).toBe(raw)
    }
  })

  it('round-trips a value with leading zeros to its parseInt-normalized form', () => {
    expect(stripCommas(formatWithCommas('00100'))).toBe('100')
  })
})
