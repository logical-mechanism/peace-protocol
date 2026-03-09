// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  encryptFileForUpload,
  decryptDownloadedFile,
  encodeFileSecret,
  decodeFileSecret,
  verifyFileDigest,
} from '../fileEncryption';

describe('fileEncryption', () => {
  describe('encryptFileForUpload', () => {
    it('returns encrypted blob, key, nonce, and digest', async () => {
      const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await encryptFileForUpload(plaintext);

      expect(result.encryptedBlob).toBeInstanceOf(Uint8Array);
      expect(result.key).toBeInstanceOf(Uint8Array);
      expect(result.nonce).toBeInstanceOf(Uint8Array);
      expect(result.digest).toBeInstanceOf(Uint8Array);
    });

    it('generates 32-byte key', async () => {
      const result = await encryptFileForUpload(new Uint8Array([1]));
      expect(result.key.length).toBe(32);
    });

    it('generates 12-byte nonce', async () => {
      const result = await encryptFileForUpload(new Uint8Array([1]));
      expect(result.nonce.length).toBe(12);
    });

    it('generates 32-byte SHA-256 digest', async () => {
      const result = await encryptFileForUpload(new Uint8Array([1, 2, 3]));
      expect(result.digest.length).toBe(32);
    });

    it('encrypted blob is larger than plaintext (GCM auth tag)', async () => {
      const plaintext = new Uint8Array(100);
      const result = await encryptFileForUpload(plaintext);
      // GCM adds a 16-byte auth tag
      expect(result.encryptedBlob.length).toBe(100 + 16);
    });

    it('produces different ciphertexts for same plaintext (random key/nonce)', async () => {
      const plaintext = new Uint8Array([10, 20, 30]);
      const r1 = await encryptFileForUpload(plaintext);
      const r2 = await encryptFileForUpload(plaintext);

      // Keys should differ
      expect(r1.key).not.toEqual(r2.key);
      // Nonces should differ
      expect(r1.nonce).not.toEqual(r2.nonce);
      // Ciphertexts should differ
      expect(r1.encryptedBlob).not.toEqual(r2.encryptedBlob);
    });

    it('handles empty file', async () => {
      const result = await encryptFileForUpload(new Uint8Array(0));
      expect(result.encryptedBlob.length).toBe(16); // only auth tag
      expect(result.key.length).toBe(32);
      expect(result.nonce.length).toBe(12);
    });
  });

  describe('encrypt → decrypt roundtrip', () => {
    it('recovers original plaintext', async () => {
      const plaintext = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const { encryptedBlob, key, nonce } = await encryptFileForUpload(plaintext);
      const decrypted = await decryptDownloadedFile(encryptedBlob, key, nonce);
      expect(decrypted).toEqual(plaintext);
    });

    it('roundtrips empty file', async () => {
      const plaintext = new Uint8Array(0);
      const { encryptedBlob, key, nonce } = await encryptFileForUpload(plaintext);
      const decrypted = await decryptDownloadedFile(encryptedBlob, key, nonce);
      expect(decrypted).toEqual(plaintext);
    });

    it('roundtrips large file (64KB)', async () => {
      const plaintext = new Uint8Array(65536);
      crypto.getRandomValues(plaintext);
      const { encryptedBlob, key, nonce } = await encryptFileForUpload(plaintext);
      const decrypted = await decryptDownloadedFile(encryptedBlob, key, nonce);
      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('decryptDownloadedFile', () => {
    it('rejects with wrong key', async () => {
      const { encryptedBlob, nonce } = await encryptFileForUpload(new Uint8Array([1, 2, 3]));
      const wrongKey = new Uint8Array(32);
      await expect(decryptDownloadedFile(encryptedBlob, wrongKey, nonce)).rejects.toThrow();
    });

    it('rejects with tampered ciphertext', async () => {
      const { encryptedBlob, key, nonce } = await encryptFileForUpload(new Uint8Array([1, 2, 3]));
      const tampered = new Uint8Array(encryptedBlob);
      tampered[0] ^= 0xff; // flip a byte
      await expect(decryptDownloadedFile(tampered, key, nonce)).rejects.toThrow();
    });
  });

  describe('encodeFileSecret / decodeFileSecret', () => {
    it('roundtrips key and nonce', () => {
      const key = new Uint8Array(32);
      const nonce = new Uint8Array(12);
      crypto.getRandomValues(key);
      crypto.getRandomValues(nonce);

      const combined = encodeFileSecret(key, nonce);
      expect(combined.length).toBe(44);

      const decoded = decodeFileSecret(combined);
      expect(decoded.key).toEqual(key);
      expect(decoded.nonce).toEqual(nonce);
    });
  });

  describe('decodeFileSecret', () => {
    it('throws for invalid length', () => {
      const bad = new Uint8Array(10);
      expect(() => decodeFileSecret(bad)).toThrow('Invalid file secret length: expected 44, got 10');
    });
  });

  describe('verifyFileDigest', () => {
    it('passes for correct content', async () => {
      const content = new Uint8Array([1, 2, 3]);
      const { digest } = await encryptFileForUpload(content);
      // Should not throw
      await verifyFileDigest(content, digest);
    });

    it('throws for tampered content', async () => {
      const content = new Uint8Array([1, 2, 3]);
      const { digest } = await encryptFileForUpload(content);
      const tampered = new Uint8Array([1, 2, 4]); // different byte
      await expect(verifyFileDigest(tampered, digest)).rejects.toThrow(
        'File integrity check failed: content has been tampered with',
      );
    });

    it('throws for wrong digest length', async () => {
      const content = new Uint8Array([1, 2, 3]);
      const badDigest = new Uint8Array(16); // wrong length
      await expect(verifyFileDigest(content, badDigest)).rejects.toThrow(
        'File integrity check failed: digest length mismatch',
      );
    });
  });
});
