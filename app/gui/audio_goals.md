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

## 1. Visualization

> Key files: `fe/src/components/AudioPlayer.tsx`, `fe/src/index.css`

- [x] 🟡 **Add peak hold indicators to FFT bars**
  - **How**: Classic Winamp 2.x signature: a single bright segment sits at each bar's peak and slowly descends. Add a `peakBarsRef = useRef(new Float32Array(BAR_COUNT))` alongside `prevBarsRef`. In `drawFrame()` (line 511), after computing `prevBarsRef.current[i]`, update the peak: `if (prevBarsRef.current[i] > peakBarsRef.current[i]) peakBarsRef.current[i] = prevBarsRef.current[i]; else peakBarsRef.current[i] *= 0.97;`. After drawing each bar's segments (line 519-525), draw the peak dot: `const peakY = height - peakBarsRef.current[i] * height; ctx.fillStyle = gradEnd; ctx.fillRect(x, peakY, barWidth, segH);`. Reset peaks to 0 alongside `prevBarsRef` in the data-loading effect (line 270). In the decay branch (line 529-546), decay peaks too: `peakBarsRef.current[i] *= 0.97;` and draw them the same way.
  - **Why**: Peak hold dots are the single most recognizable Winamp visual element. Without them, the spectrum analyzer looks generic. Every Winamp clone is defined by these floating peak indicators.

- [x] 🟢 **Respect `prefers-reduced-motion` in canvas animation loop**
  - **How**: In the RAF effect (line 563), read the media query once: `const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;`. If true, skip `startLoop()` at line 603, draw a single static frame of the waveform via `drawWaveformRef.current?.(0)`, and return. The `<audio>` element plays normally — only the canvas FFT bars and waveform animation are suppressed. Users who toggle the OS setting mid-session won't see the change until remount, which is acceptable.
  - **Why**: The existing `@media (prefers-reduced-motion)` rule in index.css (line 688) disables CSS animations but doesn't affect the JS-driven canvas loop. Users who set reduced motion for vestibular comfort still get 24fps animated bars.

---

## 2. Transport Controls

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🟡 **Add `L` keyboard shortcut for loop toggle**
  - **How**: In the global `handleKeyDown` switch statement (line 692-728), add a case after the `m`/`M` case: `case 'l': case 'L': handleToggleLoop(); break;`. Update the key hints overlay (line 1020-1025) to add a new row: `<span><kbd>L</kbd> Loop</span>`. Update the loop button's `title` to include `(L)`: line 1153 → `title={isLooping ? 'Repeat: On (L)' : 'Repeat: Off (L)'}`.
  - **Why**: Every other toggle has a keyboard shortcut (Space for play, M for mute) but loop requires a mouse click. Keyboard-only users can't toggle repeat mode.

- [x] 🟡 **Add `S` keyboard shortcut for speed cycling**
  - **How**: In the same switch statement, add: `case 's': case 'S': handleSpeedChange(); break;`. Update key hints to add `<span><kbd>S</kbd> Speed</span>`. Update the speed button's `title` at line 1166 to append `(S)`. Add `handleSpeedChange` to the `useEffect` dependency array at line 733.
  - **Why**: Same reasoning as loop — speed cycling is mouse-only. Keyboard users (especially visually impaired) benefit from being able to change speed without finding the small button.

---

## 3. Metadata & Display

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🟢 **Show bitrate and sample rate in LED display area**
  - **How**: The `music-metadata` result (line 284) includes `result.format.bitrate` (number, bps) and `result.format.sampleRate` (number, Hz). Extend the `AudioMetadata` interface (line 4) with `bitrate?: number; sampleRate?: number;`. Populate them at line 288: `bitrate: result.format.bitrate, sampleRate: result.format.sampleRate`. Display in the LED row (line 1042-1063) — add a small info section between the time display and status text: `{metadata?.bitrate && <span className="text-[10px] font-mono text-[var(--winamp-led)] opacity-40">{Math.round(metadata.bitrate / 1000)}kbps</span>}` and similarly for sample rate `{Math.round(sampleRate / 1000)}kHz`. Use the `winamp-led-text` class at reduced opacity for the retro look.
  - **Why**: Winamp 2.x always showed kbps and kHz in the main display. This is expected metadata in a retro audio player and helps users verify file quality at a glance.

- [x] 🟢 **Add mono/stereo indicator**
  - **How**: `music-metadata` provides `result.format.numberOfChannels`. Add `channels?: number` to `AudioMetadata`. Display next to bitrate: `{metadata?.channels === 1 ? 'MONO' : metadata?.channels === 2 ? 'STEREO' : null}` using the same `winamp-led-text` class at reduced opacity. Alternatively, use two small LED dots (like Winamp's stereo indicator) — a `<span>` with `bg-[var(--winamp-led)]` when stereo, `opacity-20` when mono.
  - **Why**: Classic Winamp had a prominent MONO/STEREO indicator in the main display. Fits the retro aesthetic and provides useful technical info.

---

## 4. Playback & Stability

> Key files: `fe/src/components/AudioPlayer.tsx`

- [x] 🟢 **Guard against division by zero in drawFrame waveform progress**
  - **How**: At line 552, `const progressRatio = vizTimeRef.current / duration` can produce `Infinity` if `duration` is 0 but `vizTimeRef.current` is non-zero (theoretically possible with zero-length or corrupt files). Add `if (!isFinite(progressRatio)) return;` after the calculation, before the pixel comparison at line 554. The `duration > 0` guard at line 550 should prevent this, but the Infinity check is a cheap safety net.
  - **Why**: Prevents a corrupt or zero-length file from causing the waveform to render with an Infinity progress ratio, which would produce NaN pixel values in `drawWaveform`.

---

## 5. Testing

> Key files: `fe/src/components/__tests__/AudioPlayer.test.tsx`

- [ ] 🟡 **Add LED time toggle interaction test**
  - **How**: The LED display at lines 1043-1059 has `role="button"` and `tabIndex={0}` with `onClick` and `onKeyDown` handlers. Add tests in a new `describe('AudioPlayer component → LED time toggle')` block: (1) Click the LED display and verify text changes from total to remaining format (look for the `\u2212` minus sign prefix). (2) Press Enter on the focused LED display and verify the same toggle. (3) Press Space on the LED display. Follow the existing keyboard interaction test patterns (lines ~678-730 in the test file). The LED display can be found via `role="button"` and `title="Click to toggle remaining time"`.
  - **Why**: The time toggle is an interactive element with keyboard support but has zero test coverage. A regression breaking the toggle or keyboard handler would go undetected.

- [ ] 🟢 **Verify speed button cycles `audio.playbackRate`**
  - **How**: In the existing `describe('AudioPlayer component → button interactions')` block, add a test that: clicks the speed button (find by `aria-label` matching `/playback speed/i`), then asserts the mock audio element's `playbackRate` was set to the next speed value (1.25 after first click from default 1.0). The mock audio element at line ~74 of the test file needs a `playbackRate` property added if not present.
  - **Why**: The test file verifies the speed button renders "1x" and changes label on click, but never verifies the audio element's `playbackRate` is actually updated. `handleSpeedChange()` (line 893) sets both state and `audioRef.current.playbackRate` — only the state side is implicitly tested.

- [ ] 🟢 **Verify loop toggle syncs `audio.loop`**
  - **How**: Similar to speed: in the button interactions block, click the loop button (find by `aria-label` matching `/repeat/i`), then assert `audio.loop` was set to `true`. Click again, assert `audio.loop` is `false`. The `handleToggleLoop` (line 881-887) and the sync effect (line 615-617) both set `audio.loop` — test should verify the element property changes.
  - **Why**: `aria-pressed` is tested but the actual audio element property sync isn't. A regression in `handleToggleLoop` that updates state but forgets `audioRef.current.loop = next` (line 884) would be invisible.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | 0 | — |
| 🟡 Important | 4 | Peak hold indicators, L key loop shortcut, S key speed shortcut, LED toggle test |
| 🟢 Nice-to-have | 6 | prefers-reduced-motion, bitrate/samplerate display, mono/stereo indicator, division-by-zero guard, speed playbackRate test, loop sync test |

### Implementation Order (suggested)

1. Peak hold indicators (§1) — highest visual impact, signature Winamp feature
2. L key loop shortcut (§2) — one-line addition in switch statement
3. S key speed shortcut (§2) — same pattern as loop shortcut
4. LED toggle test (§5) — covers untested interactive element
5. Everything else — in any order
