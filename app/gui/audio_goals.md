# AudioPlayer Goals & Improvements

A comprehensive backlog for making the AudioPlayer exceptional. Pick any item, implement it, check it off, and submit a PR.

**Architecture context:**
- Native `<audio>` element for playback (routes through GStreamer via WebKitGTK)
- Separate PCM decode via `OfflineAudioContext` for FFT visualization only
- Custom Cooley-Tukey radix-2 FFT (1024 samples, 32 bars)
- Waveform overview (480 buckets, peak-detection downsampling)
- WebKitGTK Web Audio API is broken (no AnalyserNode, no AudioWorklet)
- Styling uses Winamp-themed CSS variables defined in `fe/src/index.css`

Each item:
- `🔴` Critical — bugs, broken features
- `🟡` Important — UX improvements, user-requested features
- `🟢` Nice-to-have — polish, optimization

---

## 1. Playback & Stability

> Key files: `fe/src/components/AudioPlayer.tsx`, `src-tauri/src/lib.rs`

- [x] 🔴 **WAV playback fails with GStreamer `gstwavparse` internal stream error**
  - **How**: GStreamer's WAV parser reports `streaming stopped, reason error (-5)` at `gst_wavparse_loop`. The AudioPlayer sets `audio.src = src` directly (line 268) on the `<audio>` element (line 1013) without a `<source>` child element providing an explicit `type` attribute. GStreamer's demuxer uses the MIME type hint for codec selection. Fix: render the `<audio>` element with a `<source>` child: `<audio ref={audioRef} preload="auto" style={{ display: 'none' }}><source src={src} type={getMimeType(fileExtension)} /></audio>`. The `getMimeType()` function (lines 42-53) already returns `'audio/wav'`. Pass `fileExtension` as a prop (it's already available in `LibraryContentModal.tsx`). If this doesn't resolve it, investigate whether the WAV files use non-PCM encoding (ADPCM, A-law, mu-law) that GStreamer's installed plugins don't support — add a more specific error message for WAV failures mentioning `gst-plugins-good`.
  - **Why**: WAV files are a supported format but fail to play. The error is a GStreamer pipeline failure in WebKitGTK's audio backend.

- [x] 🟡 **PCM decode fetch not aborted on unmount**
  - **How**: The `decodePcmForVisualization()` function (line 284) uses `fetch(src)` (line 292) without an `AbortController`. If the component unmounts during the fetch, the request completes in the background, wasting bandwidth and memory. Add `const abortCtrl = new AbortController();` before the fetch calls, pass `{ signal: abortCtrl.signal }` to both `fetch(src, { method: 'HEAD' })` (line 287) and `fetch(src)` (line 292), and call `abortCtrl.abort()` in the cleanup function (after line 409: `cancelled = true`).
  - **Why**: Navigating away from a large audio file mid-decode wastes a full file fetch that's no longer needed.

- [x] 🟡 **OfflineAudioContext decode has no timeout**
  - **How**: `offlineCtx.decodeAudioData(arrayBuffer)` (line 300) can hang indefinitely on malformed file headers. Wrap it with `Promise.race([offlineCtx.decodeAudioData(arrayBuffer), new Promise((_, reject) => setTimeout(() => reject(new Error('Decode timeout')), 30_000))])`. On timeout, set `visualizationFailed = true` — playback continues unaffected since the native `<audio>` element handles playback independently.
  - **Why**: A corrupted file header could hang the visualization pipeline indefinitely, showing a perpetual loading state for the waveform/FFT.

---

## 2. Visualization & FFT

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🟡 **Move PCM decode to Rust side so all formats get waveform/FFT visualization**
  - **How**: WebKitGTK's `OfflineAudioContext.decodeAudioData()` (line 300) only supports a narrow set of codecs (MP3, PCM WAV, OGG Vorbis). Formats like FLAC, AAC/M4A, Opus, and non-PCM WAV silently fail — `decodeAudioData` throws, line 328-329 catches it, and visualization disappears while playback works fine (GStreamer handles it). Fix: add a Tauri command `decode_audio_waveform(path: String, bucket_count: u32) -> Vec<f32>` in `src-tauri/src/commands/media.rs` using the `symphonia` crate (pure Rust, supports MP3, FLAC, WAV, OGG, AAC, Opus). The command reads the file, decodes to PCM f32 samples, downsamples into `bucket_count` buckets (480), normalizes to [0,1], and returns the waveform data. On the frontend, replace the `decodePcmForVisualization()` function (lines 284-331) with an `invoke('decode_audio_waveform', { path, bucketCount: 480 })` call. For FFT, also return the raw PCM buffer (or a chunked subset) so the frontend can still run `fftInPlace()` against it during playback. Alternative: compute FFT bins on the Rust side too and return both waveform + a time-indexed FFT magnitude array, eliminating the need for `OfflineAudioContext` entirely.
  - **Why**: Currently FLAC, AAC, M4A, Opus, and non-PCM WAV files play fine but show "Visualization unavailable" because WebKitGTK's Web Audio decoder doesn't support them. Moving to Rust-side decode via `symphonia` gives format parity — every file GStreamer can play also gets waveform and FFT visualization.

- [x] 🟢 **Distinguish "file too large" from "format not decodable" in visualization fallback**
  - **How**: Currently line 1109-1113 shows a generic "Visualization unavailable for this format" tooltip for all visualization failures. Track the reason: add a `vizFailReason` state (`'size' | 'decode' | null`). Set `'size'` at line 290 when file > 100 MB, `'decode'` at line 329 when decode fails. Display different messages: `'size'` → "File too large for visualization (>100 MB)", `'decode'` → "Visualization unavailable for this format".
  - **Why**: Users seeing "unavailable for this format" on a large MP3 may think the format is unsupported when it's purely a size limit.

---

## 3. Performance & Memory

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🟡 **Canvas not scaled for HiDPI displays**
  - **How**: The waveform canvas (line 1071-1072) and FFT canvas (line 1079-1080) use hardcoded `width={480} height={120}` without accounting for `window.devicePixelRatio`. On HiDPI screens (2x, 3x), canvas content appears blurry. Fix: in the canvas setup, multiply the canvas element's `width`/`height` attributes by `devicePixelRatio`, set CSS `width`/`height` to the logical size via `style={{ width: 480, height: 120 }}`, and call `ctx.scale(dpr, dpr)` on the canvas contexts. Update `drawFrame()` and `drawWaveform()` to use logical coordinates (they already do — the scale transform handles the conversion). Read `devicePixelRatio` once in the color-reading effect (line 222) and store it in a ref.
  - **Why**: On HiDPI displays (common on modern laptops), the FFT bars and waveform look blurry compared to the crisp text and UI elements around them.

---

## 4. Accessibility

> Key files: `fe/src/components/AudioPlayer.tsx`

- [ ] 🟡 **Volume slider missing ARIA slider attributes**
  - **How**: The volume `<input type="range">` (line 1280-1289) has `aria-label="Volume"` but lacks explicit `role="slider"`, `aria-valuemin="0"`, `aria-valuemax="1"`, `aria-valuenow={volume}`, and `aria-valuetext={`${Math.round(volume * 100)}%`}`. Add these attributes. Compare with the seek bar (lines 1161-1167) which has full ARIA slider attributes already.
  - **Why**: Screen readers can announce the volume level numerically ("Volume: 75%") instead of just "Volume slider" with no value context.

- [ ] 🟢 **LED time display uses `<div role="button">` instead of `<button>`**
  - **How**: The LED time display (line 1119) is `<div role="button" tabIndex={0}>` with manual `onKeyDown` for Enter/Space. Replace with `<button type="button" className="..." onClick={...}>`. Remove the `onKeyDown` handler (lines 1127-1130) and `tabIndex={0}` — native `<button>` handles Enter/Space and focus natively. Keep the existing `aria-label`.
  - **Why**: Native `<button>` is semantically correct, keyboard-accessible by default, and doesn't need manual Enter/Space handling — reducing fragile code.

- [ ] 🟢 **Volume slider lacks visible focus ring**
  - **How**: The volume slider (line 1287) has `focus-visible:shadow-[var(--focus-ring)]` but `<input type="range">` often needs explicit `outline: none` + custom focus styling to override browser defaults. Verify the focus ring is visible on keyboard Tab in WebKitGTK. If not, add `[&:focus-visible]:ring-2 [&:focus-visible]:ring-[var(--accent)]` or equivalent.
  - **Why**: Keyboard users tabbing through controls can't see when the volume slider is focused if the browser's default focus ring is suppressed by the custom styling.

---

## 5. Testing

> Key files: `fe/src/components/__tests__/AudioPlayer.test.tsx`

- [ ] 🟡 **Add unit tests for `fftInPlace()` algorithm**
  - **How**: Export `fftInPlace` (line 79) or extract it to a testable utility. Test with known input→output: (1) DC signal (all 1.0 real, 0 imag) should produce energy only in bin 0. (2) Pure sine at bin frequency should produce energy in that bin. (3) Power-of-2 length validation. (4) Impulse signal `[1, 0, 0, ...]` should produce flat magnitude spectrum. Use `Float32Array` inputs matching `FFT_SIZE = 1024`.
  - **Why**: The FFT is a custom implementation (not a library) — any subtle bug (twiddle factor sign, bit-reversal order) would produce visually wrong spectrum bars with no test to catch the regression.

- [ ] 🟡 **Add tests for `computeWaveformBuckets()` edge cases**
  - **How**: The waveform downsampling (line 305-322 area) converts decoded PCM to 480 buckets. Test: (1) Empty/zero-length audio buffer → returns empty or zeroed array. (2) Very short buffer (fewer samples than buckets) → handles gracefully. (3) Single-sample buffer. (4) Normalization — max value should be 1.0. (5) All-zero input → all-zero output. If the function isn't exported, extract the bucket computation into a named function.
  - **Why**: Edge cases like very short files or silent audio could produce NaN/Infinity in the normalization step (division by max where max=0).

- [ ] 🟢 **Add tests for seek bar mouse interactions**
  - **How**: The seek bar has `onMouseDown`, `onMouseMove`, `onMouseUp` handlers for scrubbing (lines around 960-967). Test: (1) `mousedown` on seek bar starts seeking. (2) `mousemove` during seek updates tooltip position. (3) `mouseup` commits the seek to `audio.currentTime`. (4) Clicking outside the bar after mousedown doesn't crash. Mock `getBoundingClientRect()` to return known dimensions.
  - **Why**: The seek interaction is the primary way users navigate audio, but has zero test coverage — only the keyboard seek (Home/End/Arrow) is tested.

- [ ] 🟢 **Add tests for waveform mouse seek**
  - **How**: The waveform canvas has `onMouseDown` (line ~930) for click-to-seek. Test: (1) Click at 50% width → `audio.currentTime` set to 50% of duration. (2) Click at 0% → seeks to start. (3) Click at 100% → seeks to end. Mock canvas `getBoundingClientRect()`.
  - **Why**: Waveform click-to-seek is a key navigation feature with no test coverage.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 1 | WAV playback GStreamer error |
| 🟡 Important | 7 | Rust PCM decode, fetch abort, decode timeout, HiDPI canvas, volume ARIA, FFT tests, waveform bucket tests |
| 🟢 Nice-to-have | 5 | Viz fail reason, LED button semantics, focus ring, seek tests, waveform click tests |

### Implementation Order (suggested)

1. WAV playback fix (S1) — critical bug, likely a `<source>` element fix
2. Rust PCM decode (S2) — unlocks visualization for all formats
3. Volume slider ARIA (S4) — small change, big accessibility win
4. HiDPI canvas (S3) — visible quality improvement on modern displays
5. FFT unit tests (S5) — protects custom algorithm from regressions
6. PCM fetch abort + decode timeout (S1) — resilience improvements
7. Everything else — in any order
