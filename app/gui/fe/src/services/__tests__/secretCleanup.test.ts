import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EncryptionDisplay } from '../api';

vi.mock('../api', () => ({
  chainApi: {
    getConfirmations: vi.fn(),
  },
}));
vi.mock('../secretStorage', () => ({
  listSecrets: vi.fn(),
  removeSecrets: vi.fn(),
}));
vi.mock('../acceptBidStorage', () => ({
  getAcceptBidSecrets: vi.fn(),
  removeAcceptBidSecrets: vi.fn(),
}));

import { cleanupStaleSecrets, resetCleanupThrottle } from '../secretCleanup';
import { chainApi } from '../api';
import { listSecrets, removeSecrets } from '../secretStorage';
import { getAcceptBidSecrets, removeAcceptBidSecrets } from '../acceptBidStorage';

const USER_PKH = 'aabbcc';
const OTHER_PKH = 'ddeeff';

function makeEncryption(
  tokenName: string,
  sellerPkh: string,
  status: 'active' | 'pending' = 'active',
  txHash = 'tx_' + tokenName
): EncryptionDisplay {
  return {
    tokenName,
    sellerPkh,
    status,
    createdAt: '2025-01-01T00:00:00Z',
    utxo: { txHash, outputIndex: 0 },
    datum: {} as EncryptionDisplay['datum'],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCleanupThrottle();
});

describe('cleanupStaleSecrets', () => {
  it('does nothing when no seller secrets exist', async () => {
    (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await cleanupStaleSecrets(USER_PKH, []);

    expect(chainApi.getConfirmations).not.toHaveBeenCalled();
    expect(removeSecrets).not.toHaveBeenCalled();
  });

  it('skips tokens missing from chain (not auto-deleted)', async () => {
    (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tokenName: 'missing_token' },
    ]);

    await cleanupStaleSecrets(USER_PKH, []);

    expect(chainApi.getConfirmations).not.toHaveBeenCalled();
    expect(removeSecrets).not.toHaveBeenCalled();
  });

  describe('Path 1: Ownership changed', () => {
    it('deletes secrets when ownership changed and >= 15 confirmations', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);
      (chainApi.getConfirmations as ReturnType<typeof vi.fn>).mockResolvedValue({
        confirmations: 15,
      });

      const encryptions = [makeEncryption('token1', OTHER_PKH)];
      await cleanupStaleSecrets(USER_PKH, encryptions);

      expect(removeSecrets).toHaveBeenCalledWith('token1');
      expect(removeAcceptBidSecrets).toHaveBeenCalledWith('token1');
    });

    it('keeps secrets when ownership changed but < 15 confirmations', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);
      (chainApi.getConfirmations as ReturnType<typeof vi.fn>).mockResolvedValue({
        confirmations: 14,
      });

      const encryptions = [makeEncryption('token1', OTHER_PKH)];
      await cleanupStaleSecrets(USER_PKH, encryptions);

      expect(removeSecrets).not.toHaveBeenCalled();
    });

    it('keeps secrets when confirmation API fails', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);
      (chainApi.getConfirmations as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Koios unavailable')
      );

      const encryptions = [makeEncryption('token1', OTHER_PKH)];
      await cleanupStaleSecrets(USER_PKH, encryptions);

      expect(removeSecrets).not.toHaveBeenCalled();
    });

    it('ignores accept-bid removal errors (may not exist)', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);
      (chainApi.getConfirmations as ReturnType<typeof vi.fn>).mockResolvedValue({
        confirmations: 20,
      });
      (removeAcceptBidSecrets as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('not found')
      );

      const encryptions = [makeEncryption('token1', OTHER_PKH)];
      // Should not throw
      await cleanupStaleSecrets(USER_PKH, encryptions);
      expect(removeSecrets).toHaveBeenCalledWith('token1');
    });
  });

  describe('Path 2: Cancelled pending sale', () => {
    it('deletes stale hop secrets when TTL expired and confirmed', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);
      (getAcceptBidSecrets as ReturnType<typeof vi.fn>).mockResolvedValue({
        ttl: Date.now() - 60_000, // expired 60s ago
      });
      (chainApi.getConfirmations as ReturnType<typeof vi.fn>).mockResolvedValue({
        confirmations: 15,
      });

      const encryptions = [makeEncryption('token1', USER_PKH, 'active')];
      await cleanupStaleSecrets(USER_PKH, encryptions);

      expect(removeAcceptBidSecrets).toHaveBeenCalledWith('token1');
      // Seller secrets are NOT deleted (still own the encryption)
      expect(removeSecrets).not.toHaveBeenCalled();
    });

    it('skips when hop secrets TTL has not expired', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);
      (getAcceptBidSecrets as ReturnType<typeof vi.fn>).mockResolvedValue({
        ttl: Date.now() + 60_000, // expires in 60s
      });

      const encryptions = [makeEncryption('token1', USER_PKH, 'active')];
      await cleanupStaleSecrets(USER_PKH, encryptions);

      expect(removeAcceptBidSecrets).not.toHaveBeenCalled();
      expect(chainApi.getConfirmations).not.toHaveBeenCalled();
    });

    it('skips when no accept-bid secrets exist', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);
      (getAcceptBidSecrets as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const encryptions = [makeEncryption('token1', USER_PKH, 'active')];
      await cleanupStaleSecrets(USER_PKH, encryptions);

      expect(removeAcceptBidSecrets).not.toHaveBeenCalled();
    });

    it('does not touch secrets when status is pending', async () => {
      (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
        { tokenName: 'token1' },
      ]);

      const encryptions = [makeEncryption('token1', USER_PKH, 'pending')];
      await cleanupStaleSecrets(USER_PKH, encryptions);

      expect(removeSecrets).not.toHaveBeenCalled();
      expect(removeAcceptBidSecrets).not.toHaveBeenCalled();
      expect(chainApi.getConfirmations).not.toHaveBeenCalled();
    });
  });

  it('never throws — outer catch is best-effort', async () => {
    (listSecrets as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('storage error')
    );

    // Should not throw
    await expect(
      cleanupStaleSecrets(USER_PKH, [])
    ).resolves.toBeUndefined();
  });

  it('processes multiple tokens independently', async () => {
    (listSecrets as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tokenName: 'sold' },
      { tokenName: 'kept' },
    ]);
    (chainApi.getConfirmations as ReturnType<typeof vi.fn>).mockResolvedValue({
      confirmations: 20,
    });

    const encryptions = [
      makeEncryption('sold', OTHER_PKH),   // ownership changed
      makeEncryption('kept', USER_PKH),     // still ours, active
    ];

    (getAcceptBidSecrets as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await cleanupStaleSecrets(USER_PKH, encryptions);

    // sold → deleted, kept → not deleted
    expect(removeSecrets).toHaveBeenCalledWith('sold');
    expect(removeSecrets).toHaveBeenCalledTimes(1);
  });
});
