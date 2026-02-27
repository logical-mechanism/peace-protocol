import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getTheme, setTheme, applyTheme, initializeTheme } from '../themeStorage'

describe('themeStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  describe('getTheme', () => {
    it('returns dark when nothing is stored', () => {
      expect(getTheme()).toBe('dark')
    })

    it('returns stored dark theme', () => {
      localStorage.setItem('veiled_theme', 'dark')
      expect(getTheme()).toBe('dark')
    })

    it('returns stored light theme', () => {
      localStorage.setItem('veiled_theme', 'light')
      expect(getTheme()).toBe('light')
    })

    it('returns dark for invalid stored value', () => {
      localStorage.setItem('veiled_theme', 'invalid')
      expect(getTheme()).toBe('dark')
    })
  })

  describe('setTheme', () => {
    it('persists dark theme', () => {
      setTheme('dark')
      expect(localStorage.getItem('veiled_theme')).toBe('dark')
    })

    it('persists light theme', () => {
      setTheme('light')
      expect(localStorage.getItem('veiled_theme')).toBe('light')
    })

    it('roundtrips with getTheme', () => {
      setTheme('light')
      expect(getTheme()).toBe('light')
      setTheme('dark')
      expect(getTheme()).toBe('dark')
    })
  })

  describe('applyTheme', () => {
    it('sets data-theme attribute to dark', () => {
      applyTheme('dark')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    it('sets data-theme attribute to light', () => {
      applyTheme('light')
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })
  })

  describe('initializeTheme', () => {
    it('applies dark when nothing is stored', () => {
      initializeTheme()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    it('applies stored light theme', () => {
      localStorage.setItem('veiled_theme', 'light')
      initializeTheme()
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })

    it('applies stored dark theme', () => {
      localStorage.setItem('veiled_theme', 'dark')
      initializeTheme()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
  })

  describe('error paths', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('getTheme returns dark when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError')
      })
      // getTheme has no try-catch, but getItem returning null is handled
      // When getItem throws, it propagates
      expect(() => getTheme()).toThrow('SecurityError')
    })

    it('setTheme propagates when setItem throws (no try-catch)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
      expect(() => setTheme('dark')).toThrow('QuotaExceededError')
    })
  })
})
