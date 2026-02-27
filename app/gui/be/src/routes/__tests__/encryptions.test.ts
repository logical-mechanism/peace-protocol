import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

vi.mock('../../services/encryptions.js', () => ({
  getAllEncryptions: vi.fn(),
  getEncryptionByToken: vi.fn(),
  getEncryptionsByUser: vi.fn(),
  getEncryptionsByStatus: vi.fn(),
  getEncryptionLevels: vi.fn(),
}));

vi.mock('../../config/index.js', () => ({
  config: {
    useStubs: false,
    network: 'preprod',
    nodeEnv: 'test',
    cors: { origins: ['*'] },
  },
  getNetworkConfig: vi.fn(),
}));

vi.mock('../../stubs/index.js', () => ({
  STUB_ENCRYPTIONS: [
    { tokenName: 'stub_enc1', sellerPkh: 'aabb', status: 'active' },
    { tokenName: 'stub_enc2', sellerPkh: 'ccdd', status: 'pending' },
  ],
}));

import {
  getAllEncryptions,
  getEncryptionByToken,
  getEncryptionsByUser,
  getEncryptionsByStatus,
  getEncryptionLevels,
} from '../../services/encryptions.js';
import { KupoUnavailableError } from '../../services/kupo.js';
import { config } from '../../config/index.js';

const app = createApp();

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to non-stub mode
  (config as Record<string, unknown>).useStubs = false;
});

describe('GET /api/encryptions', () => {
  it('returns encryption list with meta', async () => {
    (getAllEncryptions as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ tokenName: 'enc1' }, { tokenName: 'enc2' }],
      warnings: {},
    });

    const res = await request(app).get('/api/encryptions');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(2);
  });

  it('returns 500 on service error', async () => {
    (getAllEncryptions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Kupo down'));

    const res = await request(app).get('/api/encryptions');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 503 with KUPO_UNAVAILABLE when Kupo is unreachable', async () => {
    (getAllEncryptions as ReturnType<typeof vi.fn>).mockRejectedValue(
      new KupoUnavailableError('Kupo /matches: ECONNREFUSED')
    );

    const res = await request(app).get('/api/encryptions');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('KUPO_UNAVAILABLE');
    expect(res.body.error.message).toBe('UTxO indexer is not reachable');
  });

  it('returns stub data when useStubs is true', async () => {
    (config as Record<string, unknown>).useStubs = true;

    const res = await request(app).get('/api/encryptions');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].tokenName).toBe('stub_enc1');
    expect(getAllEncryptions).not.toHaveBeenCalled();
  });

  it('includes warnings when datums are skipped', async () => {
    (getAllEncryptions as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ tokenName: 'enc1' }],
      warnings: { skippedDatums: 3 },
    });

    const res = await request(app).get('/api/encryptions');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.warnings).toEqual({ skippedDatums: 3 });
  });

  it('omits warnings when no datums are skipped', async () => {
    (getAllEncryptions as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ tokenName: 'enc1' }],
      warnings: {},
    });

    const res = await request(app).get('/api/encryptions');

    expect(res.status).toBe(200);
    expect(res.body.warnings).toBeUndefined();
  });
});

describe('GET /api/encryptions/:tokenName', () => {
  it('returns encryption when found', async () => {
    (getEncryptionByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { tokenName: 'abc' },
      warnings: {},
    });

    const res = await request(app).get('/api/encryptions/abc');

    expect(res.status).toBe(200);
    expect(res.body.data.tokenName).toBe('abc');
  });

  it('returns 404 when not found', async () => {
    (getEncryptionByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      warnings: {},
    });

    const res = await request(app).get('/api/encryptions/aabb');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on service error', async () => {
    (getEncryptionByToken as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

    const res = await request(app).get('/api/encryptions/abc');

    expect(res.status).toBe(500);
  });
});

describe('GET /api/encryptions/user/:pkh', () => {
  const validPkh = 'aa'.repeat(28); // 56 hex chars

  it('returns user encryptions', async () => {
    (getEncryptionsByUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ tokenName: 'e1', sellerPkh: validPkh }],
      warnings: {},
    });

    const res = await request(app).get(`/api/encryptions/user/${validPkh}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 500 on service error', async () => {
    (getEncryptionsByUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

    const res = await request(app).get(`/api/encryptions/user/${validPkh}`);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/encryptions/status/:status', () => {
  it('returns filtered encryptions for valid status', async () => {
    (getEncryptionsByStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      warnings: {},
    });

    const res = await request(app).get('/api/encryptions/status/active');

    expect(res.status).toBe(200);
    expect(getEncryptionsByStatus).toHaveBeenCalledWith('active');
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app).get('/api/encryptions/status/invalid');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
    expect(getEncryptionsByStatus).not.toHaveBeenCalled();
  });

  it('accepts pending status', async () => {
    (getEncryptionsByStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      warnings: {},
    });

    const res = await request(app).get('/api/encryptions/status/pending');
    expect(res.status).toBe(200);
  });

  it('accepts completed status', async () => {
    (getEncryptionsByStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      warnings: {},
    });

    const res = await request(app).get('/api/encryptions/status/completed');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/encryptions/:tokenName/levels', () => {
  it('returns encryption levels with pagination', async () => {
    (getEncryptionLevels as ReturnType<typeof vi.fn>).mockResolvedValue([
      { r1: 'aa', r2_g1: 'bb' },
    ]);

    const res = await request(app).get('/api/encryptions/ab01/levels');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  it('respects pagination params', async () => {
    const levels = Array.from({ length: 5 }, (_, i) => ({ r1: `level${i}` }));
    (getEncryptionLevels as ReturnType<typeof vi.fn>).mockResolvedValue(levels);

    const res = await request(app).get('/api/encryptions/ab01/levels?limit=2&offset=1');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(5);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.offset).toBe(1);
    expect(res.body.pagination.hasMore).toBe(true);
  });

  it('returns 500 on service error', async () => {
    (getEncryptionLevels as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

    const res = await request(app).get('/api/encryptions/ab01/levels');

    expect(res.status).toBe(500);
  });
});
