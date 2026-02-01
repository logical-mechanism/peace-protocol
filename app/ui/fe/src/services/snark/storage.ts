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

  /**
   * Initialize IndexedDB connection
   */
  async init(): Promise<void> {
    if (this.db) return

    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error)
        reject(new Error('Failed to open IndexedDB'))
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'name' })
        }
      }
    })

    return this.initPromise
  }

  /**
   * Get a file from IndexedDB cache
   */
  async getFile(name: string): Promise<SnarkFile | null> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(name)

      request.onerror = () => reject(new Error(`Failed to get file: ${name}`))
      request.onsuccess = () => resolve(request.result || null)
    })
  }

  /**
   * Store a file in IndexedDB cache
   */
  async storeFile(file: SnarkFile): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(file)

      request.onerror = () => reject(new Error(`Failed to store file: ${file.name}`))
      request.onsuccess = () => resolve()
    })
  }

  /**
   * Check if all required SNARK files are cached
   */
  async hasAllFiles(): Promise<boolean> {
    const requiredFiles = ['pk.bin', 'ccs.bin']

    for (const fileName of requiredFiles) {
      const file = await this.getFile(fileName)
      if (!file) return false
    }

    return true
  }

  /**
   * Get cached file sizes
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
   * Clear all cached files
   */
  async clearCache(): Promise<void> {
    await this.init()
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onerror = () => reject(new Error('Failed to clear cache'))
      request.onsuccess = () => resolve()
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
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Failed to download ${fileName}: ${response.status} ${response.statusText}`)
    }

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
    const data = await this.downloadFile(url, fileName, onProgress)

    await this.storeFile({
      name: fileName,
      data,
      size: data.byteLength,
      timestamp: Date.now(),
    })

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
  'pk.bin': 613 * 1024 * 1024,    // ~613 MB
  'ccs.bin': 85 * 1024 * 1024,    // ~85 MB
  'prover.wasm': 24 * 1024 * 1024, // ~24 MB
}
