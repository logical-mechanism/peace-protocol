import { describe, it, expect } from 'vitest'
import {
  marketplaceReducer, MARKETPLACE_INITIAL,
  mySalesReducer, MY_SALES_INITIAL,
  myPurchasesReducer, MY_PURCHASES_INITIAL,
  historyReducer, HISTORY_INITIAL,
  libraryReducer, LIBRARY_INITIAL,
  getGridClasses,
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
    const next = marketplaceReducer(state, { type: 'SET_CATEGORY', payload: ['document', 'audio'] })
    expect(next.categoryFilter).toEqual(['document', 'audio'])
    expect(next.currentPage).toBe(1)
  })

  it('SET_HIDE_OWN updates hideOwnListings and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 3 }
    const next = marketplaceReducer(state, { type: 'SET_HIDE_OWN', payload: true })
    expect(next.hideOwnListings).toBe(true)
    expect(next.currentPage).toBe(1)
  })

  it('SET_DATE_FROM updates dateFrom and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 2 }
    const next = marketplaceReducer(state, { type: 'SET_DATE_FROM', payload: '2025-06-01' })
    expect(next.dateFrom).toBe('2025-06-01')
    expect(next.currentPage).toBe(1)
  })

  it('SET_DATE_TO updates dateTo and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 2 }
    const next = marketplaceReducer(state, { type: 'SET_DATE_TO', payload: '2025-12-31' })
    expect(next.dateTo).toBe('2025-12-31')
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

  it('SET_SELLER_FILTER updates sellerPkh and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 4 }
    const next = marketplaceReducer(state, { type: 'SET_SELLER_FILTER', payload: 'abcdef123' })
    expect(next.sellerPkh).toBe('abcdef123')
    expect(next.currentPage).toBe(1)
  })

  it('CLEAR_SELLER_FILTER clears sellerPkh and resets page', () => {
    const state = { ...MARKETPLACE_INITIAL, sellerPkh: 'abcdef123', currentPage: 4 }
    const next = marketplaceReducer(state, { type: 'CLEAR_SELLER_FILTER' })
    expect(next.sellerPkh).toBe('')
    expect(next.currentPage).toBe(1)
  })

  it('initial sellerPkh is empty string', () => {
    expect(MARKETPLACE_INITIAL.sellerPkh).toBe('')
  })

  it('SET_CARD_SIZE updates cardSize without resetting page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 3 }
    const next = marketplaceReducer(state, { type: 'SET_CARD_SIZE', payload: 'large' })
    expect(next.cardSize).toBe('large')
    expect(next.currentPage).toBe(3)
  })

  it('SET_COLUMN_COUNT updates columnCount without resetting page', () => {
    const state = { ...MARKETPLACE_INITIAL, currentPage: 3 }
    const next = marketplaceReducer(state, { type: 'SET_COLUMN_COUNT', payload: 4 })
    expect(next.columnCount).toBe(4)
    expect(next.currentPage).toBe(3)
  })

  it('SET_COLUMN_COUNT accepts 2, 3, 4', () => {
    const a = marketplaceReducer(MARKETPLACE_INITIAL, { type: 'SET_COLUMN_COUNT', payload: 2 })
    expect(a.columnCount).toBe(2)
    const b = marketplaceReducer(MARKETPLACE_INITIAL, { type: 'SET_COLUMN_COUNT', payload: 3 })
    expect(b.columnCount).toBe(3)
    const c = marketplaceReducer(MARKETPLACE_INITIAL, { type: 'SET_COLUMN_COUNT', payload: 4 })
    expect(c.columnCount).toBe(4)
  })

  it('initial columnCount is 3', () => {
    expect(MARKETPLACE_INITIAL.columnCount).toBe(3)
  })

  it('CLEAR_FILTERS preserves cardSize', () => {
    const state = { ...MARKETPLACE_INITIAL, cardSize: 'small' as const, searchQuery: 'test' }
    const next = marketplaceReducer(state, { type: 'CLEAR_FILTERS' })
    expect(next.cardSize).toBe('small')
    expect(next.searchQuery).toBe('')
  })

  it('CLEAR_FILTERS preserves columnCount', () => {
    const state = { ...MARKETPLACE_INITIAL, columnCount: 4 as const, searchQuery: 'test' }
    const next = marketplaceReducer(state, { type: 'CLEAR_FILTERS' })
    expect(next.columnCount).toBe(4)
    expect(next.searchQuery).toBe('')
  })

  it('CLEAR_FILTERS resets all except viewMode', () => {
    const state = {
      ...MARKETPLACE_INITIAL,
      searchQuery: 'hello',
      sortBy: 'price-high' as const,
      statusFilter: 'active' as const,
      categoryFilter: ['audio'] as string[],
      hideOwnListings: true,
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      viewMode: 'list' as const,
      currentPage: 5,
      showFavoritesOnly: true,
      sellerPkh: 'abcdef123',
    }
    const next = marketplaceReducer(state, { type: 'CLEAR_FILTERS' })
    expect(next.searchQuery).toBe('')
    expect(next.sortBy).toBe('newest')
    expect(next.statusFilter).toBe('all')
    expect(next.categoryFilter).toEqual(['all'])
    expect(next.hideOwnListings).toBe(false)
    expect(next.dateFrom).toBe('')
    expect(next.dateTo).toBe('')
    expect(next.viewMode).toBe('list') // preserved
    expect(next.currentPage).toBe(1)
    expect(next.showFavoritesOnly).toBe(false)
    expect(next.sellerPkh).toBe('')
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
      payload: { categoryFilter: ['audio'] },
    })
    expect(next.categoryFilter).toEqual(['audio'])
    expect(next.searchQuery).toBe('') // default
    expect(next.sortBy).toBe('newest') // default
    expect(next.viewMode).toBe('grid') // default
    expect(next.hideOwnListings).toBe(false) // default
    expect(next.dateFrom).toBe('') // default
    expect(next.dateTo).toBe('') // default
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

  it('SET_CARD_SIZE updates cardSize', () => {
    const next = mySalesReducer(MY_SALES_INITIAL, { type: 'SET_CARD_SIZE', payload: 'small' })
    expect(next.cardSize).toBe('small')
  })

  it('SET_COLUMN_COUNT updates columnCount', () => {
    const next = mySalesReducer(MY_SALES_INITIAL, { type: 'SET_COLUMN_COUNT', payload: 4 })
    expect(next.columnCount).toBe(4)
  })

  it('initial columnCount is 3', () => {
    expect(MY_SALES_INITIAL.columnCount).toBe(3)
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

  it('SET_CARD_SIZE updates cardSize', () => {
    const next = myPurchasesReducer(MY_PURCHASES_INITIAL, { type: 'SET_CARD_SIZE', payload: 'large' })
    expect(next.cardSize).toBe('large')
  })

  it('SET_COLUMN_COUNT updates columnCount', () => {
    const next = myPurchasesReducer(MY_PURCHASES_INITIAL, { type: 'SET_COLUMN_COUNT', payload: 2 })
    expect(next.columnCount).toBe(2)
  })

  it('initial columnCount is 3', () => {
    expect(MY_PURCHASES_INITIAL.columnCount).toBe(3)
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

  it('SET_SORT accepts size-asc', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_SORT', payload: 'size-asc' })
    expect(next.sortBy).toBe('size-asc')
  })

  it('SET_SORT accepts size-desc', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_SORT', payload: 'size-desc' })
    expect(next.sortBy).toBe('size-desc')
  })

  it('SET_SORT accepts type-asc', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_SORT', payload: 'type-asc' })
    expect(next.sortBy).toBe('type-asc')
  })

  it('SET_SORT accepts type-desc', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_SORT', payload: 'type-desc' })
    expect(next.sortBy).toBe('type-desc')
  })

  it('SET_CARD_SIZE updates cardSize', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_CARD_SIZE', payload: 'small' })
    expect(next.cardSize).toBe('small')
  })

  it('SET_COLUMN_COUNT updates columnCount', () => {
    const next = libraryReducer(LIBRARY_INITIAL, { type: 'SET_COLUMN_COUNT', payload: 4 })
    expect(next.columnCount).toBe(4)
  })

  it('initial columnCount is 3', () => {
    expect(LIBRARY_INITIAL.columnCount).toBe(3)
  })
})

describe('getGridClasses', () => {
  it('returns 2-column grid classes', () => {
    const classes = getGridClasses(2)
    expect(classes).toContain('grid-cols-1')
    expect(classes).toContain('md:grid-cols-2')
    expect(classes).not.toContain('lg:grid-cols-3')
    expect(classes).not.toContain('xl:grid-cols-4')
    expect(classes).toContain('gap-6')
  })

  it('returns 3-column grid classes (default)', () => {
    const classes = getGridClasses(3)
    expect(classes).toContain('grid-cols-1')
    expect(classes).toContain('md:grid-cols-2')
    expect(classes).toContain('lg:grid-cols-3')
    expect(classes).not.toContain('xl:grid-cols-4')
    expect(classes).toContain('gap-6')
  })

  it('returns 4-column grid classes', () => {
    const classes = getGridClasses(4)
    expect(classes).toContain('grid-cols-1')
    expect(classes).toContain('md:grid-cols-2')
    expect(classes).toContain('lg:grid-cols-3')
    expect(classes).toContain('xl:grid-cols-4')
    expect(classes).toContain('gap-6')
  })

  it('always starts at 1 column on small screens', () => {
    expect(getGridClasses(2)).toContain('grid-cols-1')
    expect(getGridClasses(3)).toContain('grid-cols-1')
    expect(getGridClasses(4)).toContain('grid-cols-1')
  })
})
