import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  isValidHex,
  isValidPkh,
  isValidTokenName,
  isValidTxHash,
  validateParam,
} from '../validate.js';

describe('isValidHex', () => {
  it('accepts lowercase hex', () => {
    expect(isValidHex('0123456789abcdef')).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(isValidHex('ABCDEF')).toBe(true);
  });

  it('accepts mixed case hex', () => {
    expect(isValidHex('aAbBcC')).toBe(true);
  });

  it('accepts empty string', () => {
    expect(isValidHex('')).toBe(true);
  });

  it('rejects non-hex characters', () => {
    expect(isValidHex('xyz')).toBe(false);
    expect(isValidHex('0g')).toBe(false);
    expect(isValidHex('hello')).toBe(false);
  });

  it('rejects strings with spaces', () => {
    expect(isValidHex('ab cd')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(isValidHex('ab!c')).toBe(false);
    expect(isValidHex('ab-cd')).toBe(false);
  });
});

describe('isValidPkh', () => {
  const validPkh = 'a'.repeat(56);

  it('accepts 56-char hex string', () => {
    expect(isValidPkh(validPkh)).toBe(true);
  });

  it('rejects too short', () => {
    expect(isValidPkh('a'.repeat(55))).toBe(false);
  });

  it('rejects too long', () => {
    expect(isValidPkh('a'.repeat(57))).toBe(false);
  });

  it('rejects non-hex 56-char string', () => {
    expect(isValidPkh('g'.repeat(56))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidPkh('')).toBe(false);
  });
});

describe('isValidTokenName', () => {
  it('accepts 1-char hex', () => {
    expect(isValidTokenName('a')).toBe(true);
  });

  it('accepts 64-char hex', () => {
    expect(isValidTokenName('f'.repeat(64))).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidTokenName('')).toBe(false);
  });

  it('rejects 65-char hex', () => {
    expect(isValidTokenName('a'.repeat(65))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidTokenName('zz')).toBe(false);
  });
});

describe('isValidTxHash', () => {
  const validHash = 'ab'.repeat(32); // 64 hex chars

  it('accepts 64-char hex string', () => {
    expect(isValidTxHash(validHash)).toBe(true);
  });

  it('rejects 63-char hex', () => {
    expect(isValidTxHash('a'.repeat(63))).toBe(false);
  });

  it('rejects 65-char hex', () => {
    expect(isValidTxHash('a'.repeat(65))).toBe(false);
  });

  it('rejects non-hex 64-char string', () => {
    expect(isValidTxHash('z'.repeat(64))).toBe(false);
  });
});

describe('validateParam', () => {
  function mockReq(params: Record<string, string>): Request {
    return { params } as unknown as Request;
  }

  function mockRes(): Response {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res as unknown as Response;
  }

  it('calls next() when validation passes', () => {
    const middleware = validateParam('id', (v) => v.length > 0, 'id required');
    const req = mockReq({ id: 'abc' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 when param is missing', () => {
    const middleware = validateParam('id', (v) => v.length > 0, 'id required');
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'INVALID_PARAM', message: 'id required' },
    });
  });

  it('returns 400 when validation fails', () => {
    const middleware = validateParam('id', () => false, 'bad id');
    const req = mockReq({ id: 'whatever' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'INVALID_PARAM', message: 'bad id' },
    });
  });

  it('returns 400 for empty string param', () => {
    const middleware = validateParam('id', (v) => v.length > 0, 'id required');
    const req = mockReq({ id: '' });
    const res = mockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
