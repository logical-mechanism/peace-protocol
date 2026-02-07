/**
 * Accept Bid Storage Service
 *
 * Stores hop secrets (a0, r0, hk) between Phase 12e (SNARK tx) and Phase 12f (re-encryption tx).
 * These secrets are generated fresh for the SNARK proof and needed for the re-encryption step.
 *
 * The flow:
 * 1. Phase 12e: Seller generates SNARK proof with fresh (a0, r0), stores them here
 * 2. Phase 12e tx confirms on-chain (encryption status → Pending)
 * 3. Phase 12f: Seller retrieves (a0, r0) to compute re-encryption artifacts
 * 4. Phase 12f tx confirms on-chain (encryption status → Open, new owner)
 * 5. Secrets are cleaned up
 */

const DB_NAME = 'peace-protocol';
const DB_VERSION = 3; // Increment version to add new store
const STORE_NAME = 'accept-bid-secrets';

/**
 * Accept bid secret structure.
 */
export interface AcceptBidSecrets {
  encryptionTokenName: string; // Encryption token being sold (64 hex chars)
  bidTokenName: string; // Bid being accepted (64 hex chars)
  a0: string; // Fresh secret scalar a0 (bigint as hex string)
  r0: string; // Fresh secret scalar r0 (bigint as hex string)
  grothPublic: number[]; // The 36 public inputs from the SNARK proof
  ttl: number; // TTL in POSIX milliseconds
  snarkTxHash: string; // Phase 12e tx hash (for tracking)
  createdAt: string; // ISO timestamp
}

/**
 * Open the IndexedDB database.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create seller-secrets store if it doesn't exist (from Phase 9)
      if (!db.objectStoreNames.contains('seller-secrets')) {
        const sellerStore = db.createObjectStore('seller-secrets', { keyPath: 'tokenName' });
        sellerStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Create bidder-secrets store if it doesn't exist (from Phase 12b)
      if (!db.objectStoreNames.contains('bidder-secrets')) {
        const bidStore = db.createObjectStore('bidder-secrets', { keyPath: 'bidTokenName' });
        bidStore.createIndex('createdAt', 'createdAt', { unique: false });
        bidStore.createIndex('encryptionTokenName', 'encryptionTokenName', { unique: false });
      }

      // Create accept-bid-secrets store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'encryptionTokenName' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/**
 * Store accept-bid secrets after Phase 12e SNARK tx.
 */
export async function storeAcceptBidSecrets(
  encryptionTokenName: string,
  bidTokenName: string,
  a0: bigint,
  r0: bigint,
  grothPublic: number[],
  ttl: number,
  snarkTxHash: string
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const secrets: AcceptBidSecrets = {
      encryptionTokenName,
      bidTokenName,
      a0: a0.toString(16),
      r0: r0.toString(16),
      grothPublic,
      ttl,
      snarkTxHash,
      createdAt: new Date().toISOString(),
    };

    const request = store.put(secrets);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to store accept-bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Retrieve accept-bid secrets for an encryption.
 */
export async function getAcceptBidSecrets(
  encryptionTokenName: string
): Promise<{ a0: bigint; r0: bigint; bidTokenName: string; grothPublic: number[]; ttl: number; snarkTxHash: string } | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(encryptionTokenName);

    request.onsuccess = () => {
      const result = request.result as AcceptBidSecrets | undefined;
      if (result) {
        resolve({
          a0: BigInt('0x' + result.a0),
          r0: BigInt('0x' + result.r0),
          bidTokenName: result.bidTokenName,
          grothPublic: result.grothPublic,
          ttl: result.ttl,
          snarkTxHash: result.snarkTxHash,
        });
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      reject(new Error('Failed to retrieve accept-bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Remove accept-bid secrets (after Phase 12f completes or on cancel).
 */
export async function removeAcceptBidSecrets(encryptionTokenName: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(encryptionTokenName);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to remove accept-bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Check if accept-bid secrets exist for an encryption.
 */
export async function hasAcceptBidSecrets(encryptionTokenName: string): Promise<boolean> {
  const secrets = await getAcceptBidSecrets(encryptionTokenName);
  return secrets !== null;
}
