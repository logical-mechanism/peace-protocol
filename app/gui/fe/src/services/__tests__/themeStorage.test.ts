import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getTheme,
  setTheme,
  applyTheme,
  initializeTheme,
  resolveTheme,
  listenToSystemTheme,
} from '../themeStorage'

type MQLMock = {
  matches: boolean
  media: string
  onchange: null
  addListener: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  dispatchEvent: ReturnType<typeof vi.fn>
}

function mockMatchMedia(matches: boolean): MQLMock {
  const mql: MQLMock = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mql),
  })
  return mql
}

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

    it('returns stored system theme', () => {
      localStorage.setItem('veiled_theme', 'system')
      expect(getTheme()).toBe('system')
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

    it('persists system theme', () => {
      setTheme('system')
      expect(localStorage.getItem('veiled_theme')).toBe('system')
    })

    it('roundtrips with getTheme', () => {
      setTheme('light')
      expect(getTheme()).toBe('light')
      setTheme('system')
      expect(getTheme()).toBe('system')
      setTheme('dark')
      expect(getTheme()).toBe('dark')
    })
  })

  describe('resolveTheme', () => {
    it('returns dark for dark', () => {
      expect(resolveTheme('dark')).toBe('dark')
    })

    it('returns light for light', () => {
      expect(resolveTheme('light')).toBe('light')
    })

    it('returns dark when system prefers dark', () => {
      mockMatchMedia(true)
      expect(resolveTheme('system')).toBe('dark')
    })

    it('returns light when system prefers light', () => {
      mockMatchMedia(false)
      expect(resolveTheme('system')).toBe('light')
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

    it('resolves system to dark when OS prefers dark', () => {
      mockMatchMedia(true)
      applyTheme('system')
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })

    it('resolves system to light when OS prefers light', () => {
      mockMatchMedia(false)
      applyTheme('system')
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

    it('resolves stored system theme against OS preference', () => {
      mockMatchMedia(true)
      localStorage.setItem('veiled_theme', 'system')
      initializeTheme()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
  })

  describe('listenToSystemTheme', () => {
    it('registers a change listener on the media query', () => {
      const mql = mockMatchMedia(false)
      const cb = vi.fn()
      const cleanup = listenToSystemTheme(cb)
      expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
      cleanup()
    })

    it('cleanup removes the listener', () => {
      const mql = mockMatchMedia(false)
      const cleanup = listenToSystemTheme(vi.fn())
      const handler = mql.addEventListener.mock.calls[0][1]
      cleanup()
      expect(mql.removeEventListener).toHaveBeenCalledWith('change', handler)
    })

    it('fires callback when the media query changes', () => {
      const mql = mockMatchMedia(false)
      const cb = vi.fn()
      listenToSystemTheme(cb)
      const handler = mql.addEventListener.mock.calls[0][1]
      handler({ matches: true } as MediaQueryListEvent)
      expect(cb).toHaveBeenCalledTimes(1)
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
      expect(getTheme()).toBe('dark')
    })

    it('setTheme does not throw when setItem fails', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
      expect(() => setTheme('dark')).not.toThrow()
    })
  })
})
