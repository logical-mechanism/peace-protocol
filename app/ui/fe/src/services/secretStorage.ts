/**
 * Secret Storage Service
 *
 * Stores seller secrets (a, r) in IndexedDB for later use when accepting bids.
 * These secrets are CRITICAL - if lost, the seller cannot complete sales.
 *
 * Security considerations:
 * - Secrets are stored locally in the browser
 * - IndexedDB provides persistence across sessions
 * - In production, consider encrypting with a wallet-derived key
 * - Users should be warned about clearing browser data
 */

const DB_NAME = 'peace-protocol';
const DB_VERSION = 1;
const STORE_NAME = 'seller-secrets';

/**
 * Seller secret structure.
 */
export interface SellerSecrets {
  tokenName: string; // Encryption token name (64 hex chars)
  a: string; // Secret scalar a (bigint as hex string)
  r: string; // Secret scalar r (bigint as hex string)
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

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'tokenName' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/**
 * Store seller secrets for an encryption.
 *
 * @param tokenName - Encryption token name (64 hex chars)
 * @param a - Secret scalar a (bigint)
 * @param r - Secret scalar r (bigint)
 */
export async function storeSecrets(
  tokenName: string,
  a: bigint,
  r: bigint
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const secrets: SellerSecrets = {
      tokenName,
      a: a.toString(16),
      r: r.toString(16),
      createdAt: new Date().toISOString(),
    };

    const request = store.put(secrets);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to store secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Retrieve seller secrets for an encryption.
 *
 * @param tokenName - Encryption token name
 * @returns Secrets with a and r as bigint, or null if not found
 */
export async function getSecrets(
  tokenName: string
): Promise<{ a: bigint; r: bigint } | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(tokenName);

    request.onsuccess = () => {
      const result = request.result as SellerSecrets | undefined;
      if (result) {
        resolve({
          a: BigInt('0x' + result.a),
          r: BigInt('0x' + result.r),
        });
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      reject(new Error('Failed to retrieve secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Check if secrets exist for a token.
 *
 * @param tokenName - Encryption token name
 * @returns True if secrets exist
 */
export async function hasSecrets(tokenName: string): Promise<boolean> {
  const secrets = await getSecrets(tokenName);
  return secrets !== null;
}

/**
 * Remove secrets for an encryption (after successful sale or cancellation).
 *
 * @param tokenName - Encryption token name
 */
export async function removeSecrets(tokenName: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(tokenName);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to remove secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * List all stored secrets (for debugging/management).
 *
 * @returns Array of token names with creation dates
 */
export async function listSecrets(): Promise<
  Array<{ tokenName: string; createdAt: string }>
> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result as SellerSecrets[];
      resolve(
        results.map((s) => ({
          tokenName: s.tokenName,
          createdAt: s.createdAt,
        }))
      );
    };

    request.onerror = () => {
      reject(new Error('Failed to list secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Clear all stored secrets (use with caution!).
 */
export async function clearAllSecrets(): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to clear secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Export secrets as JSON for backup (include warning in UI).
 */
export async function exportSecrets(): Promise<string> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result as SellerSecrets[];
      resolve(JSON.stringify(results, null, 2));
    };

    request.onerror = () => {
      reject(new Error('Failed to export secrets'));
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Import secrets from JSON backup.
 */
export async function importSecrets(json: string): Promise<number> {
  const secrets: SellerSecrets[] = JSON.parse(json);
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
      reject(new Error('Failed to import secrets'));
    };
  });
}
