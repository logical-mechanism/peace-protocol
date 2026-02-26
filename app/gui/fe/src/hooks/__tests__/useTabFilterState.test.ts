import { describe, it, expect } from 'vitest'
import {
  marketplaceReducer, MARKETPLACE_INITIAL,
  mySalesReducer, MY_SALES_INITIAL,
  myPurchasesReducer, MY_PURCHASES_INITIAL,
  historyReducer, HISTORY_INITIAL,
  libraryReducer, LIBRARY_INITIAL,
} from '../useTabFilterState'

describe('marketplaceReducer', () => {
  it('SET_SEARCH updates query and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 3 }
    const next = marketplaceReducer(state, { type: 'SET_SEARCH', payload: 'test' })
    expect(next.searchQuery).toBe('test')
    expect(next.currentPage).toBe(1)
  })

  it('SET_SORT updates sortBy and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 2 }
    const next = marketplaceReducer(state, { type: 'SET_SORT', payload: 'price-high' })
    expect(next.sortBy).toBe('price-high')
    expect(next.currentPage).toBe(1)
  })

  it('SET_STATUS updates statusFilter and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 5 }
    const next = marketplaceReducer(state, { type: 'SET_STATUS', payload: 'active' })
    expect(next.statusFilter).toBe('active')
    expect(next.currentPage).toBe(1)
  })

  it('SET_CATEGORY updates categoryFilter and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 3 }
    const next = marketplaceReducer(state, { type: 'SET_CATEGORY', payload: 'document' })
    expect(next.categoryFilter).toBe('document')
    expect(next.currentPage).toBe(1)
  })

  it('SET_VIEW updates viewMode without resetting page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 3 }
    const next = marketplaceReducer(state, { type: 'SET_VIEW', payload: 'list' })
    expect(next.viewMode).toBe('list')
    expect(next.currentPage).toBe(3)
  })

  it('SET_PAGE updates currentPage', () => {
    const next = marketplaceReducer(MARKETPLACE_INITIAL, { type: 'SET_PAGE', payload: 4 })
    expect(next.currentPage).toBe(4)
  })

  it('SET_PRICE_MIN resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 2 }
    const next = marketplaceReducer(state, { type: 'SET_PRICE_MIN', payload: '10' })
    expect(next.priceMin).toBe('10')
    expect(next.currentPage).toBe(1)
  })

  it('SET_FAVORITES_ONLY resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 2 }
    const next = marketplaceReducer(state, { type: 'SET_FAVORITES_ONLY', payload: true })
    expect(next.showFavoritesOnly).toBe(true)
    expect(next.currentPage).toBe(1)
  })

  it('CLEAR_FILTERS resets all except viewMode', () => {
    const state = {
      ...MARKETPLACE_INITIAL,
      searchQuery: 'hello',
      sortBy: 'price-high' as const,
      statusFilter: 'active' as const,
      viewMode: 'list' as const,
      currentPage: 5,
      showFavoritesOnly: true,
    }
    const next = marketplaceReducer(state, { type: 'CLEAR_FILTERS' })
    expect(next.searchQuery).toBe('')
    expect(next.sortBy).toBe('newest')
    expect(next.statusFilter).toBe('all')
    expect(next.viewMode).toBe('list') // preserved
    expect(next.currentPage).toBe(1)
    expect(next.showFavoritesOnly).toBe(false)
  })

  it('HYDRATE merges partial state and resets page', () => {
    const next = marketplaceReducer(MARKETPLACE_INITIAL, {
      type: 'HYDRATE',
      payload: { searchQuery: 'hello', sortBy: 'price-high', viewMode: 'list', currentPage: 5 },
    })
    expect(next.searchQuery).toBe('hello')
    expect(next.sortBy).toBe('price-high')
    expect(next.viewMode).toBe('list')
    expect(next.currentPage).toBe(1) // always reset
  })

  it('HYDRATE with empty payload returns initial state', () => {
    const state = { ...MARKETPLACE_INITIAL, searchQuery: 'old', currentPage: 3 }
    const next = marketplaceReducer(state, { type: 'HYDRATE', payload: {} })
    expect(next.searchQuery).toBe('')
    expect(next.sortBy).toBe('newest')
    expect(next.currentPage).toBe(1)
  })

  it('HYDRATE fills missing fields from initial state', () => {
    const next = marketplaceReducer(MARKETPLACE_INITIAL, {
      type: 'HYDRATE',
      payload: { categoryFilter: 'audio' },
    })
    expect(next.categoryFilter).toBe('audio')
    expect(next.searchQuery).toBe('') // default
    expect(next.sortBy).toBe('newest') // default
    expect(next.viewMode).toBe('grid') // default
  })

  it('returns same state for unknown action', () => {
    const state = { ...MARKETPLACE_INITIAL }
    // @ts-expect-error testing unknown action
    const next = marketplaceReducer(state, { type: 'UNKNOWN' })
    expect(next).toBe(state)
  })
})

describe('mySalesReducer', () => {
  it('SET_SEARCH updates query', () => {
    const next = mySalesReducer(MY_SALES_INITIAL, { type: 'SET_SEARCH', payload: 'nft' })
    expect(next.searchQuery).toBe('nft')
  })

  it('SET_SORT updates sortBy', () => {
    const next = mySalesReducer(MY_SALES_INITIAL, { type: 'SET_SORT', payload: 'most-bids' })
    expect(next.sortBy).toBe('most-bids')
  })

  it('SET_STATUS updates statusFilter', () => {
    const next = mySalesReducer(MY_SALES_INITIAL, { type: 'SET_STATUS', payload: 'completed' })
    expect(next.statusFilter).toBe('completed')
  })

  it('SET_VIEW updates viewMode', () => {
    const next = mySalesReducer(MY_SALES_INITIAL, { type: 'SET_VIEW', payload: 'list' })
    expect(next.viewMode).toBe('list')
  })
})

describe('myPurchasesReducer', () => {
  it('SET_SORT updates sortBy', () => {
    const next = myPurchasesReducer(MY_PURCHASES_INITIAL, { type: 'SET_SORT', payload: 'amount-high' })
    expect(next.sortBy).toBe('amount-high')
  })

  it('SET_STATUS updates statusFilter', () => {
    const next = myPurchasesReducer(MY_PURCHASES_INITIAL, { type: 'SET_STATUS', payload: 'accepted' })
    expect(next.statusFilter).toBe('accepted')
  })

  it('SET_STATUS accepts "complete" value', () => {
    const next = myPurchasesReducer(MY_PURCHASES_INITIAL, { type: 'SET_STATUS', payload: 'complete' })
    expect(next.statusFilter).toBe('complete')
  })

  it('initial statusFilter is "all"', () => {
    expect(MY_PURCHASES_INITIAL.statusFilter).toBe('all')
  })
})

describe('historyReducer', () => {
  it('SET_STATUS updates statusFilter', () => {
    const next = historyReducer(HISTORY_INITIAL, { type: 'SET_STATUS', payload: 'pending' })
    expect(next.statusFilter).toBe('pending')
  })

  it('SET_TYPE updates typeFilter', () => {
    const next = historyReducer(HISTORY_INITIAL, { type: 'SET_TYPE', payload: 'place-bid' })
    expect(next.typeFilter).toBe('place-bid')
  })

  it('SET_DATE_RANGE updates dateRange', () => {
    const next = historyReducer(HISTORY_INITIAL, { type: 'SET_DATE_RANGE', payload: '7d' })
    expect(next.dateRange).toBe('7d')
  })

  it('SET_SEARCH updates searchQuery', () => {
    const next = historyReducer(HISTORY_INITIAL, { type: 'SET_SEARCH', payload: 'abc' })
    expect(next.searchQuery).toBe('abc')
  })
})

describe('libraryReducer', () => {
  it('SET_SORT updates sortBy', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_SORT', payload: 'name-asc' })
    expect(next.sortBy).toBe('name-asc')
  })

  it('SET_CATEGORY updates categoryFilter', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_CATEGORY', payload: 'audio' })
    expect(next.categoryFilter).toBe('audio')
  })

  it('SET_VIEW updates viewMode', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_VIEW', payload: 'list' })
    expect(next.viewMode).toBe('list')
  })

  it('SET_SEARCH updates searchQuery', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_SEARCH', payload: 'test' })
    expect(next.searchQuery).toBe('test')
  })
})
