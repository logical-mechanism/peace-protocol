import { describe, it, expect, beforeEach } from 'vitest';
import { optimisticStore } from '../optimisticStore';
import type { EncryptionDisplay, BidDisplay } from '../api';

function makeEncryption(overrides: Partial<EncryptionDisplay> = {}): EncryptionDisplay {
  return {
    tokenName: 'enc1',
    seller: 'addr1',
    sellerPkh: 'pkh1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    utxo: { txHash: 'tx1', outputIndex: 0 },
    datum: {
      owner_vkh: 'pkh1',
      owner_g1: { generator: '', public_value: '' },
      token: 'enc1',
      half_level: { r1b: '', r2_g1b: '', r4b: '' },
      full_level: null,
      capsule: { nonce: '', aad: '', ct: '' },
      status: { type: 'Open' },
    },
    ...overrides,
  };
}

function makeBid(overrides: Partial<BidDisplay> = {}): BidDisplay {
  return {
    tokenName: 'bid1',
    bidder: 'addr2',
    bidderPkh: 'pkh2',
    encryptionToken: 'enc1',
    amount: 5_000_000,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00Z',
    lockedUntil: 0,
    utxo: { txHash: 'tx2', outputIndex: 0 },
    datum: {
      owner_vkh: 'pkh2',
      owner_g1: { generator: '', public_value: '' },
      pointer: 'bid1',
      token: 'enc1',
      locked_until: 0,
    },
    ...overrides,
  };
}

beforeEach(() => {
  optimisticStore.clear();
});

describe('optimisticStore', () => {
  describe('mergeEncryptions', () => {
    it('returns real data unchanged when store is empty', () => {
      const real = [makeEncryption()];
      expect(optimisticStore.mergeEncryptions(real)).toEqual(real);
    });

    it('appends optimistic add entries not in real data', () => {
      const optimistic = makeEncryption({ tokenName: 'new1', _optimistic: true });
      optimisticStore.addEncryption('new1', 'txA', optimistic);

      const real = [makeEncryption({ tokenName: 'enc1' })];
      const merged = optimisticStore.mergeEncryptions(real);

      expect(merged).toHaveLength(2);
      expect(merged[1].tokenName).toBe('new1');
      expect(merged[1]._optimistic).toBe(true);
    });

    it('graduates add entries when real data catches up', () => {
      const optimistic = makeEncryption({ tokenName: 'enc1', _optimistic: true });
      optimisticStore.addEncryption('enc1', 'txA', optimistic);

      const real = [makeEncryption({ tokenName: 'enc1' })];
      const merged = optimisticStore.mergeEncryptions(real);

      // Should return real data only (optimistic graduated)
      expect(merged).toHaveLength(1);
      expect(merged[0]._optimistic).toBeUndefined();
      expect(optimisticStore.size).toBe(0);
    });

    it('filters out remove entries still in real data', () => {
      optimisticStore.removeEncryption('enc1', 'txA');

      const real = [makeEncryption({ tokenName: 'enc1' }), makeEncryption({ tokenName: 'enc2' })];
      const merged = optimisticStore.mergeEncryptions(real);

      expect(merged).toHaveLength(1);
      expect(merged[0].tokenName).toBe('enc2');
    });

    it('graduates remove entries when real data no longer has them', () => {
      optimisticStore.removeEncryption('enc1', 'txA');

      const real = [makeEncryption({ tokenName: 'enc2' })];
      optimisticStore.mergeEncryptions(real);

      expect(optimisticStore.size).toBe(0);
    });

    it('applies update entries to matching real data', () => {
      optimisticStore.updateEncryption('enc1', 'txA', { status: 'pending' });

      const real = [makeEncryption({ tokenName: 'enc1', status: 'active' })];
      const merged = optimisticStore.mergeEncryptions(real);

      expect(merged[0].status).toBe('pending');
      expect(merged[0]._optimistic).toBe(true);
    });

    it('graduates update entries when real data already has target status', () => {
      optimisticStore.updateEncryption('enc1', 'txA', { status: 'pending' });

      const real = [makeEncryption({ tokenName: 'enc1', status: 'pending' })];
      optimisticStore.mergeEncryptions(real);

      expect(optimisticStore.size).toBe(0);
    });
  });

  describe('mergeBids', () => {
    it('returns real data unchanged when store is empty', () => {
      const real = [makeBid()];
      expect(optimisticStore.mergeBids(real)).toEqual(real);
    });

    it('appends optimistic add entries', () => {
      const optimistic = makeBid({ tokenName: 'newBid', _optimistic: true });
      optimisticStore.addBid('newBid', 'txA', optimistic);

      const real = [makeBid({ tokenName: 'bid1' })];
      const merged = optimisticStore.mergeBids(real);

      expect(merged).toHaveLength(2);
      expect(merged[1].tokenName).toBe('newBid');
    });

    it('graduates add entries when real data catches up', () => {
      optimisticStore.addBid('bid1', 'txA', makeBid({ _optimistic: true }));

      const real = [makeBid({ tokenName: 'bid1' })];
      const merged = optimisticStore.mergeBids(real);

      expect(merged).toHaveLength(1);
      expect(merged[0]._optimistic).toBeUndefined();
      expect(optimisticStore.size).toBe(0);
    });

    it('filters out remove entries still in real data', () => {
      optimisticStore.removeBid('bid1', 'txA');

      const real = [makeBid({ tokenName: 'bid1' }), makeBid({ tokenName: 'bid2' })];
      const merged = optimisticStore.mergeBids(real);

      expect(merged).toHaveLength(1);
      expect(merged[0].tokenName).toBe('bid2');
    });
  });

  describe('pruneStale', () => {
    it('removes entries older than maxAgeMs', () => {
      optimisticStore.addEncryption('enc1', 'txA', makeEncryption({ _optimistic: true }));
      optimisticStore.addBid('bid1', 'txA', makeBid({ _optimistic: true }));

      // Prune with 0ms max age (everything is stale)
      optimisticStore.pruneStale(0);

      expect(optimisticStore.size).toBe(0);
    });

    it('keeps entries newer than maxAgeMs', () => {
      optimisticStore.addEncryption('enc1', 'txA', makeEncryption({ _optimistic: true }));

      optimisticStore.pruneStale(300_000);

      expect(optimisticStore.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      optimisticStore.addEncryption('enc1', 'txA', makeEncryption());
      optimisticStore.addBid('bid1', 'txA', makeBid());
      optimisticStore.removeEncryption('enc2', 'txB');

      optimisticStore.clear();

      expect(optimisticStore.size).toBe(0);
    });
  });
});
