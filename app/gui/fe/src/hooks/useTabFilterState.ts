import type { TransactionType } from '../services/transactionHistory'

// ── Shared types ──────────────────────────────────────────────────

type ViewMode = 'grid' | 'list'

// ── Marketplace ───────────────────────────────────────────────────

export interface MarketplaceFilters {
  searchQuery: string
  sortBy: 'newest' | 'oldest' | 'price-high' | 'price-low' | 'most-bids'
  statusFilter: 'all' | 'active' | 'pending'
  categoryFilter: string
  viewMode: ViewMode
  priceMin: string
  priceMax: string
  showFavoritesOnly: boolean
  currentPage: number
}

export type MarketplaceAction =
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_SORT'; payload: MarketplaceFilters['sortBy'] }
  | { type: 'SET_STATUS'; payload: MarketplaceFilters['statusFilter'] }
  | { type: 'SET_CATEGORY'; payload: string }
  | { type: 'SET_VIEW'; payload: ViewMode }
  | { type: 'SET_PRICE_MIN'; payload: string }
  | { type: 'SET_PRICE_MAX'; payload: string }
  | { type: 'SET_FAVORITES_ONLY'; payload: boolean }
  | { type: 'SET_PAGE'; payload: number }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'HYDRATE'; payload: Partial<MarketplaceFilters> }

export const MARKETPLACE_INITIAL: MarketplaceFilters = {
  searchQuery: '', sortBy: 'newest', statusFilter: 'all',
  categoryFilter: 'all', viewMode: 'grid', priceMin: '', priceMax: '',
  showFavoritesOnly: false, currentPage: 1,
}

export function marketplaceReducer(state: MarketplaceFilters, action: MarketplaceAction): MarketplaceFilters {
  switch (action.type) {
    case 'SET_SEARCH': return { ...state, searchQuery: action.payload, currentPage: 1 }
    case 'SET_SORT': return { ...state, sortBy: action.payload, currentPage: 1 }
    case 'SET_STATUS': return { ...state, statusFilter: action.payload, currentPage: 1 }
    case 'SET_CATEGORY': return { ...state, categoryFilter: action.payload, currentPage: 1 }
    case 'SET_VIEW': return { ...state, viewMode: action.payload }
    case 'SET_PRICE_MIN': return { ...state, priceMin: action.payload, currentPage: 1 }
    case 'SET_PRICE_MAX': return { ...state, priceMax: action.payload, currentPage: 1 }
    case 'SET_FAVORITES_ONLY': return { ...state, showFavoritesOnly: action.payload, currentPage: 1 }
    case 'SET_PAGE': return { ...state, currentPage: action.payload }
    case 'CLEAR_FILTERS': return { ...MARKETPLACE_INITIAL, viewMode: state.viewMode }
    case 'HYDRATE': return { ...MARKETPLACE_INITIAL, ...action.payload, currentPage: 1 }
    default: return state
  }
}

// ── My Sales ──────────────────────────────────────────────────────

export interface MySalesFilters {
  searchQuery: string
  sortBy: 'newest' | 'oldest' | 'price-high' | 'price-low' | 'most-bids'
  statusFilter: 'all' | 'active' | 'pending' | 'completed'
  viewMode: ViewMode
}

export type MySalesAction =
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_SORT'; payload: MySalesFilters['sortBy'] }
  | { type: 'SET_STATUS'; payload: MySalesFilters['statusFilter'] }
  | { type: 'SET_VIEW'; payload: ViewMode }

export const MY_SALES_INITIAL: MySalesFilters = {
  searchQuery: '', sortBy: 'newest', statusFilter: 'all', viewMode: 'grid',
}

export function mySalesReducer(state: MySalesFilters, action: MySalesAction): MySalesFilters {
  switch (action.type) {
    case 'SET_SEARCH': return { ...state, searchQuery: action.payload }
    case 'SET_SORT': return { ...state, sortBy: action.payload }
    case 'SET_STATUS': return { ...state, statusFilter: action.payload }
    case 'SET_VIEW': return { ...state, viewMode: action.payload }
    default: return state
  }
}

// ── My Purchases ──────────────────────────────────────────────────

export interface MyPurchasesFilters {
  searchQuery: string
  sortBy: 'newest' | 'oldest' | 'amount-high' | 'amount-low'
  statusFilter: 'all' | 'pending' | 'accepted' | 'rejected' | 'cancelled'
  viewMode: ViewMode
}

export type MyPurchasesAction =
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_SORT'; payload: MyPurchasesFilters['sortBy'] }
  | { type: 'SET_STATUS'; payload: MyPurchasesFilters['statusFilter'] }
  | { type: 'SET_VIEW'; payload: ViewMode }

export const MY_PURCHASES_INITIAL: MyPurchasesFilters = {
  searchQuery: '', sortBy: 'newest', statusFilter: 'all', viewMode: 'grid',
}

export function myPurchasesReducer(state: MyPurchasesFilters, action: MyPurchasesAction): MyPurchasesFilters {
  switch (action.type) {
    case 'SET_SEARCH': return { ...state, searchQuery: action.payload }
    case 'SET_SORT': return { ...state, sortBy: action.payload }
    case 'SET_STATUS': return { ...state, statusFilter: action.payload }
    case 'SET_VIEW': return { ...state, viewMode: action.payload }
    default: return state
  }
}

// ── History ───────────────────────────────────────────────────────

export interface HistoryFilters {
  searchQuery: string
  statusFilter: 'all' | 'pending' | 'confirmed' | 'failed'
  typeFilter: 'all' | TransactionType
  dateRange: 'all' | '24h' | '7d' | '30d'
}

export type HistoryAction =
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_STATUS'; payload: HistoryFilters['statusFilter'] }
  | { type: 'SET_TYPE'; payload: HistoryFilters['typeFilter'] }
  | { type: 'SET_DATE_RANGE'; payload: HistoryFilters['dateRange'] }

export const HISTORY_INITIAL: HistoryFilters = {
  searchQuery: '', statusFilter: 'all', typeFilter: 'all', dateRange: 'all',
}

export function historyReducer(state: HistoryFilters, action: HistoryAction): HistoryFilters {
  switch (action.type) {
    case 'SET_SEARCH': return { ...state, searchQuery: action.payload }
    case 'SET_STATUS': return { ...state, statusFilter: action.payload }
    case 'SET_TYPE': return { ...state, typeFilter: action.payload }
    case 'SET_DATE_RANGE': return { ...state, dateRange: action.payload }
    default: return state
  }
}

// ── Library ───────────────────────────────────────────────────────

export interface LibraryFilters {
  searchQuery: string
  sortBy: 'newest' | 'oldest' | 'name-asc' | 'name-desc'
  categoryFilter: string
  viewMode: ViewMode
}

export type LibraryAction =
  | { type: 'SET_SEARCH'; payload: string }
  | { type: 'SET_SORT'; payload: LibraryFilters['sortBy'] }
  | { type: 'SET_CATEGORY'; payload: string }
  | { type: 'SET_VIEW'; payload: ViewMode }

export const LIBRARY_INITIAL: LibraryFilters = {
  searchQuery: '', sortBy: 'newest', categoryFilter: 'all', viewMode: 'grid',
}

export function libraryReducer(state: LibraryFilters, action: LibraryAction): LibraryFilters {
  switch (action.type) {
    case 'SET_SEARCH': return { ...state, searchQuery: action.payload }
    case 'SET_SORT': return { ...state, sortBy: action.payload }
    case 'SET_CATEGORY': return { ...state, categoryFilter: action.payload }
    case 'SET_VIEW': return { ...state, viewMode: action.payload }
    default: return state
  }
}
