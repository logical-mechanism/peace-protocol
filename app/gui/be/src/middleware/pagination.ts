import type { Request } from 'express';

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 1_000_000;

export function parsePagination(req: Request): PaginationParams {
  const rawLimit = req.query.limit;
  const rawOffset = req.query.offset;

  let limit = DEFAULT_LIMIT;
  if (typeof rawLimit === 'string') {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  let offset = 0;
  if (typeof rawOffset === 'string') {
    const parsed = parseInt(rawOffset, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = Math.min(parsed, MAX_OFFSET);
    }
  }

  return { limit, offset };
}

export function paginate<T>(items: T[], params: PaginationParams): { data: T[]; pagination: PaginationMeta } {
  const { limit, offset } = params;
  const total = items.length;
  const sliced = items.slice(offset, offset + limit);
  return {
    data: sliced,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}
