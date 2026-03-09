// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, capsuleToPlutusJson } from '../ecies';

describe('ecies', () => {
  describe('roundtrip', () => {
    it('encrypts and decrypts back to original plaintext', async () => {
      const plaintext = new TextEncoder().encode('hello world');
      const capsule = await encrypt('context1', 'aabb', plaintext);
      const decrypted = await decrypt('context1', 'aabb', capsule.nonce, capsule.ct, capsule.aad);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('capsule format', () => {
    it('nonce is 24 chars (12 bytes)', async () => {
      const plaintext = new TextEncoder().encode('test');
      const capsule = await encrypt('ctx', 'aabb', plaintext);
      expect(capsule.nonce).toHaveLength(24);
      expect(capsule.nonce).toMatch(/^[0-9a-f]+$/);
    });

    it('aad is 56 chars (blake2b-224)', async () => {
      const plaintext = new TextEncoder().encode('test');
      const capsule = await encrypt('ctx', 'aabb', plaintext);
      expect(capsule.aad).toHaveLength(56);
      expect(capsule.aad).toMatch(/^[0-9a-f]+$/);
    });

    it('ct is non-empty', async () => {
      const plaintext = new TextEncoder().encode('test');
      const capsule = await encrypt('ctx', 'aabb', plaintext);
      expect(capsule.ct.length).toBeGreaterThan(0);
      expect(capsule.ct).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('tampered aad fails', () => {
    it('throws when decrypting with modified aad', async () => {
      const plaintext = new TextEncoder().encode('hello world');
      const capsule = await encrypt('ctx1', 'aabb', plaintext);
      const badAad = 'ff'.repeat(28); // wrong AAD → GCM tag mismatch
      await expect(
        decrypt('ctx1', 'aabb', capsule.nonce, capsule.ct, badAad)
      ).rejects.toThrow();
    });
  });

  describe('different kem fails', () => {
    it('throws when decrypting with wrong kem', async () => {
      const plaintext = new TextEncoder().encode('hello world');
      const capsule = await encrypt('ctx', 'aabb', plaintext);
      await expect(
        decrypt('ctx', 'ccdd', capsule.nonce, capsule.ct, capsule.aad)
      ).rejects.toThrow();
    });
  });

  describe('empty plaintext roundtrip', () => {
    it('encrypts and decrypts empty Uint8Array', async () => {
      const plaintext = new Uint8Array(0);
      const capsule = await encrypt('ctx', 'aabb', plaintext);
      const decrypted = await decrypt('ctx', 'aabb', capsule.nonce, capsule.ct, capsule.aad);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('nonce uniqueness', () => {
    it('two encryptions produce different nonces', async () => {
      const plaintext = new TextEncoder().encode('same data');
      const capsule1 = await encrypt('ctx', 'aabb', plaintext);
      const capsule2 = await encrypt('ctx', 'aabb', plaintext);
      expect(capsule1.nonce).not.toBe(capsule2.nonce);
    });
  });

  describe('capsuleToPlutusJson', () => {
    it('returns correct Plutus JSON structure with 3 fields', async () => {
      const plaintext = new TextEncoder().encode('test');
      const capsule = await encrypt('ctx', 'aabb', plaintext);
      const json = capsuleToPlutusJson(capsule) as {
        constructor: number;
        fields: { bytes: string }[];
      };
      expect(json.constructor).toBe(0);
      expect(json.fields).toHaveLength(3);
      expect(json.fields[0].bytes).toBe(capsule.nonce);
      expect(json.fields[1].bytes).toBe(capsule.aad);
      expect(json.fields[2].bytes).toBe(capsule.ct);
    });
  });
});
