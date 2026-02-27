import { describe, it, expect } from 'vitest';
import { parsePagination, paginate } from '../pagination.js';
import type { Request } from 'express';

function mockReq(query: Record<string, string> = {}): Request {
  return { query } as unknown as Request;
}

describe('parsePagination', () => {
  it('returns default limit=50 and offset=0 when no query params', () => {
    const result = parsePagination(mockReq());
    expect(result).toEqual({ limit: 50, offset: 0 });
  });

  it('parses custom limit and offset', () => {
    const result = parsePagination(mockReq({ limit: '10', offset: '5' }));
    expect(result).toEqual({ limit: 10, offset: 5 });
  });

  it('clamps limit to max 200', () => {
    const result = parsePagination(mockReq({ limit: '999' }));
    expect(result.limit).toBe(200);
  });

  it('ignores zero limit (uses default)', () => {
    const result = parsePagination(mockReq({ limit: '0' }));
    expect(result.limit).toBe(50);
  });

  it('ignores negative limit (uses default)', () => {
    const result = parsePagination(mockReq({ limit: '-5' }));
    expect(result.limit).toBe(50);
  });

  it('ignores non-numeric limit', () => {
    const result = parsePagination(mockReq({ limit: 'abc' }));
    expect(result.limit).toBe(50);
  });

  it('ignores negative offset (uses 0)', () => {
    const result = parsePagination(mockReq({ offset: '-3' }));
    expect(result.offset).toBe(0);
  });

  it('ignores non-numeric offset', () => {
    const result = parsePagination(mockReq({ offset: 'xyz' }));
    expect(result.offset).toBe(0);
  });

  it('accepts offset=0 explicitly', () => {
    const result = parsePagination(mockReq({ offset: '0' }));
    expect(result.offset).toBe(0);
  });

  it('caps offset at 1,000,000', () => {
    const result = parsePagination(mockReq({ offset: '9999999999' }));
    expect(result.offset).toBe(1_000_000);
  });

  it('accepts offset exactly at 1,000,000', () => {
    const result = parsePagination(mockReq({ offset: '1000000' }));
    expect(result.offset).toBe(1_000_000);
  });

  it('caps offset just above 1,000,000', () => {
    const result = parsePagination(mockReq({ offset: '1000001' }));
    expect(result.offset).toBe(1_000_000);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 10 }, (_, i) => `item${i}`);

  it('returns first page with default params', () => {
    const result = paginate(items, { limit: 50, offset: 0 });
    expect(result.data).toEqual(items);
    expect(result.pagination).toEqual({
      total: 10,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
  });

  it('slices correctly with limit < total', () => {
    const result = paginate(items, { limit: 3, offset: 0 });
    expect(result.data).toEqual(['item0', 'item1', 'item2']);
    expect(result.pagination.total).toBe(10);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('slices correctly with offset', () => {
    const result = paginate(items, { limit: 3, offset: 7 });
    expect(result.data).toEqual(['item7', 'item8', 'item9']);
    expect(result.pagination.hasMore).toBe(false);
  });

  it('returns empty data when offset exceeds total', () => {
    const result = paginate(items, { limit: 10, offset: 20 });
    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(10);
    expect(result.pagination.hasMore).toBe(false);
  });

  it('handles empty array', () => {
    const result = paginate([], { limit: 50, offset: 0 });
    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
  });

  it('hasMore is true when exactly at boundary', () => {
    const result = paginate(items, { limit: 5, offset: 0 });
    expect(result.data).toHaveLength(5);
    expect(result.pagination.hasMore).toBe(true);
  });

  it('hasMore is false when limit matches remaining', () => {
    const result = paginate(items, { limit: 5, offset: 5 });
    expect(result.data).toHaveLength(5);
    expect(result.pagination.hasMore).toBe(false);
  });
});
