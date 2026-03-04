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

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🔴 **Volume slider doesn't unmute when dragged while muted**
  - **How**: `handleVolumeChange` (line 819-823) sets `audio.volume` but never clears `audio.muted` or `setIsMuted(false)`. Add: if `isMuted` and new volume > 0, set `audio.muted = false` and `setIsMuted(false)`. Reference the ArrowUp handler (lines 658-659) which already does this correctly.
  - **Why**: User mutes with M, then drags volume slider up — audio stays silent even though the slider shows volume. Confusing and feels broken.

- [x] 🔴 **vizTimeRef interpolation ignores playbackRate**
  - **How**: Line 431: `vizTimeRef.current += (now - lastDrawTimeRef.current) / 1000` always advances at 1x. Multiply by `audioRef.current?.playbackRate ?? 1`. This matters because the FFT sample window (line 437: `startSample = Math.floor(vizTimeRef.current * buffer.sampleRate)`) will read from the wrong position at non-1x speeds, causing the FFT bars to not match what the user hears.
  - **Why**: At 2x speed, the FFT visualization lags ~50% behind actual playback between `timeupdate` resyncs (~250ms on WebKitGTK). Bars don't match the audio.

- [x] 🔴 **Arrow keys double-fire when seek bar is focused**
  - **How**: When the seek bar div (`role="slider"`, line 1017) is focused, pressing ArrowLeft triggers both `handleSeekKeyDown` (line 752, seeks −5s) and the global `handleKeyDown` (line 646, seeks −10s via `handleSkipBack`). Net effect: −15s instead of −5s. Fix: add `e.stopPropagation()` in `handleSeekKeyDown` for handled keys (line 768-769), preventing the event from reaching the global document listener.
  - **Why**: Pressing arrow keys on the seek bar seeks 3x the expected amount. Makes fine-grained seeking via keyboard impossible.

- [x] 🟢 **Reset vizTimeRef on loop boundary**
  - **How**: When `audio.loop = true`, the browser resets `currentTime` to 0 without firing `ended`. But `vizTimeRef` continues incrementing from the old position until the next `timeupdate` resync (~250ms). During that window, FFT reads out-of-bounds samples as 0 (line 447: `idx < channel.length ? channel[idx] : 0`), causing a brief silence dip in the bars. Fix: listen for the `seeked` event on the audio element — the browser fires `seeked` when looping. In the handler, sync `vizTimeRef.current = audio.currentTime`.
  - **Why**: Visible as a brief bar decay/silence flash at loop points. Subtle but noticeable on short loops.

- [x] 🟢 **Null bufferRef in cleanup to release decoded PCM**
  - **How**: The cleanup function (lines 343-359) pauses audio, removes listeners, revokes blob URL, and cancels RAF — but doesn't null `bufferRef.current`. Add `bufferRef.current = null; waveformDataRef.current = null;` in cleanup. The decoded PCM buffer for a 10-minute FLAC at 44.1kHz stereo is ~100MB.
  - **Why**: Large decoded audio buffers stay in memory until garbage collection. Explicit nulling allows immediate GC when the modal closes.

---

## 2. Visualization

> Key files: `fe/src/components/AudioPlayer.tsx`, `fe/src/index.css`

- [x] 🟡 **Make waveform colors theme-aware via CSS variables**
  - **How**: Lines 382-384 use hardcoded `rgba(99, 102, 241, 0.6)` and `rgba(99, 102, 241, 0.15)` for played/unplayed waveform bars. Add two CSS variables to `index.css`: `--waveform-played` and `--waveform-unplayed` in both `:root` (dark) and `[data-theme="light"]` blocks. Read them via `getComputedStyle` in the existing `readColors()` function (lines 214-221) and store in `gradientColorsRef`. Use those ref values in `drawWaveform`. For dark: `rgba(99, 102, 241, 0.6)` / `rgba(99, 102, 241, 0.15)`. For light: `rgba(79, 70, 229, 0.7)` / `rgba(79, 70, 229, 0.2)` (darker indigo, higher opacity for contrast).
  - **Why**: Light theme waveform contrast is ~2.8:1 (vs ~4.2:1 dark). Played/unplayed bars are hard to distinguish on the light `#d0d0dc` background.

- [x] 🟡 **Make position indicator color theme-aware**
  - **How**: Lines 393-397 use hardcoded `rgba(250, 250, 250, 0.9)` (white) for the position indicator line. On the light theme background (`#d0d0dc`), white-on-light is nearly invisible. Add a `--waveform-indicator` CSS variable. Dark: `rgba(250, 250, 250, 0.9)`. Light: `rgba(30, 30, 60, 0.8)` (dark line on light bg). Read alongside the other colors in `readColors()`.
  - **Why**: The playback position line is invisible in light theme, making it hard to see where you are in the track.

- [x] 🟢 **Use log-frequency bin mapping for FFT bars**
  - **How**: Line 453 uses linear mapping: `binsPerBar = Math.floor((FFT_SIZE / 2) / BAR_COUNT)`. Replace with logarithmic mapping: for bar `i` of `N`, compute `lowBin = floor((FFT_SIZE/2) * (i/N)^2)` and `highBin = floor((FFT_SIZE/2) * ((i+1)/N)^2)`. Average magnitudes across `lowBin..highBin`. This allocates more bars to bass (where musical information concentrates) and fewer to treble. Winamp 2.x uses a similar perceptual weighting.
  - **Why**: Linear mapping assigns equal bins per bar, making treble bars dim (natural spectral rolloff). Log mapping produces more visually balanced and musically meaningful bar heights.

- [x] 🟢 **Skip waveform redraw when pixel position unchanged**
  - **How**: Lines 504-506 redraw the waveform every frame (24 FPS). Add a `lastDrawnPixelRef = useRef(-1)`. In `drawFrame`, compute `const px = Math.round(progressRatio * 480)` and skip `drawWaveform()` if `px === lastDrawnPixelRef.current`. Reset the ref on seek operations. At 480px canvas width, this reduces redraws from 24/sec to only when the 1px indicator moves (~8/sec for a 1-minute track, less for longer tracks).
  - **Why**: Eliminates redundant canvas clears and repaints when the waveform looks identical. Minor perf win, bigger impact on low-end hardware.

---

## 3. Accessibility

> Key files: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟢 **Add `aria-pressed` to mute toggle button**
  - **How**: The mute button (line 1118-1133) has `aria-label` but no `aria-pressed`. Add `aria-pressed={isMuted}` to match the loop button pattern (line 1098). The loop button already does this correctly.
  - **Why**: Screen readers announce toggle state ("pressed" / "not pressed") for buttons with `aria-pressed`. Without it, the mute button's on/off state is communicated only via the changing `aria-label` text, which is less standard.

---

## 4. Testing

> Key files: `fe/src/components/__tests__/AudioPlayer.test.ts`

- [ ] 🟡 **Add component rendering tests**
  - **How**: The test file has 48 pure utility function tests but zero React component tests. Add a test section using `@testing-library/react` that renders `<AudioPlayer data={mockData} fileExtension=".mp3" />` with the Tauri mock from `fe/src/test/__mocks__/tauri.ts`. Verify: error state renders when given corrupt data, loading spinner appears initially, transport buttons are present, seek bar has correct ARIA attributes. Mock `HTMLAudioElement` and `OfflineAudioContext`. Follow the pattern in `fe/src/components/__tests__/VideoPlayer.test.ts` if it exists, or `PdfViewer.test.ts`.
  - **Why**: The entire JSX output is unverified by tests. Regressions in rendering (missing buttons, broken ARIA, wrong CSS classes) go undetected.

- [ ] 🟡 **Add interaction tests for keyboard and mouse**
  - **How**: Test keyboard shortcuts: Space toggles play/pause, ArrowLeft/Right calls skip handlers, M toggles mute. Test seek bar: clicking at 50% of width sets `currentTime` to half duration. Test volume slider: changing value updates `audio.volume`. Use `fireEvent.keyDown` and `fireEvent.mouseDown` from `@testing-library/react`. These tests would also catch the arrow key double-fire bug (§1.3) once fixed.
  - **Why**: All interaction logic is untested. Keyboard shortcut regressions (wrong key, missing `preventDefault`, double-firing) are only caught by manual testing.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 3 | Volume slider unmute, vizTimeRef playback rate, arrow key double-fire |
| 🟡 Important | 4 | Waveform theme colors, position indicator theme, component tests, interaction tests |
| 🟢 Nice-to-have | 5 | Loop boundary reset, bufferRef cleanup, log-frequency FFT, waveform redraw skip, mute aria-pressed |

### Implementation Order (suggested)

1. Arrow key double-fire fix (§1.3) — one-line `stopPropagation()`, prevents user frustration
2. Volume slider unmute (§1.1) — small fix, prevents confusing silent-slider bug
3. vizTimeRef playback rate (§1.2) — one-line multiply, fixes wrong FFT at non-1x speed
4. Waveform + indicator theme colors (§2.1, §2.2) — do together, both touch `drawWaveform` and `readColors`
5. Mute `aria-pressed` (§3.1) — one-line addition
6. Testing (§4.1, §4.2) — do together after fixing bugs so tests verify correct behavior
7. Everything else — in any order
