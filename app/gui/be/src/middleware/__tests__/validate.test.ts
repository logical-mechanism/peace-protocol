import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  validatePkhParam,
  validateTokenNameParam,
  validateTxHashParam,
  validateEncryptionTokenParam,
  validateStatusParam,
} from '../validate.js';

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

describe('validatePkhParam', () => {
  const validPkh = 'a'.repeat(56);

  it('calls next() for valid 56-char hex pkh', () => {
    const req = mockReq({ pkh: validPkh });
    const res = mockRes();
    const next = vi.fn();

    validatePkhParam(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts uppercase hex', () => {
    const req = mockReq({ pkh: 'A'.repeat(56) });
    const res = mockRes();
    const next = vi.fn();

    validatePkhParam(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects too short pkh', () => {
    const req = mockReq({ pkh: 'a'.repeat(55) });
    const res = mockRes();
    const next = vi.fn();

    validatePkhParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects too long pkh', () => {
    const req = mockReq({ pkh: 'a'.repeat(57) });
    const res = mockRes();
    const next = vi.fn();

    validatePkhParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects non-hex characters', () => {
    const req = mockReq({ pkh: 'g'.repeat(56) });
    const res = mockRes();
    const next = vi.fn();

    validatePkhParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects empty string', () => {
    const req = mockReq({ pkh: '' });
    const res = mockRes();
    const next = vi.fn();

    validatePkhParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects missing param', () => {
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    validatePkhParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'INVALID_PARAM', message: 'Payment key hash must be 56 hex characters' },
    });
  });
});

describe('validateTokenNameParam', () => {
  it('accepts 1-char hex', () => {
    const req = mockReq({ tokenName: 'a' });
    const res = mockRes();
    const next = vi.fn();

    validateTokenNameParam(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts 64-char hex', () => {
    const req = mockReq({ tokenName: 'f'.repeat(64) });
    const res = mockRes();
    const next = vi.fn();

    validateTokenNameParam(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects empty string', () => {
    const req = mockReq({ tokenName: '' });
    const res = mockRes();
    const next = vi.fn();

    validateTokenNameParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects 65-char hex', () => {
    const req = mockReq({ tokenName: 'a'.repeat(65) });
    const res = mockRes();
    const next = vi.fn();

    validateTokenNameParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects non-hex characters', () => {
    const req = mockReq({ tokenName: 'zz' });
    const res = mockRes();
    const next = vi.fn();

    validateTokenNameParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateTxHashParam', () => {
  const validHash = 'ab'.repeat(32); // 64 hex chars

  it('accepts 64-char hex string', () => {
    const req = mockReq({ txHash: validHash });
    const res = mockRes();
    const next = vi.fn();

    validateTxHashParam(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects 63-char hex', () => {
    const req = mockReq({ txHash: 'a'.repeat(63) });
    const res = mockRes();
    const next = vi.fn();

    validateTxHashParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects 65-char hex', () => {
    const req = mockReq({ txHash: 'a'.repeat(65) });
    const res = mockRes();
    const next = vi.fn();

    validateTxHashParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects non-hex 64-char string', () => {
    const req = mockReq({ txHash: 'z'.repeat(64) });
    const res = mockRes();
    const next = vi.fn();

    validateTxHashParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateEncryptionTokenParam', () => {
  it('accepts valid encryption token', () => {
    const req = mockReq({ encryptionToken: 'abcdef' });
    const res = mockRes();
    const next = vi.fn();

    validateEncryptionTokenParam(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects empty string', () => {
    const req = mockReq({ encryptionToken: '' });
    const res = mockRes();
    const next = vi.fn();

    validateEncryptionTokenParam(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateStatusParam', () => {
  const validStatuses = ['active', 'pending', 'completed'];

  it('calls next() for a valid status', () => {
    const middleware = validateStatusParam(validStatuses);
    const req = mockReq({ status: 'active' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() for each valid status', () => {
    for (const status of validStatuses) {
      const middleware = validateStatusParam(validStatuses);
      const req = mockReq({ status });
      const res = mockRes();
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
    }
  });

  it('returns 400 INVALID_STATUS for unknown status', () => {
    const middleware = validateStatusParam(validStatuses);
    const req = mockReq({ status: 'unknown' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INVALID_STATUS',
        message: 'Status must be active, pending, completed',
      },
    });
  });

  it('returns 400 when status param is missing', () => {
    const middleware = validateStatusParam(validStatuses);
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('works with different status sets', () => {
    const bidStatuses = ['pending', 'accepted', 'rejected', 'cancelled'];
    const middleware = validateStatusParam(bidStatuses);
    const req = mockReq({ status: 'accepted' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
