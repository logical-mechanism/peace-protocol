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

> Key files: `fe/src/components/VideoPlayer.tsx`, `fe/src/components/LibraryContentModal.tsx`

- [x] 🔴 **MOV MIME type mapped incorrectly in LibraryContentModal**
  - **How**: In `LibraryContentModal.tsx`, the `videoMimeMap` maps `'.mov': 'video/mp4'`. Change to `'.mov': 'video/quicktime'`. MOV containers use the QuickTime MIME type; declaring `video/mp4` can cause the probe to reject a valid MOV file or skip the remux fallback when it's actually needed.
  - **Why**: MOV files may fail the native playback probe on stricter GStreamer configurations because the declared MIME type doesn't match the actual container format.

- [ ] 🟡 **Video `onError` handler discards browser error details**
  - **How**: In `VideoPlayer.tsx`, the `handleError` callback (~line 403) sets a generic `'The video could not be played.'` message. Instead, read `videoRef.current?.error?.message` and `videoRef.current?.error?.code` (the `MediaError` object) and include it: `setError(\`Playback failed: \${videoRef.current?.error?.message || 'unknown error'}\`)`. Also append the conversion hint for the current `fileExtension` so the user sees the ffmpeg suggestion without needing a separate lookup.
  - **Why**: When playback fails after a successful probe, users see a generic message with no diagnostic info and no conversion hint — unlike the probe-failure error path which includes both.

---

## 2. Transport Controls

> Key files: `fe/src/components/VideoPlayer.tsx`, `fe/src/components/AudioPlayer.tsx`

- [ ] 🟡 **Missing `S` keyboard shortcut for playback speed cycling**
  - **How**: In the keyboard handler switch block (~line 631), add a `case 'S':` / `case 's':` that calls the same speed-cycling logic as the speed button click handler (~line 466). AudioPlayer already maps `S` to speed cycling (~line 813). Also add `S` to the keyboard hints overlay (~line 974) with label "Speed".
  - **Why**: Feature parity with AudioPlayer. Keyboard power users expect consistent shortcuts across media players in the same app.

---

## 3. Performance & Memory

> Key files: `fe/src/components/VideoPlayer.tsx`

- [ ] 🟢 **PiP event listeners re-attached on every `blobUrl` change**
  - **How**: The PiP `useEffect` (~line 157) has `[blobUrl]` in its dependency array. The `enterpictureinpicture` and `leavepictureinpicture` events are attached to the `<video>` element ref, which doesn't change when `blobUrl` changes — only `video.src` changes. Change the dependency array to `[]` (mount-only). The event listeners will still fire because they're on the element, not the URL.
  - **Why**: Every remux or data change tears down and re-attaches two event listeners unnecessarily. Benign but wasteful — especially visible in DevTools event listener counts.

---

## 4. Accessibility

> Key files: `fe/src/components/VideoPlayer.tsx`

- [ ] 🟡 **PiP button missing `aria-pressed` attribute**
  - **How**: At the PiP button (~line 943), add `aria-pressed={isPip}`. The button already has a dynamic `aria-label` that changes between "Enter/Exit Picture-in-Picture", but toggle buttons should also declare their pressed state. Every other toggle button in the control bar (play, mute, loop, CC, fullscreen) already has `aria-pressed`.
  - **Why**: Screen reader users hear the label but not the toggle state. Inconsistent with all other toggle buttons in the same control bar.

- [ ] 🟡 **Seek bar missing `aria-disabled` when video not loaded**
  - **How**: At the seek bar wrapper (~line 841), add `aria-disabled={!duration || undefined}` alongside the existing visual `opacity-50 pointer-events-none` class. The seek bar already has `role="slider"` and ARIA value attributes, but doesn't communicate the disabled state to assistive technology.
  - **Why**: The seek bar looks disabled (grayed out) but screen readers still announce it as an interactive slider. Adding `aria-disabled` completes the accessibility story.

- [ ] 🟢 **`aria-live` region shows "Ready" instead of "Paused" at time 0:00**
  - **How**: In the `aria-live` status span (~line 803), the condition is `currentTime > 0 ? 'Paused' : 'Ready'`. Change to just `'Paused'` when `!isPlaying` regardless of `currentTime`. The full expression becomes: `error ? 'Error' : loading ? 'Loading' : isPlaying ? 'Playing' : 'Paused'`. The "Ready" state is only meaningful before first play, but there's no reliable way to distinguish "never played" from "paused at 0:00" without adding state.
  - **Why**: If a user pauses at 0:00 (or after a video resets on end), the screen reader announces "Ready" instead of "Paused", which misrepresents the actual playback state.

---

## 5. Test Coverage

> Key files: `fe/src/components/__tests__/VideoPlayer.test.tsx`

- [ ] 🟡 **FFmpeg remux pipeline untested**
  - **How**: Mock `@ffmpeg/ffmpeg` and `@ffmpeg/util` (or the app's remux wrapper). Test: (1) unsupported format triggers remux after probe failure, (2) progress callback updates `remuxProgress` state, (3) cancel button calls `ffmpeg.terminate()` and shows cancelled UI, (4) stall detection fires after 30s inactivity, (5) file > 2GB shows size error, (6) file > 500MB shows size warning. Use `vi.useFakeTimers()` for the stall detection timeout.
  - **Why**: The entire remux pipeline — the most complex code path in the component — has zero test coverage. Progress, cancellation, stall detection, and size guards are all untested.

- [ ] 🟡 **Fullscreen Escape isolation not tested**
  - **How**: Render VideoPlayer inside a wrapper that listens for Escape (simulating the parent modal). Toggle fullscreen via the F key or fullscreen button. Fire `keydown` with `Escape`. Assert: (1) `isFullscreen` becomes false, (2) the wrapper's Escape handler was NOT called (stopPropagation worked). Use `document.addEventListener('keydown', spy)` in the test to verify propagation was stopped.
  - **Why**: The capture-phase Escape handler is the critical mechanism preventing fullscreen exit from closing the library modal. A regression here would make fullscreen unusable.

- [ ] 🟡 **Probe mechanism not tested**
  - **How**: Test the two probe outcomes: (1) native playback supported — mock the temporary `<video>` element's `loadedmetadata` event firing, verify blob URL is set directly without remux. (2) Native playback fails — mock the `error` event on the probe element, verify remux is triggered. Mock `document.createElement('video')` to return a controllable fake element.
  - **Why**: The probe is the decision point between native play and remux. If the probe logic regresses, videos either unnecessarily remux (slow) or fail to play (broken).

- [ ] 🟢 **PiP button rendering and state not tested**
  - **How**: Test: (1) PiP button renders when `document.pictureInPictureEnabled` is true, (2) doesn't render when false, (3) clicking calls `video.requestPictureInPicture()`, (4) `enterpictureinpicture` event updates `isPip` state and button label. Mock `document.pictureInPictureEnabled` and the video element's PiP methods.
  - **Why**: PiP support is conditional on browser capability. The rendering guard and state tracking via events are both untested.

- [ ] 🟢 **Blob URL revocation on unmount not tested**
  - **How**: Spy on `URL.revokeObjectURL`. Render VideoPlayer with data, verify blob URL is created. Unmount the component. Assert `revokeObjectURL` was called with the created URL. Also test: render with data A, then re-render with data B — verify the first blob URL is revoked before creating the second.
  - **Why**: Blob URL leaks are invisible to users but accumulate memory over time. The cleanup logic is correct but untested — a refactor could silently break it.

- [ ] 🟢 **Subtitle edge cases not tested**
  - **How**: Test: (1) empty subtitle `Uint8Array` (length 0) — should not crash, (2) SRT with malformed timestamps like `99:99:99,999` — should pass through without breaking VTT conversion, (3) SRT with HTML tags (`<b>text</b>`) — should be preserved (VTT supports basic HTML). These are boundary cases for the SRT→VTT converter.
  - **Why**: The converter handles common cases but edge cases could cause silent failures or crashes that only surface with user-provided subtitle files.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 1 | MOV MIME type bug |
| 🟡 Important | 7 | onError details, speed shortcut, PiP aria-pressed, seek bar aria-disabled, remux tests, fullscreen Escape test, probe test |
| 🟢 Nice-to-have | 5 | PiP listener deps, aria-live Ready/Paused, PiP tests, blob URL tests, subtitle edge case tests |

### Implementation Order (suggested)
1. MOV MIME type fix (1-line change, actual bug)
2. PiP `aria-pressed` attribute (1 attribute, consistency fix)
3. Seek bar `aria-disabled` (1 attribute, accessibility)
4. Video `onError` with browser error details (improved diagnostics)
5. `S` keyboard shortcut for speed (feature parity with AudioPlayer)
6. `aria-live` Ready→Paused fix (accessibility edge case)
7. PiP event listener dependency array (minor perf)
8. Test coverage items (remux, fullscreen Escape, probe, PiP, blob URL, subtitles)
