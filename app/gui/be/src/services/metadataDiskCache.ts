import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * Disk-backed metadata cache.
 *
 * On-chain tx metadata is immutable — once fetched, it never changes.
 * This cache persists entries to a JSON file so they survive Express
 * process restarts, avoiding expensive Koios re-fetches on cold start.
 *
 * In-memory Map is the primary store (fast reads). Disk writes are
 * debounced to avoid excessive I/O on rapid cache population.
 */
export class MetadataDiskCache<T> {
  private store = new Map<string, T>();
  private filePath: string | null;
  private dirty = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(filename: string, debounceMs = 5_000) {
    this.debounceMs = debounceMs;

    if (config.dataDir) {
      const cacheDir = join(config.dataDir, 'cache');
      try {
        if (!existsSync(cacheDir)) {
          mkdirSync(cacheDir, { recursive: true });
        }
        this.filePath = join(cacheDir, filename);
      } catch (err) {
        logger.warn('Failed to create cache directory, disk persistence disabled', {
          cacheDir,
          error: String(err),
        });
        this.filePath = null;
      }
    } else {
      this.filePath = null;
    }

    this.loadFromDisk();
  }

  get(key: string): T | undefined {
    return this.store.get(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  set(key: string, value: T): void {
    this.store.set(key, value);
    this.scheduleDiskWrite();
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
    this.dirty = true;
    this.flushToDisk();
  }

  /** Flush pending writes immediately (for graceful shutdown). */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (this.dirty) {
      this.flushToDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, T>;
      for (const [key, value] of Object.entries(parsed)) {
        this.store.set(key, value);
      }
      logger.info('Loaded metadata cache from disk', {
        file: this.filePath,
        entries: this.store.size,
      });
    } catch (err) {
      logger.warn('Failed to load metadata cache from disk, starting fresh', {
        file: this.filePath,
        error: String(err),
      });
    }
  }

  private scheduleDiskWrite(): void {
    this.dirty = true;
    if (this.writeTimer) return; // already scheduled
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flushToDisk();
    }, this.debounceMs);
  }

  private flushToDisk(): void {
    if (!this.filePath) {
      this.dirty = false;
      return;
    }

    try {
      const obj: Record<string, T> = {};
      for (const [key, value] of this.store) {
        obj[key] = value;
      }
      // Ensure parent directory exists (defensive)
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(obj), 'utf-8');
      this.dirty = false;
    } catch (err) {
      logger.warn('Failed to write metadata cache to disk', {
        file: this.filePath,
        error: String(err),
      });
    }
  }
}
