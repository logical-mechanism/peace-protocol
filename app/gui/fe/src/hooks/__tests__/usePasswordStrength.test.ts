import { describe, it, expect } from 'vitest'
import { getPasswordStrength } from '../usePasswordStrength'

describe('getPasswordStrength', () => {
  it('returns all requirements unmet for empty string', () => {
    const result = getPasswordStrength('')
    expect(result.requirements.minLength).toBe(false)
    expect(result.requirements.hasUppercase).toBe(false)
    expect(result.requirements.hasLowercase).toBe(false)
    expect(result.requirements.hasDigit).toBe(false)
    expect(result.metCount).toBe(0)
    expect(result.allMet).toBe(false)
    expect(result.level).toBe('weak')
  })

  it('detects minimum length requirement', () => {
    expect(getPasswordStrength('Abc1').requirements.minLength).toBe(false)
    expect(getPasswordStrength('Abcdefg1').requirements.minLength).toBe(true)
  })

  it('detects uppercase requirement', () => {
    expect(getPasswordStrength('abcdefg1').requirements.hasUppercase).toBe(false)
    expect(getPasswordStrength('Abcdefg1').requirements.hasUppercase).toBe(true)
  })

  it('detects lowercase requirement', () => {
    expect(getPasswordStrength('ABCDEFG1').requirements.hasLowercase).toBe(false)
    expect(getPasswordStrength('ABCDEFg1').requirements.hasLowercase).toBe(true)
  })

  it('detects digit requirement', () => {
    expect(getPasswordStrength('Abcdefgh').requirements.hasDigit).toBe(false)
    expect(getPasswordStrength('Abcdefg1').requirements.hasDigit).toBe(true)
  })

  it('returns weak for 0-2 requirements met', () => {
    // 0 met
    expect(getPasswordStrength('').level).toBe('weak')
    // 1 met (lowercase only)
    expect(getPasswordStrength('a').level).toBe('weak')
    // 2 met (lowercase + uppercase)
    expect(getPasswordStrength('aB').level).toBe('weak')
  })

  it('returns fair for 3 requirements met', () => {
    // lowercase + uppercase + digit, but too short
    expect(getPasswordStrength('aB1').level).toBe('fair')
    expect(getPasswordStrength('aB1').metCount).toBe(3)
    // lowercase + uppercase + length, no digit
    expect(getPasswordStrength('Abcdefgh').level).toBe('fair')
    expect(getPasswordStrength('Abcdefgh').metCount).toBe(3)
  })

  it('returns fair for all 4 met but length < 12', () => {
    const result = getPasswordStrength('Abcdefg1')
    expect(result.allMet).toBe(true)
    expect(result.metCount).toBe(4)
    expect(result.level).toBe('fair')
  })

  it('returns strong for all 4 met and length >= 12', () => {
    const result = getPasswordStrength('Abcdefghijk1')
    expect(result.allMet).toBe(true)
    expect(result.level).toBe('strong')
  })

  it('returns strong at exactly 12 characters with all requirements', () => {
    const result = getPasswordStrength('Abcdefghij1k')
    expect(result.allMet).toBe(true)
    expect(result.level).toBe('strong')
  })

  it('counts requirements correctly', () => {
    expect(getPasswordStrength('').metCount).toBe(0)
    expect(getPasswordStrength('a').metCount).toBe(1)
    expect(getPasswordStrength('aB').metCount).toBe(2)
    expect(getPasswordStrength('aB1').metCount).toBe(3)
    expect(getPasswordStrength('aB1defgh').metCount).toBe(4)
  })

  it('allMet is true only when all 4 requirements pass', () => {
    expect(getPasswordStrength('abcdefgh').allMet).toBe(false) // no uppercase, no digit
    expect(getPasswordStrength('Abcdefgh').allMet).toBe(false) // no digit
    expect(getPasswordStrength('Abcdefg1').allMet).toBe(true)
  })
})
