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

## 1. Playback & Stability

> Key file: `fe/src/components/AudioPlayer.tsx`

- [ ] 🔴 **Investigate audio skipping/lagging during playback**
  - **How**: The `<audio>` element plays via a Blob URL created from `new Uint8Array(data)` (line 183). For large files, this copies the entire buffer into a Blob synchronously on the main thread. Profile whether the skip occurs during initial Blob creation, during GStreamer pipeline setup, or mid-playback. Test with files of increasing size (5MB, 20MB, 50MB+). If the issue is Blob creation, move `new Blob([new Uint8Array(data)])` into a worker or use `data.buffer` directly without copying. If the issue is GStreamer, check whether `audio.preload = "auto"` (already set at line 629) is insufficient and whether `audio.buffered` ranges reveal gaps. Also check if the parallel `OfflineAudioContext.decodeAudioData` call (line 189) contends with GStreamer on the audio thread.
  - **Why**: Audio skipping during playback is the most user-visible bug. Users expect seamless playback once a file loads.

- [ ] 🟢 **Add `onStalled` / `onWaiting` event handling**
  - **How**: Attach `stalled` and `waiting` event listeners to the `<audio>` element alongside the existing listeners (lines 239-243). When `stalled` fires, show a "Buffering" indicator in the LED display area (line 721). When `canplay` fires again after a stall, clear the indicator. The VideoPlayer handles stalled events as a reference pattern.
  - **Why**: When GStreamer stalls mid-playback, the user sees frozen visualization with no feedback. A buffering indicator sets correct expectations.

- [ ] 🟢 **Handle `decodeAudioData` failure with user feedback**
  - **How**: The `decodeAudioData` catch block (line 195) silently swallows errors. When decoding fails, FFT and waveform never render but nothing tells the user. Set a `visualizationFailed` state flag and render a small note below the canvas (e.g., "Visualization unavailable for this format"). Playback remains unaffected.
  - **Why**: Users might think the visualization is broken rather than understanding their format does not support PCM decoding in the browser.

---

## 2. Seeking & Navigation

> Key file: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟡 **Add click-to-seek on waveform canvas**
  - **How**: Add an `onMouseDown` handler to the waveform canvas container `<div>` (line 676). On click, calculate the ratio from `(clientX - rect.left) / rect.width`, map to `ratio * duration`, and set `audio.currentTime`. Sync `vizTimeRef.current` to the new time. Reuse the same drag-to-scrub pattern from `handleSeekMouseDown` (lines 534-562): attach `mousemove` and `mouseup` listeners to `document` so dragging works even when the cursor leaves the canvas. Add `cursor-pointer` to the waveform container.
  - **Why**: Users expect click/drag-to-seek on the waveform (like Spotify, SoundCloud). Currently only the thin 8px seek bar supports seeking, which is a small click target.

- [ ] 🟡 **Add playback position indicator on waveform**
  - **How**: In `drawWaveform()` (lines 263-287), after drawing the waveform bars, draw a vertical 1px line at `x = progressRatio * width` using `ctx.fillStyle = 'rgba(250, 250, 250, 0.8)'`. This provides a scrubber-head visual on top of the played/unplayed color split. When waveform click-to-seek is implemented, this line follows the cursor during drag for immediate feedback.
  - **Why**: The current played/unplayed color boundary is too subtle at a glance. A bright vertical line makes the current position instantly visible.

- [ ] 🟢 **Enlarge seek bar click target**
  - **How**: The seek bar (line 726-736) is `h-2` (8px tall). Wrap it in a `py-1` container that captures clicks (expanding the hit area to ~24px) while keeping the visual bar at 8px. Apply `onMouseDown` to the outer wrapper and keep the visual bar as a child div.
  - **Why**: 8px is below the recommended 44px minimum touch target. Users miss clicks on the seek bar during fast interaction.

- [ ] 🟢 **Show seek preview time on hover**
  - **How**: Add `onMouseMove` to the seek bar (and waveform once click-to-seek exists). On hover, calculate `ratio * duration` and render a tooltip above the cursor showing formatted time. Use a `position: absolute` div with `left` set to cursor position and `transform: translateX(-50%)`. Hide on `mouseLeave`. Keep it lightweight — no state, just a ref to a DOM element updated directly.
  - **Why**: Users hovering over the seek bar have no idea what time position they will jump to. Time preview is standard in all modern media players.

---

## 3. Visualization

> Key file: `fe/src/components/AudioPlayer.tsx`, `fe/src/index.css`

- [ ] 🟢 **Render waveform immediately on decode complete**
  - **How**: When `decodeAudioData` completes (line 191-194), `waveformDataRef.current` is set but `drawWaveform(0)` is not called — the waveform only appears on the next RAF tick. Add a direct `drawWaveform(0)` call after setting the waveform data. This ensures the waveform renders immediately on load, not after a ~42ms delay.
  - **Why**: There is a brief window between waveform data being ready and the next RAF tick where the waveform canvas is blank. For short files or when paused, this is noticeable.

- [ ] 🟢 **Add light-theme Winamp variable overrides**
  - **How**: The Winamp CSS variables (`--winamp-bg`, `--winamp-bg-dark`, `--winamp-bg-light`, `--winamp-border-light`, `--winamp-border-dark`, `--winamp-led`, `--winamp-led-dim`) are only defined in `:root` (lines 318-328 of `index.css`). There are no `[data-theme="light"]` overrides for them. Add light-theme overrides so the AudioPlayer adapts to light mode. Suggested: `--winamp-bg: #e8e8f0`, `--winamp-bg-dark: #d0d0dc`, `--winamp-bg-light: #f0f0f8`, `--winamp-led: #16a34a`.
  - **Why**: Users on light theme see a jarring dark rectangle for the audio player while everything else is light.

---

## 4. Transport Controls

> Key file: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟡 **Add mute toggle button**
  - **How**: Add `isMuted` state and `previousVolume` ref. Place a mute button next to the volume icon SVG (line 807). On click: if not muted, store `volume` in `previousVolume`, set `audio.volume = 0`, `setIsMuted(true)`; if muted, restore `audio.volume = previousVolume.current`, `setIsMuted(false)`. The volume SVG already has a muted-cross variant at line 809 that displays when `volume === 0`. Also add keyboard shortcut `M` for mute toggle in the keydown handler (lines 492-532), matching the VideoPlayer pattern.
  - **Why**: Currently users must drag the volume slider to zero and back. A mute toggle is standard in every media player.

- [ ] 🟢 **Show keyboard shortcut hints on first keypress**
  - **How**: Follow the VideoPlayer pattern. Add a `showKeyHints` state and `hasShownHints` ref. On the first keyboard interaction in the handler, show a small overlay listing shortcuts (Space = Play/Pause, Left/Right = Seek, Up/Down = Volume, M = Mute) and auto-hide after 3 seconds. Render as an absolutely positioned div over the visualization canvas.
  - **Why**: Users do not discover keyboard shortcuts unless told. A one-time hint teaches without being intrusive.

---

## 5. Performance

> Key file: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟡 **Cache CSS variable reads outside the render loop**
  - **How**: In `drawFrame()` (line 300), `getComputedStyle(canvas)` is called every frame to read `--audio-gradient-start`, `--audio-gradient-mid`, `--audio-gradient-end`. Move these reads into a ref updated only on theme change. Add a `MutationObserver` on `document.documentElement` watching for `data-theme` attribute changes. On change (or mount), read the three CSS variables and store in `gradientColorsRef`. Use ref values in `drawFrame()`. Eliminates 24 `getComputedStyle()` calls per second.
  - **Why**: `getComputedStyle()` triggers style recalculation and is one of the most expensive calls in a render loop. Caching reduces jank on lower-end hardware.

- [ ] 🟡 **Cache gradient objects instead of creating per-segment**
  - **How**: In `drawFrame()` (lines 353-357 and 375-379), a new `CanvasGradient` is created for every bar in every frame (32 bars x 24 FPS = 768 gradients/second). Since all bars use the same three-stop vertical gradient, pre-create a single full-height gradient at the start of each frame: `ctx.createLinearGradient(0, height, 0, 0)` once, then reuse for all bars.
  - **Why**: Canvas gradient creation allocates GPU resources. Creating 768+ per second is wasteful when a single gradient serves all bars.

- [ ] 🟢 **Stop RAF loop when paused and decay complete**
  - **How**: The animation loop (lines 400-434) runs continuously even when paused. After all bars have decayed to zero (`prevBarsRef.current.every(v => v < 0.005)`) and `!isPlayingRef.current`, stop requesting frames. Resume when `handlePlay` is called.
  - **Why**: An idle AudioPlayer burns 24 `drawFrame()` calls per second forever. On a laptop this drains battery for no visual result.

- [ ] 🟢 **Avoid redundant Uint8Array copy in Blob creation**
  - **How**: At line 183, `new Uint8Array(data)` copies the entire audio buffer before creating the Blob. Since `data` is already a `Uint8Array` from props, pass it directly: `new Blob([data], { ... })`. The separate copy at line 189 for `decodeAudioData` via `data.slice().buffer` is necessary (decodeAudioData neuters the ArrayBuffer) and should remain.
  - **Why**: For a 50MB FLAC file, this eliminates a 50MB synchronous copy on the main thread, reducing load time and memory pressure.

---

## 6. Accessibility

> Key file: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟡 **Add `role="slider"` and ARIA attributes to seek bar**
  - **How**: The seek bar `<div>` (line 727) has no semantic role. Add `role="slider"`, `aria-label="Seek position"`, `aria-valuemin={0}`, `aria-valuemax={Math.round(duration)}`, `aria-valuenow={Math.round(currentTime)}`, `aria-valuetext={formatTime(currentTime)}`, and `tabIndex={0}`. Add keyboard handlers for Left/Right on the slider (move ±5s), Home (start), End (end).
  - **Why**: The seek bar is invisible to assistive technology. Screen reader users cannot seek within a track.

- [ ] 🟡 **Add `aria-live` region for playback state changes**
  - **How**: The status text "Playing"/"Paused"/"Ready"/"Loading" (line 721) should announce to screen readers when it changes. Wrap it in `<span aria-live="polite" aria-atomic="true">`. Do not apply to the time display (updates too frequently).
  - **Why**: Screen reader users have no way to know when playback starts, pauses, or ends.

- [ ] 🟢 **Improve `aria-label` on time display toggle**
  - **How**: The time display (line 704-718) has `role="button"` and `tabIndex={0}` but only a `title` attribute. Add `aria-label={showRemaining ? 'Showing remaining time, click for total' : 'Showing total time, click for remaining'}`.
  - **Why**: The time display toggle's purpose is not communicated to screen reader users beyond the title attribute.

- [ ] 🟢 **Add `aria-pressed` to loop toggle button**
  - **How**: The loop button (line 783) toggles state but does not communicate this via ARIA. Add `aria-pressed={isLooping}` so screen readers announce "pressed" or "not pressed" state.
  - **Why**: Toggle buttons should use `aria-pressed` for proper assistive technology feedback.

---

## 7. Metadata & Display

> Key file: `fe/src/components/AudioPlayer.tsx`

- [s] 🟢 **Show file size in title bar**
  - **How**: The title bar (lines 632-646) shows "Veiled Audio" and the file extension. Add the file size: calculate `data.length` and format with `formatBytes()` (from `fe/src/utils/formatBytes.ts`). Display as e.g., "MP3 — 4.2 MB".
  - **Why**: Users have no indication of file size, which helps set expectations for load times and explains why large files might take longer to decode.

- [x] 🟢 **Marquee scroll for long metadata text**
  - **How**: When metadata title or artist (lines 656-663) is truncated (uses `truncate` CSS class), add a CSS animation that scrolls horizontally on hover. Measure `scrollWidth` vs `clientWidth` and only animate when overflow occurs. Define the keyframe in `index.css`.
  - **Why**: Truncated track titles hide information the user wants to see. Hover-to-scroll reveals the full title without taking more space.

- [x] 🟢 **Support hours in time display for long audio**
  - **How**: In `formatTime()` (lines 51-56), times over 60 minutes display as "75:30" instead of "1:15:30". Add hours: `const h = Math.floor(seconds / 3600)` and format as `H:MM:SS` when `h > 0`. Update the test in `fe/src/components/__tests__/AudioPlayer.test.ts` (line 83, currently expects `formatTime(3661)` to return `'61:01'` — change to `'1:01:01'`).
  - **Why**: Audiobooks and podcasts display confusing minute counts above 60. Standard formatting uses H:MM:SS.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 1 | Audio skipping investigation |
| 🟡 Important | 8 | Waveform seek, position indicator, mute, perf caches, accessibility |
| 🟢 Nice-to-have | 14 | Polish, optimization, display improvements |

### Implementation Order (suggested)

1. Waveform click-to-seek + position indicator (§2) — user-requested, high impact
2. Mute toggle button (§4) — quick win, standard feature
3. Cache getComputedStyle + gradient objects (§5) — measurable perf improvement
4. Audio skipping investigation (§1) — requires profiling session
5. Accessibility improvements (§6) — important for inclusive design
6. Everything else — in any order
