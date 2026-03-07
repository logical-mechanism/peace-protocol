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

- [x] 🟡 **Missing `preload` attribute on video element**
  - **How**: Add `preload="metadata"` to the `<video>` element at line 882. AudioPlayer sets `preload="auto"`; `"metadata"` is more appropriate for video since it avoids buffering the full file before user action while still ensuring duration/dimensions are available early.
  - **Why**: Without a preload hint, WebKitGTK may delay metadata loading (duration, dimensions) until the user interacts, which can cause the seek bar to show `00:00 / 00:00` briefly after the blob URL is set.

- [x] 🟡 **FFmpeg terminate has no timeout -- can hang forever**
  - **How**: Wrap `ffmpeg.terminate()` at line 76 with `Promise.race([ffmpeg.terminate(), new Promise((_, rej) => setTimeout(() => rej(new Error('FFmpeg worker hung')), 10_000))])`. Same pattern for the cleanup call at line 280. If the timeout fires, log a warning -- the worker will be garbage-collected when the page navigates.
  - **Why**: If the FFmpeg WASM worker crashes or becomes unresponsive, `terminate()` never resolves, leaving the UI stuck in the remuxing state forever.

- [x] 🟢 **No stall detection during remux**
  - **How**: Track the last time `onProgress` fired in a ref. Start a `setInterval(10_000)` alongside the remux call (line 240). If progress hasn't changed in 30s, set an error: "Conversion appears stuck. The file may be too complex for in-app conversion." Clear the interval in the `finally` block.
  - **Why**: If FFmpeg stops making progress on a complex file, the user sees a frozen progress bar with no indication of failure.

---

## 2. Format Support & Remuxing

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟡 **FFmpeg WASM fetched from CDN on every remux**
  - **How**: Bundle `@ffmpeg/core@0.12.6` UMD files (`ffmpeg-core.js` + `ffmpeg-core.wasm`) as static assets in `fe/public/ffmpeg/`. Replace the CDN `baseURL` at line 50 with a relative path. Use `toBlobURL('/ffmpeg/ffmpeg-core.js', ...)` which resolves locally via Vite/Tauri. Remove the retry loop (lines 52-67) since local loads don't fail transiently.
  - **Why**: Remux fails completely if unpkg.com is unreachable. Desktop apps should work offline. Also eliminates 2-3s CDN latency on first remux.

- [x] 🟡 **No cancel button during remux**
  - **How**: In the remuxing UI (lines 668-689), add a "Cancel" button that calls `ffmpegTerminateRef.current?.()`, sets `cancelled = true` via a ref, and resets remuxing state. Show "Conversion cancelled" as an info message (not error). Offer the "Save As" fallback.
  - **Why**: Large file remux can take minutes. Users have no way to abort except closing the modal, which also loses their place in the library.

- [x] 🟢 **FFmpeg virtual filesystem not cleaned before terminate**
  - **How**: After `ffmpeg.readFile('output.mp4')` at line 73, add `await ffmpeg.deleteFile(inputName); await ffmpeg.deleteFile('output.mp4');` before `ffmpeg.terminate()`. This releases the input + output copies from WASM memory immediately.
  - **Why**: During remux of a 500MB file, FFmpeg holds both input and output in its virtual FS (up to 1GB). Deleting before terminate frees that memory sooner, reducing peak usage.

---

## 3. Performance & Memory

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟢 **Fullscreen control bar uses `transition-all` instead of specific properties**
  - **How**: At line 980, replace `transition-all duration-300` with `transition-[opacity,transform] duration-300`. The `translate-y-full` toggle only needs opacity and transform animated -- `transition-all` may animate padding, border, etc. causing unnecessary layout recalculation.
  - **Why**: On lower-end systems, animating all properties on a complex control bar can cause jank during the fullscreen hide/show transition.

---

## 4. Accessibility

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟡 **Error state not marked as `role="alert"`**
  - **How**: At line 623, add `role="alert"` to the outer `<div>`: `<div role="alert" className="p-6 bg-[var(--bg-secondary)] ...">`. This ensures screen readers announce the error immediately when it appears.
  - **Why**: When playback fails, sighted users see the error UI but screen reader users receive no announcement. The existing `aria-live` region (line 699) only covers playback states, not the early-return error view.

- [x] 🟡 **Remux progress bar missing ARIA progressbar role**
  - **How**: At line 674, add to the progress track: `role="progressbar" aria-label="Conversion progress" aria-valuenow={Math.round(remuxProgress * 100)} aria-valuemin={0} aria-valuemax={100}`. Move these attributes from the visual bar to the outer container div.
  - **Why**: Screen readers cannot announce conversion progress. Users who rely on assistive technology have no indication of remux completion percentage.

- [x] 🟡 **No focus trap in fullscreen overlay**
  - **How**: Import and use the existing `useFocusTrap` hook from `fe/src/hooks/useFocusTrap.ts` on the fullscreen overlay container (line 970). The hook already handles Tab wrapping and focus restoration -- pass a ref to the fullscreen `<div>` and enable it when `isFullscreen` is true.
  - **Why**: In fullscreen mode, Tab key can move focus to elements behind the overlay (hidden page content). The app already has `useFocusTrap` for modals -- VideoPlayer fullscreen should use the same pattern.

- [x] 🟢 **PiP button doesn't announce current state**
  - **How**: At line 836, change the static `aria-label` to dynamic: `aria-label={document.pictureInPictureElement === videoRef.current ? 'Exit Picture-in-Picture' : 'Enter Picture-in-Picture'}`. Track PiP state with `enterpictureinpicture`/`leavepictureinpicture` events on the video element to avoid reading `document.pictureInPictureElement` synchronously.
  - **Why**: Screen reader users hear "Toggle Picture-in-Picture" regardless of whether PiP is active or not, making the current state ambiguous.

- [x] 🟢 **Volume slider missing ARIA value attributes**
  - **How**: At line 785, add: `aria-valuenow={isMuted ? 0 : Math.round(volume * 100)}`, `aria-valuetext={isMuted ? 'Muted' : `${Math.round(volume * 100)}%`}`. Native `<input type="range">` already has implicit min/max from the `min`/`max` attributes.
  - **Why**: Screen readers announce the raw decimal (e.g., "0.75") instead of a human-readable percentage. The `aria-valuetext` override provides "75%" or "Muted".

---

## 5. Subtitle Support

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🟡 **Subtitle decoding assumes UTF-8 with no fallback**
  - **How**: At line 149, wrap in a try-catch: try `new TextDecoder('utf-8', { fatal: true }).decode(subtitleData)`. If it throws, fall back to `new TextDecoder('iso-8859-1').decode(subtitleData)`. ISO-8859-1 never fails (every byte maps to a character) and is the most common non-UTF-8 encoding for SRT files.
  - **Why**: SRT files from older tools or non-English sources are often encoded in Latin-1 or Windows-1252. The current `new TextDecoder().decode()` silently produces replacement characters instead of readable text.

- [x] 🟢 **SRT timestamp regex too strict for edge-case formats**
  - **How**: At line 153, relax the regex from `(\d{2}:\d{2}:\d{2}),(\d{3})` to `(\d{1,2}:\d{2}:\d{2}),(\d{1,3})`. This handles single-digit hours (e.g., `1:30:45,000`) and variable-precision milliseconds (e.g., `00:00:01,5`) which some SRT generators produce.
  - **Why**: Strictly-formatted SRT files work fine, but files from tools like Aegisub or hand-edited SRTs may use single-digit hours. These timestamps pass through unconverted, causing VTT parsing failures.

---

## 6. Display & UX

> Key files: `fe/src/components/VideoPlayer.tsx`

- [x] 🔴 **Seek thumb uses hardcoded `bg-white/60` -- invisible in light theme**
  - **How**: At line 765, replace `bg-white/60` with `bg-[var(--bg-elevated)]`. The elevated background variable has proper contrast in both dark and light themes. Keep the `border-2 border-[var(--accent)]/60` which already uses a CSS variable.
  - **Why**: In light theme, a white/60% opacity thumb on a light background is nearly invisible. Users can't see the seek position at a glance.

- [x] 🟡 **Key hints overlay shown once and cannot be recalled**
  - **How**: Add `?` or `H` to the keyboard handler (line 565 switch block) to toggle `showKeyHints`. Change the auto-dismiss from one-shot (line 559 `hasShownHints`) to always showing on `?`/`H` press with a 3s auto-dismiss. This lets users recall shortcuts after the initial display fades.
  - **Why**: Users who miss the initial 3s hint display have no way to see keyboard shortcuts again without reloading the component.

- [ ] 🟡 **Seek bar has no disabled visual state when video not loaded**
  - **How**: At line 736, add conditional opacity: `className={`flex-1 py-2 cursor-pointer relative min-w-[60px] ${!duration ? 'opacity-50 pointer-events-none' : ''}`}`. This grays out and disables the seek bar before metadata loads.
  - **Why**: The seek bar looks interactive even when duration is 0 (no video loaded). Clicking it does nothing but confuses users.

- [ ] 🟢 **Fullscreen button has no visual highlight when active**
  - **How**: At line 849, add conditional accent color like the CC and Loop buttons: `className={`${btnClass} ${isFullscreen ? 'text-[var(--accent)]' : ''}`}`. The CC button (line 802) and Loop button (line 814) already follow this pattern.
  - **Why**: Inconsistent with other toggle buttons. CC and Loop highlight in accent color when active, but Fullscreen doesn't, even though it's also a toggle with `aria-pressed`.

---

## 7. Test Coverage

> Key files: `fe/src/components/__tests__/VideoPlayer.test.tsx`

- [ ] 🟡 **Keyboard shortcuts not tested**
  - **How**: Add tests dispatching `keydown` events for Space (play/pause), ArrowLeft/Right (seek), ArrowUp/Down (volume), F (fullscreen), M (mute), L (loop), C (captions). Verify each shortcut calls the correct handler or updates state. Use `fireEvent.keyDown(document, { key: 'Space' })` pattern. Verify shortcuts are ignored when `<input>` is focused.
  - **Why**: 12 keyboard shortcuts with guard logic (line 555-556) are untested. A regression in the key handler could silently break all keyboard controls.

- [ ] 🟡 **Error state rendering not tested**
  - **How**: Mock the probe to fail (simulate `<video>` error event) and FFmpeg to throw. Verify: error message renders, format diagnostic info shows correct extension/MIME, conversion hint appears for known formats, "Save As" button renders when `onExport` is provided and text fallback when it's not.
  - **Why**: The error UI (lines 621-664) has multiple conditional branches (conversion hints, Save As vs text fallback) that are all untested.

- [ ] 🟡 **Seek bar interaction not tested**
  - **How**: Render VideoPlayer with mock data, simulate `loadedmetadata` to set duration, then test: `mousedown` on seek bar updates `currentTime`, `mousemove` during drag continues seeking, `mouseup` ends drag. Test keyboard: ArrowLeft/Right on focused seek bar, Home/End. Verify ARIA `aria-valuenow` updates.
  - **Why**: The drag-to-seek implementation (lines 360-390) and keyboard seek (lines 457-484) are complex interaction handlers with no test coverage.

- [ ] 🟡 **Playback state transitions not tested**
  - **How**: Test that `onPlay` sets `isPlaying` true (play button changes to pause icon), `onPause` sets false, `onEnded` resets to start (currentTime 0, isPlaying false). Test `onWaiting` shows loading spinner, `onPlaying` dismisses it. Test `onStalled` with 5s timer and error escalation.
  - **Why**: The stalled handler (lines 932-943) has a 5-second timer with error escalation that could regress. The ended handler (lines 918-925) has loop-conditional logic.

- [ ] 🟢 **Volume and speed controls not tested**
  - **How**: Test volume slider `onChange` updates volume state and video element. Test mute toggle. Test speed button cycles through `SPEED_OPTIONS` array and wraps around (2x -> 0.5x). Verify video element's `playbackRate` is updated.
  - **Why**: Speed cycling logic (lines 410-415) wraps around via modulo -- an off-by-one would break the cycle silently.

- [ ] 🟢 **Edge cases not tested (NaN duration, zero-length data, large files)**
  - **How**: Test `formatTime` with `NaN`, `Infinity`, `-1`, `0` (lines 29-34). Test component with `data` of length 0. Test data > 2GB triggers error (line 226). Test 500MB-2GB shows size warning (line 231). Mock `Blob` and `URL.createObjectURL` for these.
  - **Why**: Guard logic at system boundaries (size limits, NaN handling) is where regressions cause the most confusing user-facing bugs.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 1 | Seek thumb invisible in light theme |
| 🟡 Important | 12 | preload attr, FFmpeg timeout, local WASM, cancel remux, error alert role, progress ARIA, focus trap, subtitle encoding, key hints recall, seek bar disabled state, keyboard tests, error tests, seek tests, state tests |
| 🟢 Nice-to-have | 11 | Remux stall detection, FFmpeg FS cleanup, transition-all perf, PiP state label, volume ARIA, SRT regex, fullscreen highlight, volume/speed tests, edge case tests |

### Implementation Order (suggested)
1. Seek thumb light-theme fix (1-line CSS variable swap, visible bug)
2. Error state `role="alert"` (1 attribute, accessibility)
3. Remux progress ARIA (3 attributes, accessibility)
4. Fullscreen focus trap (reuse existing hook)
5. `preload="metadata"` on video (1 attribute)
6. Seek bar disabled state (conditional class)
7. Key hints recall via `?`/`H` key
8. FFmpeg terminate timeout (Promise.race wrapper)
9. Subtitle UTF-8 fallback (try-catch + ISO-8859-1)
10. Bundle FFmpeg WASM locally (eliminate CDN dependency)
11. Cancel button during remux (UI + terminate logic)
12. Fullscreen button highlight (match CC/Loop pattern)
13. Test coverage items (keyboard, error, seek, state, edge cases)
14. Remaining nice-to-haves in any order
