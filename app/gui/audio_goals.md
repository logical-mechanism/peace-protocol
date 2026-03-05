# AudioPlayer Goals & Improvements

A comprehensive backlog for making the AudioPlayer exceptional. Pick any item, implement it, check it off, and submit a PR.

**Architecture context:**
- Native `<audio>` element for playback (routes through GStreamer via WebKitGTK)
- Separate PCM decode via `OfflineAudioContext` for FFT visualization only
- Custom Cooley-Tukey radix-2 FFT (1024 samples, 32 bars)
- Waveform overview (200 buckets, peak-detection downsampling)
- WebKitGTK Web Audio API is broken (no AnalyserNode, no AudioWorklet)
- Styling uses Winamp-themed CSS variables defined in `fe/src/index.css`

Each item:
- `🔴` Critical — bugs, broken features
- `🟡` Important — UX improvements, user-requested features
- `🟢` Nice-to-have — polish, optimization

---

## 1. Accessibility

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🟡 **Add `aria-pressed` to play/pause toggle button**
  - **How**: Line 1094-1111: the play/pause button has `aria-label` but no `aria-pressed`. Add `aria-pressed={isPlaying}` to match the mute button (line 1153) and loop button (line 1128), which already use this pattern correctly.
  - **Why**: Screen readers announce toggle state ("pressed" / "not pressed") for buttons with `aria-pressed`. Without it, the play button's on/off state is communicated only via the changing `aria-label` text ("Play" / "Pause"), which is less standard. The mute and loop buttons already set the correct pattern.

- [x] 🟢 **Add conversion hints for `.ogg` and `.mp3` formats**
  - **How**: `getConversionHint()` (lines 62-71) returns `null` for `.ogg` and `.mp3` — the two most common formats. When these formats fail in GStreamer, the user gets a generic error with no actionable suggestion. Add entries: `'.ogg': 'Try converting to MP3: ffmpeg -i file.ogg -c:a libmp3lame output.mp3'` and `'.mp3': 'MP3 is widely supported. The file may be corrupted or use an uncommon bitrate.'`. Follow the existing `.wav` pattern for the MP3 entry.
  - **Why**: When a normally-supported format fails (corrupted file, unusual codec variant), the user sees no conversion hint. The `.wav` entry already handles this case for WAV files; `.ogg` and `.mp3` should match.

---

## 2. Seeking & Navigation

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🟡 **Calculate tooltip half-width dynamically for long audio**
  - **How**: `showSeekTooltip()` (line 820) hardcodes `const halfW = 28` assuming `MM:SS` text width. For audio ≥ 1 hour, `formatTime()` outputs `H:MM:SS` (7 chars vs 5), and the tooltip text overflows the clamping bounds. Fix: after setting `tooltip.textContent`, read `tooltip.offsetWidth / 2` for the actual half-width, then apply the clamp. The tooltip already has `position: absolute` and `white-space: nowrap`, so `offsetWidth` is accurate. Alternatively, bump `halfW` to `36` statically to cover both formats (simpler, slightly less precise).
  - **Why**: Seek bar and waveform tooltips clip or overflow at container edges for audio longer than 1 hour, because the clamp margin is too narrow for the wider time string.

---

## 3. Visualization

> Key files: `fe/src/components/AudioPlayer.tsx`, `fe/src/index.css`

- [x] 🟡 **Improve light-theme waveform unplayed bar contrast**
  - **How**: `--waveform-unplayed` in light theme (index.css line 347) is `rgba(79, 70, 229, 0.2)`. On the `#d0d0dc` canvas background (`--winamp-bg-dark` light override, line 337), this blends to approximately `rgb(182, 180, 222)` — roughly 1.5:1 contrast ratio against the background, which is below WCAG thresholds. Increase opacity to `rgba(79, 70, 229, 0.35)` or switch to a neutral gray like `rgba(100, 100, 120, 0.25)` for better separation from the played bars. The played bars at 0.7 opacity are fine.
  - **Why**: In light theme, unplayed waveform bars are nearly invisible against the light gray canvas. Users can't see the waveform shape ahead of the playback position, defeating the purpose of the overview.

- [x] 🟢 **Use both channels for stereo waveform peak detection**
  - **How**: `computeWaveformSummary()` (line 148-162) is called with `buffer.getChannelData(0)` (line 308), using only the left channel. For stereo files, transients that appear only in the right channel are missed, producing a visually inaccurate waveform. Fix: if `buffer.numberOfChannels >= 2`, get both channels and compute `Math.max(Math.abs(left[idx]), Math.abs(right[idx]))` per sample in the peak loop. The function signature stays the same — just pass a merged peak array. For mono files, no change needed.
  - **Why**: Stereo audio with panned elements (e.g., panned percussion) shows a waveform that doesn't match the perceived loudness. Both channels should contribute to the peak envelope.

---

## 4. Performance

> Key files: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟢 **Avoid unnecessary `data.slice()` in PCM decode**
  - **How**: Line 304: `offlineCtx.decodeAudioData(data.slice().buffer)` creates a full copy of the `Uint8Array` before decoding. `decodeAudioData` already takes ownership of the ArrayBuffer (detaches it), so the slice is defensive — but `data` is the component prop and shouldn't be detached. The fix: use `data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)` to clone only the underlying ArrayBuffer without creating an intermediate `Uint8Array`. This is cheaper for large files (avoids typed-array construction overhead). For a 25MB FLAC, this saves ~25MB of temporary heap allocation.
  - **Why**: The current approach doubles peak memory briefly during PCM decode setup. For large audio files (10+ minutes of FLAC), this is noticeable on memory-constrained systems.

- [ ] 🟢 **Add timeout for PCM decode to prevent silent hang**
  - **How**: Lines 303-313: `offlineCtx.decodeAudioData()` has no timeout. If GStreamer's offline decoder stalls (rare but possible with exotic codec variants), the visualization never appears and the user gets no feedback. Wrap the decode in a `Promise.race()` with a 15-second timeout: `Promise.race([offlineCtx.decodeAudioData(...), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))])`. On timeout, set `visualizationFailed = true` (same as current decode failure path, line 312).
  - **Why**: Prevents the visualization from being permanently "loading" if the offline audio context hangs. The user would see the "Visualization unavailable" fallback instead of an indefinite blank canvas.

---

## 5. Metadata & Display

> Key files: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟢 **Log metadata parsing failures instead of silently swallowing**
  - **How**: Lines 287-289: both `.catch(() => {})` handlers on the `music-metadata` import and `parseBuffer` call silently discard errors. Replace with `console.warn('AudioPlayer: metadata parse failed', err)` (or just the inner catch — the import catch is for bundle-split failure which is already visible). This doesn't change behavior — metadata is best-effort and playback is unaffected — but gives developers a diagnostic signal when metadata is unexpectedly missing.
  - **Why**: When a user reports "no album art" or "no title", there's currently zero diagnostic output. A warning makes it possible to determine whether the file lacks metadata or parsing failed.

---

## 6. Testing

> Key files: `fe/src/components/__tests__/AudioPlayer.test.tsx`

- [ ] 🟡 **Add metadata rendering tests**
  - **How**: The test file has 107 tests covering utilities, rendering, and interactions — but zero tests for the metadata display section (lines 939-965). Add tests that: (1) render with mock metadata containing title/artist/album and verify text appears, (2) render with metadata including a picture and verify `<img>` with `alt="Album art"` is present, (3) render without metadata and verify the metadata section is absent. Mock `music-metadata` dynamic import to resolve with controlled data. Follow the existing rendering test pattern (lines 483-623).
  - **Why**: The metadata section renders conditionally based on parsed ID3/Vorbis data. A regression that breaks the conditional (`metadata && (metadata.title || ...)`) or the `MetadataAlbumArt` subcomponent would go undetected.

- [ ] 🟢 **Add buffering state transition tests**
  - **How**: Test the `onWaiting`, `onPlaying`, and `onStalled` event handlers by firing the corresponding events on the mock audio element and verifying the status text changes. `onWaiting` (line 330-332) should show "Buffering" when `readyState < 3`. `onPlaying` (line 327-328) should clear the buffering state. `onStalled` (line 330-332) should also show "Buffering" when `readyState < 3`. Use `getStatusText()` assertions (already tested as a utility at line 449-477) combined with DOM assertions on the `aria-live` status element.
  - **Why**: Buffering state transitions are critical for user trust (knowing the player is working, not frozen). The `readyState < 3` guard in `onStalled` is a subtle condition that could regress.

- [ ] 🟢 **Add visualization failure fallback test**
  - **How**: Test that when PCM `decodeAudioData` rejects (line 311-312), the component shows "Visualization unavailable for this format" (line 1013-1016) instead of the canvas. Mock `OfflineAudioContext.decodeAudioData` to reject immediately, fire `canplay` on the audio element, and verify the fallback text appears. This also implicitly tests that playback remains functional despite visualization failure.
  - **Why**: The graceful degradation path (GStreamer plays, but FFT/waveform unavailable) is a key architectural feature. Without a test, a regression could show a blank canvas instead of the informative fallback message.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 0 | — |
| 🟡 Important | 4 | Play aria-pressed, tooltip width, light waveform contrast, metadata tests |
| 🟢 Nice-to-have | 7 | Conversion hints, stereo waveform, data.slice, decode timeout, metadata logging, buffering tests, viz failure test |

### Implementation Order (suggested)

1. Play `aria-pressed` (§1) — one-line addition, matches existing pattern
2. Light-theme waveform contrast (§3) — one CSS value change, immediately visible improvement
3. Tooltip width fix (§2) — small change, prevents clipping for long audio
4. Metadata rendering tests (§6) — covers the most user-visible untested area
5. Everything else — in any order
