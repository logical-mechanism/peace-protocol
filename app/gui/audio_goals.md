# AudioPlayer Goals & Improvements

A comprehensive backlog for making the AudioPlayer exceptional. Pick any item, implement it, check it off, and submit a PR.

**Architecture context:**
- Native `<audio>` element for playback (routes through GStreamer via WebKitGTK)
- Separate PCM decode via `OfflineAudioContext` for FFT visualization only
- Custom Cooley-Tukey radix-2 FFT (1024 samples, 32 bars)
- Waveform overview (480 buckets, peak-detection downsampling via Rust symphonia)
- WebKitGTK Web Audio API is broken (no AnalyserNode, no AudioWorklet)
- Styling uses Winamp-themed CSS variables defined in `fe/src/index.css`

Each item:
- `🔴` Critical — bugs, broken features
- `🟡` Important — UX improvements, user-requested features
- `🟢` Nice-to-have — polish, optimization

---

## 1. Loading & Decode Performance

> Key files: `fe/src/components/AudioPlayer.tsx` (lines 269-315), `src-tauri/src/commands/media.rs` (lines 848-1013), `fe/src/services/libraryService.ts`

- [x] 🔴 **Waveform decode blocks on full file read — slow for large files**
  - **How**: `decode_waveform_sync()` in `media.rs` (line 888) reads ALL samples into a `Vec<f32>` (up to 50M samples = 200MB) before bucketing. For a 10-minute FLAC file this means reading ~50MB of compressed audio, decoding every packet, and accumulating ~100MB of f32 samples — all before the user sees any waveform. Refactor to a streaming approach: compute bucket boundaries from total duration (available from symphonia's track info or first-pass seek), then accumulate per-bucket running averages as packets decode. This avoids storing the full sample vector. Alternatively, use symphonia's seek capability to sample N evenly-spaced chunks (e.g., 480 × 1024-sample windows) instead of decoding the entire file.
  - **Why**: Users report audio loading takes a long time. The Rust waveform decode is the first thing that runs after `canplay` (line 327) and must complete before the waveform appears. Streaming or sampling would show waveform data in seconds instead of tens of seconds for large files.

- [ ] 🔴 **FFT decode re-fetches the entire audio file over HTTP**
  - **How**: After the Rust waveform decode completes, the FFT phase (line 290-298) does `fetch(src)` to download the entire file again via the Axum media server, then passes it to `OfflineAudioContext.decodeAudioData()`. This doubles the I/O for every audio file. Two options: (A) Move FFT sample extraction to Rust — `decode_waveform_sync()` already decodes every packet, so extract a representative PCM chunk (e.g., first 30s, 44.1kHz mono) alongside the waveform and return it as `fft_samples: Vec<f32>` in `WaveformResult`. The frontend can then use this directly for the FFT without any fetch. (B) If keeping OfflineAudioContext, cache the `arrayBuffer` from the first fetch and reuse it, or pipe PCM from Rust.
  - **Why**: The second HTTP fetch doubles load time. For a 50MB file the user waits for symphonia decode + 50MB HTTP fetch + OfflineAudioContext decode — three serial operations when one Rust decode pass could provide both waveform and FFT data.

- [ ] 🟡 **Show waveform progressively as Rust decode streams**
  - **How**: Currently the frontend waits for the entire `decodeAudioWaveform` invoke to resolve (line 275) before drawing anything. If the Rust command is refactored to stream buckets (via Tauri events or chunked responses), the frontend could draw partial waveforms incrementally. Simpler alternative: split the decode into two passes — a fast low-resolution pass (48 buckets from seeking to evenly-spaced positions) that resolves in <1s, followed by a full-resolution pass (480 buckets) that refines the waveform.
  - **Why**: Users see "Loading audio..." with a spinner for the entire decode duration. A fast initial waveform gives immediate visual feedback while the full decode runs in the background.

- [ ] 🟡 **Cache waveform results to avoid re-decoding on re-open**
  - **How**: The Rust `decode_audio_waveform` command decodes the full file every time the AudioPlayer mounts. Add a disk cache: after computing the waveform, write the 480-float result to `media/content/{category}/{tokenName}/waveform.bin` (1,920 bytes). On subsequent opens, check for the cache file first and return it immediately. The `WaveformResult` already contains `sample_rate`, `duration_secs`, `channels` — include those in the cache header. Invalidation: the audio file is immutable (content-addressed), so no staleness concern.
  - **Why**: Re-opening the same audio file triggers the full symphonia decode again. A 1.9KB cache file eliminates all decode latency on repeat listens.

- [x] 🟡 **`SampleBuffer` allocated per packet in Rust decode loop**
  - **How**: In `decode_waveform_sync()` (line 923), `SampleBuffer::<f32>::new()` is created inside the packet loop. While symphonia may reuse internal buffers, the `new()` call does allocate. Move the `SampleBuffer` outside the loop and reuse it across packets (symphonia's `copy_interleaved_ref` handles varying frame counts). This reduces allocation pressure for files with many small packets.
  - **Why**: For a 5-minute MP3 (≈11,500 packets), this creates 11,500 `SampleBuffer` allocations. Reusing one buffer reduces GC pressure and speeds up the decode loop.

---

## 2. Visualization & FFT

> Key files: `fe/src/components/AudioPlayer.tsx` (lines 466-601), `fe/src/components/audioPlayerUtils.ts`

- [ ] 🟢 **FFT bars silent when OfflineAudioContext fails but waveform works**
  - **How**: When FFT decode fails (line 311-313, `vizFailReason = 'fft-decode'`), the FFT canvas is completely blank during playback — only the waveform shows. Consider a fallback: if Rust-side FFT samples are available (see item 1.2), use those. If not, show a subtle "no FFT" indicator in the canvas area instead of blank space, or hide the FFT canvas entirely and expand the waveform to fill both canvas areas.
  - **Why**: A blank FFT canvas above an active waveform looks like a rendering bug to users unfamiliar with the two-phase decode architecture.

- [ ] 🟢 **Gradient object created every frame in drawFrame()**
  - **How**: `ctx.createLinearGradient()` is called at line 479 inside `drawFrame()`, which runs 24 times/sec. The gradient parameters never change (same canvas height, same colors). Cache the gradient in a ref and only recreate it when theme colors change (detected by the MutationObserver at line 226). Update the ref in the color-reading effect (lines 196-230).
  - **Why**: Minor optimization — `createLinearGradient` is cheap but unnecessary 24x/sec when the gradient is invariant.

---

## 3. Playback & Stability

> Key files: `fe/src/components/AudioPlayer.tsx` (lines 317-416)

- [ ] 🟢 **Play failure silently sets error string but doesn't render it**
  - **How**: At line 685, `audio.play()` rejection calls `setError('Failed to play audio.')` but the error UI (lines 963-987) only renders when `error` is truthy AND `!isReady` (checked at line 958: `{error && !isReady && ...}`). If `isReady` is already `true` (which it is after `canplay`), the play error is invisible. Fix: either render play errors separately (e.g., as a toast or inline message below the transport controls), or change the guard to `{error && ...}`.
  - **Why**: If GStreamer refuses to play (e.g., pipeline error after initial canplay), the user clicks play and nothing happens with no feedback.

---

## 4. Metadata & Display

> Key files: `fe/src/components/AudioPlayer.tsx` (lines 6-16, 86-115, 1022-1048)

- [ ] 🟡 **Metadata parsing removed — no title/artist/album display**
  - **How**: The `AudioMetadata` interface (lines 6-16), `MetadataAlbumArt` component (lines 18-35), and `MarqueeText` (lines 86-115) are all implemented but `metadata` is always `null` (set at line 152, never populated). When the player switched from `Uint8Array` to URL-based streaming, the `music-metadata` parsing was removed. Fix: parse metadata on the Rust side using symphonia's metadata API (symphonia already reads ID3v2, Vorbis comments, etc. during `format.metadata()`). Add fields to `WaveformResult`: `title`, `artist`, `album`, `track_number`, `year`, `bitrate`, `sample_rate`, `channels`, and optionally `picture` (album art bytes + MIME type). The frontend already has the display code — just wire up the data from the invoke response.
  - **Why**: The Winamp-style player shows only "Veiled Audio" as the title. With metadata, it could show the actual song name, artist, and album art — significantly better UX for a music player.

- [ ] 🟢 **No "remaining time" toggle like VideoPlayer**
  - **How**: AudioPlayer has `showRemaining` state (line 1107) and the LED time toggle button. VideoPlayer has a `T` keyboard shortcut for toggling time display (line 501 in VideoPlayer.tsx). AudioPlayer is missing the `T` shortcut. Add `case 'T': case 't': setShowRemaining(prev => !prev); break;` to the `handleKeyDown` (around line 800) and add it to the keyboard hints display.
  - **Why**: Feature parity with VideoPlayer; discoverable via keyboard hints overlay.

---

## 5. Accessibility

> Key files: `fe/src/components/AudioPlayer.tsx` (lines 1105-1281)

- [ ] 🟢 **LED time toggle could use `role="switch"` semantics**
  - **How**: The LED time display button (line 1107) uses `aria-label` describing the toggle state but doesn't use `role="switch" aria-checked={showRemaining}`. Adding these attributes lets screen readers announce it as "Showing remaining time, switch, on/off" rather than reading the full descriptive label. The button at line 1109 already has `type="button"`.
  - **Why**: More semantic and concise for screen reader users; consistent with toggle button patterns elsewhere in the app.

- [ ] 🟢 **Error messages not linked to controls via `aria-describedby`**
  - **How**: The error message container (line 970) is rendered independently. When an error occurs and the user tabs to the play button, there's no `aria-describedby` linking the button to the error message. Add `id="audio-error-msg"` to the error text container and `aria-describedby={error ? 'audio-error-msg' : undefined}` to the play button.
  - **Why**: Screen reader users tabbing to the play button after an error won't hear the error message unless they navigate to it separately.

---

## 6. Testing

> Key files: `fe/src/components/__tests__/AudioPlayer.test.tsx`

- [ ] 🟡 **No tests for visualization failure reason display**
  - **How**: The component shows different messages based on `vizFailReason` ('decode', 'fft-size', 'fft-decode') at lines 1094-1102. Add tests that: (1) trigger Rust waveform decode failure → verify "Visualization unavailable for this format" appears. (2) Mock the HEAD response to return >100MB content-length → verify "FFT bars unavailable (file too large)". (3) Mock OfflineAudioContext to throw → verify "FFT bars unavailable for this format". These states are user-visible but untested.
  - **Why**: Visualization failure messages are the primary feedback when decode pipelines fail; regressions here would leave users confused.

- [ ] 🟡 **No tests for stalled event → buffering state**
  - **How**: The `onStalled` handler (line 350) checks `audio.readyState < 3` before setting buffering. Test: (1) fire `stalled` event with `readyState = 2` → verify "Buffering" status shown. (2) fire `stalled` with `readyState = 4` → verify buffering NOT set. Currently only `waiting`/`playing` transitions are tested.
  - **Why**: The `readyState` guard is a subtle correctness check that could regress without test coverage.

- [ ] 🟢 **No tests for play() failure error display**
  - **How**: Mock `audio.play()` to reject with an error. Verify `setError('Failed to play audio.')` is called. Currently (as noted in section 3), this error may not render due to the `!isReady` guard — the test would also document this bug.
  - **Why**: Documents the play-error rendering gap and prevents regressions once fixed.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 2 | Waveform full-file decode, FFT double-fetch |
| 🟡 Important | 5 | Progressive waveform, waveform cache, SampleBuffer reuse, metadata parsing, viz failure tests |
| 🟢 Nice-to-have | 7 | FFT blank fallback, gradient caching, play error rendering, remaining time shortcut, switch role, aria-describedby, play failure tests |

### Implementation Order (suggested)

1. **Waveform cache** (S1) — quickest win, eliminates re-decode on repeat opens
2. **FFT samples from Rust** (S1) — eliminates the double HTTP fetch, biggest perf improvement
3. **Streaming/sampling waveform decode** (S1) — reduces first-open decode time dramatically
4. **Metadata from symphonia** (S4) — enhances the Winamp experience with real song info
5. **SampleBuffer reuse** (S1) — low-effort decode speedup
6. **Progressive waveform display** (S1) — better perceived performance
7. **Play error rendering fix** (S3) — small bug fix
8. **Everything else** — in any order
