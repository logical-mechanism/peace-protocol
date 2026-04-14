import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getLanguage,
  setLanguage,
  hasStoredLanguage,
  initializeLanguage,
  AVAILABLE_LANGUAGES,
} from '../languageStorage'

describe('languageStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('getLanguage', () => {
    it('returns en when nothing is stored', () => {
      expect(getLanguage()).toBe('en')
    })

    it('returns the stored code when supported', () => {
      localStorage.setItem('veiled_language', 'en')
      expect(getLanguage()).toBe('en')
    })

    it('falls back to en for unsupported stored codes', () => {
      localStorage.setItem('veiled_language', 'zz')
      expect(getLanguage()).toBe('en')
    })
  })

  describe('setLanguage + hasStoredLanguage', () => {
    it('hasStoredLanguage is false on first launch', () => {
      expect(hasStoredLanguage()).toBe(false)
    })

    it('setLanguage persists and hasStoredLanguage flips to true', () => {
      setLanguage('en')
      expect(hasStoredLanguage()).toBe(true)
      expect(localStorage.getItem('veiled_language')).toBe('en')
    })
  })

  describe('initializeLanguage', () => {
    it('uses stored value when present and does not call invoke', async () => {
      ;(invoke as Mock).mockClear()
      localStorage.setItem('veiled_language', 'en')
      const code = await initializeLanguage()
      expect(code).toBe('en')
      expect(invoke).not.toHaveBeenCalled()
    })

    it('queries OS locale on first launch and narrows to supported code', async () => {
      ;(invoke as Mock).mockResolvedValueOnce('en-US')
      const code = await initializeLanguage()
      expect(code).toBe('en')
      expect(localStorage.getItem('veiled_language')).toBe('en')
    })

    it('falls back to en when OS reports an unsupported locale', async () => {
      ;(invoke as Mock).mockResolvedValueOnce('ja-JP')
      const code = await initializeLanguage()
      expect(code).toBe('en')
    })

    it('falls back to en when invoke throws (non-Tauri env)', async () => {
      ;(invoke as Mock).mockRejectedValueOnce(new Error('not in Tauri'))
      const code = await initializeLanguage()
      expect(code).toBe('en')
      expect(localStorage.getItem('veiled_language')).toBe('en')
    })
  })

  describe('AVAILABLE_LANGUAGES', () => {
    it('includes English', () => {
      expect(AVAILABLE_LANGUAGES.find((l) => l.code === 'en')).toBeTruthy()
    })

    it('every entry has a non-empty label', () => {
      for (const lang of AVAILABLE_LANGUAGES) {
        expect(lang.label.length).toBeGreaterThan(0)
      }
    })
  })
})

// Silence the catch-all invoke rejector from the shared Tauri mock for later suites.
afterEach(() => {
  vi.clearAllMocks()
})
