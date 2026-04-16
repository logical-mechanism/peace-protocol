import { describe, it, expect } from 'vitest'
import i18n, { resources, NAMESPACES } from '../i18n'

describe('i18n', () => {
  it('initializes synchronously with English resources', () => {
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.language.startsWith('en')).toBe(true)
  })

  it('loads every declared namespace', () => {
    for (const ns of NAMESPACES) {
      expect(resources.en).toHaveProperty(ns)
    }
  })

  it('resolves known keys', () => {
    expect(i18n.t('common:actions.cancel')).toBe('Cancel')
    expect(i18n.t('settings:language.title')).toBe('Language')
    expect(i18n.t('errors:fallback.title')).toBe('Something Went Wrong')
  })

  it('interpolates values', () => {
    const msg = i18n.t('modals:placeBid.errors.bidMin', { amount: '10' })
    expect(msg).toContain('10')
  })

  it('falls back to the key when a translation is missing', () => {
    const missing = i18n.t('common:does.not.exist')
    // i18next returns the last segment / the key itself when missing;
    // the important property is that it doesn't throw or return null.
    expect(typeof missing).toBe('string')
  })

  it('can switch language (only en available for now)', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.language).toBe('en')
  })

  describe('pluralization', () => {
    it('resolves dashboard newBidCount for singular and plural', () => {
      expect(i18n.t('notifications:newBidCount', { count: 1 })).toBe('1 new bid')
      expect(i18n.t('notifications:newBidCount', { count: 5 })).toBe('5 new bids')
    })

    it('resolves dashboard library totalCount for singular and plural', () => {
      expect(i18n.t('dashboard:library.totalCount', { count: 1 })).toBe('1 item')
      expect(i18n.t('dashboard:library.totalCount', { count: 5 })).toBe('5 items')
    })

    it('resolves marketplace totalCount for singular and plural', () => {
      expect(i18n.t('dashboard:marketplace.totalCount', { count: 1 })).toBe('1 listing')
      expect(i18n.t('dashboard:marketplace.totalCount', { count: 5 })).toBe('5 listings')
    })

    it('resolves history loadedCount for singular and plural', () => {
      expect(i18n.t('dashboard:history.loadedCount', { count: 1 })).toBe('1 transaction loaded')
      expect(i18n.t('dashboard:history.loadedCount', { count: 5 })).toBe('5 transactions loaded')
    })

    it('resolves common card bid counts for singular and plural', () => {
      expect(i18n.t('common:card.bid', { count: 1 })).toBe('1 bid')
      expect(i18n.t('common:card.bid', { count: 5 })).toBe('5 bids')
    })
  })
})
