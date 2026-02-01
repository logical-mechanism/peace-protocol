/**
 * Bid Secret Storage Service
 *
 * Stores bidder secrets (b) in IndexedDB for later use when decrypting won bids.
 * These secrets are CRITICAL - if lost, the bidder cannot decrypt purchased data.
 *
 * Security considerations:
 * - Secrets are stored locally in the browser
 * - IndexedDB provides persistence across sessions
 * - In production, consider encrypting with a wallet-derived key
 * - Users should be warned about clearing browser data
 */

const DB_NAME = 'peace-protocol';
const DB_VERSION = 2; // Increment version to add new store
const STORE_NAME = 'bidder-secrets';

/**
 * Bidder secret structure.
 */
export interface BidderSecrets {
  bidTokenName: string; // Bid token name (64 hex chars)
  encryptionTokenName: string; // Encryption token being bid on (64 hex chars)
  b: string; // Secret scalar b (bigint as hex string)
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

      // Create bidder-secrets store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'bidTokenName' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('encryptionTokenName', 'encryptionTokenName', { unique: false });
      }
    };
  });
}

/**
 * Store bidder secrets for a bid.
 *
 * @param bidTokenName - Bid token name (64 hex chars)
 * @param encryptionTokenName - Encryption token being bid on (64 hex chars)
 * @param b - Secret scalar b (bigint)
 */
export async function storeBidSecrets(
  bidTokenName: string,
  encryptionTokenName: string,
  b: bigint
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const secrets: BidderSecrets = {
      bidTokenName,
      encryptionTokenName,
      b: b.toString(16),
      createdAt: new Date().toISOString(),
    };

    const request = store.put(secrets);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to store bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Retrieve bidder secrets for a bid.
 *
 * @param bidTokenName - Bid token name
 * @returns Secrets with b as bigint and encryption token, or null if not found
 */
export async function getBidSecrets(
  bidTokenName: string
): Promise<{ b: bigint; encryptionTokenName: string } | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(bidTokenName);

    request.onsuccess = () => {
      const result = request.result as BidderSecrets | undefined;
      if (result) {
        resolve({
          b: BigInt('0x' + result.b),
          encryptionTokenName: result.encryptionTokenName,
        });
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      reject(new Error('Failed to retrieve bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get all bid secrets for a specific encryption.
 * Useful for finding the bidder's secret when they win a bid.
 *
 * @param encryptionTokenName - Encryption token name
 * @returns Array of bid secrets for that encryption
 */
export async function getBidSecretsForEncryption(
  encryptionTokenName: string
): Promise<Array<{ bidTokenName: string; b: bigint }>> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('encryptionTokenName');
    const request = index.getAll(encryptionTokenName);

    request.onsuccess = () => {
      const results = request.result as BidderSecrets[];
      resolve(
        results.map((s) => ({
          bidTokenName: s.bidTokenName,
          b: BigInt('0x' + s.b),
        }))
      );
    };

    request.onerror = () => {
      reject(new Error('Failed to retrieve bid secrets for encryption'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Check if secrets exist for a bid.
 *
 * @param bidTokenName - Bid token name
 * @returns True if secrets exist
 */
export async function hasBidSecrets(bidTokenName: string): Promise<boolean> {
  const secrets = await getBidSecrets(bidTokenName);
  return secrets !== null;
}

/**
 * Remove secrets for a bid (after successful decryption or cancellation).
 *
 * @param bidTokenName - Bid token name
 */
export async function removeBidSecrets(bidTokenName: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(bidTokenName);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to remove bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * List all stored bid secrets (for debugging/management).
 *
 * @returns Array of bid token names with encryption tokens and creation dates
 */
export async function listBidSecrets(): Promise<
  Array<{ bidTokenName: string; encryptionTokenName: string; createdAt: string }>
> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result as BidderSecrets[];
      resolve(
        results.map((s) => ({
          bidTokenName: s.bidTokenName,
          encryptionTokenName: s.encryptionTokenName,
          createdAt: s.createdAt,
        }))
      );
    };

    request.onerror = () => {
      reject(new Error('Failed to list bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Clear all stored bid secrets (use with caution!).
 */
export async function clearAllBidSecrets(): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to clear bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Export bid secrets as JSON for backup (include warning in UI).
 */
export async function exportBidSecrets(): Promise<string> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result as BidderSecrets[];
      resolve(JSON.stringify(results, null, 2));
    };

    request.onerror = () => {
      reject(new Error('Failed to export bid secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Import bid secrets from JSON backup.
 */
export async function importBidSecrets(json: string): Promise<number> {
  const secrets: BidderSecrets[] = JSON.parse(json);
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let count = 0;

    for (const secret of secrets) {
      const request = store.put(secret);
      request.onsuccess = () => {
        count++;
      };
    }

    transaction.oncomplete = () => {
      db.close();
      resolve(count);
    };

    transaction.onerror = () => {
      reject(new Error('Failed to import bid secrets'));
    };
  });
}
