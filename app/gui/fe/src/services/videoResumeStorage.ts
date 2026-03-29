import { storageGetJSON, storageSetJSON } from './storageUtils';

const STORAGE_KEY = 'veiled_video_resume';
const MAX_ENTRIES = 50;

// Only store if position is between 5% and 95% of duration
const MIN_PERCENT = 0.05;
const MAX_PERCENT = 0.95;

interface ResumeEntry {
  time: number;
  duration: number;
  updatedAt: number;
}

type ResumeMap = Record<string, ResumeEntry>;

/** Strip the random media server port prefix to get a stable key across sessions. */
export function normalizeVideoKey(src: string): string {
  // src looks like "http://127.0.0.1:{randomPort}/media/content/video/tokenName/file.mp4"
  // Strip "http://127.0.0.1:{port}/" to get the stable relative path
  return src.replace(/^https?:\/\/127\.0\.0\.1:\d+\//, '');
}

function loadMap(): ResumeMap {
  return storageGetJSON<ResumeMap>(STORAGE_KEY, {});
}

function saveMap(map: ResumeMap): void {
  storageSetJSON(STORAGE_KEY, map);
}

function evictOldest(map: ResumeMap): ResumeMap {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;
  entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const trimmed = entries.slice(entries.length - MAX_ENTRIES);
  return Object.fromEntries(trimmed);
}

export function getResumePosition(key: string): number | null {
  const map = loadMap();
  const entry = map[key];
  if (!entry) return null;
  // Validate the stored time is still within reasonable bounds
  if (entry.time <= 0 || !isFinite(entry.time)) return null;
  return entry.time;
}

export function setResumePosition(key: string, time: number, duration: number): void {
  if (duration <= 0 || !isFinite(duration) || !isFinite(time)) return;
  const percent = time / duration;
  // Don't store if too close to start or end
  if (percent < MIN_PERCENT || percent > MAX_PERCENT) return;
  const map = loadMap();
  map[key] = { time, duration, updatedAt: Date.now() };
  saveMap(evictOldest(map));
}

export function clearResumePosition(key: string): void {
  const map = loadMap();
  if (!(key in map)) return;
  delete map[key];
  saveMap(map);
}
