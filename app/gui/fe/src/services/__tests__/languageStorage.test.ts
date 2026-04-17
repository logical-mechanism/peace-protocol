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

    it('returns the stored code for each supported language', () => {
      const codes = ['es', 'fr', 'de', 'pt', 'ru', 'tr', 'nl', 'id', 'vi', 'zh', 'ja', 'ko'] as const
      for (const code of codes) {
        localStorage.setItem('veiled_language', code)
        expect(getLanguage()).toBe(code)
      }
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

    it('normalizes OS locale to supported code', async () => {
      ;(invoke as Mock).mockResolvedValueOnce('ja-JP')
      const code = await initializeLanguage()
      expect(code).toBe('ja')
      expect(localStorage.getItem('veiled_language')).toBe('ja')
    })

    it('normalizes zh-CN to zh', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('zh-CN')
      const code = await initializeLanguage()
      expect(code).toBe('zh')
    })

    it('normalizes es-MX to es', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('es-MX')
      const code = await initializeLanguage()
      expect(code).toBe('es')
    })

    it('normalizes fr_FR to fr', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('fr_FR')
      const code = await initializeLanguage()
      expect(code).toBe('fr')
    })

    it('normalizes de-AT to de', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('de-AT')
      const code = await initializeLanguage()
      expect(code).toBe('de')
    })

    it('normalizes ko-KR to ko', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('ko-KR')
      const code = await initializeLanguage()
      expect(code).toBe('ko')
    })

    it('normalizes pt-BR to pt', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('pt-BR')
      const code = await initializeLanguage()
      expect(code).toBe('pt')
    })

    it('normalizes ru-RU to ru', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('ru-RU')
      const code = await initializeLanguage()
      expect(code).toBe('ru')
    })

    it('normalizes tr-TR to tr', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('tr-TR')
      const code = await initializeLanguage()
      expect(code).toBe('tr')
    })

    it('normalizes nl-NL to nl', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('nl-NL')
      const code = await initializeLanguage()
      expect(code).toBe('nl')
    })

    it('normalizes id-ID to id', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('id-ID')
      const code = await initializeLanguage()
      expect(code).toBe('id')
    })

    it('normalizes vi-VN to vi', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('vi-VN')
      const code = await initializeLanguage()
      expect(code).toBe('vi')
    })

    it('falls back to en when OS reports an unsupported locale', async () => {
      localStorage.clear()
      ;(invoke as Mock).mockResolvedValueOnce('sw-KE')
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

    it('includes all 13 supported languages', () => {
      const codes = AVAILABLE_LANGUAGES.map((l) => l.code)
      expect(codes).toEqual(['en', 'es', 'fr', 'de', 'pt', 'ru', 'tr', 'nl', 'id', 'vi', 'zh', 'ja', 'ko'])
    })

    it('has native-script labels for each locale', () => {
      const labels = Object.fromEntries(AVAILABLE_LANGUAGES.map((l) => [l.code, l.label]))
      expect(labels.en).toBe('English')
      expect(labels.es).toBe('Español')
      expect(labels.fr).toBe('Français')
      expect(labels.de).toBe('Deutsch')
      expect(labels.pt).toBe('Português')
      expect(labels.ru).toBe('Русский')
      expect(labels.tr).toBe('Türkçe')
      expect(labels.nl).toBe('Nederlands')
      expect(labels.id).toBe('Bahasa Indonesia')
      expect(labels.vi).toBe('Tiếng Việt')
      expect(labels.zh).toBe('中文')
      expect(labels.ja).toBe('日本語')
      expect(labels.ko).toBe('한국어')
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
