/**
 * Notification Sound Service
 *
 * Plays per-event notification sounds from bundled MP3 files.
 * Sounds are served from /sounds/ (Vite public directory).
 * WebKitGTK Web Audio API is broken, so we rely on <audio> + GStreamer.
 */

import type { SoundEvent } from './soundPreferences'
import {
  shouldPlayEvent,
  getEventSoundVolume,
  setEventSoundVolume,
} from './soundPreferences'

// Re-export for backwards compat (was previously defined in this file)
export { isMasterSoundEnabled as isSoundEnabled } from './soundPreferences'
export { setMasterSoundEnabled as setSoundEnabled } from './soundPreferences'

/** Get the global sound volume (uses new_bid event as the representative). */
export function getSoundVolume(): number {
  return getEventSoundVolume('new_bid')
}

/** Set the global sound volume — forwards to new_bid event for backwards compat. */
export function setSoundVolume(volume: number): void {
  setEventSoundVolume('new_bid', volume)
}

// ---------------------------------------------------------------------------
// Audio element cache (one per event type)
// ---------------------------------------------------------------------------

const audioElements = new Map<SoundEvent, HTMLAudioElement>()

function getAudioElement(event: SoundEvent): HTMLAudioElement {
  let audio = audioElements.get(event)
  if (!audio) {
    audio = new Audio(`/sounds/${event}.mp3`)
    audioElements.set(event, audio)
  }
  return audio
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Play the sound for a specific event (if enabled and master is on). */
export function playSound(event: SoundEvent): void {
  if (!shouldPlayEvent(event)) return
  try {
    const audio = getAudioElement(event)
    audio.volume = getEventSoundVolume(event)
    audio.currentTime = 0
    audio.play().catch(() => {
      // Autoplay policy may block; silently ignore
    })
  } catch {
    // Best effort
  }
}

/** Preview a sound in settings (bypasses enabled check, respects volume). */
export function previewSound(event: SoundEvent, volume?: number): void {
  try {
    const audio = getAudioElement(event)
    audio.volume = volume ?? getEventSoundVolume(event)
    audio.currentTime = 0
    audio.play().catch(() => {})
  } catch {
    // Best effort
  }
}

/**
 * Backwards-compatible alias for playSound('new_bid').
 * Used by useDashboardEffects and anywhere the old API was called.
 */
export function playNotificationSound(): void {
  playSound('new_bid')
}

// For testing — reset all cached audio elements
export function _resetAudioElement(): void {
  audioElements.clear()
}
