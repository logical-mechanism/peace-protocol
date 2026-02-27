import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { SnarkProver, getSnarkProver } from '../snark/prover';
import type { SnarkProofInputs } from '../snark/prover';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const testInputs: SnarkProofInputs = {
  secretA: '0x123',
  secretR: '0x456',
  publicV: 'a'.repeat(96),
  publicW0: 'b'.repeat(96),
  publicW1: 'c'.repeat(96),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('SnarkProver', () => {
  describe('stub mode', () => {
    it('checkSetup returns true in stub mode', async () => {
      const prover = new SnarkProver({ useStubs: true });
      const result = await prover.checkSetup();
      expect(result).toBe(true);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('initialize completes immediately in stub mode', async () => {
      const prover = new SnarkProver({ useStubs: true });
      const onProgress = vi.fn();
      await prover.initialize(onProgress);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'complete', message: expect.stringContaining('stub') }),
      );
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('initialize is idempotent', async () => {
      const prover = new SnarkProver({ useStubs: true });
      const onProgress = vi.fn();
      await prover.initialize(onProgress);
      await prover.initialize(onProgress);
      // Only called once (second init skipped)
      expect(onProgress).toHaveBeenCalledTimes(1);
    });

    it('generateProof returns stub proof in stub mode', async () => {
      const prover = new SnarkProver({ useStubs: true, stubDelayMs: 0 });
      const result = await prover.generateProof(testInputs);
      expect(result.proofJson).toBeTruthy();
      expect(result.publicJson).toBeTruthy();
      expect(mockInvoke).not.toHaveBeenCalled();
      // Verify the stub output is valid JSON
      expect(() => JSON.parse(result.proofJson)).not.toThrow();
      expect(() => JSON.parse(result.publicJson)).not.toThrow();
    });

    it('gtToHash returns stub hash in stub mode', async () => {
      const prover = new SnarkProver({ useStubs: true });
      const result = await prover.gtToHash('0x123abc');
      expect(result).toMatch(/^stub_hash_/);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('decryptToHash returns stub hash in stub mode', async () => {
      const prover = new SnarkProver({ useStubs: true });
      const result = await prover.decryptToHash('g1b', 'r1', 'shared', 'g2b');
      expect(result).toMatch(/^stub_decrypt_hash_/);
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe('real mode', () => {
    it('checkSetup calls snark_check_setup', async () => {
      const prover = new SnarkProver({ useStubs: false });
      mockInvoke.mockResolvedValueOnce(true);
      const result = await prover.checkSetup();
      expect(mockInvoke).toHaveBeenCalledWith('snark_check_setup');
      expect(result).toBe(true);
    });

    it('initialize checks setup and skips decompress when files exist', async () => {
      const prover = new SnarkProver({ useStubs: false });
      mockInvoke.mockResolvedValueOnce(true); // snark_check_setup
      const onProgress = vi.fn();
      await prover.initialize(onProgress);
      expect(mockInvoke).toHaveBeenCalledWith('snark_check_setup');
      expect(mockInvoke).not.toHaveBeenCalledWith('snark_decompress_setup');
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'complete' }),
      );
    });

    it('initialize decompresses when setup files missing', async () => {
      const prover = new SnarkProver({ useStubs: false });
      mockInvoke
        .mockResolvedValueOnce(false)     // snark_check_setup → not found
        .mockResolvedValueOnce(undefined); // snark_decompress_setup
      const onProgress = vi.fn();
      await prover.initialize(onProgress);
      expect(mockInvoke).toHaveBeenCalledWith('snark_decompress_setup');
    });

    it('generateProof calls snark_prove with correct args', async () => {
      const prover = new SnarkProver({ useStubs: false });
      mockInvoke
        .mockResolvedValueOnce(true) // snark_check_setup (from initialize)
        .mockResolvedValueOnce({ proofJson: '{}', publicJson: '[]' }); // snark_prove
      const result = await prover.generateProof(testInputs);
      expect(mockInvoke).toHaveBeenCalledWith('snark_prove', {
        secrets: {
          a: testInputs.secretA,
          r: testInputs.secretR,
          v: testInputs.publicV,
          w0: testInputs.publicW0,
          w1: testInputs.publicW1,
        },
      });
      expect(result).toEqual({ proofJson: '{}', publicJson: '[]' });
    });

    it('generateProof reports progress', async () => {
      const prover = new SnarkProver({ useStubs: false });
      mockInvoke
        .mockResolvedValueOnce(true) // snark_check_setup
        .mockResolvedValueOnce({ proofJson: '{}', publicJson: '[]' }); // snark_prove
      const onProgress = vi.fn();
      await prover.generateProof(testInputs, onProgress);
      // Should have called with proving stage
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'proving' }),
      );
      // Should have called with complete stage
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'complete' }),
      );
    });

    it('gtToHash calls snark_gt_to_hash', async () => {
      const prover = new SnarkProver({ useStubs: false });
      const hash56 = 'a'.repeat(56);
      mockInvoke.mockResolvedValueOnce(hash56);
      const result = await prover.gtToHash('0x123');
      expect(mockInvoke).toHaveBeenCalledWith('snark_gt_to_hash', { a: '0x123' });
      expect(result).toBe(hash56);
    });

    it('decryptToHash calls snark_decrypt_to_hash', async () => {
      const prover = new SnarkProver({ useStubs: false });
      mockInvoke.mockResolvedValueOnce('hash'.repeat(14));
      const result = await prover.decryptToHash('g1b', 'r1', 'shared', 'g2b');
      expect(mockInvoke).toHaveBeenCalledWith('snark_decrypt_to_hash', {
        g1b: 'g1b', r1: 'r1', shared: 'shared', g2b: 'g2b',
      });
      expect(result).toBeTruthy();
    });

    it('decryptToHash defaults g2b to empty string', async () => {
      const prover = new SnarkProver({ useStubs: false });
      mockInvoke.mockResolvedValueOnce('hash'.repeat(14));
      await prover.decryptToHash('g1b', 'r1', 'shared');
      expect(mockInvoke).toHaveBeenCalledWith('snark_decrypt_to_hash', {
        g1b: 'g1b', r1: 'r1', shared: 'shared', g2b: '',
      });
    });
  });

  describe('dispose', () => {
    it('resets setupChecked flag', async () => {
      const prover = new SnarkProver({ useStubs: true });
      await prover.initialize();
      prover.dispose();
      // After dispose, initialize should run again
      const onProgress = vi.fn();
      await prover.initialize(onProgress);
      expect(onProgress).toHaveBeenCalledTimes(1);
    });
  });
});

describe('getSnarkProver', () => {
  it('returns a SnarkProver singleton', () => {
    // Note: singleton state persists across tests in the same module
    const prover1 = getSnarkProver({ useStubs: true });
    const prover2 = getSnarkProver();
    expect(prover1).toBe(prover2);
  });
});
