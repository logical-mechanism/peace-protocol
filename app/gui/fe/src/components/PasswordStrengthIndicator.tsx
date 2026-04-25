import { useTranslation } from 'react-i18next'
import type { PasswordStrength } from '../hooks/usePasswordStrength'

interface Props {
  strength: PasswordStrength
  password: string
}

const requirementLabels = [
  { key: 'minLength' as const, labelKey: 'passwordStrength.minChars' },
  { key: 'hasUppercase' as const, labelKey: 'passwordStrength.uppercase' },
  { key: 'hasLowercase' as const, labelKey: 'passwordStrength.lowercase' },
  { key: 'hasDigit' as const, labelKey: 'passwordStrength.digit' },
  { key: 'hasSpecialChar' as const, labelKey: 'passwordStrength.special' },
]

const levelConfig = {
  weak: { segments: 1, color: 'var(--error)', labelKey: 'passwordStrength.weak' },
  fair: { segments: 2, color: 'var(--warning)', labelKey: 'passwordStrength.fair' },
  strong: { segments: 3, color: 'var(--success)', labelKey: 'passwordStrength.strong' },
}

export default function PasswordStrengthIndicator({ strength, password }: Props) {
  const { t } = useTranslation('common')
  if (!password) return null

  const config = levelConfig[strength.level]

  return (
    <div className="mt-3 space-y-3" aria-live="polite">
      {/* Requirements checklist */}
      <div className="space-y-1.5">
        {requirementLabels.map(({ key, labelKey }) => {
          const met = strength.requirements[key]
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              {met ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  style={{ color: 'var(--success)', flexShrink: 0 }}
                >
                  <path
                    d="M3 7l3 3 5-5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                >
                  <path
                    d="M4 7h6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <span style={{ color: met ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {t(labelKey)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Strength bar */}
      <div>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{
                background:
                  i < config.segments ? config.color : 'var(--bg-secondary)',
                transition: 'background var(--transition-base)',
              }}
            />
          ))}
        </div>
        <div className="text-xs mt-1" style={{ color: config.color }}>
          {t(config.labelKey)}
        </div>
      </div>
    </div>
  )
}
