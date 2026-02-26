/**
 * Mock for @tauri-apps/plugin-notification.
 *
 * Vitest alias in vite.config.ts redirects the plugin import here,
 * so any service importing notification functions gets these mocks.
 *
 * Tests can override behavior:
 *   import { isPermissionGranted } from '@tauri-apps/plugin-notification';
 *   (isPermissionGranted as Mock).mockResolvedValueOnce(false);
 */
import { vi } from 'vitest';

export const isPermissionGranted = vi.fn().mockResolvedValue(true);
export const requestPermission = vi.fn().mockResolvedValue('granted');
export const sendNotification = vi.fn();
