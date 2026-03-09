/**
 * Desktop Notification Service
 *
 * Sends OS-level notifications via tauri-plugin-notification.
 * Wraps permission checks and provides a simple fire-and-forget API.
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

const STORAGE_KEY = 'veiled_desktop_notifications_enabled';
const DEFAULT_ENABLED = true;

// --- Settings persistence ---

export function isDesktopNotificationsEnabled(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored !== null ? stored === 'true' : DEFAULT_ENABLED;
}

export function setDesktopNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

// --- Permission management ---

let permissionChecked = false;
let hasPermission = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return hasPermission;

  try {
    hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      const result = await requestPermission();
      hasPermission = result === 'granted';
    }
    permissionChecked = true;
    return hasPermission;
  } catch {
    // Running outside Tauri (e.g. in tests or browser dev)
    return false;
  }
}

/** Reset cached permission state (for testing or after settings change). */
export function resetPermissionCache(): void {
  permissionChecked = false;
  hasPermission = false;
}

// --- Send notifications ---

/**
 * Send a desktop notification if enabled and permission is granted.
 * Fire-and-forget: errors are silently ignored.
 */
export async function sendDesktopNotification(
  title: string,
  body: string,
): Promise<void> {
  if (!isDesktopNotificationsEnabled()) return;

  try {
    const granted = await ensurePermission();
    if (!granted) return;
    sendNotification({ title, body });
  } catch {
    // Best effort
  }
}
