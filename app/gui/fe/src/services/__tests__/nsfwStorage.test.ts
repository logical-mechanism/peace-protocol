import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getNsfwEnabled, setNsfwEnabled } from '../nsfwStorage'

describe('nsfwStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('getNsfwEnabled', () => {
    it('returns false by default when nothing is stored', () => {
      expect(getNsfwEnabled()).toBe(false)
    })

    it('returns true when "true" is stored', () => {
      localStorage.setItem('veiled_nsfw_enabled', 'true')
      expect(getNsfwEnabled()).toBe(true)
    })

    it('returns false when "false" is stored', () => {
      localStorage.setItem('veiled_nsfw_enabled', 'false')
      expect(getNsfwEnabled()).toBe(false)
    })
  })

  describe('setNsfwEnabled', () => {
    it('stores "true" when called with true', () => {
      setNsfwEnabled(true)
      expect(localStorage.getItem('veiled_nsfw_enabled')).toBe('true')
    })

    it('stores "false" when called with false', () => {
      setNsfwEnabled(false)
      expect(localStorage.getItem('veiled_nsfw_enabled')).toBe('false')
    })

    it('roundtrips with getNsfwEnabled', () => {
      setNsfwEnabled(true)
      expect(getNsfwEnabled()).toBe(true)
      setNsfwEnabled(false)
      expect(getNsfwEnabled()).toBe(false)
    })
  })
})
