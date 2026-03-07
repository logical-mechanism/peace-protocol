# VideoPlayer Goals & Improvements

A comprehensive backlog for making the VideoPlayer exceptional. Pick any item, implement it, check it off, and submit a PR.

**Architecture context:**
- Native `<video>` element for playback (routes through GStreamer via WebKitGTK)
- FFmpeg.wasm remux fallback for unsupported containers (MKV, AVI -> MP4)
- Format probe mechanism: temporary `<video>` element with 8s timeout
- SRT/VTT subtitle support with automatic format conversion
- Fullscreen overlay mode with capture-phase Escape handling
- Styling uses Tailwind utilities + CSS variables defined in `fe/src/index.css`

Each item:
- `🔴` Critical -- bugs, broken features
- `🟡` Important -- UX improvements, user-requested features
- `🟢` Nice-to-have -- polish, optimization

---

## 1. Playback & Stability

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟡 **Zero-length video files fail silently**
  - **How**: After the probe resolves and `onLoadedMetadata` fires, check `video.duration`. If `duration === 0` or `!isFinite(duration)`, call `setError('This file contains no playable video data.')` and `setLoading(false)` instead of proceeding. Add the check at ~line 397 inside the `onLoadedMetadata` handler.
  - **Why**: Zero-length or metadata-only files leave the player in a limbo state — seek bar disabled, play button does nothing, no error message. Users think the app is broken.

- [x] 🟡 **No timeout on `ffmpeg.load()` — WASM init can hang indefinitely**
  - **How**: Wrap the `ffmpeg.load()` call (~line 64) in a `Promise.race` with a 15-second timeout. If the timeout fires, reject with `'FFmpeg failed to initialize. Try restarting the app.'` and set `loading` to false. The caller at ~line 288 already catches and displays errors.
  - **Why**: If `ffmpeg-core.wasm` is corrupt or the JS worker deadlocks, the user sees an infinite "Converting..." spinner with no way to recover except closing the modal.

- [x] 🟢 **Probe `<video>` element never removed from memory**
  - **How**: In the `probeNativePlayback` function (~line 225), the temporary video element is created via `document.createElement('video')` but never explicitly released. Add `probe.src = ''; probe.load();` in the `cleanup()` function (~line 241) to release any internal GStreamer resources the element acquired during the probe.
  - **Why**: While GC will eventually collect the orphaned element, calling `load()` after clearing `src` immediately releases the media pipeline resources. Matters when probing multiple files in sequence.

---

## 2. Transport Controls

> Key files: `fe/src/components/VideoPlayer.tsx`, `fe/src/components/AudioPlayer.tsx`

- [x] 🟢 **No time format toggle (elapsed vs remaining)**
  - **How**: Add a `showRemaining` boolean state (default `false`). On the time display (~line 841), when `showRemaining` is true, show `-formatTime(duration - displayTime) / formatTime(duration)` instead of `formatTime(displayTime) / formatTime(duration)`. Make the time display clickable to toggle. Add `T` keyboard shortcut in the key handler (~line 631). AudioPlayer implements this pattern at ~line 185 with `showRemaining` state.
  - **Why**: Standard video player feature. Lets users see how much time is left without mental math.

- [x] 🟢 **No double-click on video to toggle fullscreen**
  - **How**: Add an `onDoubleClick` handler to the video element (~line 1000) that calls the same `toggleFullscreen` logic used by the F key and fullscreen button (~line 577). Use `e.preventDefault()` to avoid text selection. Must not interfere with single-click play/pause — use a 200ms `setTimeout` pattern: single-click sets a timer, double-click clears it and toggles fullscreen instead.
  - **Why**: Double-click-to-fullscreen is the universal convention in desktop video players (VLC, mpv, YouTube). Users try it instinctively.

---

## 3. Performance & Memory

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟡 **Redundant `Uint8Array` copy during remux doubles memory usage**
  - **How**: At ~line 290, `new Uint8Array(data)` creates a copy of the entire file before passing to FFmpeg. If `data` is already a `Uint8Array`, pass it directly: `const input = data instanceof Uint8Array ? data : new Uint8Array(data);`. The `remuxToMp4` function at ~line 46 accepts `Uint8Array`, so no signature change needed.
  - **Why**: For a 500MB video, this copy creates ~1GB peak memory (original + copy) before FFmpeg even starts. Eliminating the copy reduces peak memory by the file size. Especially important near the 2GB hard limit.

- [x] 🟢 **Probe blob creates another unnecessary copy**
  - **How**: At ~line 227, `new Blob([new Uint8Array(data)])` copies the data again for the probe. Since the probe only needs to check if the format plays (8s timeout, no seeking), consider reusing the same `Uint8Array` reference: `new Blob([data])` works if `data` is already a `Uint8Array` or `ArrayBuffer`. Check the type first and avoid the wrapper copy.
  - **Why**: During the probe phase, three copies of the file exist momentarily (prop, Uint8Array wrapper, Blob internals). For large files this is wasteful, though the probe blob is short-lived.

---

## 4. Accessibility

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟡 **No `aria-live` announcement for volume changes via keyboard**
  - **How**: Add an `aria-live="polite"` region (similar to the playback state region at ~line 810) that announces volume changes. When the `ArrowUp`/`ArrowDown` keyboard handler adjusts volume (~line 649), update the region text to `Volume ${Math.round(newVolume * 100)}%`. Use a separate `sr-only` span so it doesn't interfere with the playback state announcements. AudioPlayer has this pattern.
  - **Why**: Keyboard users adjusting volume with arrow keys get no audio feedback (volume changes are silent by nature for small increments) and no screen reader feedback. They can't tell if the shortcut worked.

- [x] 🟡 **No `aria-live` announcement for speed changes via keyboard**
  - **How**: When the `S` key cycles speed (~line 684), update the same (or a second) `aria-live` region with `Speed ${newSpeed}x`. The speed button's visual text already updates, but screen readers don't re-read button text on content change — they need a live region.
  - **Why**: Keyboard users pressing S have no confirmation the speed actually changed unless they navigate to the speed button and re-read it.

- [x] 🟢 **Caption button disappears when no subtitles — no disabled state for discoverability**
  - **How**: At ~line 913, the CC button is conditionally rendered with `{subtitleUrl && (...)}`. Change to always render the button, but add `disabled` + `opacity-50 cursor-not-allowed` when `!subtitleUrl`. Set `aria-disabled={!subtitleUrl || undefined}` and skip the toggle handler when disabled.
  - **Why**: Users don't know captions are a feature unless they happen to open a file that has subtitles. A grayed-out CC button signals the feature exists and is available for files with subtitle data.

---

## 5. Test Coverage

> Key files: `fe/src/components/__tests__/VideoPlayer.test.tsx`

- [x] 🟡 **Fullscreen auto-hide timer not tested**
  - **How**: Test the 3-second inactivity timer: (1) enter fullscreen via F key, (2) advance timers by 3000ms with `vi.advanceTimersByTime(3000)`, (3) verify controls are hidden (check for `opacity-0` or `translate-y-full` class on control bar). Also test that mouse movement resets the timer: move mouse, advance 2s, verify still visible, advance 2s more, verify hidden.
  - **Why**: The auto-hide timer is the core fullscreen UX mechanism. A regression would leave controls permanently visible or permanently hidden.

- [x] 🟡 **Loop-on-ended behavior not tested**
  - **How**: (1) Enable loop via L key, (2) fire `ended` event on video element, (3) verify `currentTime` is NOT reset to 0 (loop lets the video element handle replay). Contrast with non-loop: fire `ended`, verify `currentTime` IS reset to 0 and `isPlaying` becomes false. The `onEnded` handler at ~line 1035 has the branching logic.
  - **Why**: The loop/non-loop branch in `onEnded` is the only code path that distinguishes these behaviors. Testing both branches prevents regressions.

- [ ] 🟢 **Volume boundary clamping at 0 and 1.0 not tested**
  - **How**: (1) Set volume to 0.05 via slider, press ArrowDown — verify volume clamps to 0, not -0.05. (2) Set volume to 0.95, press ArrowUp — verify volume clamps to 1.0, not 1.05. The clamping logic is at ~line 649: `Math.min(1, Math.max(0, ...))`.
  - **Why**: Boundary values are classic regression points. If clamping breaks, volume could go negative (silent with no recovery) or above 1.0 (browser may clip or distort).

- [ ] 🟢 **Seek bar mouse click interaction not tested**
  - **How**: Get the seek bar element (`role="slider"`), fire `mousedown` with a `clientX` at 50% of the bar width. Verify `video.currentTime` is set to ~50% of duration. Use `getBoundingClientRect` mock to control bar dimensions. The handler is `handleSeekMouseDown` at ~line 418.
  - **Why**: Seek-by-click is the primary mouse interaction. Currently only keyboard seek (Home/End/Arrows) is tested.

- [ ] 🟢 **Caption track mode synchronization not tested**
  - **How**: (1) Render with subtitle data, (2) verify `<track>` element has `default={true}` (showCaptions starts true), (3) press C to toggle captions off, (4) verify `video.textTracks[0].mode === 'hidden'`. Mock `video.textTracks` as a list with one track object. The toggle logic is at ~line 548.
  - **Why**: The caption toggle sets `textTracks[0].mode` directly — if the track index assumption breaks or mode assignment fails, captions silently stop working.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 0 | — |
| 🟡 Important | 7 | zero-length files, FFmpeg timeout, remux memory copy, volume aria-live, speed aria-live, fullscreen timer test, loop-on-ended test |
| 🟢 Nice-to-have | 8 | probe element cleanup, time format toggle, double-click fullscreen, probe blob copy, disabled CC button, volume clamping test, seek click test, caption track test |

### Implementation Order (suggested)
1. Zero-length video error (quick guard, fixes silent failure)
2. FFmpeg load timeout (Promise.race wrapper, prevents hangs)
3. Volume/speed `aria-live` announcements (accessibility compliance)
4. Remux Uint8Array copy elimination (memory optimization)
5. Fullscreen auto-hide timer test (protects core UX)
6. Loop-on-ended test (protects playback logic)
7. Remaining test coverage items (volume clamping, seek click, caption track)
8. Double-click fullscreen + time format toggle (UX polish)
9. Disabled CC button (discoverability)
10. Probe element cleanup + probe blob copy (minor memory)
