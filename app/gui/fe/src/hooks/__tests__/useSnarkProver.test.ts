import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSnarkProver } from '../useSnarkProver';

const mockCheckSetup = vi.fn();
const mockGenerateProof = vi.fn();

vi.mock('../../services/snark', () => ({
  getSnarkProver: () => ({
    checkSetup: mockCheckSetup,
    generateProof: mockGenerateProof,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSnarkProver', () => {
  it('checks setup on mount and sets isReady=true when setup exists', async () => {
    mockCheckSetup.mockResolvedValue(true);

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(mockCheckSetup).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it('sets isReady=false when setup does not exist', async () => {
    mockCheckSetup.mockResolvedValue(false);

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(mockCheckSetup).toHaveBeenCalled();
    });

    expect(result.current.isReady).toBe(false);
  });

  it('sets error on checkSetup failure', async () => {
    mockCheckSetup.mockRejectedValue(new Error('setup files corrupted'));

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(result.current.error).toBe('setup files corrupted');
    });

    expect(result.current.isReady).toBe(false);
  });

  it('generateProof sets isProving during execution and returns proof', async () => {
    mockCheckSetup.mockResolvedValue(true);
    const mockProof = { proofJson: '{}', publicJson: '{}' };
    mockGenerateProof.mockResolvedValue(mockProof);

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    let proof: unknown;
    await act(async () => {
      proof = await result.current.generateProof({
        secretA: 'a',
        secretR: 'r',
        publicV: 'v',
        publicW0: 'w0',
        publicW1: 'w1',
      });
    });

    expect(proof).toEqual(mockProof);
    expect(result.current.isProving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('generateProof sets error state on failure and returns null', async () => {
    mockCheckSetup.mockResolvedValue(true);
    mockGenerateProof.mockRejectedValue(new Error('prover crashed'));

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    let proof: unknown;
    await act(async () => {
      proof = await result.current.generateProof({
        secretA: 'a',
        secretR: 'r',
        publicV: 'v',
        publicW0: 'w0',
        publicW1: 'w1',
      });
    });

    expect(proof).toBeNull();
    expect(result.current.error).toBe('prover crashed');
    expect(result.current.isProving).toBe(false);
  });

  it('clearError resets error to null', async () => {
    mockCheckSetup.mockRejectedValue(new Error('check failed'));

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(result.current.error).toBe('check failed');
    });

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('checkSetup can be called manually after mount', async () => {
    mockCheckSetup.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(mockCheckSetup).toHaveBeenCalledOnce();
    });

    expect(result.current.isReady).toBe(false);

    let setupExists: boolean | undefined;
    await act(async () => {
      setupExists = await result.current.checkSetup();
    });

    expect(setupExists).toBe(true);
    expect(result.current.isReady).toBe(true);
  });

  it('handles non-Error thrown objects gracefully', async () => {
    mockCheckSetup.mockRejectedValue('string error');

    const { result } = renderHook(() => useSnarkProver());

    await waitFor(() => {
      expect(result.current.error).toBe('Failed to check setup');
    });
  });
});
