import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { WalletProvider, useWalletContext } from '../WalletContext';

// Mock heavy dependencies to avoid loading WASM/crypto
vi.mock('@meshsdk/core', () => ({
  MeshWallet: vi.fn().mockImplementation(() => ({
    getAddresses: () => ({
      baseAddressBech32: 'addr_test1qz...',
      enterpriseAddressBech32: null,
    }),
    getLovelace: vi.fn().mockResolvedValue('5000000'),
  })),
  EmbeddedWallet: vi.fn().mockImplementation(() => ({
    getAccount: () => ({ paymentKeyHex: 'abc123def456' }),
  })),
}));

vi.mock('../../services/providers', () => ({
  getKupoAdapter: vi.fn(),
  getOgmiosProvider: vi.fn(),
}));

vi.mock('../../services/crypto/zkKeyDerivation', () => ({
  setPaymentKeyHex: vi.fn(),
}));

vi.mock('../../services/autolock', () => ({
  getAutolockMinutes: vi.fn(() => 0), // 0 = never auto-lock
  AUTOLOCK_CHECK_INTERVAL: 600_000,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WalletContext', () => {
  it('transitions from loading to locked when wallet exists', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    expect(result.current.walletState).toBe('loading');

    await waitFor(() => {
      expect(result.current.walletState).toBe('locked');
    });
  });

  it('transitions from loading to no_wallet when wallet does not exist', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.walletState).toBe('no_wallet');
    });
  });

  it('transitions to no_wallet on wallet_exists error', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('invoke error'));

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.walletState).toBe('no_wallet');
    });
  });

  it('unlockWallet transitions to unlocked', async () => {
    // First call: wallet_exists → true (mount)
    // Second call: unlock_wallet → words
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true) // wallet_exists
      .mockResolvedValueOnce(['word1', 'word2', 'word3']); // unlock_wallet

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.walletState).toBe('locked');
    });

    await act(async () => {
      await result.current.unlockWallet('password123');
    });

    expect(result.current.walletState).toBe('unlocked');
    expect(result.current.address).toBe('addr_test1qz...');
    expect(result.current.connected).toBe(true);
  });

  it('lock clears state and transitions to locked', async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true) // wallet_exists
      .mockResolvedValueOnce(['word1', 'word2']) // unlock_wallet
      .mockResolvedValueOnce(undefined); // lock_wallet

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.walletState).toBe('locked');
    });

    await act(async () => {
      await result.current.unlockWallet('pw');
    });

    expect(result.current.walletState).toBe('unlocked');

    await act(async () => {
      await result.current.lock();
    });

    expect(result.current.walletState).toBe('locked');
    expect(result.current.address).toBeNull();
    expect(result.current.lovelace).toBeNull();
    expect(result.current.connected).toBe(false);
  });

  it('deleteWallet transitions to no_wallet', async () => {
    (invoke as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true) // wallet_exists
      .mockResolvedValueOnce(undefined); // delete_wallet

    const { result } = renderHook(() => useWalletContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.walletState).toBe('locked');
    });

    await act(async () => {
      await result.current.deleteWallet();
    });

    expect(result.current.walletState).toBe('no_wallet');
  });

  it('throws when used outside WalletProvider', () => {
    expect(() => {
      renderHook(() => useWalletContext());
    }).toThrow('useWalletContext must be used within WalletProvider');
  });
});
