import { useMemo } from 'react'

export interface PasswordRequirements {
  minLength: boolean
  hasUppercase: boolean
  hasLowercase: boolean
  hasDigit: boolean
  hasSpecialChar: boolean
}

export type StrengthLevel = 'weak' | 'fair' | 'strong'

export interface PasswordStrength {
  requirements: PasswordRequirements
  metCount: number
  allMet: boolean
  level: StrengthLevel
}

export function getPasswordStrength(password: string): PasswordStrength {
  const requirements: PasswordRequirements = {
    minLength: password.length >= 12,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasDigit: /[0-9]/.test(password),
    hasSpecialChar: /[^A-Za-z0-9]/.test(password),
  }

  const metCount = Object.values(requirements).filter(Boolean).length
  const allMet = metCount === 5

  let level: StrengthLevel
  if (metCount <= 2) {
    level = 'weak'
  } else if (allMet) {
    level = 'strong'
  } else {
    level = 'fair'
  }

  return { requirements, metCount, allMet, level }
}

export function usePasswordStrength(password: string): PasswordStrength {
  return useMemo(() => getPasswordStrength(password), [password])
}
