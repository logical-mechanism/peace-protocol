/**
 * Centralized mock for @tauri-apps/api/core and @tauri-apps/api/event.
 *
 * Vitest aliases in vite.config.ts redirect both Tauri import paths here,
 * so any service importing `invoke` or `listen` gets these mocks automatically.
 *
 * Tests can override behavior per-command:
 *   import { invoke } from '@tauri-apps/api/core';
 *   (invoke as Mock).mockResolvedValueOnce({ ... });
 */
import { vi } from 'vitest';

// ── @tauri-apps/api/core ────────────────────────────────────────────────

/** Default: resolves to undefined. Override in tests with mockResolvedValueOnce / mockImplementation. */
export const invoke = vi.fn().mockResolvedValue(undefined);

// ── @tauri-apps/api/event ───────────────────────────────────────────────

/** Returns an unlisten function (also a vi.fn). */
export const listen = vi.fn().mockResolvedValue(vi.fn());

export const emit = vi.fn().mockResolvedValue(undefined);

// Re-export a no-op UnlistenFn type alias for TypeScript compatibility
export type UnlistenFn = () => void;
