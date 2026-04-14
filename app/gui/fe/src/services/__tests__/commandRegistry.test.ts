import { describe, it, expect } from 'vitest'
import { getCommands, filterCommands, type Command } from '../commandRegistry'

describe('commandRegistry', () => {
  describe('getCommands', () => {
    it('returns a non-empty list', () => {
      const commands = getCommands()
      expect(commands.length).toBeGreaterThan(0)
    })

    it('includes navigation, action, and settings categories', () => {
      const commands = getCommands()
      const categories = new Set(commands.map((c) => c.category))
      expect(categories.has('navigation')).toBe(true)
      expect(categories.has('action')).toBe(true)
      expect(categories.has('settings')).toBe(true)
    })

    it('has unique command ids', () => {
      const commands = getCommands()
      const ids = commands.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('includes the five tab navigation commands', () => {
      const ids = getCommands().map((c) => c.id)
      expect(ids).toContain('tab-marketplace')
      expect(ids).toContain('tab-my-sales')
      expect(ids).toContain('tab-my-purchases')
      expect(ids).toContain('tab-history')
      expect(ids).toContain('tab-library')
    })
  })

  describe('filterCommands', () => {
    const sample: Command[] = [
      { id: 'a', label: 'Go to Marketplace', keywords: ['browse'], category: 'navigation' },
      { id: 'b', label: 'Toggle Theme', keywords: ['dark', 'light'], category: 'action' },
      { id: 'c', label: 'Jump to Wallet', keywords: ['mnemonic'], category: 'settings' },
    ]

    it('returns all commands when query is empty', () => {
      expect(filterCommands(sample, '')).toEqual(sample)
      expect(filterCommands(sample, '   ')).toEqual(sample)
    })

    it('filters by label substring (case-insensitive)', () => {
      const result = filterCommands(sample, 'marketplace')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('a')

      const upper = filterCommands(sample, 'THEME')
      expect(upper).toHaveLength(1)
      expect(upper[0].id).toBe('b')
    })

    it('filters by keywords (case-insensitive)', () => {
      const result = filterCommands(sample, 'dark')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('b')

      const upper = filterCommands(sample, 'MNEMONIC')
      expect(upper).toHaveLength(1)
      expect(upper[0].id).toBe('c')
    })

    it('returns empty array when no match', () => {
      expect(filterCommands(sample, 'zzznomatch')).toEqual([])
    })

    it('matches partial substrings', () => {
      const result = filterCommands(sample, 'wall')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('c')
    })
  })
})
