import { invoke } from '@tauri-apps/api/core'
import { storageGet, storageSet } from './storageUtils'

const LANGUAGE_KEY = 'veiled_language'

export const AVAILABLE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
] as const

export type LanguageCode = (typeof AVAILABLE_LANGUAGES)[number]['code']

const DEFAULT_LANGUAGE: LanguageCode = 'en'

function isSupported(code: string): code is LanguageCode {
  return AVAILABLE_LANGUAGES.some((l) => l.code === code)
}

/** Narrow an arbitrary BCP-47 locale ("en-US", "fr_FR") to a supported code. */
function normalizeLocale(raw: string | null | undefined): LanguageCode {
  if (!raw) return DEFAULT_LANGUAGE
  const base = raw.toLowerCase().split(/[-_]/)[0]
  return isSupported(base) ? base : DEFAULT_LANGUAGE
}

/** Read the stored language from localStorage (defaults to 'en'). */
export function getLanguage(): LanguageCode {
  const stored = storageGet(LANGUAGE_KEY)
  return stored && isSupported(stored) ? stored : DEFAULT_LANGUAGE
}

/** Persist language choice to localStorage. */
export function setLanguage(code: LanguageCode): void {
  storageSet(LANGUAGE_KEY, code)
}

/** True if the user has never set a language (first launch). */
export function hasStoredLanguage(): boolean {
  return storageGet(LANGUAGE_KEY) !== null
}

/**
 * On first launch, ask the OS for its locale (via Tauri) and store the
 * narrowed language code. Subsequent launches read from localStorage.
 * Safe to call in non-Tauri environments (tests) — falls back to default.
 */
export async function initializeLanguage(): Promise<LanguageCode> {
  if (hasStoredLanguage()) return getLanguage()
  try {
    const osLocale = await invoke<string>('get_os_locale')
    const code = normalizeLocale(osLocale)
    setLanguage(code)
    return code
  } catch {
    setLanguage(DEFAULT_LANGUAGE)
    return DEFAULT_LANGUAGE
  }
}
