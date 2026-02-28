import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

vi.mock('../../config/index.js', () => ({
  config: {
    useStubs: false,
    network: 'preprod',
    nodeEnv: 'test',
    cors: { origins: ['*'] },
  },
  getNetworkConfig: vi.fn(() => ({
    contracts: {
      encryptionAddress: 'addr_enc',
      biddingAddress: 'addr_bid',
      referenceAddress: 'addr_ref',
      encryptionPolicyId: 'pol_enc',
      biddingPolicyId: 'pol_bid',
      grothPolicyId: 'pol_groth',
      genesisPolicyId: 'pol_gen',
      genesisTokenName: 'genesis_tkn',
      encryptionRefTxHash: 'tx_enc_ref',
      encryptionRefOutputIndex: 1,
      biddingRefTxHash: 'tx_bid_ref',
      biddingRefOutputIndex: 1,
      grothRefTxHash: 'tx_groth_ref',
      grothRefOutputIndex: 1,
    },
  })),
}));

const mockKupoClient = {
  getAddressUtxos: vi.fn(),
};

const mockKoiosClient = {
  getProtocolParams: vi.fn(),
  getTxInfo: vi.fn(),
  getTip: vi.fn(),
};

vi.mock('../../services/kupo.js', () => ({
  getKupoClient: () => mockKupoClient,
}));

vi.mock('../../services/koios.js', () => ({
  getKoiosClient: () => mockKoiosClient,
}));

vi.mock('../../stubs/index.js', () => ({
  STUB_ENCRYPTIONS: [],
  STUB_BIDS: [],
  STUB_PROTOCOL_CONFIG: {
    network: 'preprod',
    contracts: {
      encryptionAddress: 'stub_addr_enc',
      biddingAddress: 'stub_addr_bid',
      encryptionPolicyId: 'stub_pol_enc',
      biddingPolicyId: 'stub_pol_bid',
    },
    referenceScripts: { encryption: null, bidding: null, groth: null },
  },
}));

vi.mock('../../services/encryptions.js', () => ({
  getAllEncryptions: vi.fn(),
  getEncryptionByToken: vi.fn(),
  getEncryptionsByUser: vi.fn(),
  getEncryptionsByStatus: vi.fn(),
  getEncryptionLevels: vi.fn(),
}));

vi.mock('../../services/bids.js', () => ({
  getAllBids: vi.fn(),
  getBidByToken: vi.fn(),
  getBidsByUser: vi.fn(),
  getBidsByEncryption: vi.fn(),
  getBidsByStatus: vi.fn(),
}));

import { config } from '../../config/index.js';

const app = createApp();

beforeEach(() => {
  vi.clearAllMocks();
  (config as Record<string, unknown>).useStubs = false;
});

describe('GET /api/protocol/config', () => {
  it('returns protocol configuration', async () => {
    const res = await request(app).get('/api/protocol/config');

    expect(res.status).toBe(200);
    expect(res.body.data.network).toBe('preprod');
    expect(res.body.data.contracts.encryptionAddress).toBe('addr_enc');
    expect(res.body.data.referenceScripts.encryption.txHash).toBe('tx_enc_ref');
  });

  it('returns stub data when useStubs is true', async () => {
    (config as Record<string, unknown>).useStubs = true;

    const res = await request(app).get('/api/protocol/config');

    expect(res.status).toBe(200);
    expect(res.body.data.contracts.encryptionAddress).toBe('stub_addr_enc');
  });
});

describe('GET /api/protocol/reference', () => {
  it('returns keyed reference scripts from config', async () => {
    const res = await request(app).get('/api/protocol/reference');

    expect(res.status).toBe(200);
    expect(res.body.data.encryption).toEqual({ txHash: 'tx_enc_ref', outputIndex: 1 });
    expect(res.body.data.bidding).toEqual({ txHash: 'tx_bid_ref', outputIndex: 1 });
    expect(res.body.data.groth).toEqual({ txHash: 'tx_groth_ref', outputIndex: 1 });
  });

  it('returns stub data when useStubs is true', async () => {
    (config as Record<string, unknown>).useStubs = true;

    const res = await request(app).get('/api/protocol/reference');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ encryption: null, bidding: null, groth: null });
  });
});

describe('GET /api/protocol/scripts', () => {
  it('returns script addresses and policy IDs', async () => {
    const res = await request(app).get('/api/protocol/scripts');

    expect(res.status).toBe(200);
    expect(res.body.data.encryption.address).toBe('addr_enc');
    expect(res.body.data.encryption.policyId).toBe('pol_enc');
    expect(res.body.data.bidding.address).toBe('addr_bid');
  });
});

describe('GET /api/protocol/params', () => {
  it('returns protocol parameters from Koios', async () => {
    mockKoiosClient.getProtocolParams.mockResolvedValue({
      minFeeA: 44,
      minFeeB: 155381,
    });

    const res = await request(app).get('/api/protocol/params');

    expect(res.status).toBe(200);
    expect(res.body.data.minFeeA).toBe(44);
  });

  it('returns 500 on Koios error', async () => {
    mockKoiosClient.getProtocolParams.mockRejectedValue(new Error('Koios down'));

    const res = await request(app).get('/api/protocol/params');
    expect(res.status).toBe(500);
  });
});
