/**
 * IndexedDB storage for SNARK proving files.
 *
 * The proving files (pk.bin ~613MB, ccs.bin ~85MB) are too large to keep in memory
 * and would be expensive to download repeatedly. This service caches them in IndexedDB
 * after the first download, making subsequent visits instant.
 */

const DB_NAME = 'peace-protocol-snark'
const DB_VERSION = 1
const STORE_NAME = 'files'

export interface SnarkFile {
  name: string
  data: ArrayBuffer
  size: number
  hash?: string
  timestamp: number
}

export interface DownloadProgress {
  loaded: number
  total: number
  percent: number
  fileName: string
}

class SnarkStorage {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null
  // In-memory fallback for files that fail to store in IndexedDB (quota exceeded)
  private memoryCache = new Map<string, SnarkFile>()
  // Track if we've requested persistent storage
  private persistentStorageRequested = false
  // Track if OPFS is available and initialized
  private opfsRoot: FileSystemDirectoryHandle | null = null
  private opfsInitPromise: Promise<boolean> | null = null

  /**
   * Request persistent storage to get larger IndexedDB quota
   * Returns true if granted, false otherwise
   */
  async requestPersistentStorage(): Promise<boolean> {
    if (this.persistentStorageRequested) {
      return true
    }

    try {
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted()
        if (isPersisted) {
          console.log('[SnarkStorage] Storage is already persistent')
          this.persistentStorageRequested = true
          return true
        }

        const granted = await navigator.storage.persist()
        console.log(`[SnarkStorage] Persistent storage ${granted ? 'granted' : 'denied'}`)
        this.persistentStorageRequested = true
        return granted
      }
    } catch (err) {
      console.warn('[SnarkStorage] Failed to request persistent storage:', err)
    }
    return false
  }

  /**
   * Initialize OPFS (Origin Private File System) for large file storage
   * OPFS has much larger storage limits than IndexedDB
   */
  async initOPFS(): Promise<boolean> {
    if (this.opfsRoot) {
      return true
    }

    if (this.opfsInitPromise) {
      return this.opfsInitPromise
    }

    this.opfsInitPromise = (async () => {
      try {
        if (!('storage' in navigator) || !('getDirectory' in navigator.storage)) {
          console.log('[SnarkStorage] OPFS not available in this browser')
          return false
        }

        this.opfsRoot = await navigator.storage.getDirectory()
        console.log('[SnarkStorage] OPFS initialized successfully')
        return true
      } catch (err) {
        console.warn('[SnarkStorage] Failed to initialize OPFS:', err)
        return false
      }
    })()

    return this.opfsInitPromise
  }

  /**
   * Store a file in OPFS
   */
  async storeFileOPFS(file: SnarkFile): Promise<boolean> {
    const opfsAvailable = await this.initOPFS()
    if (!opfsAvailable || !this.opfsRoot) {
      return false
    }

    try {
      console.log(`[SnarkStorage] OPFS: storing ${file.name} (${file.size} bytes)`)
      const fileHandle = await this.opfsRoot.getFileHandle(file.name, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(file.data)
      await writable.close()

      // Store metadata separately (timestamp, hash)
      const metaHandle = await this.opfsRoot.getFileHandle(`${file.name}.meta`, { create: true })
      const metaWritable = await metaHandle.createWritable()
      await metaWritable.write(JSON.stringify({
        size: file.size,
        hash: file.hash,
        timestamp: file.timestamp,
      }))
      await metaWritable.close()

      console.log(`[SnarkStorage] OPFS: ${file.name} stored successfully`)
      return true
    } catch (err) {
      console.error(`[SnarkStorage] OPFS: failed to store ${file.name}:`, err)
      return false
    }
  }

  /**
   * Get a file from OPFS
   */
  async getFileOPFS(name: string): Promise<SnarkFile | null> {
    const opfsAvailable = await this.initOPFS()
    if (!opfsAvailable || !this.opfsRoot) {
      return null
    }

    try {
      const fileHandle = await this.opfsRoot.getFileHandle(name)
      const file = await fileHandle.getFile()
      const data = await file.arrayBuffer()

      // Try to get metadata
      let meta = { size: data.byteLength, hash: undefined, timestamp: Date.now() }
      try {
        const metaHandle = await this.opfsRoot.getFileHandle(`${name}.meta`)
        const metaFile = await metaHandle.getFile()
        const metaText = await metaFile.text()
        meta = JSON.parse(metaText)
      } catch {
        // Metadata file might not exist for older files
      }

      console.log(`[SnarkStorage] OPFS: ${name} found (${data.byteLength} bytes)`)
      return {
        name,
        data,
        size: data.byteLength,
        hash: meta.hash,
        timestamp: meta.timestamp,
      }
    } catch (err) {
      // File not found is expected, other errors should be logged
      if ((err as Error).name !== 'NotFoundError') {
        console.warn(`[SnarkStorage] OPFS: error reading ${name}:`, err)
      }
      return null
    }
  }

  /**
   * Initialize IndexedDB connection
   */
  async init(): Promise<void> {
    if (this.db) {
      console.log('[SnarkStorage] init: already initialized')
      return
    }

    if (this.initPromise) {
      console.log('[SnarkStorage] init: waiting for existing init promise')
      return this.initPromise
    }

    console.log('[SnarkStorage] init: opening IndexedDB...')
    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('[SnarkStorage] init: Failed to open IndexedDB:', request.error)
        reject(new Error('Failed to open IndexedDB'))
      }

      request.onsuccess = () => {
        this.db = request.result
        console.log('[SnarkStorage] init: IndexedDB opened successfully')
        resolve()
      }

      request.onupgradeneeded = (event) => {
        console.log('[SnarkStorage] init: upgrading database schema...')
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'name' })
          console.log('[SnarkStorage] init: created object store')
        }
      }
    })

    return this.initPromise
  }

  /**
   * Get a file from storage (checks: memory cache -> OPFS -> IndexedDB)
   */
  async getFile(name: string): Promise<SnarkFile | null> {
    console.log(`[SnarkStorage] getFile: requesting ${name}`)

    // Check memory cache first (for files that failed persistent storage)
    const memoryFile = this.memoryCache.get(name)
    if (memoryFile) {
      console.log(`[SnarkStorage] getFile: ${name} found in memory cache (${memoryFile.size} bytes)`)
      return memoryFile
    }

    // Check OPFS next (preferred for large files)
    const opfsFile = await this.getFileOPFS(name)
    if (opfsFile) {
      console.log(`[SnarkStorage] getFile: ${name} found in OPFS (${opfsFile.size} bytes)`)
      return opfsFile
    }

    // Finally check IndexedDB
    await this.init()
    if (!this.db) {
      console.error('[SnarkStorage] getFile: database not initialized!')
      throw new Error('Database not initialized')
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(name)

      request.onerror = () => {
        console.error(`[SnarkStorage] getFile: error retrieving ${name}:`, request.error)
        reject(new Error(`Failed to get file: ${name}`))
      }
      request.onsuccess = () => {
        const result = request.result || null
        console.log(`[SnarkStorage] getFile: ${name} in IndexedDB =`, result ? `${result.size} bytes` : 'not found')
        resolve(result)
      }
    })
  }

  /**
   * Store a file in persistent storage
   * Strategy: Request persistent storage -> Try IndexedDB -> Try OPFS -> Memory fallback
   */
  async storeFile(file: SnarkFile): Promise<void> {
    console.log(`[SnarkStorage] storeFile: storing ${file.name} (${file.size} bytes)`)

    // For large files (>100MB), request persistent storage first
    if (file.size > 100 * 1024 * 1024) {
      await this.requestPersistentStorage()
    }

    await this.init()
    if (!this.db) {
      console.error('[SnarkStorage] storeFile: database not initialized!')
      throw new Error('Database not initialized')
    }

    // Helper to try OPFS fallback
    const tryOPFSFallback = async (): Promise<boolean> => {
      console.log(`[SnarkStorage] storeFile: trying OPFS fallback for ${file.name}`)
      const opfsSuccess = await this.storeFileOPFS(file)
      if (opfsSuccess) {
        console.log(`[SnarkStorage] storeFile: ${file.name} stored in OPFS successfully`)
        return true
      }
      return false
    }

    // Helper to use memory cache as last resort
    const useMemoryFallback = () => {
      console.warn(`[SnarkStorage] storeFile: using memory cache for ${file.name} (will need re-download after refresh)`)
      this.memoryCache.set(file.name, file)
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(file)

      // Use transaction events, not request events - more reliable for large files
      transaction.onerror = async () => {
        console.error(`[SnarkStorage] storeFile: transaction error storing ${file.name}:`, transaction.error)
        // Try OPFS, then memory fallback
        const opfsSuccess = await tryOPFSFallback()
        if (!opfsSuccess) {
          useMemoryFallback()
        }
        resolve() // Don't reject - we have fallbacks
      }

      transaction.onabort = async () => {
        const errorName = transaction.error?.name || 'unknown'
        console.error(`[SnarkStorage] storeFile: transaction aborted for ${file.name}:`, errorName)

        // Check if it's a quota error - try OPFS first, then memory
        if (errorName === 'QuotaExceededError' || transaction.error?.message?.includes('quota')) {
          console.warn(`[SnarkStorage] storeFile: IndexedDB quota exceeded for ${file.name}, trying OPFS...`)
          const opfsSuccess = await tryOPFSFallback()
          if (!opfsSuccess) {
            useMemoryFallback()
          }
          resolve() // Don't reject - we have fallbacks
        } else {
          reject(new Error(`Storage aborted for ${file.name}: ${errorName}`))
        }
      }

      transaction.oncomplete = async () => {
        console.log(`[SnarkStorage] storeFile: IndexedDB transaction complete for ${file.name}`)
        // Verify the file was actually stored (IndexedDB can silently fail)
        try {
          // Temporarily remove from memory cache to check persistent storage directly
          const wasInMemory = this.memoryCache.has(file.name)
          if (wasInMemory) {
            this.memoryCache.delete(file.name)
          }

          const verification = await this.getFile(file.name)

          if (!verification || verification.size !== file.size) {
            console.warn(`[SnarkStorage] storeFile: IndexedDB storage failed silently for ${file.name}, trying OPFS...`)
            const opfsSuccess = await tryOPFSFallback()
            if (!opfsSuccess) {
              useMemoryFallback()
            }
          } else {
            console.log(`[SnarkStorage] storeFile: ${file.name} verified in IndexedDB (${verification.size} bytes)`)
          }
          resolve()
        } catch (err) {
          console.warn(`[SnarkStorage] storeFile: verification error for ${file.name}, trying OPFS:`, err)
          const opfsSuccess = await tryOPFSFallback()
          if (!opfsSuccess) {
            useMemoryFallback()
          }
          resolve()
        }
      }

      request.onerror = () => {
        console.error(`[SnarkStorage] storeFile: request error storing ${file.name}:`, request.error)
      }
    })
  }

  /**
   * Check if all required SNARK files are cached (IndexedDB or memory)
   * Also validates that cached files are large enough to be real (not stale/corrupt).
   */
  async hasAllFiles(): Promise<boolean> {
    const requiredFiles = ['pk.bin', 'ccs.bin']
    // Minimum sizes to consider a cached file valid (must be at least 1MB)
    const MIN_VALID_SIZE = 1 * 1024 * 1024
    console.log('[SnarkStorage] hasAllFiles: checking for', requiredFiles)

    for (const fileName of requiredFiles) {
      const file = await this.getFile(fileName) // This checks both memory and IndexedDB
      const source = this.memoryCache.has(fileName) ? 'memory' : 'IndexedDB'
      console.log(`[SnarkStorage] hasAllFiles: ${fileName} =`, file ? `${file.size} bytes (${source})` : 'null')
      if (!file) {
        console.log(`[SnarkStorage] hasAllFiles: ${fileName} not found, returning false`)
        return false
      }
      if (file.size < MIN_VALID_SIZE) {
        console.warn(`[SnarkStorage] hasAllFiles: ${fileName} is too small (${file.size} bytes), treating as invalid`)
        return false
      }
    }

    console.log('[SnarkStorage] hasAllFiles: all files found and valid, returning true')
    return true
  }

  /**
   * Get cached file sizes and storage locations
   */
  async getCachedFileSizes(): Promise<{ pk: number | null; ccs: number | null }> {
    const pk = await this.getFile('pk.bin')
    const ccs = await this.getFile('ccs.bin')

    return {
      pk: pk?.size ?? null,
      ccs: ccs?.size ?? null,
    }
  }

  /**
   * Get storage info for debugging - reports where each file is stored
   */
  async getStorageInfo(): Promise<{
    pk: { size: number | null; location: 'memory' | 'opfs' | 'indexeddb' | 'none' }
    ccs: { size: number | null; location: 'memory' | 'opfs' | 'indexeddb' | 'none' }
    persistentStorage: boolean
  }> {
    const getLocation = async (name: string): Promise<{ size: number | null; location: 'memory' | 'opfs' | 'indexeddb' | 'none' }> => {
      // Check memory
      const memFile = this.memoryCache.get(name)
      if (memFile) {
        return { size: memFile.size, location: 'memory' }
      }

      // Check OPFS
      const opfsFile = await this.getFileOPFS(name)
      if (opfsFile) {
        return { size: opfsFile.size, location: 'opfs' }
      }

      // Check IndexedDB
      await this.init()
      if (this.db) {
        const idbFile = await new Promise<SnarkFile | null>((resolve) => {
          const transaction = this.db!.transaction(STORE_NAME, 'readonly')
          const store = transaction.objectStore(STORE_NAME)
          const request = store.get(name)
          request.onerror = () => resolve(null)
          request.onsuccess = () => resolve(request.result || null)
        })
        if (idbFile) {
          return { size: idbFile.size, location: 'indexeddb' }
        }
      }

      return { size: null, location: 'none' }
    }

    const isPersisted = navigator.storage?.persisted
      ? await navigator.storage.persisted()
      : false

    return {
      pk: await getLocation('pk.bin'),
      ccs: await getLocation('ccs.bin'),
      persistentStorage: isPersisted,
    }
  }

  /**
   * Clear all cached files (IndexedDB, OPFS, and memory)
   */
  async clearCache(): Promise<void> {
    console.log('[SnarkStorage] clearCache: clearing all storage...')

    // Clear memory cache
    this.memoryCache.clear()
    console.log('[SnarkStorage] clearCache: memory cache cleared')

    // Clear OPFS
    try {
      if (this.opfsRoot) {
        const filesToDelete = ['pk.bin', 'pk.bin.meta', 'ccs.bin', 'ccs.bin.meta']
        for (const name of filesToDelete) {
          try {
            await this.opfsRoot.removeEntry(name)
            console.log(`[SnarkStorage] clearCache: OPFS ${name} deleted`)
          } catch {
            // File might not exist, that's fine
          }
        }
      }
    } catch (err) {
      console.warn('[SnarkStorage] clearCache: error clearing OPFS:', err)
    }

    // Clear IndexedDB
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onerror = () => reject(new Error('Failed to clear cache'))
      request.onsuccess = () => {
        console.log('[SnarkStorage] clearCache: IndexedDB cleared')
        resolve()
      }
    })
  }

  /**
   * Download a file with progress tracking
   *
   * @param url - URL to download from
   * @param fileName - Name to store the file as
   * @param onProgress - Progress callback
   */
  async downloadFile(
    url: string,
    fileName: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<ArrayBuffer> {
    console.log(`[SnarkStorage] downloadFile: fetching ${url}`)
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`[SnarkStorage] downloadFile: HTTP error ${response.status} ${response.statusText}`)
      throw new Error(`Failed to download ${fileName}: ${response.status} ${response.statusText}`)
    }
    console.log(`[SnarkStorage] downloadFile: response OK, starting download...`)

    const contentLength = response.headers.get('Content-Length')
    const total = contentLength ? parseInt(contentLength, 10) : 0

    if (!response.body) {
      // Fallback for browsers without streaming support
      const data = await response.arrayBuffer()
      return data
    }

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0

    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      chunks.push(value)
      loaded += value.length

      if (onProgress) {
        onProgress({
          loaded,
          total: total || loaded,
          percent: total ? Math.round((loaded / total) * 100) : 0,
          fileName,
        })
      }
    }

    // Combine chunks into single ArrayBuffer
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0

    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result.buffer
  }

  /**
   * Download and cache a file
   */
  async downloadAndCache(
    url: string,
    fileName: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<ArrayBuffer> {
    console.log(`[SnarkStorage] downloadAndCache: starting download from ${url}`)
    const data = await this.downloadFile(url, fileName, onProgress)
    console.log(`[SnarkStorage] downloadAndCache: downloaded ${fileName}, ${data.byteLength} bytes`)

    console.log(`[SnarkStorage] downloadAndCache: storing ${fileName} in IndexedDB...`)
    await this.storeFile({
      name: fileName,
      data,
      size: data.byteLength,
      timestamp: Date.now(),
    })
    console.log(`[SnarkStorage] downloadAndCache: ${fileName} stored successfully`)

    return data
  }
}

// Singleton instance
export const snarkStorage = new SnarkStorage()

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/**
 * Expected file sizes for progress estimation
 */
export const EXPECTED_FILE_SIZES = {
  'pk.bin': 468_981_843,    // ~447 MB
  'ccs.bin': 54_683_814,    // ~52 MB
  'prover.wasm': 19_197_052, // ~18 MB
}
