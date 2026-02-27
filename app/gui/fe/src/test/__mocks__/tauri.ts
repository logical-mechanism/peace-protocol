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

/**
 * Default: REJECTS with an error. Tests must explicitly mock each command they use.
 * This prevents silent undefined returns from masking missing mocks.
 *
 * Override in tests with mockResolvedValueOnce / mockResolvedValue / mockImplementation.
 */
export const invoke = vi.fn().mockRejectedValue(
  new Error('invoke() not mocked for this command — add an explicit mock in your test')
);

// ── @tauri-apps/api/event ───────────────────────────────────────────────

/** Returns an unlisten function (also a vi.fn). */
export const listen = vi.fn().mockResolvedValue(vi.fn());

export const emit = vi.fn().mockResolvedValue(undefined);

// Re-export a no-op UnlistenFn type alias for TypeScript compatibility
export type UnlistenFn = () => void;
