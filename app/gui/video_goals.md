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

- [x] 🔴 **FFmpeg worker not terminated on unmount during remux**
  - **How**: In the cleanup function (line ~183), after setting `cancelled = true`, call `ffmpeg.terminate()` on the in-flight FFmpeg instance. Requires lifting the `ffmpeg` reference out of `remuxToMp4` into a ref (`ffmpegRef`) so cleanup can access it. Pattern: `ffmpegRef.current?.terminate()` in the effect cleanup.
  - **Why**: If a user closes the modal while remuxing, the FFmpeg WASM worker keeps running in the background, consuming CPU and memory until it finishes or the app is closed.

- [x] 🟡 **Missing `waiting` and `playing` event handlers**
  - **How**: Add `onWaiting={() => setLoading(true)}` and `onPlaying={() => setLoading(false)}` to the `<video>` element (after line ~584). AudioPlayer handles these at lines 375-376.
  - **Why**: Without `waiting`, the spinner doesn't appear during mid-playback buffering. Without `playing`, the spinner doesn't dismiss after a stall resolves. Users see either no feedback or a stuck spinner.

- [x] 🟡 **Stalled handler too aggressive -- sets error instead of recoverable state**
  - **How**: Change the `onStalled` handler (line ~585) to show a warning message instead of a permanent error. Use a timeout (e.g., 5s) before escalating to error. If `playing` fires before the timeout, clear the warning. AudioPlayer pattern (lines 377-381) is more conservative.
  - **Why**: Network hiccups or slow GStreamer pipeline startup trigger `stalled`, but playback often resumes. Current behavior shows a permanent error for transient issues.

- [x] 🟡 **NaN duration not guarded with `isFinite()`**
  - **How**: In `handleLoadedMetadata` (line ~209) and `onDurationChange` (line ~581), wrap with `isFinite()`: `setDuration(isFinite(d) ? d : 0)`. AudioPlayer does this at line 310.
  - **Why**: WebKitGTK/GStreamer can report NaN at loadedmetadata time. NaN duration breaks the seek bar calculation and time display.

- [x] 🟢 **No CDN retry for FFmpeg WASM load**
  - **How**: Wrap the `toBlobURL` calls in `remuxToMp4` (lines 35-36) with a retry loop (2 retries, 2s delay). Show distinct error message on CDN failure vs. format failure: "Could not download video converter. Check your internet connection."
  - **Why**: A single network blip during WASM download (2 fetches: core.js + core.wasm) causes the entire remux to fail with a generic error message that doesn't mention connectivity.

---

## 2. Seeking & Navigation

> Key files: `fe/src/components/VideoPlayer.tsx`, `fe/src/components/AudioPlayer.tsx` (reference)

- [x] 🟡 **No drag-to-seek on progress bar (click-only)**
  - **How**: Add `onMouseDown` to seek bar div (line ~465) that registers `mousemove` and `mouseup` listeners on `document`, updating `video.currentTime` on each move. Follow AudioPlayer's pattern (lines 822-851) with `handleMouseMove` + `handleMouseUp`. Clean up listeners on mouseup.
  - **Why**: Desktop users expect click-and-drag seeking. Click-only requires repeated precise clicks to find a position.

- [x] 🟡 **No visible thumb/handle on seek bar**
  - **How**: Add a circular thumb element positioned at the current progress point. Use a `::after` pseudo-element or a child div with `rounded-full w-3 h-3 bg-[var(--accent)]` absolutely positioned at the progress edge. AudioPlayer has this at line 1184.
  - **Why**: Without a thumb, users can't see where the playhead is at a glance -- they must read the time display.

- [x] 🟢 **Seek bar click target too small (6px)**
  - **How**: Add `py-2` padding to the seek bar wrapper (line ~465) to expand the click target to ~22px while keeping the visual bar at `h-1.5`. AudioPlayer does this at lines 1174-1175.
  - **Why**: 6px is hard to click precisely, especially on high-DPI displays.

- [x] 🟢 **No hover time preview on seek bar**
  - **How**: Add `onMouseMove` to the seek bar that calculates position ratio and displays a tooltip with `formatTime(ratio * duration)`. Position the tooltip above the cursor. Follow AudioPlayer's `showSeekTooltip`/`hideSeekTooltip` pattern (lines 918-957).
  - **Why**: Users can't preview where a click will seek to without the tooltip.

---

## 3. Transport Controls

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟢 **No loop toggle**
  - **How**: Add `loop` state, a loop button (recycle arrow icon) next to the speed button, and set `video.loop = loop` via ref. Add `L` keyboard shortcut (following AudioPlayer's pattern at lines 807-810). Add `aria-pressed={loop}` to the button.
  - **Why**: Users watching tutorials or short clips want to loop playback without manually restarting.

- [x] 🟢 **No end-of-video visual feedback**
  - **How**: In the `onEnded` handler (line ~584), add `setIsPlaying(false)` (already present) plus seek to 0: `videoRef.current.currentTime = 0`. This matches AudioPlayer's `handleStop` behavior (line 713).
  - **Why**: When video ends, it freezes on the last frame. Users may not notice it finished vs. paused. Resetting to start makes replay obvious.

---

## 4. Format Support & Remuxing

> Key files: `fe/src/components/VideoPlayer.tsx`, `fe/src/components/AudioPlayer.tsx` (reference for hints)

- [ ] 🟡 **Generic error messages -- no format-specific conversion hints**
  - **How**: Add a `getConversionHint(ext)` function (like AudioPlayer lines 65-76) mapping extensions to FFmpeg CLI commands. Display the hint in the error UI below the generic message. Example: `.mkv` -> "Try converting with: `ffmpeg -i file.mkv -c copy output.mp4`".
  - **Why**: Users with unsupported formats get "This video format could not be converted" with no actionable guidance. AudioPlayer already provides format-specific hints.

- [ ] 🟡 **CDN failure indistinguishable from format failure**
  - **How**: In `remuxToMp4`, catch errors from `toBlobURL` (lines 35-36) separately from `ffmpeg.exec` errors (line 42). Set distinct error messages: "Video converter could not be loaded (check internet)" vs. "This format could not be converted".
  - **Why**: Users blame the format when the real issue is network connectivity. Different errors need different user actions.

- [ ] 🟢 **No validation of remux output before playback**
  - **How**: After `ffmpeg.readFile('output.mp4')` (line ~43), check that `mp4Bytes.length > 0`. If empty, throw an error with a message about corrupt input rather than loading an empty blob.
  - **Why**: FFmpeg can silently produce empty output for certain corrupt inputs. Loading an empty blob into `<video>` causes a confusing delayed error.

---

## 5. Performance & Memory

> Key files: `fe/src/components/VideoPlayer.tsx`

- [ ] 🔴 **FFmpeg WASM Blob URLs never revoked (memory leak)**
  - **How**: `toBlobURL()` at lines 35-36 creates 2 Blob URLs per remux that are never revoked. Store the URLs returned by `toBlobURL` and call `URL.revokeObjectURL()` on each after `ffmpeg.load()` completes (the WASM is already loaded into memory at that point). Add cleanup after line 37.
  - **Why**: Each remux operation permanently leaks 2 Blob URLs. Users who open multiple unsupported videos accumulate leaked URLs for the session lifetime.

- [ ] 🟡 **Old blobUrl not revoked when data prop changes**
  - **How**: In the main effect cleanup (line ~182), revoke `blobUrl` state value in addition to the local `currentUrl`. Use a ref to track the active blob URL so cleanup can always revoke it regardless of which path (probe or remux) created it.
  - **Why**: Switching between videos (e.g., opening video1.mkv then video2.mkv in the library) leaks the previous Blob URL.

- [ ] 🟡 **No file size warning before remux**
  - **How**: Before calling `remuxToMp4` (line ~163), check `data.length`. If > 500MB, show a warning: "Large file ({size}MB) -- conversion may use significant memory." If > 2GB, skip remux and show error suggesting export. Use `formatBytes` from `fe/src/utils/formatBytes.ts`.
  - **Why**: Remux peak memory is ~3-4x input size. A 1GB video needs ~3-4GB RAM. No warning means the app silently freezes or crashes.

- [ ] 🔴 **Key hints overlay uses hardcoded colors -- unreadable in light theme**
  - **How**: At line ~558, replace `bg-black/80 text-white` with `bg-[var(--bg-elevated)]/90 text-[var(--text-primary)]`. Replace `bg-white/20` on kbd elements (line ~560) with `bg-[var(--bg-tertiary)]`.
  - **Why**: In light theme, white text on a near-white background is invisible. This is a visible bug for all light-theme users.

---

## 6. Accessibility

> Key files: `fe/src/components/VideoPlayer.tsx`, `fe/src/components/AudioPlayer.tsx` (reference)

- [ ] 🟡 **Seek bar missing ARIA slider role and attributes**
  - **How**: Add to the seek bar div (line ~465): `role="slider"`, `tabIndex={0}`, `aria-label="Seek"`, `aria-valuemin={0}`, `aria-valuemax={Math.round(duration)}`, `aria-valuenow={Math.round(currentTime)}`, `aria-valuetext={formatTime(currentTime)}`. Add `onKeyDown` for ArrowLeft/Right seeking. AudioPlayer implements this at line 1160.
  - **Why**: Screen readers cannot interact with or announce the seek bar position. Keyboard-only users cannot tab to or operate the seek bar.

- [ ] 🟡 **No aria-live status region for playback state**
  - **How**: Add a visually-hidden `<div aria-live="polite" aria-atomic="true">` that displays current state text ("Playing", "Paused", "Loading", "Error"). AudioPlayer has this at line 1147.
  - **Why**: Screen reader users receive no announcement when playback starts, pauses, errors, or completes.

- [ ] 🟡 **Toggle buttons missing `aria-pressed`**
  - **How**: Add `aria-pressed={isPlaying}` to play/pause (line ~433), `aria-pressed={isMuted}` to mute (line ~479), `aria-pressed={showCaptions}` to CC (line ~509), `aria-pressed={isFullscreen}` to fullscreen (line ~542). AudioPlayer does this at lines 1207, 1242, 1267.
  - **Why**: Screen readers cannot convey toggle state to users. "Mute" button doesn't indicate whether audio is currently muted.

- [ ] 🟢 **No visible focus ring on buttons**
  - **How**: Add `focus-visible:shadow-[var(--focus-ring)]` to the `btnClass` definition (line ~427). AudioPlayer uses this pattern.
  - **Why**: Keyboard users cannot see which control is focused when tabbing through the control bar.

---

## 7. Subtitle Support

> Key files: `fe/src/components/VideoPlayer.tsx`

- [ ] 🟡 **SRT-to-VTT conversion doesn't handle cue IDs**
  - **How**: In the SRT->VTT conversion (line ~97), after adding the WEBVTT header, strip standalone numeric cue IDs. Add a regex pass: `.replace(/^\d+\s*$/gm, '')` to remove lines that are just numbers (SRT cue identifiers). Clean up resulting double blank lines with `.replace(/\n{3,}/g, '\n\n')`.
  - **Why**: SRT files have numeric cue IDs (1, 2, 3...) before each timestamp. VTT treats standalone numbers as orphan cues, which can cause parsing failures or display glitches.

- [ ] 🟢 **Hard-coded subtitle language "en"**
  - **How**: At line ~597, change `srcLang="en"` to derive language from subtitle filename if available, or default to `"und"` (undetermined) per BCP 47. The `label` could similarly be "Subtitles" for unknown language.
  - **Why**: Non-English subtitles are mislabeled, which affects browser subtitle styling and screen reader announcements.

---

## 8. Display & UX

> Key files: `fe/src/components/VideoPlayer.tsx`, `fe/src/index.css`

- [ ] 🟡 **No loading indicator during 8-second format probe**
  - **How**: Set `setLoading(true)` at the start of the probe (before line ~125). The spinner already renders when `loading && blobUrl` is truthy (line ~635), but `blobUrl` is null during probe. Either show a spinner unconditionally when `loading` is true, or add a "Checking format..." text state.
  - **Why**: Users see nothing for up to 8 seconds while the probe determines format support. Feels like the app froze.

- [ ] 🟡 **Seek bar position jank on WebKitGTK (~4Hz updates)**
  - **How**: Add time interpolation between `onTimeUpdate` events using `requestAnimationFrame`. Store last known time + timestamp in a ref, interpolate linearly at 60fps. AudioPlayer solves this with `vizTimeRef` interpolation (lines 209, 501-506). Apply interpolated time to seek bar width and time display.
  - **Why**: WebKitGTK fires `timeupdate` at ~4Hz (every 250ms). Without interpolation, the seek bar visibly jumps rather than sliding smoothly.

- [ ] 🟢 **No fullscreen enter/exit transition**
  - **How**: Add `transition-opacity duration-200` to the fullscreen overlay (line ~615). Use a brief opacity fade (0->1 on enter, 1->0 on exit with a short delay before unmounting).
  - **Why**: Fullscreen toggle is an abrupt snap. A subtle fade makes the mode switch feel intentional rather than jarring.

- [ ] 🟢 **No control auto-hide in fullscreen**
  - **How**: In fullscreen mode, track mouse movement. Show controls on move, hide after 3s of inactivity via `setTimeout`. Add `cursor: none` when controls are hidden. Reset timer on any mouse/keyboard activity.
  - **Why**: In fullscreen, the always-visible control bar covers video content. Professional video players hide controls after inactivity.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 3 | FFmpeg worker leak on unmount, FFmpeg Blob URL leak, light-theme key hints |
| 🟡 Important | 15 | Buffering events, stall handling, NaN duration, drag-to-seek, seek thumb, error hints, CDN vs format errors, blobUrl leak, file size warning, ARIA slider, aria-live, aria-pressed, SRT cue IDs, probe loading, seek jank |
| 🟢 Nice-to-have | 10 | CDN retry, click target, hover preview, loop, end-of-video reset, remux validation, focus ring, subtitle lang, fullscreen transition, control auto-hide |

### Implementation Order (suggested)
1. Light-theme key hints (5 min fix, visible bug)
2. FFmpeg Blob URL leak (small fix, prevents memory accumulation)
3. FFmpeg worker termination on unmount (ref + cleanup, prevents background CPU waste)
4. `waiting`/`playing` events (2 lines, fixes buffering spinner)
5. NaN duration guard (1 line, prevents seek bar breakage)
6. Stalled handler improvement (small refactor, fewer false errors)
7. Old blobUrl revocation on data change (ref tracking, prevents leak)
8. ARIA slider on seek bar (accessibility, moderate effort)
9. `aria-pressed` on toggles (5 attributes, easy)
10. `aria-live` status region (small addition)
11. Probe loading indicator (UX feedback)
12. Drag-to-seek (moderate effort, big UX win)
13. Seek bar thumb (CSS addition)
14. Format-specific error hints (new function + UI)
15. CDN vs format error distinction (error path split)
16. SRT cue ID stripping (regex addition)
17. File size warning (conditional check)
18. Seek bar time interpolation (rAF loop, moderate)
19. Remaining nice-to-haves in any order
