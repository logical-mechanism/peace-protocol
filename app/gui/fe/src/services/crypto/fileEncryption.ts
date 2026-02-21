/**
 * File Encryption for Off-Chain Storage
 *
 * AES-256-GCM encryption/decryption for files before uploading to Iagon.
 * Uses the Web Crypto API (no additional dependencies).
 *
 * The encryption key and nonce are stored in the peace-payload's `secret`
 * field (field 1) inside the ECIES-encrypted capsule, so only the buyer
 * who decrypts the capsule can decrypt the file.
 */

const AES_KEY_BYTES = 32; // AES-256
const NONCE_BYTES = 12; // GCM standard nonce

/**
 * Result of encrypting a file for off-chain upload.
 */
export interface FileEncryptionResult {
  /** AES-256-GCM encrypted file bytes (ciphertext + auth tag) */
  encryptedBlob: Uint8Array;
  /** The 32-byte AES key (random) */
  key: Uint8Array;
  /** The 12-byte GCM nonce (random) */
  nonce: Uint8Array;
  /** SHA-256 digest of the original plaintext file */
  digest: Uint8Array;
}

/**
 * Encrypt a file for off-chain storage.
 *
 * Generates a random AES-256-GCM key and nonce, encrypts the file,
 * and computes a SHA-256 digest of the original content for integrity.
 *
 * @param fileBytes - Raw file content
 * @returns Encrypted blob + key + nonce + digest
 */
export async function encryptFileForUpload(
  fileBytes: Uint8Array
): Promise<FileEncryptionResult> {
  // Generate random key and nonce
  const key = crypto.getRandomValues(new Uint8Array(AES_KEY_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  // Import key for AES-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    fileBytes
  );

  // SHA-256 digest of original plaintext
  const digestBuf = await crypto.subtle.digest('SHA-256', fileBytes);

  return {
    encryptedBlob: new Uint8Array(encrypted),
    key,
    nonce,
    digest: new Uint8Array(digestBuf),
  };
}

/**
 * Decrypt a file downloaded from off-chain storage.
 *
 * @param encryptedBlob - AES-256-GCM ciphertext (including auth tag)
 * @param key - 32-byte AES key
 * @param nonce - 12-byte GCM nonce
 * @returns Decrypted file bytes
 */
export async function decryptDownloadedFile(
  encryptedBlob: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    encryptedBlob
  );

  return new Uint8Array(decrypted);
}

/**
 * Encode the AES key + nonce into a single byte array for storage in
 * the peace-payload `secret` field (field 1).
 *
 * Format: key (32 bytes) || nonce (12 bytes) = 44 bytes total
 */
export function encodeFileSecret(key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const combined = new Uint8Array(AES_KEY_BYTES + NONCE_BYTES);
  combined.set(key, 0);
  combined.set(nonce, AES_KEY_BYTES);
  return combined;
}

/**
 * Decode the AES key + nonce from the peace-payload `secret` field.
 */
export function decodeFileSecret(secret: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  if (secret.length !== AES_KEY_BYTES + NONCE_BYTES) {
    throw new Error(
      `Invalid file secret length: expected ${AES_KEY_BYTES + NONCE_BYTES}, got ${secret.length}`
    );
  }
  return {
    key: secret.slice(0, AES_KEY_BYTES),
    nonce: secret.slice(AES_KEY_BYTES),
  };
}

/**
 * Verify the SHA-256 digest of decrypted content matches the expected digest.
 *
 * @throws Error if digest doesn't match
 */
export async function verifyFileDigest(
  content: Uint8Array,
  expectedDigest: Uint8Array
): Promise<void> {
  const actualDigest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', content)
  );
  if (actualDigest.length !== expectedDigest.length) {
    throw new Error('File integrity check failed: digest length mismatch');
  }
  for (let i = 0; i < actualDigest.length; i++) {
    if (actualDigest[i] !== expectedDigest[i]) {
      throw new Error('File integrity check failed: content has been tampered with');
    }
  }
}
