# Veiled Desktop App — Goals & Improvements

A backlog of remaining work for making the Veiled Desktop App production-ready. Pick any item, implement it, check it off, and submit a PR.

Each item has:
- **What**: A brief description of the feature or improvement
- **How**: Implementation ideas and key files involved
- **Why**: The value it provides

---

## Table of Contents

1. [Audio Player](#1-audio-player)
2. [Video Player](#2-video-player)
3. [Backend Reliability](#3-backend-reliability)

---

## 1. Audio Player

> Key file: `fe/src/components/AudioPlayer.tsx`

- [ ] **Keyboard shortcuts for transport controls**
  - **How**: Add a `useEffect` keydown listener — Space for play/pause, Left/Right arrows for skip -/+ 10s, Up/Down for volume. Only active when AudioPlayer is mounted (not globally).
  - **Why**: Standard media player behavior. Users expect keyboard control without reaching for the mouse.

- [ ] **Drag-to-seek on the progress bar**
  - **How**: Add `onMouseDown` + `onMouseMove` + `onMouseUp` handlers to the seek bar div. Track a `isSeeking` ref to update position on drag. Currently only `onClick` is supported (`handleSeek`).
  - **Why**: Click-only seeking is imprecise. Drag seeking lets users scrub through audio fluidly.

- [ ] **Repeat / loop toggle**
  - **How**: Add a `loop` state toggle button next to transport controls. Set `audioRef.current.loop = true` when enabled. Persist preference in component state (or localStorage for stickiness).
  - **Why**: Users reviewing purchased audio content often want to loop a track. No loop means the audio stops and they must manually replay.

- [ ] **Waveform overview display**
  - **How**: Pre-compute a waveform summary from the decoded `AudioBuffer` (already available in `bufferRef`). Draw a static waveform on a second canvas layer behind the FFT bars. Highlight the played portion with accent color.
  - **Why**: Gives users a visual map of the entire track — they can see quiet/loud sections and seek to points of interest. Standard in modern audio players.

- [ ] **Better error state with format-specific guidance**
  - **How**: Expand the error display in AudioPlayer to show the detected MIME type, suggest specific conversion tools (e.g., "Try converting FLAC to MP3 with ffmpeg"), and offer a one-click "Open with system player" via Tauri shell open.
  - **Why**: Current error says "format not supported" but doesn't help the user fix it. Actionable error messages reduce frustration.

- [ ] **Audio metadata display (ID3 tags)**
  - **How**: Add a dependency like `music-metadata` (browser build) to parse ID3/Vorbis tags from the `Uint8Array`. Display artist, album, track number, and embedded album art above the visualization canvas.
  - **Why**: Purchased audio content often has metadata. Showing it makes the player feel professional and helps users identify what they're listening to.

---

## 2. Video Player

> Key file: `fe/src/components/VideoPlayer.tsx`

- [x] **Playback speed control (0.5x — 2x)**
  - **How**: Add a speed selector dropdown/button group near the fullscreen toggle. Set `videoRef.current.playbackRate` on change. Options: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x.
  - **Why**: Standard video player feature. Users reviewing educational or long-form content need speed control.

- [x] **Progress feedback during FFmpeg remux**
  - **How**: FFmpeg.wasm supports a `progress` callback via `ffmpeg.on('progress', ...)`. Use it to show a percentage bar and ETA instead of the current static "Converting for playback..." spinner.
  - **Why**: Remuxing can take 10+ seconds for large files. Users need to know it's progressing and approximately how long it will take.

- [x] **Keyboard shortcuts**
  - **How**: Add keydown listener — Space for play/pause, Left/Right for skip 5s, F for fullscreen toggle, M for mute. Scope to when VideoPlayer is mounted.
  - **Why**: Standard video player UX. Users expect keyboard-driven control.

- [x] **Better error state with fallback guidance**
  - **How**: When remux fails, show the detected file extension and MIME type in the error. Offer a "Save As" button inline (not just as a suggestion) that triggers the export flow directly.
  - **Why**: Current error tells users the format is unsupported but requires them to figure out how to export. A direct action button reduces friction.

- [x] **Picture-in-Picture support**
  - **How**: Check `document.pictureInPictureEnabled` and if supported, add a PiP button that calls `videoRef.current.requestPictureInPicture()`. WebKitGTK may not support this — degrade gracefully by hiding the button.
  - **Why**: PiP lets users watch video while browsing the marketplace. Nice-to-have for multitasking.

- [x] **Volume control and mute toggle**
  - **How**: The native `<video controls>` provides some of this, but add an explicit mute button and volume slider in the custom toolbar for consistency with AudioPlayer's design language.
  - **Why**: Custom toolbar controls provide a consistent UX across audio and video players.

---

## 3. Backend Reliability

> Key files: `be/src/services/`, `be/src/routes/`, `be/src/index.ts`

- [x] **Input validation middleware**
  - **How**: Create validation middleware for common patterns: `validatePkh` (28-byte hex), `validateTokenName` (hex string), `validateTxHash` (64-char hex), `validateStatus` (enum). Apply to all route params.
  - **Why**: No input validation exists. Garbage params pass through to Kupo/Koios calls, causing confusing downstream errors.

- [ ] **Enhanced health check endpoint**
  - **How**: Expand `GET /health` to test Kupo and Koios connectivity. Return `{ status, kupo: { reachable, latency }, koios: { reachable, latency }, uptime, lastSuccessfulRefresh }`.
  - **Why**: Current health check returns "ok" even when Kupo/Koios are down. A real health check helps diagnose issues.

- [x] **Circuit breaker for external dependencies**
  - **How**: Implement a simple circuit breaker pattern for Koios calls. After N consecutive failures, "open" the circuit and return cached/stale data for a cooldown period before retrying.
  - **Why**: If Koios goes down, every request fails and times out. A circuit breaker returns fast (stale) responses instead of hanging.

- [x] **Datum parsing failure metrics**
  - **How**: Count skipped datums per request and include the count in the API response: `{ encryptions: [...], warnings: { skippedDatums: 3 } }`. Frontend can display "3 listings had parsing errors".
  - **Why**: Datum parsing failures are silently skipped. Frontend shows incomplete data with no indication that listings are missing.

---

## Priority Guide

### Must-Have (blocks production readiness)
- Backend input validation

### Should-Have (significant UX improvement)
- Audio player keyboard shortcuts and drag seek
- Video playback speed control

### Nice-to-Have (polish and delight)
- Waveform visualization
- Picture-in-Picture video
- Audio metadata display
