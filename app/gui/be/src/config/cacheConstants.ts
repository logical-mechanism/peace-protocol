/**
 * Centralized cache constants.
 *
 * HTTP Cache-Control headers and in-memory TTLs used across routes and services.
 */

/** Cache-Control headers for HTTP responses. */
export const CACHE_HEADER_DATA = 'max-age=5, stale-while-revalidate=15';
export const CACHE_HEADER_CONFIG = 'max-age=60, stale-while-revalidate=120';
export const CACHE_HEADER_STATIC = 'max-age=300, stale-while-revalidate=600';

/** In-memory cache TTLs in milliseconds. */
export const CACHE_TTL_DATA = 15_000;    // UTxO data (bids, encryptions)
export const CACHE_TTL_CHAIN = 60_000;   // Chain history queries
export const CACHE_TTL_PENDING = 15_000; // Pending tx confirmation checks
