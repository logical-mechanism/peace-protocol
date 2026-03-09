import { describe, it, expect } from 'vitest'
import { getPasswordStrength } from '../usePasswordStrength'

describe('getPasswordStrength', () => {
  it('returns all requirements unmet for empty string', () => {
    const result = getPasswordStrength('')
    expect(result.requirements.minLength).toBe(false)
    expect(result.requirements.hasUppercase).toBe(false)
    expect(result.requirements.hasLowercase).toBe(false)
    expect(result.requirements.hasDigit).toBe(false)
    expect(result.requirements.hasSpecialChar).toBe(false)
    expect(result.metCount).toBe(0)
    expect(result.allMet).toBe(false)
    expect(result.level).toBe('weak')
  })

  it('detects minimum length requirement (12 chars)', () => {
    expect(getPasswordStrength('Abc1!').requirements.minLength).toBe(false)
    expect(getPasswordStrength('Abcdefghij1').requirements.minLength).toBe(false)
    expect(getPasswordStrength('Abcdefghij1!').requirements.minLength).toBe(true)
  })

  it('detects uppercase requirement', () => {
    expect(getPasswordStrength('abcdefghij1!').requirements.hasUppercase).toBe(false)
    expect(getPasswordStrength('Abcdefghij1!').requirements.hasUppercase).toBe(true)
  })

  it('detects lowercase requirement', () => {
    expect(getPasswordStrength('ABCDEFGHIJ1!').requirements.hasLowercase).toBe(false)
    expect(getPasswordStrength('ABCDEFGHIj1!').requirements.hasLowercase).toBe(true)
  })

  it('detects digit requirement', () => {
    expect(getPasswordStrength('Abcdefghijk!').requirements.hasDigit).toBe(false)
    expect(getPasswordStrength('Abcdefghij1!').requirements.hasDigit).toBe(true)
  })

  it('detects special character requirement', () => {
    expect(getPasswordStrength('Abcdefghij12').requirements.hasSpecialChar).toBe(false)
    expect(getPasswordStrength('Abcdefghij1!').requirements.hasSpecialChar).toBe(true)
    expect(getPasswordStrength('Abcdefghij1@').requirements.hasSpecialChar).toBe(true)
    expect(getPasswordStrength('Abcdefghij1 ').requirements.hasSpecialChar).toBe(true)
  })

  it('returns weak for 0-2 requirements met', () => {
    // 0 met
    expect(getPasswordStrength('').level).toBe('weak')
    // 1 met (lowercase only)
    expect(getPasswordStrength('a').level).toBe('weak')
    // 2 met (lowercase + uppercase)
    expect(getPasswordStrength('aB').level).toBe('weak')
  })

  it('returns fair for 3-4 requirements met', () => {
    // 3 met: lowercase + uppercase + digit
    expect(getPasswordStrength('aB1').level).toBe('fair')
    expect(getPasswordStrength('aB1').metCount).toBe(3)
    // 4 met: lowercase + uppercase + length + digit (no special char)
    expect(getPasswordStrength('Abcdefghij12').level).toBe('fair')
    expect(getPasswordStrength('Abcdefghij12').metCount).toBe(4)
  })

  it('returns strong when all 5 requirements met', () => {
    const result = getPasswordStrength('Abcdefghij1!')
    expect(result.allMet).toBe(true)
    expect(result.metCount).toBe(5)
    expect(result.level).toBe('strong')
  })

  it('counts requirements correctly', () => {
    expect(getPasswordStrength('').metCount).toBe(0)
    expect(getPasswordStrength('a').metCount).toBe(1)
    expect(getPasswordStrength('aB').metCount).toBe(2)
    expect(getPasswordStrength('aB1').metCount).toBe(3)
    expect(getPasswordStrength('aB1!').metCount).toBe(4)
    expect(getPasswordStrength('Abcdefghij1!').metCount).toBe(5)
  })

  it('allMet is true only when all 5 requirements pass', () => {
    expect(getPasswordStrength('abcdefghij12').allMet).toBe(false) // no uppercase, no special
    expect(getPasswordStrength('Abcdefghij12').allMet).toBe(false) // no special
    expect(getPasswordStrength('Abcdefghij1!').allMet).toBe(true)
  })
})
