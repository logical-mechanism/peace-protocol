---
name: update-gui-goals
description: Regenerate app/gui/audio_goals.md with a fresh comprehensive analysis of the AudioPlayer component
---

# Update Audio Goals

Delete `audio_goals.md` and regenerate it from scratch with a comprehensive analysis of every possible improvement across the AudioPlayer component. Do not carry over completed items or skipped items from the previous round — this is a fresh audit against the current state of the code.

**Design intent:** The AudioPlayer is a Winamp clone. All suggestions must respect the retro aesthetic — segmented FFT bars, beveled transport buttons, LED/LCD time display, groove-inset panels, pixelated canvas rendering. Do not suggest "modern" patterns (rounded waveforms, minimal flat controls, material design) that conflict with the Winamp identity. New features should feel like they belong in Winamp 2.x.

## Process

1. **Read CLAUDE.md** to understand the current architecture, conventions, and gotchas
2. **Read the current audio_goals.md** (if it exists) to understand what was previously identified — but do NOT preserve it. The output is a clean slate. Note any items marked `[s]` (skipped) — these were intentionally declined and must NOT be re-suggested in the new goals.
3. **Launch parallel Explore subagents** (all "very thorough") to audit the AudioPlayer:

   **Agent 1 — Playback, Seeking & Transport:**
   - Read the full `AudioPlayer.tsx` component line by line
   - Read the `VideoPlayer.tsx` component for feature parity comparison
   - Read `LibraryContentModal.tsx` for integration point (how data is passed, how the player is mounted)
   - Read `fe/src/config/categories.ts` for supported audio formats
   - Identify gaps using this checklist:
     - **Playback reliability**: Does the `<audio>` element handle all lifecycle events? Check for `stalled`, `waiting`, `suspend`, `abort`, `emptied`. Are there race conditions between Blob creation, GStreamer pipeline init, and `decodeAudioData`?
     - **Seeking UX**: Can users seek via waveform click/drag? Is there a visible playback position indicator? Does the seek bar have adequate click target size? Is there a hover time preview? Does seeking work during pause?
     - **Transport completeness**: Play, pause, stop, skip, loop, speed, mute, volume — is anything missing? Are keyboard shortcuts comprehensive and discoverable? Does the VideoPlayer have transport features the AudioPlayer lacks?
     - **Playback state sync**: Is `vizTimeRef` always in sync with `audio.currentTime`? Are there edge cases where they diverge (seeking while paused, speed changes, loop boundary)?
     - **Format handling**: Are all 7 supported formats (mp3, wav, flac, ogg, aac, m4a, opus) handled correctly? Are MIME types accurate? Are error messages helpful when a format fails?
     - **Edge cases**: What happens at track end with loop off? With loop on? What about zero-length files? Corrupted files? Files with no audio channel?

   **Agent 2 — Visualization & Performance:**
   - Read the FFT implementation (`fftInPlace`, `drawFrame`, constants)
   - Read the waveform implementation (`drawWaveform`, `computeWaveformSummary`)
   - Read the animation loop and RAF management
   - Read `fe/src/index.css` for Winamp CSS variables, gradient colors, slider styles, animations
   - Identify gaps using this checklist:
     - **FFT accuracy**: Is the Hann window applied correctly? Is the dB normalization range appropriate (-70dB floor, -20dB ceiling)? Does the bin-to-bar mapping miss high frequencies? Are there artifacts from the smoothing factor?
     - **Waveform quality**: Is 200 buckets sufficient resolution? Does peak detection miss transients? Are played/unplayed colors distinguishable in both themes? Is the position indicator visible?
     - **Canvas performance**: Are gradients cached or recreated every frame? Is `getComputedStyle()` called in the render loop? Are there unnecessary allocations per frame? Could the waveform be drawn less frequently (only on time change)?
     - **RAF loop efficiency**: Does the loop stop when paused and decay complete? Does it respect `document.hidden`? Is the 24 FPS throttle smooth or jittery? Is there a memory leak from leaked RAF callbacks?
     - **Theme support**: Do all Winamp CSS variables have light-theme overrides? Do gradient colors work in both themes? Is the canvas background correct in light mode?
     - **Memory management**: Is the decoded AudioBuffer released when the component unmounts? Is the Blob URL revoked? Are Float32Array allocations reused or recreated?

   **Agent 3 — UX, Accessibility & Display:**
   - Read all UI rendering sections of `AudioPlayer.tsx` (the JSX return block)
   - Read the metadata parsing and display logic
   - Read the error state rendering
   - Read the test file at `fe/src/components/__tests__/AudioPlayer.test.ts`
   - Identify gaps using this checklist:
     - **Accessibility**: Does the seek bar have `role="slider"` + ARIA attributes? Are playback state changes announced via `aria-live`? Do toggle buttons use `aria-pressed`? Are all interactive elements keyboard-reachable? Is tab order logical?
     - **Loading states**: Is there a loading indicator? Does it show during initial decode? During format conversion? Is there a skeleton or spinner?
     - **Error states**: Are error messages actionable? Do they suggest next steps (export, convert)? Is the error UI visually distinct? Are there error states that are silently swallowed?
     - **Metadata display**: Are long titles/artists truncated gracefully? Is album art displayed correctly? Is there a hover state to reveal full text? Are time formats correct for long audio (H:MM:SS)?
     - **Visual polish**: Are transitions smooth? Do buttons have proper hover/active/focus states? Is spacing consistent with the design system? Do animations feel responsive?
     - **Test coverage**: What utility functions are tested? What's NOT tested? Are edge cases covered (NaN, Infinity, empty arrays, zero-length audio)?

4. **Synthesize findings** from all agents into a single `audio_goals.md` file. Cross-reference between agents to eliminate duplicates. If an area has no genuine issues, do not pad it with filler items.

## Output Format

Write `audio_goals.md` with this structure:

```markdown
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

## N. Section Name

> Key files: `relevant/file/paths`

- [ ] 🟢 **Feature or improvement title**
  - **How**: Concrete implementation approach with file paths, function names, patterns to follow. Should be detailed enough that a developer can start coding without further research.
  - **Why**: 1-2 sentences explaining the user-facing or developer-facing value.

---

## Priority Summary

| Priority | Count | Items |
|----------|-------|-------|
| 🔴 Critical | N | ... |
| 🟡 Important | N | ... |
| 🟢 Nice-to-have | N | ... |

### Implementation Order (suggested)
[ordered list of recommended implementation sequence]
```

## Section Categories

Organize items into these sections (merge or split as findings dictate). If a section has no genuine issues, omit it entirely.

1. Playback & Stability
2. Seeking & Navigation
3. Visualization
4. Transport Controls
5. Performance
6. Accessibility
7. Metadata & Display

## Quality Standards

- **Every item must reference specific files** — no vague "improve the player" items
- **How sections must be actionable** — describe the approach concretely enough that a developer can start implementing without ambiguity
- **No duplicates** — each improvement appears exactly once in the most relevant section
- **Verify before suggesting** — read the actual code to confirm something is missing before adding it as a goal. Do not guess based on file names alone. If the component already handles a state/feature, do not suggest adding it
- **Specific over generic** — "Add `aria-pressed={isLooping}` to the loop button at line 783" is better than "Improve accessibility". Name the file, the line, the prop
- **User-observable value** — every item should describe a change that a user would notice. Internal refactors must explain the observable benefit (smoother playback, fewer glitches, better errors)

## Rules

- Delete the existing `audio_goals.md` before writing — this is always a fresh analysis
- Do NOT carry over checked items (`[x]`) from the previous `audio_goals.md`
- Do NOT carry over skipped items (`[s]`) from the previous `audio_goals.md` — these were intentionally declined and must not reappear
- Do NOT add items that are already implemented in the codebase — verify by reading the actual code
- Do NOT pad sections — if a section has no real issues, omit it or include only 1-2 genuine items. Quality over quantity
- Match the terse, reference-style tone of CLAUDE.md
- Include every genuine finding — no artificial item count target. Let the findings emerge naturally from the current state of the code
- Run the Explore agents in parallel to minimize wall-clock time
- After writing, count the total items with `grep -c '^\- \[ \]'` and report the count
- Report per-priority breakdown: `grep -c '🔴'`, `grep -c '🟡'`, `grep -c '🟢'`
